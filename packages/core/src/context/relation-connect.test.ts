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
import { MalformedForeignKeyInputError, NonOwningRelationInputError } from './relationship-input.js'

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
   * The filter-returning branch of the reachability gate is what the test
   * above exercises. A target list whose `query` is a hard `false` never
   * reaches a filter at all, and is the branch that stops a wholly-denied list
   * from being linkable — so it is asserted on its own, against the same
   * caller that CAN link the very same row when the deny is lifted.
   */
  test(
    'a hard-denied target list is not linkable, and answers as an absent target does',
    async () => {
      const authorId = await seedAuthor('ada')
      const denied = contextAt(
        schemaConfig(() => false),
        { userId: 'u1' },
      )

      const unreadable = await denied.db.Post.create({
        data: { title: 'denied', author: { connect: { id: authorId } } },
      })
      expect(unreadable).toBeNull()

      const absent = await denied.db.Post.create({
        data: { title: 'absent', author: { connect: { id: ABSENT_ID } } },
      })
      expect(absent).toEqual(unreadable)
      expect(await storedLinks(harness.url)).toEqual([])

      // The same row, the same id, through a context whose target list is not
      // denied: the answers must differ, or the fixture proves nothing.
      expect(
        await harness.context.db.Post.create({
          data: { title: 'seen', author: { connect: { id: authorId } } },
        }),
      ).toMatchObject({ title: 'seen' })
      expect(await storedLinks(harness.url)).toEqual([{ title: 'seen', author: authorId }])
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
 * #1331: the foreign-key column named directly (`authorId`) is the same edge
 * as `{ connect: { id } }`, so it owes the same two access components
 * (ADR-0050) and must give the same answer. Every case here is asserted
 * against the `connect` spelling of the identical write rather than against a
 * literal, because "the same answer" is the guarantee — a table where the two
 * spellings are checked separately would pass while they diverge.
 */
describe('the foreign-key column, spelled without the relationship field', () => {
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
    'a readable target still links through the column',
    async () => {
      const authorId = await seedAuthor('ada')

      const created = await harness.context.db.Post.create({
        data: { title: 'ship it', authorId },
      })

      expect(created).toMatchObject({ title: 'ship it' })
      expect(await storedLinks(harness.url)).toEqual([{ title: 'ship it', author: authorId }])
    },
    BOOT,
  )

  test(
    'null on the column clears the edge without a reachability query',
    async () => {
      const authorId = await seedAuthor('ada')
      const post = await harness.context.db.Post.create({ data: { title: 'ship it', authorId } })

      const updated = await harness.context.db.Post.update({
        where: { id: String(post?.id) },
        data: { authorId: null },
      })

      expect(updated).toMatchObject({ title: 'ship it' })
      expect(await storedLinks(harness.url)).toEqual([{ title: 'ship it', author: null }])
    },
    BOOT,
  )

  /**
   * The exact three cases QA reproduced the oracle with, run on one context
   * whose `query` rule returns a filter, so the scoped and unscoped answers
   * cannot coincide: the positive control links a row the same filter admits.
   */
  test(
    'an unreadable target, an absent target and the connect spelling are one answer',
    async () => {
      const visible = await seedAuthor('visible')
      const hidden = await seedAuthor('hidden')

      const scoped = contextAt(
        schemaConfig(() => ({ name: { equals: 'visible' } })),
        { userId: 'u1' },
      )

      // The positive control, on the same context: a target the filter admits,
      // through the column spelling under test.
      expect(
        await scoped.db.Post.create({ data: { title: 'seen', authorId: visible } }),
      ).toMatchObject({ title: 'seen' })

      // Each spelling's error is captured rather than thrown, because "the
      // same answer" covers the failure shape too: it is success-versus-error
      // that tells an unreadable row from an absent one.
      const faults = new Map<string, unknown>()
      const answer = async (title: string, data: Record<string, unknown>): Promise<unknown> =>
        scoped.db.Post.create({ data: { title, ...data } }).catch((fault: unknown) => {
          faults.set(title, fault)
          return 'threw' as const
        })

      const throughConnect = await answer('connect', { author: { connect: { id: hidden } } })
      const throughColumn = await answer('column', { authorId: hidden })
      const absentColumn = await answer('absent', { authorId: ABSENT_ID })

      expect(throughConnect).toBeNull()
      expect(throughColumn).toEqual(throughConnect)
      expect(absentColumn).toEqual(throughColumn)
      expect([...faults.keys()]).toEqual([])

      // Only the control was written: neither denied spelling left a row, and
      // the absent id raised no database error to distinguish it by.
      expect(await storedLinks(harness.url)).toEqual([{ title: 'seen', author: visible }])
    },
    BOOT,
  )

  test(
    'a hard-denied target list is not linkable through the column either',
    async () => {
      const authorId = await seedAuthor('ada')
      const denied = contextAt(
        schemaConfig(() => false),
        { userId: 'u1' },
      )

      const faults: unknown[] = []
      const answer = async (title: string, data: Record<string, unknown>): Promise<unknown> =>
        denied.db.Post.create({ data: { title, ...data } }).catch((fault: unknown) => {
          faults.push(fault)
          return 'threw' as const
        })

      const throughColumn = await answer('denied', { authorId })
      const throughConnect = await answer('denied', { author: { connect: { id: authorId } } })
      const absent = await answer('absent', { authorId: ABSENT_ID })

      expect(faults).toEqual([])
      expect(throughColumn).toBeNull()
      expect(throughConnect).toEqual(throughColumn)
      expect(absent).toEqual(throughColumn)
      expect(await storedLinks(harness.url)).toEqual([])

      // The same row, the same id, the same spelling, through a context whose
      // target list is not denied: the answers must differ, or the fixture
      // proves nothing.
      expect(
        await harness.context.db.Post.create({ data: { title: 'seen', authorId } }),
      ).toMatchObject({ title: 'seen' })
      expect(await storedLinks(harness.url)).toEqual([{ title: 'seen', author: authorId }])
    },
    BOOT,
  )

  test(
    'an update that re-points the column is scoped the same way',
    async () => {
      const visible = await seedAuthor('visible')
      const hidden = await seedAuthor('hidden')
      const post = await harness.context.db.Post.create({
        data: { title: 'ship it', authorId: visible },
      })

      const scoped = contextAt(
        schemaConfig(() => ({ name: { equals: 'visible' } })),
        { userId: 'u1' },
      )

      expect(
        await scoped.db.Post.update({
          where: { id: String(post?.id) },
          data: { authorId: hidden },
        }),
      ).toBeNull()
      expect(await storedLinks(harness.url)).toEqual([{ title: 'ship it', author: visible }])

      // The control: the same update, a target the same filter admits.
      expect(
        await scoped.db.Post.update({
          where: { id: String(post?.id) },
          data: { authorId: visible },
        }),
      ).toMatchObject({ title: 'ship it' })
    },
    BOOT,
  )

  /**
   * The owning field's write access is the other half of ADR-0050's pair, and
   * it still runs first: a caller who may not write `author` is refused before
   * the reachability query is spent, through either spelling.
   */
  test(
    'the owning field write gate still refuses the column, ahead of reachability',
    async () => {
      const authorId = await seedAuthor('ada')
      const base = schemaConfig()
      const gated = contextAt(
        {
          ...base,
          lists: {
            ...base.lists,
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

      await expect(gated.db.Post.create({ data: { title: 't', authorId } })).rejects.toThrow(
        'Cannot create "author" (via column "authorId"): field-level access denied.',
      )

      expect(await storedLinks(harness.url)).toEqual([])
    },
    BOOT,
  )

  test(
    'a wrapper the surface does not lower is refused rather than written unchecked',
    async () => {
      const authorId = await seedAuthor('ada')

      await expect(
        harness.context.db.Post.create({ data: { title: 't', authorId: { set: authorId } } }),
      ).rejects.toBeInstanceOf(MalformedForeignKeyInputError)

      expect(await storedLinks(harness.url)).toEqual([])
    },
    BOOT,
  )

  /**
   * Sudo bypasses the target list's `query` rule for both spellings, and for
   * neither does it bypass the row having to exist — the reachability query
   * still runs, so an id naming no row is the same silent `null` a scoped
   * caller gets rather than a foreign-key `DatabaseError`.
   */
  test(
    'sudo answers the same way for both spellings',
    async () => {
      const hidden = await seedAuthor('hidden')
      const sudo = contextAt(
        schemaConfig(() => false),
        { userId: 'u1' },
      ).sudo()

      expect(
        await sudo.db.Post.create({ data: { title: 'column', authorId: hidden } }),
      ).toMatchObject({ title: 'column' })
      expect(
        await sudo.db.Post.create({
          data: { title: 'connect', author: { connect: { id: hidden } } },
        }),
      ).toMatchObject({ title: 'connect' })

      const faults: unknown[] = []
      const absent = async (data: Record<string, unknown>): Promise<unknown> =>
        sudo.db.Post.create({ data: { title: 'absent', ...data } }).catch((fault: unknown) => {
          faults.push(fault)
          return 'threw' as const
        })

      const absentColumn = await absent({ authorId: ABSENT_ID })
      const absentConnect = await absent({ author: { connect: { id: ABSENT_ID } } })
      expect(absentColumn).toBeNull()
      expect(absentConnect).toEqual(absentColumn)
      expect(faults).toEqual([])

      expect(await storedLinks(harness.url)).toEqual([
        { title: 'column', author: hidden },
        { title: 'connect', author: hidden },
      ])
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

  test(
    'the column spelling issues the same two statements, in the same order',
    async () => {
      const author = await harness.context.db.Author.create({ data: { name: 'ada' } })

      recorder.clear()
      await harness.context.db.Post.create({ data: { title: 't', authorId: String(author?.id) } })

      expect(recorder.plans.map((plan) => plan.kind)).toEqual(['select', 'insert'])
      expect(recorder.plans.map((plan) => plan.origin)).toEqual(['engine', 'engine'])
    },
    BOOT,
  )
})
