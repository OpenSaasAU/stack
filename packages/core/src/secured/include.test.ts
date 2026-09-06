import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import type { AccessContext, Session } from '../access/types.js'
import { checkbox, relationship, text, virtual } from '../fields/index.js'
import { withOrigin } from '../origin.js'
import { createTestDatabase, ormClientFor, type TestDatabase } from '../testing/context.js'
import { createPlanRecorder } from '../testing/plans.js'
import { AccessScopeDepthExceededError } from '../access/errors.js'
import { buildAccessScopedInclude } from '../access/access-filter.js'
import {
  DuplicateIncludeError,
  InvalidRefinementError,
  NestedToOneIncludeError,
} from './include.js'

const BOOT = 120_000

let ada: Session = {}
let bob: Session = {}

/** A chain of lists long enough to reach the read-include depth cap and pass it. */
function chain(length: number): OpenSaasConfig['lists'] {
  const names = Array.from({ length }, (_, index) => `C${index + 1}`)
  const lists: OpenSaasConfig['lists'] = {}
  names.forEach((name, index) => {
    const next = names[index + 1]
    const previous = names[index - 1]
    lists[name] = {
      fields: {
        label: text({ validation: { isRequired: true } }),
        ...(next ? { next: relationship({ ref: `${next}.prev`, many: true }) } : {}),
        ...(previous
          ? {
              prev: relationship({ ref: `${previous}.next` }),
              // A live declared dependency set naming a relation, at every
              // level of the chain: the engine's own widening is exempt from
              // the cap, so a tree at the cap is served with one in play.
              summary: virtual({
                type: 'string',
                needs: ['prev'],
                hooks: { resolveOutput: () => 'summary' },
              }),
            }
          : {}),
      },
      access: { operation: { query: () => true } },
    }
  })
  return lists
}

/**
 * A blog fixture carrying one relation per shape the include path has to
 * honour: a to-one the Access Filter scopes away, a to-many whose list is
 * denied outright, a relation whose own `read` rule is row-independent, one
 * whose rule is row-dependent, one that is both denied and declared, a
 * one-to-one reachable from either side, and a list-only ref whose target
 * carries only the synthetic back-relation.
 */
const blogConfig: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    User: {
      // A session sees itself and nobody else, so an author written by
      // somebody else is a to-one the Access Filter scopes away rather than a
      // row that does not exist.
      fields: {
        handle: text({ validation: { isRequired: true } }),
        posts: relationship({ ref: 'Post.author', many: true }),
        secrets: relationship({ ref: 'Secret.owner', many: true }),
        badge: relationship({ ref: 'Badge.user' }),
      },
      access: {
        operation: { query: ({ session }) => ({ handle: { equals: session?.handle ?? '' } }) },
      },
    },
    Badge: {
      fields: {
        label: text({ validation: { isRequired: true } }),
        user: relationship({ ref: 'User.badge' }),
      },
      access: { operation: { query: () => true } },
    },
    Post: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        published: checkbox({ defaultValue: false }),
        author: relationship({ ref: 'User.posts' }),
        // The same shape as `author`, with the foreign-key column renamed, so
        // nothing about the include collides with it. What the caller may see
        // must not depend on that.
        mappedAuthor: relationship({
          ref: 'User',
          db: { foreignKey: { map: 'mapped_author_id' } },
        }),
        category: relationship({ ref: 'Category' }),
        editorNotes: text({ access: { read: () => false } }),
        // Row-independent and denies: omitted before the query runs.
        hiddenEditor: relationship({ ref: 'User', access: { read: () => false } }),
        // Denied the same way, but declared by `summary` below: fetched for
        // the hook and stripped from the caller's result.
        declaredEditor: relationship({ ref: 'User', access: { read: () => false } }),
        // Row-dependent: never omitted, because it cannot be answered without
        // a row. Field Visibility is the one that decides.
        reviewer: relationship({
          ref: 'User',
          access: { read: ({ item }) => item?.published === true },
        }),
        summary: virtual({
          type: 'string',
          needs: ['declaredEditor'],
          hooks: { resolveOutput: () => 'summary' },
        }),
      },
      access: { operation: { query: () => true } },
    },
    Category: {
      fields: { name: text({ validation: { isRequired: true } }) },
      access: { operation: { query: () => true } },
    },
    // Declares no rule, so `query` is denied by default — the to-many an
    // include has to bring back as `[]` with the key present.
    Secret: {
      fields: {
        code: text({ validation: { isRequired: true } }),
        owner: relationship({ ref: 'User.secrets' }),
      },
    },
    ...chain(7),
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
 * Seed through the Unsafe origin: writes are spec 4's, and a seed that went
 * through the engine would make the read test depend on the write path.
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

/**
 * The relations the recorded plan actually reached: Prisma renders each
 * include as one more projection item whose expression is a subquery, aliased
 * by the relation's name.
 */
function includedRelations(plan: { ast: unknown } | undefined): string[] {
  if (plan === undefined || !isRecord(plan.ast)) return []
  const projection: unknown = Reflect.get(plan.ast, 'projection')
  if (!Array.isArray(projection)) return []
  return projection
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .filter((item) => isRecord(item.expr) && item.expr.kind === 'subquery')
    .map((item) => String(item.alias))
}

async function seedBlog(): Promise<void> {
  const adaRow = await seed('User', { handle: 'ada' })
  ada = { userId: adaRow.id, handle: 'ada' }
  const bobRow = await seed('User', { handle: 'bob' })
  bob = { userId: bobRow.id, handle: 'bob' }

  await seed('Badge', { label: "ada's badge", user: adaRow.id })
  await seed('Secret', { code: 'nobody may read this', owner: adaRow.id })

  const category = await seed('Category', { name: 'essays' })
  await seed('Post', {
    title: "ada's published",
    published: true,
    author: adaRow.id,
    mappedAuthorId: bobRow.id,
    category: category.id,
    editorNotes: 'secret',
    hiddenEditor: bobRow.id,
    declaredEditor: bobRow.id,
    reviewer: adaRow.id,
  })
  await seed('Post', {
    title: "bob's draft",
    published: false,
    author: bobRow.id,
    reviewer: adaRow.id,
  })
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

describe('One hop', () => {
  test(
    'a named relation comes back on every row, and nothing else does',
    async () => {
      const rows = await database
        .context(ada)
        .db.Post.where({ title: "ada's published" })
        .include('author')
        .all()

      expect(rows).toHaveLength(1)
      expect(rows[0].author).toMatchObject({ handle: 'ada' })
      // One hop: the author's own relations are not reached.
      expect(isRecord(rows[0].author) ? rows[0].author.posts : 'absent').toBeUndefined()
    },
    BOOT,
  )

  test(
    'a refinement narrows, sorts and pages the related rows',
    async () => {
      await seed('Post', { title: "ada's second", published: true, author: ada.userId })

      const rows = await database
        .context(ada)
        .db.User.include('posts', (posts) =>
          posts
            .where({ published: { equals: true } })
            .orderBy({ title: 'desc' })
            .limit(1),
        )
        .all()

      expect(rows).toHaveLength(1)
      expect(rows[0].posts).toEqual([expect.objectContaining({ title: "ada's second" })])
    },
    BOOT,
  )

  test(
    'a one-to-one reads from either side',
    async () => {
      const fromUser = await database.context(ada).db.User.include('badge').all()
      expect(fromUser).toHaveLength(1)
      expect(fromUser[0].badge).toMatchObject({ label: "ada's badge" })

      const fromBadge = await database.context(ada).db.Badge.include('user').all()
      expect(fromBadge).toHaveLength(1)
      expect(fromBadge[0].user).toMatchObject({ handle: 'ada' })
    },
    BOOT,
  )

  test(
    'a refinement that returns nothing is refused rather than dropped',
    async () => {
      expect(() =>
        database.context(ada).db.Post.include('author', (author) => {
          author.where({ handle: { equals: 'ada' } })
          return undefined as never
        }),
      ).toThrow(InvalidRefinementError)
    },
    BOOT,
  )
})

describe('the Access Filter rides into the include', () => {
  test(
    'a to-one the session cannot read is null and the parent row is kept',
    async () => {
      const rows = await database
        .context(ada)
        .db.Post.where({ title: "bob's draft" })
        .include('author')
        .all()

      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ title: "bob's draft" })
      expect(rows[0].author).toBeNull()
      expect('author' in rows[0]).toBe(true)
    },
    BOOT,
  )

  test(
    'a to-many scoped to nothing is [] with the key present',
    async () => {
      const rows = await database.context(ada).db.User.include('secrets').all()

      expect(rows).toHaveLength(1)
      expect(rows[0].secrets).toEqual([])
      // `Secret` declares no `query` rule, so the refinement is a
      // never-matching predicate rather than an absent key.
      expect(includedRelations(recorder.plans[0])).toEqual(['secrets'])
    },
    BOOT,
  )

  test(
    'the shape of the result does not vary by session',
    async () => {
      const seen = await database.context(ada).db.Post.include('author').all()
      const unseen = await database.context(bob).db.Post.include('author').all()

      expect(seen.map((row) => Object.keys(row).sort())).toEqual(
        unseen.map((row) => Object.keys(row).sort()),
      )
      expect(seen.map((row) => row.author === null)).toEqual([false, true])
      expect(unseen.map((row) => row.author === null)).toEqual([true, false])
    },
    BOOT,
  )

  test(
    "the refinement carries the related list's filter, not the parent's",
    async () => {
      await database.context(ada).db.Post.include('author').all()

      const [plan] = recorder.plans
      // `declaredEditor` rides along because `summary` declares it — the
      // widening, not the caller.
      expect(includedRelations(plan).sort()).toEqual(['author', 'declaredEditor'])
      expect(JSON.stringify(plan.ast)).toContain('"value":"ada"')
    },
    BOOT,
  )

  test(
    'sudo carries no access filter into the include',
    async () => {
      const rows = await database
        .context(ada)
        .sudo()
        .db.Post.where({ title: "bob's draft" })
        .include('author')
        .all()

      expect(rows[0].author).toMatchObject({ handle: 'bob' })
    },
    BOOT,
  )
})

describe('Field Visibility is the boundary, not the omission', () => {
  test(
    'a row-independent-denied relation is absent from the recorded plan',
    async () => {
      const rows = await database.context(ada).db.Post.include('hiddenEditor').all()

      expect(includedRelations(recorder.plans[0])).toEqual(['declaredEditor'])
      for (const row of rows) expect(row.hiddenEditor).toBeUndefined()
    },
    BOOT,
  )

  test(
    'a row-dependent-denied relation is fetched and stripped after the query',
    async () => {
      const rows = await database.context(ada).db.Post.include('reviewer').all()

      // Row-dependent: it cannot be answered without a row, so the omission
      // declines to answer and the relation is fetched.
      expect(includedRelations(recorder.plans[0]).sort()).toEqual(['declaredEditor', 'reviewer'])
      const published = rows.find((row) => row.published === true)
      const draft = rows.find((row) => row.published === false)
      expect(published?.reviewer).toMatchObject({ handle: 'ada' })
      expect(draft?.reviewer).toBeUndefined()
      // The relation is stripped from every key that could carry it, the
      // foreign-key column included: a stripped relation must not survive
      // under a second name.
      expect(draft?.reviewerId).not.toBe(ada.userId)
      expect(JSON.stringify(draft)).not.toContain('ada')
    },
    BOOT,
  )

  test(
    'a relation in a live declared dependency set is fetched and still stripped',
    async () => {
      const rows = await database.context(ada).db.Post.include('declaredEditor').all()

      expect(includedRelations(recorder.plans[0])).toEqual(['declaredEditor'])
      for (const row of rows) expect(row.declaredEditor).toBeUndefined()
    },
    BOOT,
  )

  test(
    'a denied relation reached under sudo is neither omitted nor stripped',
    async () => {
      const rows = await database
        .context(ada)
        .sudo()
        .db.Post.where({ title: "ada's published" })
        .include('hiddenEditor')
        .all()

      expect(includedRelations(recorder.plans[0]).sort()).toEqual([
        'declaredEditor',
        'hiddenEditor',
      ])
      expect(rows[0].hiddenEditor).toMatchObject({ handle: 'bob' })
    },
    BOOT,
  )
})

describe("the foreign key follows the relation's own visibility", () => {
  test(
    'a to-one the Access Filter scoped away leaves no id behind',
    async () => {
      const [row] = await database
        .context(ada)
        .db.Post.where({ title: "bob's draft" })
        .include('author')
        .all()

      expect(row.author).toBeNull()
      expect(row.authorId).toBeNull()
      expect(row.authorId).not.toBe(bob.userId)
    },
    BOOT,
  )

  test(
    'a renamed foreign-key column is treated no differently',
    async () => {
      // `mappedAuthor` carries `db.foreignKey.map`, so the include's alias and
      // the physical column never collide — and the id must still not survive
      // a relation the caller cannot see.
      const [row] = await database
        .context(ada)
        .db.Post.where({ title: "ada's published" })
        .include('mappedAuthor')
        .all()

      expect(row.mappedAuthor).toBeNull()
      expect(row.mappedAuthorId).toBeNull()
      expect(row.mappedAuthorId).not.toBe(bob.userId)
    },
    BOOT,
  )

  test(
    'a row-dependent denial takes the foreign key with it',
    async () => {
      const rows = await database.context(ada).db.Post.include('reviewer').all()
      const draft = rows.find((row) => row.published === false)

      expect(draft?.reviewer).toBeUndefined()
      expect(draft?.reviewerId).toBeNull()
      expect(draft?.reviewerId).not.toBe(ada.userId)
    },
    BOOT,
  )

  test(
    'a visible to-one keeps its own id',
    async () => {
      const [row] = await database
        .context(ada)
        .db.Post.where({ title: "ada's published" })
        .include('author')
        .all()

      expect(row.author).toMatchObject({ handle: 'ada' })
      expect(row.authorId).toBe(ada.userId)
    },
    BOOT,
  )

  test(
    'a read-denied relation is unqueryable under its foreign key too',
    async () => {
      const denied = database
        .context(ada)
        .db.Post.where({ hiddenEditorId: { not: null } })
        .all()
      const undeclared = database
        .context(ada)
        .db.Post.where({ nopeId: { not: null } })
        .all()

      await expect(denied).rejects.toThrow(/not a queryable field/)
      await expect(undeclared).rejects.toThrow(/not a queryable field/)
    },
    BOOT,
  )
})

describe('a nested to-one is refused until #1236', () => {
  test(
    'the refusal names the relation and the issue rather than reaching the database',
    async () => {
      const nested = database
        .context(ada)
        .db.User.include('posts', (posts) => posts.include('author'))
        .all()

      await expect(nested).rejects.toThrow(NestedToOneIncludeError)
      await expect(nested).rejects.toThrow(/1236/)
      expect(recorder.plans).toEqual([])
    },
    BOOT,
  )

  test(
    'a nested to-one whose column is renamed is served',
    async () => {
      // The collision is the column name, not the arity: the day #1236 renames
      // every to-one's column, the guard above is the deletion and this is the
      // shape that already worked.
      const rows = await database
        .context(ada)
        .db.User.include('posts', (posts) => posts.include('mappedAuthor'))
        .all()

      expect(rows).toHaveLength(1)
      expect(rows[0].posts).toEqual([
        expect.objectContaining({ title: "ada's published", mappedAuthor: null }),
      ])
    },
    BOOT,
  )
})

describe('a relation named twice is refused', () => {
  test(
    'the refusal names the relation, at the top level and inside a refinement',
    async () => {
      const top = database
        .context(ada)
        .db.Post.include('author')
        .include('author', (author) => author.where({ handle: { equals: 'ada' } }))
        .all()
      const nested = database
        .context(ada)
        .db.User.include('posts', (posts) => posts.include('category').include('category'))
        .all()

      await expect(top).rejects.toThrow(DuplicateIncludeError)
      await expect(top).rejects.toThrow(/author/)
      await expect(nested).rejects.toThrow(/category/)
      expect(recorder.plans).toEqual([])
    },
    BOOT,
  )
})

describe('the two read surfaces scope a filtered to-one identically', () => {
  test(
    'both mechanisms scope Post.author by the same rule, and reach the same answer',
    async () => {
      // Two mechanisms, one answer. The legacy method surface flags a filtered
      // to-one for a post-query existence check carrying the related list's
      // own `query` filter; the secured surface pushes that same filter into
      // the join. Both stay alive until `context/index.ts` is transformed
      // (#1237), and nothing else pins them to each other.
      //
      // The legacy surface's own terminal cannot run here: it drives a
      // Prisma 7 `findMany` the rc.8 client does not carry. So the comparison
      // is made where both are observable — the filter each mechanism decides
      // on, and the row the secured one returns under it.
      const context = database.context(ada)
      const accessContext: AccessContext = {
        ...context,
        ormHandle: ormClientFor(database.data, database.client.orm),
        _resolveOutputChain: [],
      }
      const legacy = await buildAccessScopedInclude(
        { author: true },
        blogConfig.lists.Post.fields,
        { session: ada, context: accessContext },
        blogConfig,
        'Post',
      )

      expect(legacy.toOneAccessFilters.filters.author).toEqual({
        kind: 'scoped',
        relatedListName: 'User',
        accessWhere: { handle: { equals: 'ada' } },
      })

      const secured = await context.db.Post.where({ title: "bob's draft" }).include('author').all()
      const plan = recorder.plans[recorder.plans.length - 1]

      // The same rule, in the shape the secured path carries it: inside the
      // include's own subquery rather than in a second round trip.
      expect(includedRelations(plan).sort()).toEqual(['author', 'declaredEditor'])
      expect(JSON.stringify(plan.ast)).toContain('"value":"ada"')
      // And the same answer: bob is not a user ada may see, so the relation is
      // absent for her by either route.
      expect(secured).toHaveLength(1)
      expect(secured[0].author).toBeNull()
    },
    BOOT,
  )
})

describe('key validation inside a refinement', () => {
  test(
    'a nested where naming a key the related list does not declare is refused',
    async () => {
      await expect(
        database
          .context(ada)
          .db.Post.include('author', (author) => author.where({ nope: 'x' }))
          .all(),
      ).rejects.toThrow(/nope/)
    },
    BOOT,
  )

  test(
    'a nested where naming a denied field is refused, and identically',
    async () => {
      const denied = database
        .context(ada)
        .db.User.include('posts', (posts) => posts.where({ editorNotes: 'secret' }))
        .all()
      const undeclared = database
        .context(ada)
        .db.User.include('posts', (posts) => posts.where({ nope: 'x' }))
        .all()

      await expect(denied).rejects.toThrow(/not a queryable field/)
      await expect(undeclared).rejects.toThrow(/not a queryable field/)
    },
    BOOT,
  )

  test(
    'a nested orderBy is checked the same way',
    async () => {
      await expect(
        database
          .context(ada)
          .db.User.include('posts', (posts) => posts.orderBy({ editorNotes: 'asc' }))
          .all(),
      ).rejects.toThrow(/editorNotes/)
    },
    BOOT,
  )

  test(
    'an include naming a key that is not a relation is refused',
    async () => {
      await expect(database.context(ada).db.Post.include('title').all()).rejects.toThrow(/title/)
      await expect(database.context(ada).db.Post.include('nope').all()).rejects.toThrow(/nope/)
      await expect(database.context(ada).db.Post.include('authorId').all()).rejects.toThrow(
        /authorId/,
      )
    },
    BOOT,
  )

  test(
    'a synthetic back-relation is validated and scoped like the declared field',
    async () => {
      const rows = await database.context(ada).db.Category.include('from_Post_category').all()

      expect(rows).toHaveLength(1)
      expect(rows[0].from_Post_category).toEqual([
        expect.objectContaining({ title: "ada's published" }),
      ])

      await expect(
        database
          .context(ada)
          .db.Category.include('from_Post_category', (posts) => posts.where({ nope: 'x' }))
          .all(),
      ).rejects.toThrow(/nope/)
    },
    BOOT,
  )
})

describe('the read-include depth cap', () => {
  const label = (name: string) => ({ label: name })

  beforeEach(async () => {
    let previous: Record<string, unknown> | undefined
    for (let index = 1; index <= 7; index += 1) {
      previous = await seed(`C${index}`, {
        ...label(`c${index}`),
        ...(previous ? { prev: previous.id } : {}),
      })
    }
    recorder.clear()
  })

  test(
    'a caller tree at the cap is served',
    async () => {
      const rows = await database
        .context(ada)
        .db.C1.include('next', (c2) =>
          c2.include('next', (c3) =>
            c3.include('next', (c4) => c4.include('next', (c5) => c5.include('next'))),
          ),
        )
        .all()

      expect(includedRelations(recorder.plans[0])).toEqual(['next'])
      let level: unknown = rows[0]
      for (const label of ['c2', 'c3', 'c4', 'c5', 'c6']) {
        const next: unknown = isRecord(level) ? level.next : undefined
        expect(Array.isArray(next) ? next : []).toHaveLength(1)
        level = Array.isArray(next) ? next[0] : undefined
        expect(isRecord(level) ? level.label : undefined).toBe(label)
      }
    },
    BOOT,
  )

  test(
    'a caller tree one level past the cap is refused, loudly',
    async () => {
      await expect(
        database
          .context(ada)
          .db.C1.include('next', (c2) =>
            c2.include('next', (c3) =>
              c3.include('next', (c4) =>
                c4.include('next', (c5) => c5.include('next', (c6) => c6.include('next'))),
              ),
            ),
          )
          .all(),
      ).rejects.toThrow(AccessScopeDepthExceededError)
    },
    BOOT,
  )

  test(
    'the cap is not the Access Filter recursion bound: nothing was queried',
    async () => {
      await expect(
        database
          .context(ada)
          .db.C1.include('next', (c2) =>
            c2.include('next', (c3) =>
              c3.include('next', (c4) =>
                c4.include('next', (c5) => c5.include('next', (c6) => c6.include('next'))),
              ),
            ),
          )
          .all(),
      ).rejects.toThrow(/include depth/)
      expect(recorder.plans).toEqual([])
    },
    BOOT,
  )
})

describe('a composed read is an immutable value', () => {
  test(
    'adding an include leaves the query it was added to alone',
    async () => {
      const base = database.context(ada).db.Post.where({ title: "ada's published" })
      const withAuthor = base.include('author')

      expect((await withAuthor.all())[0].author).toMatchObject({ handle: 'ada' })
      expect((await base.all())[0].author).toBeUndefined()
    },
    BOOT,
  )
})
