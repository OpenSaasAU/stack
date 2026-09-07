import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { BaseFieldConfig, OpenSaasConfig, TypeInfo } from '../config/types.js'
import type { Session } from '../access/types.js'
import type { ListQuery, ListRefinement, RemainderBase } from '../types/index.js'
import { checkbox, integer, relationship, text } from '../fields/index.js'
import { withOrigin } from '../origin.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import type { SecuredQuery } from './read.js'
import type { SecuredRefinement } from './include.js'

/**
 * The bridge between the surface a generated project is typed against and the
 * engine that answers it.
 *
 * An application reaches `context.db.<List>` as `SecuredList<Contract,
 * Remainder, K>` and composes a {@link ListQuery}; the engine hands out a
 * {@link SecuredQuery}, and the generated context joins the two through
 * `as unknown as Context` — a seam no compiler crosses. `aggregate`,
 * `nearest`, `combine`, `count`, `distinct`, `distinctOn`, `cursor` and
 * top-level `offset` shipped on one side of it only, so every one of them was
 * unreachable from a generated project while 1300 lines of engine tests stayed
 * green (#1253, QA defect D1 on spec #1123).
 *
 * The type-level half of the join is checked from the generated bundle itself
 * in `packages/cli/src/generator/types-read-terminals.test.ts`. What is
 * checked here is the other half: that the engine carries every member the
 * generated surface promises, and answers when each is called.
 */

const BOOT = 120_000

function embedding(dimensions: number): BaseFieldConfig<TypeInfo> {
  return {
    type: 'vector',
    getContractField: (fieldName) => ({
      kind: 'column',
      name: fieldName,
      type: { pack: 'pgvector', type: 'Vector', args: [dimensions] },
      nullable: true,
    }),
    getVectorColumn: (fieldName) => ({
      column: fieldName,
      dimensions,
      distanceFunction: 'cosine',
    }),
  }
}

const config: OpenSaasConfig = {
  db: {
    provider: 'postgresql',
    timestamps: true,
    extensions: [{ name: 'pgvector', from: '@prisma/orm-extension-pgvector' }],
  },
  lists: {
    User: {
      fields: {
        handle: text({ validation: { isRequired: true } }),
        posts: relationship({ ref: 'Post.author', many: true }),
      },
      access: { operation: { query: () => true } },
    },
    Post: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        kind: text(),
        published: checkbox({ defaultValue: false }),
        views: integer({ defaultValue: 0 }),
        author: relationship({ ref: 'User.posts' }),
      },
      access: {
        operation: {
          query: ({ session }) =>
            typeof session?.userId === 'string'
              ? { authorId: { equals: session.userId } }
              : { published: { equals: true } },
        },
      },
    },
    Article: {
      fields: { title: text(), embedding: embedding(3) },
      access: { operation: { query: () => true } },
    },
    Locked: {
      fields: { title: text() },
      access: { operation: { query: () => false } },
    },
  },
}

// ── the type-level half: no member is promised that the engine lacks ───────

/**
 * Instantiated over the base constraints rather than a real contract: what is
 * being compared is the MEMBER SET, which is the same at every instantiation,
 * and a real one would need an emitted contract this package does not carry.
 */
type PromisedQueryMember = keyof ListQuery<unknown, RemainderBase, string>
type PromisedRefinementMember = keyof ListRefinement<unknown, RemainderBase, string>
/**
 * The transaction-bound face promises one member more (ADR-0047), and the
 * engine has to answer that one too — `forUpdate()` reached a generated
 * project through `SecuredQuery`, not through a second implementation.
 */
type PromisedLockingMember = keyof ListQuery<unknown, RemainderBase, string, unknown, never, true>

type UnansweredQueryMember = Exclude<PromisedLockingMember, keyof SecuredQuery>
type UnansweredRefinementMember = Exclude<PromisedRefinementMember, keyof SecuredRefinement>

const queryBridged: [UnansweredQueryMember] extends [never] ? true : false = true
const refinementBridged: [UnansweredRefinementMember] extends [never] ? true : false = true

/**
 * The generated surface's members, spelled out so the runtime can walk them.
 * The `Exact` pair below fails to compile if this list and {@link ListQuery}
 * ever disagree, so a member added there cannot quietly skip the walk.
 */
const PROMISED_QUERY_MEMBERS = [
  'where',
  'orderBy',
  'include',
  'select',
  'limit',
  'offset',
  'distinct',
  'distinctOn',
  'cursor',
  'all',
  'first',
  'nearest',
  'aggregate',
] as const

const PROMISED_REFINEMENT_MEMBERS = [
  'where',
  'orderBy',
  'limit',
  'offset',
  'select',
  'include',
  'count',
  'combine',
] as const

type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

const queryListed: Exact<PromisedQueryMember, (typeof PROMISED_QUERY_MEMBERS)[number]> = true
/** The locking face is the plain one plus `forUpdate`, and nothing else. */
const lockListed: Exact<Exclude<PromisedLockingMember, PromisedQueryMember>, 'forUpdate'> = true
const refinementListed: Exact<
  PromisedRefinementMember,
  (typeof PROMISED_REFINEMENT_MEMBERS)[number]
> = true

let database: TestDatabase
let ada: Session = {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function collection(model: string): Record<string, unknown> {
  const namespace: unknown = Reflect.get(database.client.orm, 'public')
  if (!isRecord(namespace)) throw new Error('no public namespace')
  const found: unknown = Reflect.get(namespace, model)
  if (!isRecord(found)) throw new Error(`no collection "${model}"`)
  return found
}

/** Seed through the Unsafe origin: writes are spec 4's. */
async function seed(model: string, row: object): Promise<Record<string, unknown>> {
  const target = collection(model)
  const create: unknown = target.create
  if (typeof create !== 'function') throw new Error(`collection "${model}" has no create`)
  return await withOrigin('unsafe', async () => {
    const created: unknown = await create.call(target, row)
    if (!isRecord(created)) throw new Error('create returned no row')
    return created
  })
}

function titles(rows: readonly Record<string, unknown>[]): unknown[] {
  return rows.map((row) => row.title)
}

beforeAll(async () => {
  database = await createTestDatabase(config)
}, BOOT)

afterAll(async () => {
  await database?.close()
})

beforeEach(async () => {
  await database.truncate()
  const user = await seed('User', { handle: 'ada' })
  ada = { userId: user.id }
  await seed('Post', { title: 'alpha', kind: 'essay', views: 3, author: user.id })
  await seed('Post', { title: 'beta', kind: 'note', views: 2, author: user.id })
  await seed('Post', { title: 'gamma', kind: 'note', views: 1, author: user.id })
})

describe('the members the generated surface promises', () => {
  test('the type-level bridge holds in both directions', () => {
    expect([queryBridged, refinementBridged, queryListed, refinementListed, lockListed]).toEqual([
      true,
      true,
      true,
      true,
      true,
    ])
    // Not vacuous: the walk below has something to walk.
    expect(PROMISED_QUERY_MEMBERS.length).toBeGreaterThan(0)
  })

  test('every one of them is callable on the engine value', () => {
    const query: SecuredQuery = database.context(ada).db.Post
    const absent = [...PROMISED_QUERY_MEMBERS, 'forUpdate'].filter(
      (member) => typeof Reflect.get(query, member) !== 'function',
    )
    expect(absent).toEqual([])
  })

  test('and every refinement member is callable on the value a refinement is handed', async () => {
    // A sentinel rather than `[]`: the assertion below is on the absent
    // members, and `[]` is also what "the callback never ran" looks like.
    let seen: readonly string[] = ['<the refinement callback never ran>']
    await database
      .context(ada)
      .db.User.include('posts', (posts) => {
        seen = PROMISED_REFINEMENT_MEMBERS.filter(
          (member) => typeof Reflect.get(posts, member) !== 'function',
        )
        return posts
      })
      .all()
    expect(seen).toEqual([])
  })
})

describe('each promised member answers', () => {
  test('offset skips rows, and composes with orderBy and limit', async () => {
    const db = database.context(ada).db.Post
    const all = await db.orderBy({ title: 'asc' }).all()
    expect(titles(all)).toEqual(['alpha', 'beta', 'gamma'])

    expect(titles(await db.orderBy({ title: 'asc' }).offset(1).all())).toEqual(['beta', 'gamma'])
    expect(titles(await db.orderBy({ title: 'asc' }).offset(1).limit(1).all())).toEqual(['beta'])
    // Replaces rather than accumulates, exactly as `limit` does.
    expect(titles(await db.orderBy({ title: 'asc' }).offset(2).offset(1).all())).toEqual([
      'beta',
      'gamma',
    ])
  })

  test('first() honours offset — it has no offset of its own', async () => {
    const db = database.context(ada).db.Post
    expect((await db.orderBy({ title: 'asc' }).first())?.title).toBe('alpha')
    expect((await db.orderBy({ title: 'asc' }).offset(1).first())?.title).toBe('beta')
    expect((await db.orderBy({ title: 'asc' }).offset(2).first())?.title).toBe('gamma')
    // Past the end of the scoped set is absent, not the last row.
    expect(await db.orderBy({ title: 'asc' }).offset(3).first()).toBeNull()
  })

  test('first() pages inside the Access Filter, not around it', async () => {
    const other = await seed('User', { handle: 'bob' })
    await seed('Post', { title: 'delta', kind: 'essay', views: 9, author: other.id })

    // Four rows exist and `delta` sorts second, so an offset of one over the
    // whole table would answer with it rather than with ada's own `beta`.
    expect(
      (await database.context(ada).db.Post.orderBy({ title: 'asc' }).offset(1).first())?.title,
    ).toBe('beta')
  })

  test('aggregate refuses a composed offset rather than counting past it', async () => {
    const db = database.context(ada).db.Post
    expect(await db.aggregate((a) => ({ total: a.count() }))).toEqual({ total: 3 })

    await expect(db.offset(1).aggregate((a) => ({ total: a.count() }))).rejects.toThrow(
      /composed "offset"/,
    )
    // The same class, and the same refusal: neither bounds the rows an
    // aggregate counts.
    await expect(db.limit(1).aggregate((a) => ({ total: a.count() }))).rejects.toThrow(
      /composed "limit"/,
    )
    await expect(
      db
        .limit(1)
        .offset(1)
        .aggregate((a) => ({ total: a.count() })),
    ).rejects.toThrow(/composed "limit", "offset"/)
  })

  test('a denied read answers 0 rather than that refusal', async () => {
    await seed('Locked', { title: 'sealed' })
    const locked = database.context(ada).db.Locked
    // The refusal runs after the access check, so a caller who may not read at
    // all never learns which members the read composed (#912, #915).
    expect(await locked.aggregate((a) => ({ total: a.count() }))).toEqual({ total: 0 })
    expect(await locked.offset(1).aggregate((a) => ({ total: a.count() }))).toEqual({ total: 0 })
    expect(await locked.offset(1).first()).toBeNull()
    expect(await locked.offset(1).all()).toEqual([])
  })

  test('offset pages within the Access Filter, not around it', async () => {
    const other = await seed('User', { handle: 'bob' })
    await seed('Post', { title: 'delta', kind: 'essay', views: 9, author: other.id })

    // Four rows exist; ada may see three, so an offset of three is empty for
    // her and would return `delta` if the skip ran over the whole table.
    expect(await database.context(ada).db.Post.orderBy({ title: 'asc' }).offset(3).all()).toEqual(
      [],
    )
    expect(
      titles(await database.context({ userId: other.id }).db.Post.orderBy({ title: 'asc' }).all()),
    ).toEqual(['delta'])
  })

  test('distinct and distinctOn collapse rows', async () => {
    const db = database.context(ada).db.Post
    expect(await db.distinct('kind').all()).toHaveLength(2)
    expect(
      titles(
        await db
          .orderBy([{ kind: 'asc' }, { title: 'asc' }])
          .distinctOn('kind')
          .all(),
      ),
    ).toEqual(['alpha', 'beta'])
  })

  test('cursor resumes along the order the read established', async () => {
    const rows = await database
      .context(ada)
      .db.Post.orderBy({ title: 'asc' })
      .cursor({ title: 'beta' })
      .all()
    expect(titles(rows)).toEqual(['gamma'])
  })

  test('aggregate counts the rows the session may see', async () => {
    const scoped = await database.context(ada).db.Post.aggregate((a) => ({ total: a.count() }))
    expect(scoped).toEqual({ total: 3 })
    // Anonymous sees only published rows, of which the seed has none.
    expect(await database.context(null).db.Post.aggregate((a) => ({ total: a.count() }))).toEqual({
      total: 0,
    })
  })

  test('count and combine reduce an included relation', async () => {
    const counted = await database
      .context(ada)
      .db.User.include('posts', (posts) => posts.count())
      .all()
    expect(counted[0].posts).toBe(3)

    const combined = await database
      .context(ada)
      .db.User.include('posts', (posts) =>
        posts.combine({
          notes: posts.where({ kind: { equals: 'note' } }).count(),
          total: posts.count(),
        }),
      )
      .all()
    expect(combined[0].posts).toEqual({ notes: 2, total: 3 })
  })

  test('nearest returns the row and its score', async () => {
    await seed('Article', { title: 'near', embedding: [1, 0, 0] })
    await seed('Article', { title: 'far', embedding: [0, 1, 0] })

    const hits = await database.context(null).db.Article.nearest('embedding', [1, 0, 0], {
      limit: 1,
    })
    expect(hits).toHaveLength(1)
    expect(hits[0].item.title).toBe('near')
    expect(hits[0].score).toBeGreaterThan(0.99)
  })
})
