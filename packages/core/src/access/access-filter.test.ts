import { describe, it, expect, vi } from 'vitest'
import { buildAccessScopedInclude, resolveToOneAccessVisibility } from './access-filter.js'
import {
  AccessScopeDepthExceededError,
  UndeclaredCountKeyError,
  UndeclaredIncludeKeyError,
} from './errors.js'
import { READ_INCLUDE_MAX_DEPTH } from './depth-limits.js'
import type { OpenSaasConfig, FieldConfig } from '../config/types.js'
import type { AccessContext } from './types.js'

/**
 * Regression coverage for `buildAccessScopedInclude`, the caller-directed
 * access-scoping walk introduced by ADR-0026. It replaces the old two-step
 * "auto-walk every relationship of the list, then reconcile against whatever
 * the caller asked for" pipeline (`buildIncludeWithAccessControl` +
 * `mergeIncludeWithAccessControl`): the walk now recurses ONLY into the
 * branches a request (`requestedInclude`) itself names, and never evaluates
 * `query` access on a relation nobody asked for.
 *
 * The scenarios below carry forward the guarantees the old two-function
 * pipeline encoded — #566 (caller include augments, never replaces, the
 * access-controlled scope), #752 (a caller `take` survives the merge), #830
 * (fail-closed past the read-include depth cap) — expressed against the new,
 * single-function API. New coverage (the point of ADR-0026 itself): a
 * relation the request doesn't name never has its list's `query` access
 * invoked, and naming a relation fetches its own columns and stops (the "One
 * hop" rule) at every level, not just the root.
 *
 * The scenarios in this file build every chain relation as to-MANY
 * (`rel(ref, true)`), so `where`-in-`include` keeps meaning what it always
 * has here — the walk-depth/caller-directed logic under test is arity-
 * agnostic. The to-one-specific behavior this function grew for issue #974
 * (a `where` on a to-one include is not something Prisma accepts, so it's
 * recorded in `toOneAccessFilters` instead and resolved post-query by
 * `resolveToOneAccessVisibility`) has its own dedicated describe blocks below.
 */

// A relationship field pointing at another list.
function rel(ref: string, many = false): FieldConfig {
  return { type: 'relationship', ref, many } as unknown as FieldConfig
}

function makeContext(): AccessContext {
  return {
    session: null,
    _isSudo: false,
    _resolveOutputChain: [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal context for unit test
  } as any
}

// Measure the maximum nesting depth of an include tree.
function includeDepth(include: unknown): number {
  if (!include || typeof include !== 'object') return 0
  let max = 0
  for (const value of Object.values(include as Record<string, unknown>)) {
    if (value && typeof value === 'object') {
      const nested = (value as { include?: unknown }).include
      if (nested) max = Math.max(max, 1 + includeDepth(nested))
      else max = Math.max(max, 1)
    } else {
      max = Math.max(max, 1)
    }
  }
  return max
}

// A straight-line chain of `count` lists, each with a scalar field and a
// single relationship to the next list: L0 → L1 → … → L(count-1). Every list
// past the root is query-scoped with a filter unique to it, so a test can
// assert the scoped tree actually carries the right `where` at a given hop
// (not just that it happens not to throw). `access.operation.query` is a
// `vi.fn()` on every list so tests can additionally assert which lists' access
// functions were (or were not) invoked.
function chainConfig(count: number): {
  config: OpenSaasConfig
  queryFns: Record<string, ReturnType<typeof vi.fn>>
} {
  const lists: Record<string, { fields: Record<string, FieldConfig>; access: unknown }> = {}
  const queryFns: Record<string, ReturnType<typeof vi.fn>> = {}
  for (let i = 0; i < count; i++) {
    const listName = `L${i}`
    const fields: Record<string, FieldConfig> = { name: { type: 'text' } as FieldConfig }
    if (i < count - 1) {
      fields.next = rel(`L${i + 1}.prev`, true)
    }
    if (i > 0) {
      fields.prev = rel(`L${i - 1}.next`, true)
    }
    const filter = { ownerId: { equals: listName } }
    const queryFn = vi.fn(i === 0 ? () => true : () => filter)
    queryFns[listName] = queryFn
    lists[listName] = { fields, access: { operation: { query: queryFn } } }
  }
  return {
    config: {
      db: { provider: 'sqlite', url: 'file:./dev.db' },
      lists,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any,
    queryFns,
  }
}

// A requested `include` value selecting `next` `hops` more times beyond the
// point at which this value is attached, ending in a bare `true` leaf. E.g.
// `nestedInclude(0) === true` (stop here); `{ include: { next: nestedInclude(2) } }`
// at the top level names 3 hops total (the outer `next` plus 2 more).
function nestedInclude(hops: number): Record<string, unknown> {
  if (hops <= 0) return true as unknown as Record<string, unknown>
  return { include: { next: nestedInclude(hops - 1) } }
}

// Read the `where` at the end of a chain of nested `next` includes (used to
// assert row-scoping survived down to a specific hop).
function whereAtHop(scoped: Record<string, unknown>, hops: number): unknown {
  let current: unknown = scoped
  for (let i = 0; i < hops; i++) {
    const entry = (current as { next?: unknown })?.next
    if (i === hops - 1) return (entry as { where?: unknown })?.where
    current = (entry as { include?: unknown })?.include
  }
  return undefined
}

describe('buildAccessScopedInclude — caller-directed walk (ADR-0026)', () => {
  it('does not invoke query access on a relation the request never named', async () => {
    // A → B, A → C (siblings). Requesting only `b` must never touch C's
    // access function — the core guarantee #852 introduces: a request
    // naming one relation no longer walks (and access-checks) every other
    // relationship of the list.
    const queryB = vi.fn(() => true)
    const queryC = vi.fn(() => true)
    const config = {
      db: { provider: 'sqlite' },
      lists: {
        A: {
          fields: { b: rel('B.a'), c: rel('C.a') },
          access: { operation: { query: () => true } },
        },
        B: {
          fields: { name: { type: 'text' } as FieldConfig },
          access: { operation: { query: queryB } },
        },
        C: {
          fields: { name: { type: 'text' } as FieldConfig },
          access: { operation: { query: queryC } },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any as OpenSaasConfig

    const { include } = await buildAccessScopedInclude(
      { b: true },
      config.lists.A.fields,
      { session: null, context: makeContext() },
      config,
      'A',
    )

    expect(include).toEqual({ b: true })
    expect(queryB).toHaveBeenCalledTimes(1)
    expect(queryC).not.toHaveBeenCalled()
  })

  it("fetches a named relation's own columns and stops — does not auto-expand its subtree (One hop)", async () => {
    const { config, queryFns } = chainConfig(4) // L0 → L1 → L2 → L3

    const { include } = await buildAccessScopedInclude(
      { next: true },
      config.lists.L0.fields,
      { session: null, context: makeContext() },
      config,
      'L0',
    )

    // L1 is fetched and where-scoped; L2/L3 are never reached because the
    // request named `next` bare, with no nested `include` beneath it.
    expect(include).toEqual({ next: { where: { ownerId: { equals: 'L1' } } } })
    expect(includeDepth(include)).toBe(1)
    expect(queryFns.L1).toHaveBeenCalledTimes(1)
    expect(queryFns.L2).not.toHaveBeenCalled()
    expect(queryFns.L3).not.toHaveBeenCalled()
  })

  it('scopes a nested path at every level the request names it', async () => {
    const { config, queryFns } = chainConfig(4) // L0 → L1 → L2 → L3

    const { include } = await buildAccessScopedInclude(
      { next: { include: { next: { include: { next: true } } } } },
      config.lists.L0.fields,
      { session: null, context: makeContext() },
      config,
      'L0',
    )

    expect(include).toEqual({
      next: {
        where: { ownerId: { equals: 'L1' } },
        include: {
          next: {
            where: { ownerId: { equals: 'L2' } },
            include: { next: { where: { ownerId: { equals: 'L3' } } } },
          },
        },
      },
    })
    expect(queryFns.L1).toHaveBeenCalledTimes(1)
    expect(queryFns.L2).toHaveBeenCalledTimes(1)
    expect(queryFns.L3).toHaveBeenCalledTimes(1)
  })

  it('scopes a full cyclic path exactly as requested, one hop stopping the cycle', async () => {
    // A → B → C → A. The caller explicitly names the whole cyclic path; the
    // walk simply follows the finite literal it was given (no cycle guard
    // needed here — that only matters for the declared-dependency fold, see
    // declared-dependencies.ts).
    const allowQuery = () => true
    const config = {
      db: { provider: 'sqlite' },
      lists: {
        A: { fields: { b: rel('B.a') }, access: { operation: { query: allowQuery } } },
        B: { fields: { c: rel('C.b') }, access: { operation: { query: allowQuery } } },
        C: { fields: { a: rel('A.c') }, access: { operation: { query: allowQuery } } },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any as OpenSaasConfig

    const { include } = await buildAccessScopedInclude(
      { b: { include: { c: { include: { a: true } } } } },
      config.lists.A.fields,
      { session: null, context: makeContext() },
      config,
      'A',
    )

    expect(include).toEqual({ b: { include: { c: { include: { a: true } } } } })
  })
})

/**
 * A caller-supplied `take` on a to-many relation include must survive
 * scoping (issue #752). It only narrows the fetched rows and can never widen
 * past the access `where`, so it rides on top of the access filter unchanged.
 */
describe('buildAccessScopedInclude — caller take on a to-many relation (issue #752)', () => {
  function scopedConfig(): OpenSaasConfig {
    return {
      db: { provider: 'sqlite' },
      lists: {
        User: {
          fields: { name: { type: 'text' } as FieldConfig, posts: rel('Post.author', true) },
          access: { operation: { query: () => true } },
        },
        Post: {
          fields: { title: { type: 'text' } as FieldConfig, author: rel('User.posts') },
          access: { operation: { query: () => ({ published: { equals: true } }) } },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any
  }

  it('preserves the take and AND-combines it with the access where', async () => {
    const config = scopedConfig()

    const { include } = await buildAccessScopedInclude(
      { posts: { take: 10 } },
      config.lists.User.fields,
      { session: null, context: makeContext() },
      config,
      'User',
    )

    // The bound rides on top of the access filter — neither is dropped. The
    // Post→author back-relation is NOT auto-nested (One hop, ADR-0026) since
    // the request didn't name it.
    expect(include).toEqual({
      posts: {
        where: { published: { equals: true } },
        take: 10,
      },
    })
  })

  it('drops a take for a relation whose query access is denied', async () => {
    const config = scopedConfig()
    config.lists.Post.access = { operation: { query: () => false } }

    const { include } = await buildAccessScopedInclude(
      { posts: { take: 10 } },
      config.lists.User.fields,
      { session: null, context: makeContext() },
      config,
      'User',
    )

    // A denied relation is dropped wholesale — the take cannot resurrect it.
    expect(include).toEqual({})
  })
})

/**
 * Regression coverage for issue #830: the read pipeline used to FAIL OPEN past
 * `READ_INCLUDE_MAX_DEPTH` — a caller-supplied `include` nested deeper than the
 * engine could scope was passed through unscoped rather than denied. These
 * tests pin the exact boundary ADR-0022 introduced and ADR-0026 preserves: a
 * request one level past the cap throws, the same request one level
 * shallower still works, and a request that never reaches the cap is
 * unaffected.
 */
describe('buildAccessScopedInclude — fail-closed at the read-include depth cap (#830)', () => {
  const HOPS_AT_CAP = READ_INCLUDE_MAX_DEPTH

  it('throws AccessScopeDepthExceededError when the request reaches past the cap', async () => {
    const chainLength = HOPS_AT_CAP + 2
    const { config } = chainConfig(chainLength)

    // Outer `next` (hop 1) + nestedInclude(HOPS_AT_CAP) (HOPS_AT_CAP more) = HOPS_AT_CAP + 1 hops.
    const requested = { next: nestedInclude(HOPS_AT_CAP) }

    await expect(
      buildAccessScopedInclude(
        requested,
        config.lists.L0.fields,
        { session: null, context: makeContext() },
        config,
        'L0',
      ),
    ).rejects.toThrow(AccessScopeDepthExceededError)
  })

  it('describes a cost refusal, not an inability to scope', async () => {
    const chainLength = HOPS_AT_CAP + 2
    const { config } = chainConfig(chainLength)
    const requested = { next: nestedInclude(HOPS_AT_CAP) }

    await expect(
      buildAccessScopedInclude(
        requested,
        config.lists.L0.fields,
        { session: null, context: makeContext() },
        config,
        'L0',
      ),
    ).rejects.toThrow(/cost limit/)
  })

  it('still row-scopes a request one level shallower than the cap', async () => {
    const chainLength = HOPS_AT_CAP + 1
    const { config } = chainConfig(chainLength)

    // Outer `next` (hop 1) + nestedInclude(HOPS_AT_CAP - 1) = HOPS_AT_CAP hops total — right at the boundary.
    const requested = { next: nestedInclude(HOPS_AT_CAP - 1) }

    const { include } = await buildAccessScopedInclude(
      requested,
      config.lists.L0.fields,
      { session: null, context: makeContext() },
      config,
      'L0',
    )

    expect(includeDepth(include)).toBe(HOPS_AT_CAP)
    expect(whereAtHop(include, HOPS_AT_CAP)).toEqual({ ownerId: { equals: `L${HOPS_AT_CAP}` } })
  })

  it('does not throw for a request that never reaches the cap', async () => {
    const chainLength = HOPS_AT_CAP + 3
    const { config } = chainConfig(chainLength)

    await expect(
      buildAccessScopedInclude(
        { next: true },
        config.lists.L0.fields,
        { session: null, context: makeContext() },
        config,
        'L0',
      ),
    ).resolves.not.toThrow()
  })

  it('an empty request never throws, even on a deep schema', async () => {
    const chainLength = HOPS_AT_CAP + 3
    const { config } = chainConfig(chainLength)

    const { include } = await buildAccessScopedInclude(
      {},
      config.lists.L0.fields,
      { session: null, context: makeContext() },
      config,
      'L0',
    )
    expect(include).toEqual({})
  })

  it('a declared non-relationship key on a list with no relationships passes through unchanged', async () => {
    const config = {
      db: { provider: 'sqlite' },
      lists: {
        Leaf: {
          fields: { name: { type: 'text' } as FieldConfig },
          access: { operation: { query: () => true } },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any as OpenSaasConfig

    // A declared field that isn't a relationship — access control does not
    // govern it (e.g. a virtual field named in `include`, stripped later by
    // `stripVirtualFieldsFromInclude`).
    const { include } = await buildAccessScopedInclude(
      { name: true },
      config.lists.Leaf.fields,
      { session: null, context: makeContext() },
      config,
      'Leaf',
    )
    expect(include).toEqual({ name: true })
  })

  it('rejects a key that is neither declared nor a synthetic back-relation (#1082)', async () => {
    const config = {
      db: { provider: 'sqlite' },
      lists: {
        Leaf: {
          fields: { name: { type: 'text' } as FieldConfig },
          access: { operation: { query: () => true } },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any as OpenSaasConfig

    await expect(
      buildAccessScopedInclude(
        { someUnrelatedKey: true },
        config.lists.Leaf.fields,
        { session: null, context: makeContext() },
        config,
        'Leaf',
      ),
    ).rejects.toThrow(UndeclaredIncludeKeyError)
  })

  it('a bare `_count: true` on a list with no to-many relations yields no `_count` key at all (#1087)', async () => {
    const config = {
      db: { provider: 'sqlite' },
      lists: {
        Leaf: {
          fields: { name: { type: 'text' } as FieldConfig },
          access: { operation: { query: () => true } },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any as OpenSaasConfig

    const { include } = await buildAccessScopedInclude(
      { _count: true },
      config.lists.Leaf.fields,
      { session: null, context: makeContext() },
      config,
      'Leaf',
    )
    expect(include).toEqual({})
  })
})

/**
 * Regression coverage for issue #1087: a caller-supplied `_count` in
 * `include` used to reach Prisma unscoped (#1082's "Out of scope" — the one
 * key `buildAccessScopedInclude`'s own denial rule allowlisted through rather
 * than rejecting or scoping). These tests pin the fix: each named relation's
 * `_count.select` entry is scoped by that relation's own `query` access,
 * exactly like the rest of this module scopes `include`, and a denied
 * relation is recorded in `countDenials` for `filterReadableFields` to inject
 * `0` for post-query (Prisma cannot be asked for a guaranteed `0`).
 */
describe('buildAccessScopedInclude — `_count` is scoped like any other relation (issue #1087)', () => {
  function countConfig(postQuery: unknown): OpenSaasConfig {
    return {
      db: { provider: 'sqlite' },
      lists: {
        User: {
          fields: {
            name: { type: 'text' } as FieldConfig,
            posts: rel('Post.author', true),
            secrets: rel('Secret.owner', true),
          },
          access: { operation: { query: () => true } },
        },
        Post: {
          fields: { title: { type: 'text' } as FieldConfig, author: rel('User.posts') },
          access: { operation: { query: postQuery } },
        },
        Secret: {
          fields: { body: { type: 'text' } as FieldConfig, owner: rel('User.secrets') },
          access: { operation: { query: () => false } },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any
  }

  it('a fully-readable relation counts unchanged', async () => {
    const config = countConfig(() => true)

    const { include, countDenials } = await buildAccessScopedInclude(
      { _count: { select: { posts: true } } },
      config.lists.User.fields,
      { session: null, context: makeContext() },
      config,
      'User',
    )

    expect(include).toEqual({ _count: { select: { posts: true } } })
    expect(countDenials.keys.size).toBe(0)
  })

  it('folds the related list row filter into the count select', async () => {
    const config = countConfig(() => ({ published: { equals: true } }))

    const { include } = await buildAccessScopedInclude(
      { _count: { select: { posts: true } } },
      config.lists.User.fields,
      { session: null, context: makeContext() },
      config,
      'User',
    )

    expect(include).toEqual({
      _count: { select: { posts: { where: { published: { equals: true } } } } },
    })
  })

  it('AND-combines a caller-supplied nested `where` with the access filter, never replacing it', async () => {
    const config = countConfig(() => ({ published: { equals: true } }))

    const { include } = await buildAccessScopedInclude(
      { _count: { select: { posts: { where: { title: { contains: 'foo' } } } } } },
      config.lists.User.fields,
      { session: null, context: makeContext() },
      config,
      'User',
    )

    expect(include).toEqual({
      _count: {
        select: {
          posts: {
            where: {
              AND: [{ published: { equals: true } }, { title: { contains: 'foo' } }],
            },
          },
        },
      },
    })
  })

  it('omits a fully-denied relation from the select and records it in `countDenials`', async () => {
    const config = countConfig(() => true)

    const { include, countDenials } = await buildAccessScopedInclude(
      { _count: { select: { posts: true, secrets: true } } },
      config.lists.User.fields,
      { session: null, context: makeContext() },
      config,
      'User',
    )

    expect(include).toEqual({ _count: { select: { posts: true } } })
    expect(countDenials.keys).toEqual(new Set(['secrets']))
  })

  it('a wholly-denied `_count.select` omits the `_count` key entirely, still recording the denial', async () => {
    const config = countConfig(() => true)

    const { include, countDenials } = await buildAccessScopedInclude(
      { _count: { select: { secrets: true } } },
      config.lists.User.fields,
      { session: null, context: makeContext() },
      config,
      'User',
    )

    expect(include).toEqual({})
    expect(countDenials.keys).toEqual(new Set(['secrets']))
  })

  it('a denied relation resolves to 0 without validating its caller `where` — no field-name/read-access oracle', async () => {
    // A caller who cannot read a single `Secret` row supplies a nonsense
    // `where` naming a field that doesn't exist. If denial were checked
    // AFTER `where` validation, this would throw a `ValidationError` naming
    // "Secret"'s fields — letting a caller probe a fully denied list's
    // schema. Denial must win first: the count is 0 regardless of `where`.
    const config = countConfig(() => true)

    const { include, countDenials } = await buildAccessScopedInclude(
      { _count: { select: { secrets: { where: { bogusField: { equals: 1 } } } } } },
      config.lists.User.fields,
      { session: null, context: makeContext() },
      config,
      'User',
    )

    expect(include).toEqual({})
    expect(countDenials.keys).toEqual(new Set(['secrets']))
  })

  it('rejects a `_count.select` key that is not a countable to-many (undeclared)', async () => {
    const config = countConfig(() => true)

    await expect(
      buildAccessScopedInclude(
        { _count: { select: { nonsense: true } } },
        config.lists.User.fields,
        { session: null, context: makeContext() },
        config,
        'User',
      ),
    ).rejects.toThrow(UndeclaredCountKeyError)
  })

  it('rejects a `_count.select` key naming a scalar field', async () => {
    const config = countConfig(() => true)

    await expect(
      buildAccessScopedInclude(
        { _count: { select: { name: true } } },
        config.lists.User.fields,
        { session: null, context: makeContext() },
        config,
        'User',
      ),
    ).rejects.toThrow(UndeclaredCountKeyError)
  })

  it('rejects a `_count.select` key naming a to-one relationship', async () => {
    const config = countConfig(() => true)

    await expect(
      buildAccessScopedInclude(
        { _count: { select: { author: true } } },
        config.lists.Post.fields,
        { session: null, context: makeContext() },
        config,
        'Post',
      ),
    ).rejects.toThrow(UndeclaredCountKeyError)
  })

  it('does not reject a `_count.select` key naming a synthetic back-relation (#1082)', async () => {
    const config = {
      db: { provider: 'sqlite' },
      lists: {
        Category: {
          fields: { name: { type: 'text' } as FieldConfig },
          access: { operation: { query: () => true } },
        },
        Post: {
          fields: {
            title: { type: 'text' } as FieldConfig,
            // A list-only ref: no `Category` field names it back, so schema
            // generation synthesizes `from_Post_category` on Category.
            category: rel('Category'),
          },
          access: { operation: { query: () => true } },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any as OpenSaasConfig

    const { include } = await buildAccessScopedInclude(
      { _count: { select: { from_Post_category: true } } },
      config.lists.Category.fields,
      { session: null, context: makeContext() },
      config,
      'Category',
    )

    expect(include).toEqual({ _count: { select: { from_Post_category: true } } })
  })

  it('`_count: true` also expands to a synthetic back-relation, scoped (#1082/#1087)', async () => {
    const config = {
      db: { provider: 'sqlite' },
      lists: {
        Category: {
          fields: { name: { type: 'text' } as FieldConfig },
          access: { operation: { query: () => true } },
        },
        Post: {
          fields: {
            title: { type: 'text' } as FieldConfig,
            category: rel('Category'),
          },
          // A row filter — proves the synthetic relation's count is scoped
          // exactly like an explicitly-named one, not merely included.
          access: { operation: { query: () => ({ published: { equals: true } }) } },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any as OpenSaasConfig

    const { include } = await buildAccessScopedInclude(
      { _count: true },
      config.lists.Category.fields,
      { session: null, context: makeContext() },
      config,
      'Category',
    )

    expect(include).toEqual({
      _count: { select: { from_Post_category: { where: { published: { equals: true } } } } },
    })
  })

  it('scopes a relation filter nested inside a caller-supplied count `where` (e.g. `_count.select.posts.where.comments.some`)', async () => {
    const config = {
      db: { provider: 'sqlite' },
      lists: {
        User: {
          fields: { name: { type: 'text' } as FieldConfig, posts: rel('Post.author', true) },
          access: { operation: { query: () => true } },
        },
        Post: {
          fields: {
            title: { type: 'text' } as FieldConfig,
            author: rel('User.posts'),
            comments: rel('Comment.post', true),
          },
          access: { operation: { query: () => true } },
        },
        Comment: {
          fields: { body: { type: 'text' } as FieldConfig, post: rel('Post.comments') },
          // A row filter one hop past the counted relation — must still be
          // folded in, or the resulting post count would reveal whether
          // inaccessible comments matching the caller's filter exist.
          access: { operation: { query: () => ({ approved: { equals: true } }) } },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any as OpenSaasConfig

    const { include } = await buildAccessScopedInclude(
      {
        _count: {
          select: {
            posts: { where: { comments: { some: { body: { contains: 'hi' } } } } },
          },
        },
      },
      config.lists.User.fields,
      { session: null, context: makeContext() },
      config,
      'User',
    )

    expect(include).toEqual({
      _count: {
        select: {
          posts: {
            where: {
              comments: {
                some: {
                  AND: [{ approved: { equals: true } }, { body: { contains: 'hi' } }],
                },
              },
            },
          },
        },
      },
    })
  })

  it('`_count: true` expands to every declared to-many relation, scoped', async () => {
    const config = countConfig(() => true)

    const { include, countDenials } = await buildAccessScopedInclude(
      { _count: true },
      config.lists.User.fields,
      { session: null, context: makeContext() },
      config,
      'User',
    )

    expect(include).toEqual({ _count: { select: { posts: true } } })
    expect(countDenials.keys).toEqual(new Set(['secrets']))
  })

  it('scopes `_count` nested inside an ordinary relation include, at that level', async () => {
    const config = {
      db: { provider: 'sqlite' },
      lists: {
        Org: {
          fields: { name: { type: 'text' } as FieldConfig, users: rel('User.org', true) },
          access: { operation: { query: () => true } },
        },
        User: {
          fields: {
            name: { type: 'text' } as FieldConfig,
            org: rel('Org.users'),
            posts: rel('Post.author', true),
          },
          access: { operation: { query: () => true } },
        },
        Post: {
          fields: { title: { type: 'text' } as FieldConfig, author: rel('User.posts') },
          access: { operation: { query: () => ({ published: { equals: true } }) } },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any as OpenSaasConfig

    const { include } = await buildAccessScopedInclude(
      { users: { include: { _count: { select: { posts: true } } } } },
      config.lists.Org.fields,
      { session: null, context: makeContext() },
      config,
      'Org',
    )

    expect(include).toEqual({
      users: {
        include: { _count: { select: { posts: { where: { published: { equals: true } } } } } },
      },
    })
  })
})

/**
 * Regression coverage for issue #974: Prisma accepts a nested `where` on an
 * `include` entry only for a to-many relation — the same shape on a to-one
 * relation raises `PrismaClientValidationError`. `buildAccessScopedInclude`
 * must never attach one for a to-one relation, whatever its related list's
 * `query` access resolves to; the scoping information goes into
 * `toOneAccessFilters` instead.
 */
describe('buildAccessScopedInclude — to-one relations record a post-query filter, not `where` (issue #974)', () => {
  function ownerConfig(queryAccess: unknown): OpenSaasConfig {
    return {
      db: { provider: 'sqlite' },
      lists: {
        Child: {
          fields: { name: { type: 'text' } as FieldConfig, owner: rel('Owner') },
          access: { operation: { query: () => true } },
        },
        Owner: {
          fields: { name: { type: 'text' } as FieldConfig },
          access: { operation: { query: queryAccess } },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any
  }

  it('records the access filter instead of attaching `where` when the related list scopes by a filter', async () => {
    const config = ownerConfig(() => ({ id: { equals: 'u1' } }))

    const { include, toOneAccessFilters } = await buildAccessScopedInclude(
      { owner: true },
      config.lists.Child.fields,
      { session: null, context: makeContext() },
      config,
      'Child',
    )

    // The Prisma-bound include never carries a `where` on this to-one key —
    // Prisma would reject it.
    expect(include).toEqual({ owner: true })
    expect(toOneAccessFilters).toEqual({
      filters: {
        owner: { kind: 'scoped', relatedListName: 'Owner', accessWhere: { id: { equals: 'u1' } } },
      },
      nested: {},
    })
  })

  it('leaves a to-one relation whose related list is fully open untouched — no filter recorded, no extra query later', async () => {
    const config = ownerConfig(() => true)

    const { include, toOneAccessFilters } = await buildAccessScopedInclude(
      { owner: true },
      config.lists.Child.fields,
      { session: null, context: makeContext() },
      config,
      'Child',
    )

    expect(include).toEqual({ owner: true })
    expect(toOneAccessFilters).toEqual({ filters: {}, nested: {} })
  })

  it('drops a to-one relation whose related list denies query access outright, and records the denial', async () => {
    const config = ownerConfig(() => false)

    const { include, toOneAccessFilters } = await buildAccessScopedInclude(
      { owner: true },
      config.lists.Child.fields,
      { session: null, context: makeContext() },
      config,
      'Child',
    )

    // Never asked of Prisma at all — same as before this fix.
    expect(include).toEqual({})
    expect(toOneAccessFilters).toEqual({ filters: { owner: { kind: 'denied' } }, nested: {} })
  })

  it('records a to-one filter nested inside another relation the caller explicitly included', async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite' },
      lists: {
        GrandChild: {
          fields: { name: { type: 'text' } as FieldConfig, child: rel('Child') },
          access: { operation: { query: () => true } },
        },
        Child: {
          fields: { name: { type: 'text' } as FieldConfig, owner: rel('Owner') },
          access: { operation: { query: () => true } },
        },
        Owner: {
          fields: { name: { type: 'text' } as FieldConfig },
          access: { operation: { query: () => ({ id: { equals: 'u1' } }) } },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any

    const { include, toOneAccessFilters } = await buildAccessScopedInclude(
      { child: { include: { owner: true } } },
      config.lists.GrandChild.fields,
      { session: null, context: makeContext() },
      config,
      'GrandChild',
    )

    expect(include).toEqual({ child: { include: { owner: true } } })
    expect(toOneAccessFilters).toEqual({
      filters: {},
      nested: {
        child: {
          filters: {
            owner: {
              kind: 'scoped',
              relatedListName: 'Owner',
              accessWhere: { id: { equals: 'u1' } },
            },
          },
          nested: {},
        },
      },
    })
  })
})

describe('resolveToOneAccessVisibility (issue #974)', () => {
  function makeVisibilityContext(findMany: ReturnType<typeof vi.fn>): AccessContext {
    return {
      session: null,
      _isSudo: false,
      _resolveOutputChain: [],
      prisma: { owner: { findMany } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal context for unit test
    } as any
  }

  it('passes a denied filter straight through with no query', async () => {
    const findMany = vi.fn()
    const context = makeVisibilityContext(findMany)

    const resolved = await resolveToOneAccessVisibility(
      [{ id: 'c1' }],
      { filters: { owner: { kind: 'denied' } }, nested: {} },
      { session: null, context },
    )

    expect(resolved).toEqual({ filters: { owner: { kind: 'denied' } }, nested: {} })
    expect(findMany).not.toHaveBeenCalled()
  })

  it('skips the query when no row carries a value at the scoped key', async () => {
    const findMany = vi.fn()
    const context = makeVisibilityContext(findMany)
    const tree = {
      filters: {
        owner: {
          kind: 'scoped' as const,
          relatedListName: 'Owner',
          accessWhere: { id: { equals: 'u1' } },
        },
      },
      nested: {},
    }

    const resolved = await resolveToOneAccessVisibility([{ id: 'c1', owner: null }], tree, {
      session: null,
      context,
    })

    expect(resolved).toEqual({
      filters: { owner: { kind: 'visible', ids: new Set() } },
      nested: {},
    })
    expect(findMany).not.toHaveBeenCalled()
  })

  it('batches every row into ONE existence check, through the raw Prisma client, using the exact access filter', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'u1' }, { id: 'u2' }])
    const context = makeVisibilityContext(findMany)
    const tree = {
      filters: {
        owner: {
          kind: 'scoped' as const,
          relatedListName: 'Owner',
          accessWhere: { studioId: { equals: 's1' } },
        },
      },
      nested: {},
    }
    const items = [
      { id: 'c1', owner: { id: 'u1' } },
      { id: 'c2', owner: { id: 'u2' } },
      { id: 'c3', owner: { id: 'u3' } }, // excluded by the mocked response below
      { id: 'c4', owner: null }, // contributes no id
    ]

    const resolved = await resolveToOneAccessVisibility(items, tree, { session: null, context })

    // One call, not one per row.
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany).toHaveBeenCalledWith({
      where: { AND: [{ studioId: { equals: 's1' } }, { id: { in: ['u1', 'u2', 'u3'] } }] },
      select: { id: true },
    })
    expect(resolved.filters.owner).toEqual({ kind: 'visible', ids: new Set(['u1', 'u2']) })
  })

  it('recurses into nested trees, flattening rows reached through a to-many hop into one batch', async () => {
    const ownerFindMany = vi.fn().mockResolvedValue([{ id: 'u1' }])
    const context: AccessContext = {
      session: null,
      _isSudo: false,
      _resolveOutputChain: [],
      prisma: { owner: { findMany: ownerFindMany } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal context for unit test
    } as any
    const tree = {
      filters: {},
      nested: {
        children: {
          filters: {
            owner: {
              kind: 'scoped' as const,
              relatedListName: 'Owner',
              accessWhere: { id: { equals: 'u1' } },
            },
          },
          nested: {},
        },
      },
    }
    const items = [
      {
        id: 'p1',
        children: [
          { id: 'c1', owner: { id: 'u1' } },
          { id: 'c2', owner: { id: 'u9' } },
        ],
      },
      { id: 'p2', children: [{ id: 'c3', owner: { id: 'u1' } }] },
    ]

    const resolved = await resolveToOneAccessVisibility(items, tree, { session: null, context })

    // Every child across BOTH parents resolved in one batched call.
    expect(ownerFindMany).toHaveBeenCalledTimes(1)
    expect(ownerFindMany).toHaveBeenCalledWith({
      where: { AND: [{ id: { equals: 'u1' } }, { id: { in: ['u1', 'u9'] } }] },
      select: { id: true },
    })
    expect(resolved.nested.children.filters.owner).toEqual({
      kind: 'visible',
      ids: new Set(['u1']),
    })
  })
})

/**
 * Regression coverage for issue #1082: a list-only `ref` (`ref: 'Term'`, no
 * target field) makes schema generation synthesize a back-relation on `Term`
 * (`from_Bill_term`) that no list config declares. Before this fix,
 * `buildAccessScopedInclude` treated any key it couldn't resolve to a
 * DECLARED relationship as "not governed by access control" and passed it
 * through unchanged — so a caller naming `from_Bill_term` in `include`
 * bypassed `Bill`'s own `query` access entirely. These tests pin the fix: a
 * synthetic key is scoped exactly like the declared relationship field it
 * stands for.
 */
describe('buildAccessScopedInclude — synthetic back-relation (#1082)', () => {
  // Term ← Bill.term (list-only ref) ← Bill.lineItems (declared, to-many).
  // `from_Bill_term` is the back-relation schema generation synthesizes on
  // Term; nothing in `Term.fields` declares it.
  function syntheticConfig(billQuery: () => boolean | Record<string, unknown>) {
    const config = {
      db: { provider: 'sqlite' },
      lists: {
        Term: {
          fields: { name: { type: 'text' } as FieldConfig },
          access: { operation: { query: () => true } },
        },
        Bill: {
          fields: {
            amount: { type: 'integer' } as FieldConfig,
            term: rel('Term'), // list-only ref — synthesizes `from_Bill_term` on Term
            lineItems: rel('LineItem.bill', true),
          },
          access: { operation: { query: billQuery } },
        },
        LineItem: {
          fields: { sku: { type: 'text' } as FieldConfig, bill: rel('Bill.lineItems') },
          access: { operation: { query: () => true } },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any as OpenSaasConfig
    return config
  }

  it('drops the relation entirely when the owning list denies query access', async () => {
    const config = syntheticConfig(() => false)

    const { include } = await buildAccessScopedInclude(
      { from_Bill_term: true },
      config.lists.Term.fields,
      { session: null, context: makeContext() },
      config,
      'Term',
    )

    expect(include).toEqual({})
  })

  it('AND-folds the owning list access filter with the caller-supplied where', async () => {
    const config = syntheticConfig(() => ({ paid: { equals: true } }))

    const { include } = await buildAccessScopedInclude(
      { from_Bill_term: { where: { amount: { gt: 10 } } } },
      config.lists.Term.fields,
      { session: null, context: makeContext() },
      config,
      'Term',
    )

    expect(include).toEqual({
      from_Bill_term: {
        where: { AND: [{ paid: { equals: true } }, { amount: { gt: 10 } }] },
      },
    })
  })

  it('scopes a nested include against the OWNING list fields and consumes depth', async () => {
    const config = syntheticConfig(() => true)
    const lineItemQuery = vi.fn(() => true)
    config.lists.LineItem.access = { operation: { query: lineItemQuery } }

    const { include } = await buildAccessScopedInclude(
      { from_Bill_term: { include: { lineItems: true } } },
      config.lists.Term.fields,
      { session: null, context: makeContext() },
      config,
      'Term',
    )

    // The nested `lineItems` key was resolved against Bill's own fields (not
    // Term's, which has no `lineItems` field at all) — proof the recursion
    // used the owning list, not the synthetic key's declaring list.
    expect(lineItemQuery).toHaveBeenCalledTimes(1)
    expect(include).toEqual({ from_Bill_term: { include: { lineItems: true } } })
  })

  it('a synthetic hop counts toward the read-include depth cap the same as a declared one', async () => {
    // A chain like `chainConfig` builds (L0 ↔ L1 ↔ … via declared `next`/`prev`),
    // except the FIRST hop is synthetic: L1's `prev` is a list-only ref, so L0
    // never declares `next` at all — it only gets `from_L1_prev` synthesized
    // onto it. Every hop past that first one is declared, exactly matching the
    // mixed synthetic-then-declared case the depth cap must bound identically.
    const chainLength = READ_INCLUDE_MAX_DEPTH + 2
    const { config } = chainConfig(chainLength)
    delete (config.lists.L0.fields as Record<string, unknown>).next
    ;(config.lists.L1.fields as Record<string, FieldConfig>).prev = rel('L0')

    // Outer `from_L1_prev` (hop 1) + nestedInclude(HOPS_AT_CAP) (HOPS_AT_CAP
    // more, via the declared `next` chain from L1 onward) = HOPS_AT_CAP + 1.
    const requested = { from_L1_prev: nestedInclude(READ_INCLUDE_MAX_DEPTH) }

    await expect(
      buildAccessScopedInclude(
        requested,
        config.lists.L0.fields,
        { session: null, context: makeContext() },
        config,
        'L0',
      ),
    ).rejects.toThrow(AccessScopeDepthExceededError)
  })

  it('still resolves a synthetic hop one level shallower than the cap', async () => {
    const chainLength = READ_INCLUDE_MAX_DEPTH + 1
    const { config } = chainConfig(chainLength)
    delete (config.lists.L0.fields as Record<string, unknown>).next
    ;(config.lists.L1.fields as Record<string, FieldConfig>).prev = rel('L0')

    const requested = { from_L1_prev: nestedInclude(READ_INCLUDE_MAX_DEPTH - 1) }

    const { include } = await buildAccessScopedInclude(
      requested,
      config.lists.L0.fields,
      { session: null, context: makeContext() },
      config,
      'L0',
    )

    expect(includeDepth(include)).toBe(READ_INCLUDE_MAX_DEPTH)
  })

  it('rejects a key that resolves to neither a declared relationship nor a synthetic one', async () => {
    const config = syntheticConfig(() => true)

    await expect(
      buildAccessScopedInclude(
        { from_Nonexistent_field: true },
        config.lists.Term.fields,
        { session: null, context: makeContext() },
        config,
        'Term',
      ),
    ).rejects.toThrow(UndeclaredIncludeKeyError)
  })
})
