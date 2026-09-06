import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import type { Session } from '../access/types.js'
import { checkbox, integer, relationship, text } from '../fields/index.js'
import { withOrigin } from '../origin.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import { createPlanRecorder } from '../testing/plans.js'
import { ValidationError } from '../hooks/index.js'
import type { SecuredQuery } from './read.js'
import {
  InvalidCombineBranchError,
  ReducedToOneIncludeError,
  UnreducibleRefinementError,
} from './include.js'

const BOOT = 120_000

let ada: Session = {}
let bob: Session = {}
/** The row `Draft` was seeded with, so a denied count can be told from an empty one. */
let seededDraft: Record<string, unknown> = {}

/**
 * A blog fixture carrying one shape per rule a count has to honour: a list
 * whose `query` access differs by session, a list denied outright, a list open
 * and genuinely empty, a to-many relation whose own `read` rule is
 * row-independent, and one whose rule reaches into the row.
 */
const blogConfig: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    User: {
      fields: {
        handle: text({ validation: { isRequired: true } }),
        posts: relationship({ ref: 'Post.author', many: true }),
        secrets: relationship({ ref: 'Secret.owner', many: true }),
        // Row-independent and denies: the relation is left out before the
        // query runs, so a count on it is not in the result at all.
        watched: relationship({ ref: 'Post.watcher', many: true, access: { read: () => false } }),
        // Row-dependent, so it cannot be answered without a row: the relation
        // is fetched and Field Visibility decides, per parent row.
        reviewed: relationship({
          ref: 'Post.reviewer',
          many: true,
          access: { read: ({ item }) => item?.handle === 'ada' },
        }),
      },
      access: { operation: { query: () => true } },
    },
    Post: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        published: checkbox({ defaultValue: false }),
        views: integer({ defaultValue: 0 }),
        kind: text(),
        editorNotes: text({ access: { read: () => false } }),
        author: relationship({ ref: 'User.posts' }),
        watcher: relationship({ ref: 'User.watched' }),
        reviewer: relationship({ ref: 'User.reviewed' }),
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
    // Declares no rule, so `query` is denied by default.
    Draft: {
      fields: { title: text({ validation: { isRequired: true } }) },
    },
    Secret: {
      fields: {
        code: text({ validation: { isRequired: true } }),
        owner: relationship({ ref: 'User.secrets' }),
      },
    },
    // Open to everyone and never seeded: the genuinely empty count a denied
    // one has to be indistinguishable from.
    Empty: {
      fields: { title: text({ validation: { isRequired: true } }) },
      access: { operation: { query: () => true } },
    },
  },
}

const recorder = createPlanRecorder()
let database: TestDatabase

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

/** Seed through the Unsafe origin: writes are spec 4's, not this test's. */
function seed(model: string, row: object): Promise<Record<string, unknown>> {
  const target = collection(model)
  const create: unknown = target.create
  if (typeof create !== 'function') throw new Error(`collection "${model}" has no create`)
  return withOrigin('unsafe', async () => {
    const created: unknown = await create.call(target, row)
    if (!isRecord(created)) throw new Error('create returned no row')
    return created
  })
}

async function seedUser(handle: string): Promise<Session> {
  const row = await seed('User', { handle })
  return { userId: row.id, handle }
}

/**
 * Two authors, five posts. Ada has three (two published, one draft) and Bob
 * two (one published, one draft), so no two sessions agree on any count below.
 */
async function seedBlog(): Promise<void> {
  ada = await seedUser('ada')
  bob = await seedUser('bob')
  await seed('Post', {
    title: 'ada one',
    published: true,
    views: 10,
    kind: 'essay',
    author: ada.userId,
    reviewer: ada.userId,
    watcher: ada.userId,
    editorNotes: 'secret',
  })
  await seed('Post', {
    title: 'ada two',
    published: true,
    views: 4,
    kind: 'note',
    author: ada.userId,
  })
  await seed('Post', {
    title: 'ada three',
    published: false,
    views: 2,
    kind: 'note',
    author: ada.userId,
  })
  await seed('Post', {
    title: 'bob one',
    published: true,
    views: 5,
    kind: 'essay',
    author: bob.userId,
    reviewer: bob.userId,
  })
  await seed('Post', {
    title: 'bob two',
    published: false,
    views: 1,
    kind: 'note',
    author: bob.userId,
  })
  seededDraft = await seed('Draft', { title: 'nobody may read this' })
  await seed('Secret', { code: 'hunter2', owner: ada.userId })
  await seed('Secret', { code: 'swordfish', owner: bob.userId })
}

function count(result: Record<string, number>): number {
  return result.count
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function byHandle(rows: readonly Record<string, unknown>[]): Record<string, unknown> {
  const found: Record<string, unknown> = {}
  for (const row of rows) found[String(row.handle)] = row
  return found
}

beforeAll(async () => {
  database = await createTestDatabase(blogConfig, { middleware: [recorder.middleware] })
}, BOOT)

afterAll(async () => {
  await database?.close()
})

beforeEach(async () => {
  await database.truncate()
  await seedBlog()
  recorder.clear()
})

describe('Session-relative value', () => {
  test(
    "a count equals the length of the same session's own all()",
    async () => {
      for (const session of [null, ada, bob]) {
        const db = database.context(session).db
        const rows = await db.Post.all()
        const counted = await db.Post.aggregate((aggregate) => ({ count: aggregate.count() }))
        expect(count(counted)).toBe(rows.length)
      }
    },
    BOOT,
  )

  test(
    'the equality is not vacuous: the three sessions disagree on the count',
    async () => {
      const counts = await Promise.all(
        [null, ada, bob].map(async (session) =>
          count(
            await database
              .context(session)
              .db.Post.aggregate((aggregate) => ({ count: aggregate.count() })),
          ),
        ),
      )
      // Anonymous sees the three published posts; ada her own three; bob his
      // own two. A count that ignored the Access Filter would answer 5 to all
      // three, and one that ignored the session would answer one number.
      expect(counts).toEqual([3, 3, 2])
      expect(new Set(counts).size).toBeGreaterThan(1)
    },
    BOOT,
  )

  test(
    "a caller's own where narrows the count, still equal to its own all()",
    async () => {
      const db = database.context(ada).db
      const published = db.Post.where({ published: { equals: true } })
      expect(count(await published.aggregate((aggregate) => ({ count: aggregate.count() })))).toBe(
        (await published.all()).length,
      )
      expect(count(await published.aggregate((aggregate) => ({ count: aggregate.count() })))).toBe(
        2,
      )
    },
    BOOT,
  )

  test(
    'the count is computed in the database rather than over materialised rows',
    async () => {
      recorder.clear()
      await database.context(ada).db.Post.aggregate((aggregate) => ({ count: aggregate.count() }))
      expect(recorder.plans).toHaveLength(1)
      expect(recorder.plans[0].origin).toBe('engine')
    },
    BOOT,
  )

  test(
    'several keys in one spec each answer the same scoped count',
    async () => {
      const counted = await database
        .context(ada)
        .db.Post.aggregate((aggregate) => ({ total: aggregate.count(), again: aggregate.count() }))
      expect(counted).toEqual({ total: 3, again: 3 })
    },
    BOOT,
  )
})

describe('Silent failure', () => {
  test(
    'a denied list counts 0 while its rows exist',
    async () => {
      const db = database.context(ada).db
      expect(count(await db.Draft.aggregate((aggregate) => ({ count: aggregate.count() })))).toBe(0)
      // The row is really there — the database minted its id when the seed
      // wrote it — so the 0 above is a denial rather than an empty table.
      expect(typeof seededDraft.id).toBe('string')
    },
    BOOT,
  )

  test(
    'a denied count is indistinguishable from a permitted empty one',
    async () => {
      const db = database.context(ada).db
      const denied = await db.Draft.aggregate((aggregate) => ({ count: aggregate.count() }))
      const empty = await db.Empty.aggregate((aggregate) => ({ count: aggregate.count() }))
      expect(denied).toEqual(empty)
      expect(denied).toEqual({ count: 0 })
    },
    BOOT,
  )

  test(
    'a denied read answers 0 rather than the validation error a permitted one raises',
    async () => {
      const db = database.context(ada).db
      // The same predicate on a permitted list is refused for naming a key
      // the list does not declare…
      await expect(
        db.Empty.where({ nope: { equals: 1 } }).aggregate((aggregate) => ({
          count: aggregate.count(),
        })),
      ).rejects.toBeInstanceOf(ValidationError)
      // …and on a denied one the caller never learns that much (ADR-0055).
      expect(
        count(
          await db.Draft.where({ nope: { equals: 1 } }).aggregate((aggregate) => ({
            count: aggregate.count(),
          })),
        ),
      ).toBe(0)
    },
    BOOT,
  )
})

describe('Field Visibility', () => {
  test(
    'a where naming an unreadable field is refused exactly as an undeclared one is',
    async () => {
      const db = database.context(ada).db
      const undeclared = await db.Post.where({ nope: { equals: 1 } })
        .aggregate((aggregate) => ({ count: aggregate.count() }))
        .catch((error: unknown) => error)
      const denied = await db.Post.where({ editorNotes: { equals: 'secret' } })
        .aggregate((aggregate) => ({ count: aggregate.count() }))
        .catch((error: unknown) => error)

      expect(undeclared).toBeInstanceOf(ValidationError)
      expect(denied).toBeInstanceOf(ValidationError)
      expect(messageOf(denied)).toBe(messageOf(undeclared).replace('nope', 'editorNotes'))
    },
    BOOT,
  )

  test(
    'the indistinguishability assertion is falsifiable: a readable field is not refused',
    async () => {
      const counted = await database
        .context(ada)
        .db.Post.where({ title: { equals: 'ada one' } })
        .aggregate((aggregate) => ({ count: aggregate.count() }))
      expect(count(counted)).toBe(1)
    },
    BOOT,
  )
})

describe('Access Filter', () => {
  test(
    'a count reducer on an include counts only the related rows the session may see',
    async () => {
      const rows = await database
        .context(ada)
        .db.User.include('posts', (posts) => posts.count())
        .all()
      const users = byHandle(rows)
      // Ada's Access Filter on Post scopes every correlated count, so her own
      // row counts her three posts and Bob's row counts none of his.
      expect(users.ada).toMatchObject({ posts: 3 })
      expect(users.bob).toMatchObject({ posts: 0 })
    },
    BOOT,
  )

  test(
    "the reducer's count equals the length of the same relation read as rows",
    async () => {
      const db = database.context(bob).db
      const counted = byHandle(await db.User.include('posts', (posts) => posts.count()).all())
      const listed = byHandle(await db.User.include('posts').all())
      for (const handle of ['ada', 'bob']) {
        const rows = (listed[handle] as Record<string, unknown>).posts
        expect((counted[handle] as Record<string, unknown>).posts).toBe(
          Array.isArray(rows) ? rows.length : -1,
        )
      }
      expect((counted.bob as Record<string, unknown>).posts).toBe(2)
      expect((counted.ada as Record<string, unknown>).posts).toBe(0)
    },
    BOOT,
  )

  test(
    "a reducer's own where narrows within the Access Filter, never past it",
    async () => {
      const rows = await database
        .context(ada)
        .db.User.include('posts', (posts) => posts.where({ published: { equals: true } }).count())
        .all()
      expect(byHandle(rows).ada).toMatchObject({ posts: 2 })
      expect(byHandle(rows).bob).toMatchObject({ posts: 0 })
    },
    BOOT,
  )

  test(
    'a relation whose list denies query counts 0 for every parent row',
    async () => {
      const rows = await database
        .context(ada)
        .db.User.include('secrets', (secrets) => secrets.count())
        .all()
      expect(byHandle(rows).ada).toMatchObject({ secrets: 0 })
      expect(byHandle(rows).bob).toMatchObject({ secrets: 0 })
    },
    BOOT,
  )

  test(
    "a relationship field's own row-independent read denial leaves the count out",
    async () => {
      const rows = await database
        .context(ada)
        .db.User.include('watched', (watched) => watched.count())
        .all()
      for (const row of rows) expect(row).not.toHaveProperty('watched')
    },
    BOOT,
  )

  test(
    "a relationship field's row-dependent read rule decides the count per parent row",
    async () => {
      const rows = await database
        .context(ada)
        .db.User.include('reviewed', (reviewed) => reviewed.count())
        .all()
      const users = byHandle(rows)
      // The rule is `handle === 'ada'`, which only a row can answer: ada's row
      // keeps the count and bob's loses the key entirely.
      expect(users.ada).toMatchObject({ reviewed: 1 })
      expect(users.bob).not.toHaveProperty('reviewed')
    },
    BOOT,
  )
})

describe('combine', () => {
  test(
    'two scoped counts over one relation both answer correctly',
    async () => {
      const rows = await database
        .context(ada)
        .db.User.include('posts', (posts) =>
          posts.combine({
            published: posts.where({ published: { equals: true } }).count(),
            total: posts.count(),
          }),
        )
        .all()
      expect(byHandle(rows).ada).toMatchObject({ posts: { published: 2, total: 3 } })
      expect(byHandle(rows).bob).toMatchObject({ posts: { published: 0, total: 0 } })
    },
    BOOT,
  )

  test(
    "a branch's predicates do not reach its sibling",
    async () => {
      const rows = await database
        .context(bob)
        .db.User.include('posts', (posts) =>
          posts.combine({
            drafts: posts.where({ published: { equals: false } }).count(),
            total: posts.count(),
          }),
        )
        .all()
      // Bob has two posts, one of them a draft. A branch that leaked its
      // sibling's `where` would make these two numbers agree.
      expect(byHandle(rows).bob).toMatchObject({ posts: { drafts: 1, total: 2 } })
    },
    BOOT,
  )

  test(
    'a denied relation beside a permitted one leaves the permitted count alone',
    async () => {
      const rows = await database
        .context(ada)
        .db.User.include('secrets', (secrets) => secrets.count())
        .include('posts', (posts) => posts.count())
        .all()
      expect(byHandle(rows).ada).toMatchObject({ secrets: 0, posts: 3 })
    },
    BOOT,
  )

  test(
    'a branch naming an unreadable key is refused, as one naming an undeclared key is',
    async () => {
      const db = database.context(ada).db
      const attempt = (key: string): Promise<unknown> =>
        db.User.include('posts', (posts) =>
          posts.combine({ hits: posts.where({ [key]: { equals: 'x' } }).count() }),
        ).all()
      await expect(attempt('editorNotes')).rejects.toBeInstanceOf(ValidationError)
      await expect(attempt('nope')).rejects.toBeInstanceOf(ValidationError)
    },
    BOOT,
  )

  test(
    'a branch that is not a count is refused',
    async () => {
      const db = database.context(ada).db
      expect(() =>
        db.User.include('posts', (posts) =>
          posts.combine({
            nested: posts.combine({ total: posts.count() }),
          }),
        ),
      ).toThrow(InvalidCombineBranchError)
    },
    BOOT,
  )
})

describe('what a count refuses', () => {
  test(
    'a to-one relation cannot be counted',
    async () => {
      await expect(
        database
          .context(ada)
          .db.Post.include('author', (author) => author.count())
          .all(),
      ).rejects.toBeInstanceOf(ReducedToOneIncludeError)
    },
    BOOT,
  )

  test(
    'a refinement a count cannot honour is refused rather than dropped',
    async () => {
      const db = database.context(ada).db
      await expect(
        db.User.include('posts', (posts) => posts.limit(2).count()).all(),
      ).rejects.toBeInstanceOf(UnreducibleRefinementError)
      await expect(
        db.User.include('posts', (posts) => posts.offset(1).count()).all(),
      ).rejects.toBeInstanceOf(UnreducibleRefinementError)
      await expect(
        db.User.include('posts', (posts) => posts.orderBy({ title: 'asc' }).count()).all(),
      ).rejects.toBeInstanceOf(UnreducibleRefinementError)
    },
    BOOT,
  )
})

describe('distinct, distinctOn and cursor', () => {
  test(
    'distinct collapses rows that agree on the named column, within the Access Filter',
    async () => {
      const db = database.context(ada).db
      // Ada's three posts carry two kinds, and the five in the table carry the
      // same two — so a distinct that ran unscoped would answer the same
      // number. The scoped read below is what makes the pair meaningful.
      expect(await db.Post.distinct('kind').all()).toHaveLength(2)
      expect(
        await db.Post.where({ kind: { equals: 'note' } })
          .distinct('kind')
          .all(),
      ).toHaveLength(1)
    },
    BOOT,
  )

  test(
    'distinctOn keeps the first row per key in the order the read established',
    async () => {
      const rows = await database
        .context(ada)
        .db.Post.orderBy([{ kind: 'asc' }, { views: 'desc' }])
        .distinctOn('kind')
        .all()
      expect(rows.map((row) => row.title)).toEqual(['ada one', 'ada two'])
    },
    BOOT,
  )

  test(
    'a cursor resumes from a position on the axis the read is sorted along',
    async () => {
      const db = database.context(ada).db
      const sorted = db.Post.orderBy({ views: 'asc' })
      const all = await sorted.all()
      const resumed = await sorted.cursor({ views: all[0].views }).all()
      expect(resumed.map((row) => row.title)).toEqual(['ada two', 'ada one'])
    },
    BOOT,
  )

  test(
    'distinct and a cursor name columns through the same read gate a where does',
    async () => {
      const db = database.context(ada).db
      await expect(db.Post.distinct('editorNotes').all()).rejects.toBeInstanceOf(ValidationError)
      await expect(db.Post.distinct('nope').all()).rejects.toBeInstanceOf(ValidationError)
      await expect(
        db.Post.orderBy({ views: 'asc' }).cursor({ editorNotes: 'secret' }).all(),
      ).rejects.toBeInstanceOf(ValidationError)
    },
    BOOT,
  )

  test(
    'distinctOn and a cursor need an order to resume along',
    async () => {
      const db = database.context(ada).db
      await expect(db.Post.distinctOn('kind').all()).rejects.toBeInstanceOf(ValidationError)
      await expect(db.Post.cursor({ views: 1 }).all()).rejects.toBeInstanceOf(ValidationError)
    },
    BOOT,
  )

  test(
    'an aggregate over a distinct or paged read is refused rather than answered wrongly',
    async () => {
      const db = database.context(ada).db
      await expect(
        db.Post.distinct('kind').aggregate((aggregate) => ({ count: aggregate.count() })),
      ).rejects.toBeInstanceOf(ValidationError)
      await expect(
        db.Post.orderBy({ views: 'asc' })
          .cursor({ views: 1 })
          .aggregate((aggregate) => ({ count: aggregate.count() })),
      ).rejects.toBeInstanceOf(ValidationError)
    },
    BOOT,
  )
})

/**
 * Method absence is the contract: a method appears on the wrapper only where
 * the engine knows how to scope it, so its absence is what tells a reader the
 * engine cannot (ADR-0041). These assertions are compile-time — `Absent`
 * resolves to `never` the moment the key appears, and `= true` stops
 * compiling — with the runtime pair below for the built surface.
 */
type Absent<T, K extends PropertyKey> = K extends keyof T ? never : true

const noGroupBy: Absent<SecuredQuery, 'groupBy'> = true
const noUpdateAll: Absent<SecuredQuery, 'updateAll'> = true
const noDeleteAll: Absent<SecuredQuery, 'deleteAll'> = true
const noCreateAll: Absent<SecuredQuery, 'createAll'> = true
const noCreateAndCount: Absent<SecuredQuery, 'createAndCount'> = true
const noUpdateAndCount: Absent<SecuredQuery, 'updateAndCount'> = true
const noDeleteAndCount: Absent<SecuredQuery, 'deleteAndCount'> = true
const noUpsert: Absent<SecuredQuery, 'upsert'> = true

describe('what the wrapper does not carry', () => {
  test('the compile-time fixtures hold', () => {
    expect([
      noGroupBy,
      noUpdateAll,
      noDeleteAll,
      noCreateAll,
      noCreateAndCount,
      noUpdateAndCount,
      noDeleteAndCount,
      noUpsert,
    ]).toEqual(Array.from({ length: 8 }, () => true))
  })

  test(
    'the built surface carries none of them either',
    async () => {
      const query = database.context(ada).db.Post
      for (const member of [
        'groupBy',
        'updateAll',
        'deleteAll',
        'createAll',
        'createAndCount',
        'updateAndCount',
        'deleteAndCount',
        'upsert',
      ]) {
        expect(Reflect.get(query, member)).toBeUndefined()
      }
      // Not vacuous: the members the engine does scope are right there.
      for (const member of ['where', 'all', 'first', 'aggregate']) {
        expect(typeof Reflect.get(query, member)).toBe('function')
      }
    },
    BOOT,
  )
})
