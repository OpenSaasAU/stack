import { describe, it, expect, vi } from 'vitest'
import { buildAccessScopedInclude } from './access-filter.js'
import { AccessScopeDepthExceededError } from './errors.js'
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
      fields.next = rel(`L${i + 1}.prev`)
    }
    if (i > 0) {
      fields.prev = rel(`L${i - 1}.next`)
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

    const include = await buildAccessScopedInclude(
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

    const include = await buildAccessScopedInclude(
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

    const include = await buildAccessScopedInclude(
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

    const include = await buildAccessScopedInclude(
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

    const include = await buildAccessScopedInclude(
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

    const include = await buildAccessScopedInclude(
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

    const include = await buildAccessScopedInclude(
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

    const include = await buildAccessScopedInclude(
      {},
      config.lists.L0.fields,
      { session: null, context: makeContext() },
      config,
      'L0',
    )
    expect(include).toEqual({})
  })

  it('a list with no relationships passes an unrelated requested key through unchanged', async () => {
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

    // An arbitrary (non-declared-relationship) key passed through unchanged —
    // access control does not govern keys it doesn't recognize as relationships.
    const include = await buildAccessScopedInclude(
      { someUnrelatedKey: true },
      config.lists.Leaf.fields,
      { session: null, context: makeContext() },
      config,
      'Leaf',
    )
    expect(include).toEqual({ someUnrelatedKey: true })
  })
})
