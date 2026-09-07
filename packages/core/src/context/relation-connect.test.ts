import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import type { AccessControlledDB, Session } from '../access/index.js'
import type { PrismaFilter } from '../access/types.js'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text } from '../fields/index.js'
import { createTestContext, ormClientFor, type TestContext } from '../testing/context.js'
import { createPlanRecorder } from '../testing/plans.js'
import type { StackContext } from '../types/context.js'
import { getContext } from './index.js'
import { NonOwningRelationInputError } from './relationship-input.js'

/**
 * #1153: `connect` on the foreign-key-owning field, and `null` as its
 * counterpart (ADR-0050).
 *
 * Every assertion here is a row read straight off the driver or a value the
 * terminal returned — except the plan test, where the statements the terminal
 * built are themselves the subject.
 */

const BOOT = 120_000

const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

/**
 * `Post.author` owns the foreign key; `Author.posts` is the inverse the other
 * side keys. The pair is what the ownership rule is stated over, so both ends
 * are declared rather than only the one under test.
 */
function schemaConfig(authorQuery: () => boolean | PrismaFilter = () => true): OpenSaasConfig {
  return {
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      Author: {
        fields: { name: text(), posts: relationship({ ref: 'Post.author', many: true }) },
        access: { operation: { ...OPEN, query: authorQuery } },
      },
      Post: {
        fields: { title: text(), author: relationship({ ref: 'Author.posts' }) },
        access: { operation: OPEN },
      },
    },
  }
}

/**
 * What each post actually stores for its link. The physical column is named
 * for the field (`author`); the contract member for the key it holds
 * (`authorId`). Reading the column is what stops the engine's own return value
 * from being both the claim and the evidence.
 */
async function storedLinks(url: string): Promise<Array<{ title: string; author: string | null }>> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    const result = await client.query(
      'select "title", "author" from "public"."Post" order by "title"',
    )
    return result.rows.map((row: { title: string; author: string | null }) => ({
      title: row.title,
      author: row.author,
    }))
  } finally {
    await client.end()
  }
}

/** A well-formed id of the right column type that names no row. */
const ABSENT_ID = '00000000-0000-7000-8000-000000000000'

describe('connect on the foreign-key-owning field', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(schemaConfig(), { userId: 'u1' })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.truncate()
  })

  function contextAt(
    config: OpenSaasConfig,
    session: Session | null,
  ): StackContext<AccessControlledDB> {
    const orm = ormClientFor(harness.data, harness.client.orm)
    return getContext(config, orm, session, undefined, false, undefined, undefined, harness.client)
  }

  async function seedAuthor(name: string): Promise<string> {
    const author = await harness.context.db.Author.create({ data: { name } })
    return String(author?.id)
  }

  test(
    'connect to a readable target writes the foreign key',
    async () => {
      const authorId = await seedAuthor('ada')

      const created = await harness.context.db.Post.create({
        data: { title: 'ship it', author: { connect: { id: authorId } } },
      })

      expect(created).toMatchObject({ title: 'ship it' })
      expect(await storedLinks(harness.url)).toEqual([{ title: 'ship it', author: authorId }])
    },
    BOOT,
  )

  test(
    'null on the same field clears the foreign key without touching the row',
    async () => {
      const authorId = await seedAuthor('ada')
      const post = await harness.context.db.Post.create({
        data: { title: 'ship it', author: { connect: { id: authorId } } },
      })

      const updated = await harness.context.db.Post.update({
        where: { id: String(post?.id) },
        data: { author: null },
      })

      expect(updated).toMatchObject({ title: 'ship it' })
      expect(await storedLinks(harness.url)).toEqual([{ title: 'ship it', author: null }])
    },
    BOOT,
  )

  /**
   * The reachability query is the whole reason `connect` is not a foreign-key
   * assignment: without it the constraint answers "that row exists" to a
   * caller who may not see it (ADR-0050). Unreadable and absent must therefore
   * be one answer, and this asserts they are the same value rather than
   * asserting each separately.
   */
  test(
    'an unreadable target and an absent one are the same answer',
    async () => {
      const visible = await seedAuthor('visible')
      const hidden = await seedAuthor('hidden')

      const scoped = contextAt(
        schemaConfig(() => ({ name: { equals: 'visible' } })),
        { userId: 'u1' },
      )

      // The positive control: the same context, the same call, a target the
      // filter admits.
      expect(
        await scoped.db.Post.create({
          data: { title: 'seen', author: { connect: { id: visible } } },
        }),
      ).toMatchObject({ title: 'seen' })

      let unreadableError: unknown
      let absentError: unknown
      const unreadable = await scoped.db.Post.create({
        data: { title: 'hidden', author: { connect: { id: hidden } } },
      }).catch((error: unknown) => {
        unreadableError = error
        return 'threw' as const
      })
      const absent = await scoped.db.Post.create({
        data: { title: 'absent', author: { connect: { id: ABSENT_ID } } },
      }).catch((error: unknown) => {
        absentError = error
        return 'threw' as const
      })

      expect(unreadable).toBeNull()
      expect(unreadableError).toBeUndefined()
      expect(absent).toEqual(unreadable)
      expect(absentError).toEqual(unreadableError)

      // Only the readable link was written. Neither denied create left a row.
      expect(await storedLinks(harness.url)).toEqual([{ title: 'seen', author: visible }])
    },
    BOOT,
  )

  /**
   * The arity rule (ADR-0050): an edge is a column on the row being written,
   * and only the foreign-key-owning end holds that column. Connecting through
   * `Author.posts` would be N updates against `Post`, each owing that list's
   * own access and hooks.
   */
  test(
    'connect through the inverse field is refused, and nothing is written',
    async () => {
      const authorId = await seedAuthor('ada')
      const post = await harness.context.db.Post.create({ data: { title: 'ship it' } })

      await expect(
        harness.context.db.Author.update({
          where: { id: authorId },
          data: { posts: { connect: { id: String(post?.id) } } },
        }),
      ).rejects.toBeInstanceOf(NonOwningRelationInputError)

      expect(await storedLinks(harness.url)).toEqual([{ title: 'ship it', author: null }])
    },
    BOOT,
  )

  test(
    'a connect the field-level write gate denies never links the row',
    async () => {
      const authorId = await seedAuthor('ada')
      const gated = contextAt(
        {
          ...schemaConfig(),
          lists: {
            ...schemaConfig().lists,
            Post: {
              fields: {
                title: text(),
                author: relationship({
                  ref: 'Author.posts',
                  access: { create: () => false, update: () => false },
                }),
              },
              access: { operation: OPEN },
            },
          },
        },
        { userId: 'u1' },
      )

      await expect(
        gated.db.Post.create({ data: { title: 't', author: { connect: { id: authorId } } } }),
      ).rejects.toThrow('Cannot create "author": field-level access denied.')

      expect(await storedLinks(harness.url)).toEqual([])
    },
    BOOT,
  )
})

/**
 * The plan test: the statements the terminal built are the subject here, so
 * this is one of the two places the spec admits a plan assertion.
 */
describe('the statements a connect issues', () => {
  let harness: TestContext
  const recorder = createPlanRecorder()

  beforeAll(async () => {
    harness = await createTestContext(
      schemaConfig(),
      { userId: 'u1' },
      {
        middleware: [recorder.middleware],
      },
    )
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.truncate()
  })

  test(
    'the reachability query runs before the foreign-key write, both inside the origin',
    async () => {
      const author = await harness.context.db.Author.create({ data: { name: 'ada' } })

      recorder.clear()
      await harness.context.db.Post.create({
        data: { title: 't', author: { connect: { id: String(author?.id) } } },
      })

      const kinds = recorder.plans.map((plan) => plan.kind)
      expect(kinds).toEqual(['select', 'insert'])
      expect(recorder.plans.map((plan) => plan.origin)).toEqual(['engine', 'engine'])
    },
    BOOT,
  )
})
