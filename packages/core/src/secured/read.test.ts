import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import type { Session } from '../access/types.js'
import { checkbox, integer, relationship, text } from '../fields/index.js'
import { withOrigin } from '../origin.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import { createPlanRecorder } from '../testing/plans.js'
import { ValidationError } from '../hooks/index.js'
import { AccessFilterRecursionError, type Where } from './vocabulary.js'

const BOOT = 120_000

/** Ids the database mints, filled in by {@link seedBlog}. */
let ada: Session = {}
let bob: Session = {}

/**
 * A blog fixture with one rule per shape the terminals have to honour: a list
 * open to everyone, one whose `query` access is a filter that differs by
 * session, and one that declares no rule at all (denied by default).
 */
const blogConfig: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    User: {
      fields: {
        handle: text({ validation: { isRequired: true } }),
        posts: relationship({ ref: 'Post.author', many: true }),
        secrets: relationship({ ref: 'Secret.owner', many: true }),
        // A relationship the session may not read: `orderBy` must refuse it
        // with the message an undeclared key gets, not one that confirms it.
        hidden: relationship({ ref: 'Secret', access: { read: () => false } }),
      },
      access: { operation: { query: () => true } },
    },
    Post: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        published: checkbox({ defaultValue: false }),
        views: integer({ defaultValue: 0 }),
        editorNotes: text({ access: { read: () => false } }),
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
    Draft: {
      fields: { title: text({ validation: { isRequired: true } }) },
    },
    // Declares no rule, so `query` is denied by default — the related list a
    // relation quantifier has to read as the empty set.
    Secret: {
      fields: {
        code: text({ validation: { isRequired: true } }),
        owner: relationship({ ref: 'User.secrets' }),
      },
    },
    Empty: {
      fields: { title: text({ validation: { isRequired: true } }) },
      access: { operation: { query: () => true } },
    },
    Widened: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        owner: text(),
      },
      access: { operation: { query: ({ session }) => ({ owner: session?.userId }) } },
    },
    // An Access Filter that scopes by a relation on its own list: expanding it
    // re-enters the same filter, so it has no fixed point.
    SelfRef: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        parent: relationship({ ref: 'SelfRef.children' }),
        children: relationship({ ref: 'SelfRef.parent', many: true }),
      },
      access: {
        operation: { query: () => ({ parent: { some: { title: { equals: 'root' } } } }) },
      },
    },
    // The same shape spread across two lists, which no single-list guard sees.
    Left: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        rights: relationship({ ref: 'Right.left', many: true }),
      },
      access: { operation: { query: () => ({ rights: { some: {} } }) } },
    },
    Right: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        left: relationship({ ref: 'Left.rights' }),
      },
      access: { operation: { query: () => ({ left: { some: {} } }) } },
    },
  },
}

const recorder = createPlanRecorder()
let database: TestDatabase

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The client's own collection, as the harness exposes it (ADR-0057). */
function collection(model: string): Record<string, unknown> {
  const namespace: unknown = Reflect.get(database.client.orm, 'public')
  if (!isRecord(namespace)) throw new Error('no public namespace')
  const found: unknown = Reflect.get(namespace, model)
  if (!isRecord(found)) throw new Error(`no collection "${model}"`)
  return found
}

/**
 * Seed through the Unsafe origin rather than the secured surface: writes are
 * spec 4's, and a seed that went through the engine would make the read test
 * depend on the write path it is meant to be independent of.
 */
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
  return { userId: row.id }
}

async function seedBlog(): Promise<void> {
  ada = await seedUser('ada')
  bob = await seedUser('bob')
  await seed('Post', {
    title: "ada's published",
    published: true,
    views: 10,
    author: ada.userId,
    editorNotes: 'secret',
  })
  await seed('Post', {
    title: "ada's draft",
    published: false,
    views: 2,
    author: ada.userId,
  })
  await seed('Post', {
    title: "bob's published",
    published: true,
    views: 5,
    author: bob.userId,
  })
  await seed('Draft', { title: 'nobody may read this' })
}

/** Every column the recorded plan's `where` compares against, in order. */
function filterColumns(node: unknown): string[] {
  if (!isRecord(node)) return []
  const kind: unknown = node.kind
  if (kind === 'and' || kind === 'or') {
    const exprs: unknown = node.exprs
    return Array.isArray(exprs) ? exprs.flatMap((expr) => filterColumns(expr)) : []
  }
  const left: unknown = node.left
  if (isRecord(left) && typeof left.column === 'string') return [left.column]
  return []
}

function titles(rows: readonly Record<string, unknown>[]): unknown[] {
  return rows.map((row) => row.title).sort()
}

beforeAll(async () => {
  database = await createTestDatabase(blogConfig, { middleware: [recorder.middleware] })
}, BOOT)

afterAll(async () => {
  await database?.close()
})

beforeEach(async () => {
  await database.truncate()
  recorder.clear()
})

describe('a real round trip through the secured surface', () => {
  test(
    'a row written to the database is read back through context.db.<List>',
    async () => {
      const author = await seedUser('ada')
      const written = await seed('Post', {
        title: 'written by the driver',
        published: true,
        author: author.userId,
      })

      const rows = await database.context(author).db.Post.all()

      expect(rows).toHaveLength(1)
      // `id` and `createdAt` are the database's, never the caller's: a read
      // that short-circuited could not produce either.
      expect(rows[0]).toMatchObject({
        id: written.id,
        title: 'written by the driver',
        createdAt: written.createdAt,
      })
      expect(recorder.plans.some((plan) => plan.kind === 'select')).toBe(true)
    },
    BOOT,
  )

  test(
    'the round-trip assertion is falsifiable: a short-circuited read fails it',
    async () => {
      const author = await seedUser('ada')
      const written = await seed('Draft', { title: 'written by the driver' })

      // `Draft` declares no `query` rule, so the read is denied before the
      // database is reached — the short-circuit the assertion above must not
      // be able to pass under.
      const rows = await database.context(author).db.Draft.all()

      expect(rows).toEqual([])
      expect(() =>
        expect(rows[0]).toMatchObject({ id: written.id, title: 'written by the driver' }),
      ).toThrow()
    },
    BOOT,
  )
})

describe('Silent failure', () => {
  beforeEach(async () => {
    await seedBlog()
    recorder.clear()
  })

  test(
    'an anonymous session sees exactly the published rows',
    async () => {
      const rows = await database.context(null).db.Post.all()
      expect(titles(rows)).toEqual(["ada's published", "bob's published"])
    },
    BOOT,
  )

  test(
    'an author sees exactly their own rows, published or not',
    async () => {
      const rows = await database.context(ada).db.Post.all()
      expect(titles(rows)).toEqual(["ada's draft", "ada's published"])
    },
    BOOT,
  )

  test(
    'another user sees exactly their own rows',
    async () => {
      const rows = await database.context(bob).db.Post.all()
      expect(titles(rows)).toEqual(["bob's published"])
    },
    BOOT,
  )

  test(
    'a denied list is indistinguishable from an empty one',
    async () => {
      const context = database.context(ada)
      expect(await context.db.Draft.all()).toEqual(await context.db.Empty.all())
      expect(await context.db.Draft.first()).toEqual(await context.db.Empty.first())
      expect(await context.db.Draft.first()).toBeNull()
    },
    BOOT,
  )

  test(
    'a denied read reaches no database at all',
    async () => {
      await database.context(ada).db.Draft.all()
      expect(recorder.plans).toEqual([])
    },
    BOOT,
  )

  test(
    'first() returns one row this session may see',
    async () => {
      const row = await database.context(bob).db.Post.first()
      expect(row).toMatchObject({ title: "bob's published" })
    },
    BOOT,
  )
})

describe('the Access Filter is a filter entry', () => {
  beforeEach(async () => {
    await seedBlog()
    recorder.clear()
  })

  test(
    "it is ANDed with the caller's predicate rather than merged into it",
    async () => {
      const rows = await database.context(ada).db.Post.where({ published: true }).all()

      expect(titles(rows)).toEqual(["ada's published"])
      expect(recorder.plans).toHaveLength(1)
      const where: unknown = isRecord(recorder.plans[0].ast)
        ? Reflect.get(recorder.plans[0].ast, 'where')
        : undefined
      expect(isRecord(where) ? where.kind : undefined).toBe('and')
      // The plan names physical columns: the `authorId` the access filter
      // spells is the relationship field's own `author` column.
      expect(filterColumns(where)).toEqual(['published', 'author'])
    },
    BOOT,
  )

  test(
    'a read with no caller predicate carries the access filter alone',
    async () => {
      await database.context(ada).db.Post.all()

      const where: unknown = isRecord(recorder.plans[0].ast)
        ? Reflect.get(recorder.plans[0].ast, 'where')
        : undefined
      expect(filterColumns(where)).toEqual(['author'])
    },
    BOOT,
  )

  test(
    'sudo carries the caller predicate and no access filter',
    async () => {
      const rows = await database.context(ada).sudo().db.Post.where({ published: false }).all()

      expect(titles(rows)).toEqual(["ada's draft"])
      const where: unknown = isRecord(recorder.plans[0].ast)
        ? Reflect.get(recorder.plans[0].ast, 'where')
        : undefined
      expect(filterColumns(where)).toEqual(['published'])
    },
    BOOT,
  )
})

describe('a composed read is an immutable value', () => {
  beforeEach(async () => {
    await seedBlog()
    recorder.clear()
  })

  test(
    'narrowing a query leaves the query it was narrowed from alone',
    async () => {
      const base = database.context(ada).db.Post.where({ published: false })
      const narrowed = base.where({ title: "ada's published" })

      expect(titles(await narrowed.all())).toEqual([])
      expect(titles(await base.all())).toEqual(["ada's draft"])
    },
    BOOT,
  )

  test(
    'no Collection and no CollectionState is reachable from the wrapper',
    async () => {
      const query = database.context(ada).db.Post.where({ published: true })

      expect(Object.keys(query).sort()).toEqual(['all', 'first', 'orderBy', 'where'])
      for (const member of ['state', 'ctx', 'modelName', 'registry', 'tableName']) {
        expect(Reflect.get(query, member)).toBeUndefined()
      }
    },
    BOOT,
  )
})

describe('Field Visibility', () => {
  beforeEach(async () => {
    await seedBlog()
    recorder.clear()
  })

  test(
    'a field this session cannot read is absent from the row',
    async () => {
      const rows = await database.context(ada).db.Post.where({ published: true }).all()
      expect(rows[0]).toMatchObject({ title: "ada's published" })
      expect(rows[0].editorNotes).toBeUndefined()
    },
    BOOT,
  )

  test(
    'a predicate naming a field this session cannot read is refused',
    async () => {
      await expect(
        database.context(ada).db.Post.where({ editorNotes: 'secret' }).all(),
      ).rejects.toThrow(/editorNotes/)
    },
    BOOT,
  )

  test(
    'a predicate naming a column the list does not declare is refused',
    async () => {
      await expect(database.context(ada).db.Post.where({ nope: 'x' }).all()).rejects.toThrow(/nope/)
    },
    BOOT,
  )
})

describe('the Where vocabulary', () => {
  beforeEach(async () => {
    await seedBlog()
    recorder.clear()
  })

  const owned = (predicate: Where) => database.context(ada).sudo().db.Post.where(predicate)

  test(
    'every scalar operator lowers and returns the rows it names',
    async () => {
      expect(titles(await owned({ title: { equals: "ada's draft" } }).all())).toEqual([
        "ada's draft",
      ])
      expect(titles(await owned({ title: { not: "ada's draft" } }).all())).toEqual([
        "ada's published",
        "bob's published",
      ])
      expect(titles(await owned({ views: { in: [2, 5] } }).all())).toEqual([
        "ada's draft",
        "bob's published",
      ])
      expect(titles(await owned({ views: { notIn: [2, 5] } }).all())).toEqual(["ada's published"])
      expect(titles(await owned({ views: { lt: 5 } }).all())).toEqual(["ada's draft"])
      expect(titles(await owned({ views: { lte: 5 } }).all())).toEqual([
        "ada's draft",
        "bob's published",
      ])
      expect(titles(await owned({ views: { gt: 5 } }).all())).toEqual(["ada's published"])
      expect(titles(await owned({ views: { gte: 5 } }).all())).toEqual([
        "ada's published",
        "bob's published",
      ])
      expect(titles(await owned({ title: { contains: 'draft' } }).all())).toEqual(["ada's draft"])
    },
    BOOT,
  )

  test(
    'operators on one column are ANDed',
    async () => {
      expect(titles(await owned({ views: { gte: 2, lt: 10 } }).all())).toEqual([
        "ada's draft",
        "bob's published",
      ])
    },
    BOOT,
  )

  test(
    'contains is case-insensitive and matches a literal per-cent sign',
    async () => {
      await seed('Post', { title: '50% off, ADA', published: true, views: 1, author: ada.userId })

      expect(titles(await owned({ title: { contains: 'ada' } }).all())).toEqual([
        '50% off, ADA',
        "ada's draft",
        "ada's published",
      ])
      // `%` is escaped rather than bound as a wildcard, so this matches the one
      // title that carries the character itself.
      expect(titles(await owned({ title: { contains: '50%' } }).all())).toEqual(['50% off, ADA'])
      expect(titles(await owned({ title: { contains: '%' } }).all())).toEqual(['50% off, ADA'])
    },
    BOOT,
  )

  test(
    'equals: null is IS NULL and not: null is IS NOT NULL',
    async () => {
      await seed('Post', { title: 'unowned', published: true, views: 0 })

      expect(titles(await owned({ author: { some: {} } }).all())).toEqual([
        "ada's draft",
        "ada's published",
        "bob's published",
      ])
      expect(titles(await owned({ authorId: { equals: null } }).all())).toEqual(['unowned'])
      expect(titles(await owned({ authorId: { not: null } }).all())).toEqual([
        "ada's draft",
        "ada's published",
        "bob's published",
      ])
    },
    BOOT,
  )

  test(
    'AND, OR and NOT combine predicates',
    async () => {
      expect(
        titles(
          await owned({
            OR: [{ title: { contains: 'draft' } }, { views: { equals: 5 } }],
          }).all(),
        ),
      ).toEqual(["ada's draft", "bob's published"])

      expect(
        titles(await owned({ AND: [{ published: true }, { views: { gt: 5 } }] }).all()),
      ).toEqual(["ada's published"])

      expect(titles(await owned({ NOT: { published: true } }).all())).toEqual(["ada's draft"])
    },
    BOOT,
  )

  test(
    'a relation quantifier lowers to an EXISTS over the related list',
    async () => {
      const handles = async (predicate: Where): Promise<unknown[]> =>
        (await database.context(ada).db.User.where(predicate).all()).map((row) => row.handle).sort()

      expect(await handles({ posts: { some: { published: false } } })).toEqual(['ada'])
      expect(await handles({ posts: { none: { published: false } } })).toEqual(['bob'])
      expect(await handles({ posts: { some: {} } })).toEqual(['ada'])
    },
    BOOT,
  )

  test(
    'a relation predicate ANDs the related list access filter inside the EXISTS',
    async () => {
      const handles = async (predicate: Where): Promise<unknown[]> =>
        (await database.context(null).db.User.where(predicate).all())
          .map((row) => row.handle)
          .sort()

      // Anonymously, `Post` scopes to published rows, so the draft is not
      // visible to the quantifier at all: `some` cannot find it, and `every`
      // is measured over the visible rows only.
      expect(await handles({ posts: { some: { published: false } } })).toEqual([])
      expect(await handles({ posts: { some: {} } })).toEqual(['ada', 'bob'])
      expect(await handles({ posts: { none: { published: true } } })).toEqual([])
    },
    BOOT,
  )

  test(
    'every asks whether every VISIBLE row matches, so an invisible row decides nothing',
    async () => {
      const handles = async (session: Session | null, predicate: Where): Promise<unknown[]> =>
        (await database.context(session).db.User.where(predicate).all())
          .map((row) => row.handle)
          .sort()

      // ada owns a draft; bob does not. Anonymously neither draft nor any
      // unpublished row is visible, so both users' visible posts are all
      // published and both satisfy `every`. If the access filter were ANDed
      // into the quantifier body instead, ada would drop out here — a
      // positive signal about a row this caller may not see (#1123 story 10).
      expect(await handles(null, { posts: { every: { published: true } } })).toEqual(['ada', 'bob'])
      expect(await handles(null, { posts: { every: { published: false } } })).toEqual([])

      // ada's own session sees her draft, so it does decide her membership;
      // bob's posts are invisible to her, which makes his `every` vacuously
      // true rather than false.
      expect(await handles(ada, { posts: { every: { published: true } } })).toEqual(['bob'])
    },
    BOOT,
  )

  test(
    'a related list the session cannot query is the empty set',
    async () => {
      const context = database.context(ada)
      await seed('Secret', { code: 'shh', owner: ada.userId })

      // `Secret` denies `query`, so `some` is false and `none`/`every` are
      // true — the parent rows are never distinguished by a list the session
      // cannot see.
      expect(await context.db.User.where({ secrets: { some: {} } }).all()).toEqual([])
      expect(
        (await context.db.User.where({ secrets: { none: {} } }).all()).map((row) => row.handle),
      ).toEqual(['ada', 'bob'])
      expect(
        (await context.db.User.where({ secrets: { every: {} } }).all()).map((row) => row.handle),
      ).toEqual(['ada', 'bob'])
    },
    BOOT,
  )

  test(
    "orderBy sorts by the list's own columns",
    async () => {
      const context = database.context(ada).sudo()
      expect(titles(await context.db.Post.orderBy({ views: 'asc' }).all())).toEqual([
        "ada's draft",
        "ada's published",
        "bob's published",
      ])
      expect(
        (await context.db.Post.orderBy({ views: 'desc' }).all()).map((row) => row.views),
      ).toEqual([10, 5, 2])
    },
    BOOT,
  )

  test(
    'orderBy is scalar-only: a relation is refused',
    async () => {
      await expect(database.context(ada).db.Post.orderBy({ author: 'asc' }).all()).rejects.toThrow(
        /scalar columns only/,
      )
    },
    BOOT,
  )
})

describe("the engine's own recursion is bounded", () => {
  test(
    'an Access Filter that expands into itself refuses the read and names the lists',
    async () => {
      await expect(database.context(ada).db.SelfRef.all()).rejects.toThrow(
        /Access Filter on "SelfRef" is cyclic.*SelfRef → SelfRef/s,
      )
      expect(recorder.plans).toEqual([])
    },
    BOOT,
  )

  test(
    'two lists whose Access Filters reference each other are refused the same way',
    async () => {
      await expect(database.context(ada).db.Left.all()).rejects.toThrow(
        /is cyclic.*Left → Right → Left/s,
      )
      await expect(database.context(ada).db.Right.all()).rejects.toThrow(
        /is cyclic.*Right → Left → Right/s,
      )
      expect(recorder.plans).toEqual([])
    },
    BOOT,
  )

  test(
    'the refusal is loud, not a truncated filter: no rows come back either way',
    async () => {
      await seed('SelfRef', { title: 'root' })
      // A truncated Access Filter would be a widened read, so the failure has
      // to be an error rather than a result set of any size.
      await expect(database.context(ada).db.SelfRef.all()).rejects.toThrow(
        AccessFilterRecursionError,
      )
    },
    BOOT,
  )
})

describe('the vocabulary is closed, and refusing is not an oracle', () => {
  beforeEach(async () => {
    await seedBlog()
    recorder.clear()
  })

  const message = async (run: Promise<unknown>): Promise<string> => {
    try {
      await run
    } catch (error) {
      if (error instanceof ValidationError) return error.errors.join(' ')
      throw error
    }
    throw new Error('the read was expected to be refused')
  }

  test(
    'an unknown key names the list and the key',
    async () => {
      await expect(database.context(ada).db.Post.where({ nope: 'x' }).all()).rejects.toThrow(
        /Cannot query "Post" — "nope"/,
      )
    },
    BOOT,
  )

  test(
    'an unknown operator names the list and the key',
    async () => {
      await expect(
        database
          .context(ada)
          .db.Post.where({ title: { startsWith: 'ada' } })
          .all(),
      ).rejects.toThrow(/Cannot query "Post" — "title" was given "startsWith"/)
    },
    BOOT,
  )

  test(
    'sudo is refused identically: an unknown operator is a bug, not a permission',
    async () => {
      const context = database.context(ada).sudo()
      await expect(context.db.Post.where({ nope: 'x' }).all()).rejects.toThrow(
        /Cannot query "Post" — "nope"/,
      )
      await expect(context.db.Post.where({ title: { mode: 'insensitive' } }).all()).rejects.toThrow(
        /is not part of the Where vocabulary/,
      )
      expect(recorder.plans).toEqual([])
    },
    BOOT,
  )

  test(
    'a read-denied field is refused identically to one the list does not declare',
    async () => {
      const context = database.context(ada)
      const denied = await message(context.db.Post.where({ editorNotes: 'secret' }).all())
      const absent = await message(context.db.Post.where({ nope: 'secret' }).all())

      expect(denied.replace('editorNotes', 'nope')).toBe(absent)
    },
    BOOT,
  )

  test(
    'orderBy refuses a read-denied relationship exactly as it refuses an absent key',
    async () => {
      const context = database.context(ada)
      const denied = await message(context.db.User.orderBy({ hidden: 'asc' }).all())
      const absent = await message(context.db.User.orderBy({ nope: 'asc' }).all())

      expect(denied.replace('hidden', 'nope')).toBe(absent)
      expect(denied).not.toMatch(/scalar columns only/)
    },
    BOOT,
  )

  test(
    'a nested predicate is validated whether or not the related list is queryable',
    async () => {
      const context = database.context(ada)
      // `Secret` denies `query` and `Post` does not; refusing the nested key
      // in only one of them would make the refusal an existence oracle for
      // the related list's own access.
      const denied = await message(context.db.User.where({ secrets: { some: { nope: 1 } } }).all())
      const queryable = await message(context.db.User.where({ posts: { some: { nope: 1 } } }).all())

      expect(denied).toBe('Cannot query "Secret" — "nope" is not a queryable field of this list.')
      expect(denied.replace('Secret', 'Post')).toBe(queryable)
    },
    BOOT,
  )

  test(
    'a denied caller never reaches key validation at all',
    async () => {
      // `Draft` denies `query` outright, so the Silent failure comes first: an
      // undeclared key must not tell an unauthorised caller anything.
      expect(await database.context(ada).db.Draft.where({ nope: 'x' }).all()).toEqual([])
      expect(recorder.plans).toEqual([])
    },
    BOOT,
  )
})

// The lowering is total: an `undefined` condition is refused on BOTH spellings.
// Before #1147 the bare spelling was skipped, which silently widened the read —
// and because the Access Filter is lowered through the same seam, the idiomatic
// `({ session }) => ({ owner: session?.userId })` matched every row for an
// anonymous caller. These tests pinned that behaviour; they now pin its refusal.
describe('the lowering is total', () => {
  test(
    'a bare `undefined` is refused rather than dropped',
    async () => {
      await expect(database.context(ada).db.Post.where({ title: undefined }).all()).rejects.toThrow(
        /is undefined/,
      )
    },
    BOOT,
  )

  test(
    'the same rule spelled `{ equals: undefined }` is refused identically',
    async () => {
      await expect(
        database
          .context(ada)
          .db.Post.where({ title: { equals: undefined } })
          .all(),
      ).rejects.toThrow(/is undefined/)
    },
    BOOT,
  )

  test(
    'an Access Filter that yields undefined refuses the read instead of widening it',
    async () => {
      await seed('Widened', { title: "ada's", owner: 'ada' })
      await seed('Widened', { title: "bob's", owner: 'bob' })

      await expect(database.context(null).db.Widened.all()).rejects.toThrow(/is undefined/)
      expect(titles(await database.context({ userId: 'ada' }).db.Widened.all())).toEqual(["ada's"])
    },
    BOOT,
  )
})

describe('every terminal runs inside the engine origin', () => {
  beforeEach(async () => {
    await seedBlog()
    recorder.clear()
  })

  test(
    'all() and first() compile their plans under the engine stamp',
    async () => {
      const context = database.context(ada)
      await context.db.Post.all()
      await context.db.Post.where({ published: true }).first()

      expect(recorder.plans).toHaveLength(2)
      expect(recorder.plans.map((plan) => plan.origin)).toEqual(['engine', 'engine'])
    },
    BOOT,
  )
})

describe('context.db is keyed by the PascalCase list name', () => {
  test(
    'the list key is the config spelling and the camelCase key is absent',
    async () => {
      const context = database.context(null)
      expect(typeof context.db.Post.all).toBe('function')
      expect(Reflect.get(context.db, 'post')).toBeUndefined()
      expect(Object.keys(context.db).sort()).toEqual([
        'Draft',
        'Empty',
        'Left',
        'Post',
        'Right',
        'Secret',
        'SelfRef',
        'User',
        'Widened',
      ])
    },
    BOOT,
  )

  test(
    'getDbKey is gone from the package entry',
    async () => {
      const core: Record<string, unknown> = await import('../index.js')
      expect('getDbKey' in core).toBe(false)
      expect(typeof core.getUrlKey).toBe('function')
    },
    BOOT,
  )
})
