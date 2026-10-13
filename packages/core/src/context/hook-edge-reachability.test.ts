import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text } from '../fields/index.js'
import { createTestContext, type TestContext } from '../testing/context.js'
import { createPlanRecorder } from '../testing/plans.js'
import { DatabaseError } from '../lib/database-errors.js'

const BOOT = 120_000
const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }
const ABSENT_ID = '00000000-0000-7000-8000-000000000000'

type EdgeHook = (args: {
  inputData: Record<string, unknown>
  resolvedData: Record<string, unknown>
}) => Record<string, unknown>

interface Hidden {
  id: string
  visible: string
}

function schemaConfig(hook: EdgeHook, fieldHook?: EdgeHook): OpenSaasConfig {
  return {
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      Author: {
        fields: { name: text(), posts: relationship({ ref: 'Post.author', many: true }) },
        access: { operation: { ...OPEN, query: () => ({ name: { equals: 'visible' } }) } },
      },
      Post: {
        fields: {
          title: text(),
          author: relationship({
            ref: 'Author.posts',
            ...(fieldHook
              ? {
                  hooks: {
                    resolveInput: ({ resolvedData }) =>
                      fieldHook({ inputData: {}, resolvedData }).author,
                  },
                }
              : {}),
          }),
        },
        access: { operation: OPEN },
        hooks: {
          resolveInput: async ({ inputData, resolvedData }) => hook({ inputData, resolvedData }),
        },
      },
    },
  }
}

async function storedAuthors(url: string): Promise<Array<string | null>> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    const result = await client.query('select "authorId" from "public"."Post" order by "title"')
    return result.rows.map((row: { authorId: string | null }) => row.authorId)
  } finally {
    await client.end()
  }
}

describe('a hook-introduced edge is trusted; a caller-supplied one is gated', () => {
  let target = ''
  let reachableId = ''
  const state: { mode: string } = { mode: 'connect' }
  const recorder = createPlanRecorder()
  let harness: TestContext

  const hook: EdgeHook = ({ resolvedData }) => {
    switch (state.mode) {
      case 'connect':
        return { ...resolvedData, author: { connect: { id: target } } }
      case 'column':
        return { ...resolvedData, authorId: target }
      case 'overwrite': {
        const { author: _author, ...rest } = resolvedData
        return { ...rest, author: { connect: { id: reachableId } } }
      }
      case 'mutate':
        resolvedData.author = { connect: { id: target } }
        return resolvedData
      case 'absent':
        return { ...resolvedData, author: { connect: { id: ABSENT_ID } } }
      default:
        return resolvedData
    }
  }

  beforeAll(async () => {
    harness = await createTestContext(
      schemaConfig(hook),
      { userId: 'u1' },
      { middleware: [recorder.middleware] },
    )
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.truncate()
    state.mode = 'none'
    const sudo = harness.context.sudo()
    const hidden = await sudo.db.Author.create({ data: { name: 'hidden' } })
    const visible = await sudo.db.Author.create({ data: { name: 'visible' } })
    target = String((hidden as Hidden | null)?.id)
    reachableId = String((visible as Hidden | null)?.id)
  })

  test(
    'a hook connect to a row the session cannot query persists the key',
    async () => {
      state.mode = 'connect'
      const created = await harness.context.db.Post.create({ data: { title: 'a' } })
      expect(created).not.toBeNull()
      expect(await storedAuthors(harness.url)).toEqual([target])
    },
    BOOT,
  )

  test(
    'the foreign-key column spelling from a hook is trusted too',
    async () => {
      state.mode = 'column'
      expect(await harness.context.db.Post.create({ data: { title: 'a' } })).not.toBeNull()
      expect(await storedAuthors(harness.url)).toEqual([target])
    },
    BOOT,
  )

  test(
    'update: a hook connect is trusted',
    async () => {
      const post = await harness.context.db.Post.create({ data: { title: 'a' } })
      state.mode = 'connect'
      const updated = await harness.context.db.Post.update({
        where: { id: String(post?.id) },
        data: { title: 'b' },
      })
      expect(updated).not.toBeNull()
      expect(await storedAuthors(harness.url)).toEqual([target])
    },
    BOOT,
  )

  test(
    'a caller connect to an unreachable row returns null, even if a hook overwrites it',
    async () => {
      state.mode = 'overwrite'
      const result = await harness.context.db.Post.create({
        data: { title: 'a', author: { connect: { id: target } } },
      })
      expect(result).toBeNull()
      expect(await storedAuthors(harness.url)).toEqual([])
    },
    BOOT,
  )

  test(
    'a caller connect to a reachable row a hook passes through is checked once',
    async () => {
      state.mode = 'none'
      recorder.clear()
      const result = await harness.context.db.Post.create({
        data: { title: 'a', author: { connect: { id: reachableId } } },
      })
      expect(result).not.toBeNull()
      expect(
        recorder.plans.map((plan) => plan.kind).filter((kind) => kind === 'select'),
      ).toHaveLength(2)
    },
    BOOT,
  )

  test(
    'a hook mutating resolvedData in place is still a hook edge',
    async () => {
      state.mode = 'mutate'
      expect(await harness.context.db.Post.create({ data: { title: 'a' } })).not.toBeNull()
      expect(await storedAuthors(harness.url)).toEqual([target])
    },
    BOOT,
  )

  test(
    'a hook connecting to a non-existent id rejects with a DatabaseError',
    async () => {
      state.mode = 'absent'
      await expect(harness.context.db.Post.create({ data: { title: 'a' } })).rejects.toBeInstanceOf(
        DatabaseError,
      )
    },
    BOOT,
  )
})

describe('a field-level resolveInput introducing the edge', () => {
  let harness: TestContext
  let target = ''

  beforeAll(async () => {
    harness = await createTestContext(
      schemaConfig(
        ({ resolvedData }) => ({ ...resolvedData, author: null }),
        ({ resolvedData }) => ({ ...resolvedData, author: { connect: { id: target } } }),
      ),
      { userId: 'u1' },
    )
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  test(
    'is trusted',
    async () => {
      const hidden = await harness.context.sudo().db.Author.create({ data: { name: 'hidden' } })
      target = String((hidden as Hidden | null)?.id)
      expect(await harness.context.db.Post.create({ data: { title: 'a' } })).not.toBeNull()
      expect(await storedAuthors(harness.url)).toEqual([target])
    },
    BOOT,
  )
})
