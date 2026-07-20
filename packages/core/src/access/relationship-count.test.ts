import { describe, it, expect, vi } from 'vitest'
import { list } from '../config/index.js'
import { text, relationship, integer } from '../fields/index.js'
import type { OpenSaasConfig } from '../config/types.js'
import type { AccessContext } from './types.js'
import {
  buildRelationshipCountSelect,
  resolveRelationshipCountFilters,
  isToManyRelationshipField,
} from './relationship-count.js'
import { RELATIONSHIP_COUNT_FILTER_KEY } from '../filter/types.js'

/**
 * Access-scoped to-many relationship counts (issue #732). Verifies:
 *  • the filtered `_count` select folds in the related list's query access,
 *  • a denied related list is omitted (its count renders as 0, never a leak),
 *  • count-filter markers resolve to access-scoped `{ id: { in } }` via a single
 *    secured read (never a per-row query), including the fully-denied case.
 */

// User (published-only for anon via a filter), plus a Widget list that is fully
// closed by default (no query access) to prove the denied path.
function makeConfig(): OpenSaasConfig {
  return {
    db: { provider: 'sqlite', prismaClientConstructor: () => null as never },
    lists: {
      User: list({
        fields: {
          name: text(),
          posts: relationship({ ref: 'Post.author', many: true }),
          widgets: relationship({ ref: 'Widget', many: true }),
          manager: relationship({ ref: 'User' }), // to-one — never counted
        },
        access: { operation: { query: () => true } },
      }),
      Post: list({
        fields: { title: text(), views: integer(), author: relationship({ ref: 'User.posts' }) },
        // Only published posts are visible → the count must be access-scoped.
        access: { operation: { query: () => ({ status: { equals: 'published' } }) } },
      }),
      // Widget ships closed (no access block) → query denied by default.
      Widget: list({ fields: { name: text() } }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
  } as any
}

function makeContext(
  findMany?: (args: unknown) => Promise<Array<Record<string, unknown>>>,
): AccessContext {
  return {
    session: null,
    _isSudo: false,
    _resolveOutputCounter: { depth: 0 },
    db: findMany ? { user: { findMany } } : {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal context for unit test
  } as any
}

describe('isToManyRelationshipField', () => {
  const config = makeConfig()
  const userFields = config.lists.User.fields
  it('is true only for a to-many relationship', () => {
    expect(isToManyRelationshipField(userFields.posts)).toBe(true)
    expect(isToManyRelationshipField(userFields.widgets)).toBe(true)
    expect(isToManyRelationshipField(userFields.manager)).toBe(false)
    expect(isToManyRelationshipField(userFields.name)).toBe(false)
  })
})

describe('buildRelationshipCountSelect', () => {
  it("folds the related list's query filter into each to-many count and omits denied/to-one", async () => {
    const config = makeConfig()
    const select = await buildRelationshipCountSelect(
      config.lists.User,
      { session: null, context: makeContext() },
      config,
    )
    // `posts` → access-scoped where; `widgets` → denied (omitted); `manager` →
    // to-one (never counted).
    expect(select).toEqual({ posts: { where: { status: { equals: 'published' } } } })
  })

  it('uses a bare `true` when the related list is fully readable', async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite', prismaClientConstructor: () => null as never },
      lists: {
        Tag: list({ fields: { name: text() }, access: { operation: { query: () => true } } }),
        Post: list({ fields: { title: text(), tags: relationship({ ref: 'Tag', many: true }) } }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any
    const select = await buildRelationshipCountSelect(
      config.lists.Post,
      { session: null, context: makeContext() },
      config,
    )
    expect(select).toEqual({ tags: true })
  })

  it('returns undefined when there are no countable to-many relationships', async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite', prismaClientConstructor: () => null as never },
      lists: { Post: list({ fields: { title: text() } }) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any
    const select = await buildRelationshipCountSelect(
      config.lists.Post,
      { session: null, context: makeContext() },
      config,
    )
    expect(select).toBeUndefined()
  })
})

describe('resolveRelationshipCountFilters', () => {
  const marker = (operator: string, value: number) => ({
    posts: { [RELATIONSHIP_COUNT_FILTER_KEY]: { operator, value } },
  })

  it('returns the where unchanged when there are no count markers', async () => {
    const config = makeConfig()
    const where = { name: { contains: 'ada' } }
    const resolved = await resolveRelationshipCountFilters(
      where,
      config.lists.User,
      'User',
      { session: null, context: makeContext() },
      config,
    )
    expect(resolved).toBe(where)
  })

  it('resolves a count marker to an access-scoped { id: { in } } via a single secured read', async () => {
    const config = makeConfig()
    // Two users; the secured read returns each with its access-scoped `_count`.
    const findMany = vi.fn(async () => [
      { id: 'u1', _count: { posts: 3 } },
      { id: 'u2', _count: { posts: 7 } },
    ])
    const resolved = await resolveRelationshipCountFilters(
      marker('gt', 5),
      config.lists.User,
      'User',
      { session: null, context: makeContext(findMany) },
      config,
    )
    // Only u2 (7 > 5) matches; the read was access-scoped (published-only count).
    expect(resolved).toEqual({ id: { in: ['u2'] } })
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany).toHaveBeenCalledWith({
      include: { _count: { select: { posts: { where: { status: { equals: 'published' } } } } } },
    })
  })

  it('includes zero-count rows for comparisons that admit zero (no complement bug)', async () => {
    const config = makeConfig()
    const findMany = vi.fn(async () => [
      { id: 'u1', _count: { posts: 0 } },
      { id: 'u2', _count: { posts: 4 } },
    ])
    const resolved = await resolveRelationshipCountFilters(
      marker('lt', 1), // count < 1 → only the zero-count user
      config.lists.User,
      'User',
      { session: null, context: makeContext(findMany) },
      config,
    )
    expect(resolved).toEqual({ id: { in: ['u1'] } })
  })

  it('resolves a denied related list without any query: count is always 0', async () => {
    const config = makeConfig()
    const findMany = vi.fn(async () => [])
    // `widgets`' related list (Widget) is fully denied → every count is 0.
    const where = { widgets: { [RELATIONSHIP_COUNT_FILTER_KEY]: { operator: 'gt', value: 5 } } }
    const resolved = await resolveRelationshipCountFilters(
      where,
      config.lists.User,
      'User',
      { session: null, context: makeContext(findMany) },
      config,
    )
    // 0 is not > 5 → nothing matches, and no read was issued.
    expect(resolved).toEqual({ id: { in: [] } })
    expect(findMany).not.toHaveBeenCalled()
  })

  it('preserves sibling conditions, ANDing the resolved id constraint', async () => {
    const config = makeConfig()
    const findMany = vi.fn(async () => [{ id: 'u2', _count: { posts: 7 } }])
    const where = { AND: [{ name: { contains: 'ada' } }, marker('gte', 1)] }
    const resolved = await resolveRelationshipCountFilters(
      where,
      config.lists.User,
      'User',
      { session: null, context: makeContext(findMany) },
      config,
    )
    expect(resolved).toEqual({ AND: [{ name: { contains: 'ada' } }, { id: { in: ['u2'] } }] })
  })

  it('reads with only the filtered `_count` include — no over-fetching `select` projection', async () => {
    const config = makeConfig()
    const findMany = vi.fn((_args: unknown) =>
      Promise.resolve([{ id: 'u2', _count: { posts: 7 } }]),
    )
    await resolveRelationshipCountFilters(
      marker('gt', 5),
      config.lists.User,
      'User',
      { session: null, context: makeContext(findMany) },
      config,
    )
    // The secured read is issued with the access-scoped `_count` include and NO
    // `select` — the secured findMany does not honour `select`, so forcing one
    // would be an ignored no-op. Access-scoping lives entirely in `_count.where`.
    expect(findMany).toHaveBeenCalledTimes(1)
    const callArg = findMany.mock.calls[0][0]
    expect(callArg).not.toHaveProperty('select')
    expect(callArg).toEqual({
      include: { _count: { select: { posts: { where: { status: { equals: 'published' } } } } } },
    })
  })

  it('preserves a sibling condition co-present in the same member as the marker', async () => {
    const config = makeConfig()
    const findMany = vi.fn(async () => [{ id: 'u2', _count: { posts: 7 } }])
    // A single AND-member carrying BOTH a scalar condition and the count marker.
    // The marker resolution must keep the co-present sibling, not replace the
    // member wholesale (guards against a future filter-engine change that merges
    // conditions into one member).
    const where = {
      AND: [
        {
          name: { contains: 'ada' },
          posts: { [RELATIONSHIP_COUNT_FILTER_KEY]: { operator: 'gt', value: 5 } },
        },
      ],
    }
    const resolved = await resolveRelationshipCountFilters(
      where,
      config.lists.User,
      'User',
      { session: null, context: makeContext(findMany) },
      config,
    )
    expect(resolved).toEqual({ name: { contains: 'ada' }, id: { in: ['u2'] } })
  })

  it('ANDs the resolved id constraint with a co-present sibling id condition (no silent drop)', async () => {
    const config = makeConfig()
    const findMany = vi.fn(async () => [{ id: 'u2', _count: { posts: 7 } }])
    // Contrived: a member carrying its own `id` condition alongside the marker.
    // Spreading would let one `id` overwrite the other; instead both are ANDed.
    const where = {
      id: { in: ['u1', 'u2'] },
      posts: { [RELATIONSHIP_COUNT_FILTER_KEY]: { operator: 'gt', value: 5 } },
    }
    const resolved = await resolveRelationshipCountFilters(
      where,
      config.lists.User,
      'User',
      { session: null, context: makeContext(findMany) },
      config,
    )
    expect(resolved).toEqual({ AND: [{ id: { in: ['u1', 'u2'] } }, { id: { in: ['u2'] } }] })
  })
})
