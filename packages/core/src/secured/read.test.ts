import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import type { Session } from '../access/types.js'
import { checkbox, relationship, text } from '../fields/index.js'
import { withOrigin } from '../origin.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import { createPlanRecorder } from '../testing/plans.js'
import { lowerPredicate, UnsupportedPredicateError } from './read.js'

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
      },
      access: { operation: { query: () => true } },
    },
    Post: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        published: checkbox({ defaultValue: false }),
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
    author: ada.userId,
    editorNotes: 'secret',
  })
  await seed('Post', { title: "ada's draft", published: false, author: ada.userId })
  await seed('Post', { title: "bob's published", published: true, author: bob.userId })
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

      expect(Object.keys(query).sort()).toEqual(['all', 'first', 'where'])
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

describe('a predicate the engine cannot lower is refused', () => {
  test(
    'an operator outside the vocabulary throws rather than widening the read',
    async () => {
      await expect(
        database
          .context(ada)
          // @ts-expect-error -- the vocabulary refuses this at compile time too
          .db.Post.where({ title: { contains: 'ada' } })
          .all(),
      ).rejects.toBeInstanceOf(UnsupportedPredicateError)
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

// The two spellings behave oppositely today: `lowerPredicate` skips an
// `undefined` condition (Prisma's `undefined`-means-omitted semantics) and
// refuses the explicit `{ equals: undefined }`. #1147 makes the lowering total;
// these tests are what makes that a visible change rather than a silent one.
describe('an undefined condition, pending the total Where vocabulary (#1147)', () => {
  test('a bare `undefined` is skipped, so the entry constrains nothing', () => {
    expect(lowerPredicate('Post', { authorId: undefined })).toEqual({})
    expect(lowerPredicate('Post', { published: true, authorId: undefined })).toEqual({
      published: true,
    })
  })

  test('the same rule spelled `{ equals: undefined }` is refused', () => {
    expect(() => lowerPredicate('Post', { authorId: { equals: undefined } })).toThrow(
      UnsupportedPredicateError,
    )
  })

  test(
    'an Access Filter that yields undefined therefore widens the read to every row',
    async () => {
      await seed('Widened', { title: "ada's", owner: 'ada' })
      await seed('Widened', { title: "bob's", owner: 'bob' })

      const anonymous = await database.context(null).db.Widened.all()
      expect(titles(anonymous)).toEqual(["ada's", "bob's"])
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
      expect(Object.keys(context.db).sort()).toEqual(['Draft', 'Empty', 'Post', 'User', 'Widened'])
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
