import { describe, it, expect } from 'vitest'
import {
  buildIncludeWithAccessControl,
  mergeIncludeWithAccessControl,
  toPrismaInclude,
} from './access-filter.js'
import { AccessScopeDepthExceededError } from './errors.js'
import { READ_INCLUDE_MAX_DEPTH } from './depth-limits.js'
import type { OpenSaasConfig, FieldConfig } from '../config/types.js'
import type { AccessContext } from './types.js'

/**
 * Regression coverage for the cyclic readable-relationship auto-include.
 *
 * On a relationship graph that contains a cycle (A → B → C → A) the depth-first
 * auto-include used to descend the cycle on every branch to `MAX_DEPTH`, and
 * `mergeIncludeWithAccessControl` re-expanded any bare-`true` leaf back into that
 * same auto-include. The resulting include tree was deep/large enough to
 * stack-overflow downstream processing (the RSC serializer). The fix seeds a
 * cycle guard with the root list and stops the walk at cycle back-edges, so a
 * relation that closes a cycle comes back FLAT (own columns only).
 */

// A relationship field pointing at another list.
function rel(ref: string, many = false): FieldConfig {
  return { type: 'relationship', ref, many } as unknown as FieldConfig
}

// A cyclic config: A → B → C → A (plus a scalar on each list).
function cyclicConfig(): OpenSaasConfig {
  const allowQuery = () => true
  return {
    db: { provider: 'sqlite', url: 'file:./dev.db' },
    lists: {
      A: {
        fields: { name: { type: 'text' } as FieldConfig, b: rel('B.a') },
        access: { operation: { query: allowQuery } },
      },
      B: {
        fields: { name: { type: 'text' } as FieldConfig, c: rel('C.b') },
        access: { operation: { query: allowQuery } },
      },
      C: {
        fields: { name: { type: 'text' } as FieldConfig, a: rel('A.c') },
        access: { operation: { query: allowQuery } },
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
  } as any
}

function makeContext(resolveOutputDepth = 0): AccessContext {
  const chain = Array.from({ length: resolveOutputDepth }, (_, i) => ({
    listKey: 'TestHook',
    fieldKey: `hook${i}`,
  }))
  return {
    session: null,
    _isSudo: false,
    _resolveOutputChain: chain,
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
// assert the merged tree actually carries the right `where` at a given hop
// (not just that it happens not to throw).
function chainConfig(count: number): OpenSaasConfig {
  const lists: Record<string, { fields: Record<string, FieldConfig>; access: unknown }> = {}
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
    lists[listName] = {
      fields,
      access: { operation: { query: i === 0 ? () => true : () => filter } },
    }
  }
  return {
    db: { provider: 'sqlite', url: 'file:./dev.db' },
    lists,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
  } as any
}

// A caller `include` value selecting `next` `hops` more times beyond the
// point at which this value is attached, ending in a bare `true` leaf. E.g.
// `nestedInclude(0) === true` (stop here); `{ next: nestedInclude(2) }` at the
// top level names 3 hops total (the outer `next` plus 2 more).
function nestedInclude(hops: number): Record<string, unknown> {
  if (hops <= 0) return true as unknown as Record<string, unknown>
  return { include: { next: nestedInclude(hops - 1) } }
}

// Read the `where` at the end of a chain of nested `next` includes (used to
// assert row-scoping survived down to a specific hop).
function whereAtHop(merged: Record<string, unknown>, hops: number): unknown {
  let current: unknown = merged
  for (let i = 0; i < hops; i++) {
    const entry = (current as { next?: unknown })?.next
    if (i === hops - 1) return (entry as { where?: unknown })?.where
    current = (entry as { include?: unknown })?.include
  }
  return undefined
}

describe('buildIncludeWithAccessControl — cyclic graph', () => {
  it('stops re-descending a relationship cycle instead of walking to MAX_DEPTH', async () => {
    const config = cyclicConfig()
    const result = await buildIncludeWithAccessControl(
      config.lists.A.fields,
      { session: null, context: makeContext() },
      config,
      0,
      ['A'],
    )
    const include = toPrismaInclude(result)

    // A → B → C, then C.a closes the cycle back to A → flat (no further nesting).
    expect(include).toEqual({
      b: { include: { c: { include: { a: true } } } },
    })
    // Three distinct lists → depth 3, not the old MAX_DEPTH=5 (which on a cycle
    // could recurse A→B→C→A→B).
    expect(includeDepth(include)).toBe(3)
  })

  it('flattens a self-referential relationship to a single level', async () => {
    const allowQuery = () => true
    const config = {
      db: { provider: 'sqlite' },
      lists: {
        Category: {
          fields: {
            name: { type: 'text' } as FieldConfig,
            parent: rel('Category.children'),
            children: rel('Category.parent', true),
          },
          access: { operation: { query: allowQuery } },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any as OpenSaasConfig

    const result = await buildIncludeWithAccessControl(
      config.lists.Category.fields,
      { session: null, context: makeContext() },
      config,
      0,
      ['Category'],
    )
    const include = toPrismaInclude(result)

    // Both self-references come back flat — no infinite parent/children descent.
    expect(include).toEqual({ parent: true, children: true })
    expect(includeDepth(include)).toBe(1)
  })
})

describe('mergeIncludeWithAccessControl — bare-true leaf on a cyclic graph', () => {
  it('does not re-expand a bare-true leaf beyond the cycle-bounded auto-include', async () => {
    const config = cyclicConfig()
    const accessControlledInclude = await buildIncludeWithAccessControl(
      config.lists.A.fields,
      { session: null, context: makeContext() },
      config,
      0,
      ['A'],
    )

    // Caller asks for A → b with a bare-`true` leaf. The merge must keep the
    // access-controlled (cycle-bounded) nested include rather than re-expanding
    // the leaf into an unbounded auto-include.
    const merged = mergeIncludeWithAccessControl(
      { b: true },
      accessControlledInclude,
      config.lists.A.fields,
      config,
      'A',
    )

    expect(merged).toEqual({
      b: { include: { c: { include: { a: true } } } },
    })
    // Still bounded to the acyclic path length.
    expect(includeDepth(merged)).toBeLessThanOrEqual(3)
  })
})

/**
 * A caller-supplied `take` on a to-many relation include must survive the
 * access-controlled merge (issue #752). It only narrows the fetched rows and can
 * never widen past the access `where`, so the merge re-attaches it on top of the
 * per-relation access filter — powering the item view's bounded relationship
 * tables without dropping row-level access.
 */
describe('mergeIncludeWithAccessControl — caller take on a to-many relation (issue #752)', () => {
  // A one-list config whose `posts` to-many is query-scoped by an access filter.
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
          // Scoped read access → the merge must fold this into the relation include.
          access: { operation: { query: () => ({ published: { equals: true } }) } },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any
  }

  it('preserves the take and AND-combines it with the access where', async () => {
    const config = scopedConfig()
    const accessControlledInclude = await buildIncludeWithAccessControl(
      config.lists.User.fields,
      { session: null, context: makeContext() },
      config,
      0,
      ['User'],
    )

    const merged = mergeIncludeWithAccessControl(
      { posts: { take: 10 } },
      accessControlledInclude,
      config.lists.User.fields,
      config,
      'User',
    )

    // The bound rides on top of the access filter — neither is dropped. The
    // access-controlled include also auto-nests Post's `author` back-relation.
    expect(merged).toEqual({
      posts: {
        where: { published: { equals: true } },
        include: { author: true },
        take: 10,
      },
    })
  })

  it('drops a take for a relation whose query access is denied', async () => {
    const config = scopedConfig()
    // Deny Post reads entirely.
    config.lists.Post.access = { operation: { query: () => false } }
    const accessControlledInclude = await buildIncludeWithAccessControl(
      config.lists.User.fields,
      { session: null, context: makeContext() },
      config,
      0,
      ['User'],
    )

    const merged = mergeIncludeWithAccessControl(
      { posts: { take: 10 } },
      accessControlledInclude,
      config.lists.User.fields,
      config,
      'User',
    )

    // A denied relation is dropped wholesale — the take cannot resurrect it.
    expect(merged).toEqual({})
  })
})

/**
 * Regression coverage for issue #830: the read pipeline used to FAIL OPEN past
 * `READ_INCLUDE_MAX_DEPTH` — a caller-supplied `include` nested deeper than the
 * engine could scope was passed through unscoped rather than denied. These
 * tests pin the exact boundary the fix introduces (ADR-0022): a caller include
 * one level past the cap throws, the same include one level shallower still
 * works, and an unrequested auto-include past the cap stays silent.
 */
describe('mergeIncludeWithAccessControl — fail-closed at the read-include depth cap (#830)', () => {
  // A relation `hops` hops from the root sits AT the cap boundary (correctly
  // where-scoped, matching the triage report's "F" list); one hop further is
  // the first one the engine cannot scope ("G"). With
  // READ_INCLUDE_MAX_DEPTH = 5 that boundary is hop 5 / hop 6.
  const HOPS_AT_CAP = READ_INCLUDE_MAX_DEPTH

  it('throws AccessScopeDepthExceededError when the caller include reaches past the cap', async () => {
    // L0 → L1 → … → L6 (one more list than HOPS_AT_CAP + 1) so a caller
    // include can walk `next` one hop past the boundary.
    const chainLength = HOPS_AT_CAP + 2
    const config = chainConfig(chainLength)

    const accessControlledInclude = await buildIncludeWithAccessControl(
      config.lists.L0.fields,
      { session: null, context: makeContext() },
      config,
      0,
      ['L0'],
    )

    // Outer `next` (hop 1) + nestedInclude(HOPS_AT_CAP) (HOPS_AT_CAP more) = HOPS_AT_CAP + 1 hops.
    const callerInclude = { next: nestedInclude(HOPS_AT_CAP) }

    expect(() =>
      mergeIncludeWithAccessControl(
        callerInclude,
        accessControlledInclude,
        config.lists.L0.fields,
        config,
        'L0',
      ),
    ).toThrow(AccessScopeDepthExceededError)
  })

  it('still row-scopes a caller include one level shallower than the cap', async () => {
    const chainLength = HOPS_AT_CAP + 1
    const config = chainConfig(chainLength)

    const accessControlledInclude = await buildIncludeWithAccessControl(
      config.lists.L0.fields,
      { session: null, context: makeContext() },
      config,
      0,
      ['L0'],
    )

    // Outer `next` (hop 1) + nestedInclude(HOPS_AT_CAP - 1) = HOPS_AT_CAP hops total — right at the boundary.
    const callerInclude = { next: nestedInclude(HOPS_AT_CAP - 1) }

    // Must NOT throw — this depth is within what the engine can scope.
    const merged = mergeIncludeWithAccessControl(
      callerInclude,
      accessControlledInclude,
      config.lists.L0.fields,
      config,
      'L0',
    )

    expect(includeDepth(merged)).toBe(HOPS_AT_CAP)
    // The last list in the chain (at the boundary) is genuinely row-scoped —
    // not just present without a throw.
    expect(whereAtHop(merged, HOPS_AT_CAP)).toEqual({ ownerId: { equals: `L${HOPS_AT_CAP}` } })
  })

  it('does not throw for an ordinary read with no caller include, even on a deep schema', async () => {
    // No caller include at all — the auto-include just stops at the cap
    // silently. This must never throw; only an EXPLICIT caller selection past
    // the cap is a denial.
    const chainLength = HOPS_AT_CAP + 3
    const config = chainConfig(chainLength)

    const result = await buildIncludeWithAccessControl(
      config.lists.L0.fields,
      { session: null, context: makeContext() },
      config,
      0,
      ['L0'],
    )

    expect(() => toPrismaInclude(result)).not.toThrow()
    const include = toPrismaInclude(result)
    expect(includeDepth(include)).toBeLessThanOrEqual(HOPS_AT_CAP)
  })

  it('a list with no relationships still passes the caller include through unchanged', async () => {
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

    const accessControlledInclude = await buildIncludeWithAccessControl(
      config.lists.Leaf.fields,
      { session: null, context: makeContext() },
      config,
      0,
      ['Leaf'],
    )

    expect(accessControlledInclude).toEqual({ kind: 'nothing-to-scope' })

    // An arbitrary (non-declared-relationship) key passed through unchanged —
    // access control does not govern keys it doesn't recognize as relationships.
    const merged = mergeIncludeWithAccessControl(
      { someUnrelatedKey: true },
      accessControlledInclude,
      config.lists.Leaf.fields,
      config,
      'Leaf',
    )
    expect(merged).toEqual({ someUnrelatedKey: true })
  })
})

/**
 * Regression coverage for the resolveOutput/virtual-field trigger of #830: a
 * read issued from inside a resolveOutput hook used to lose relation row
 * scoping ENTIRELY (whole-object passthrough) rather than scoping the
 * immediate relation and simply not auto-expanding further. The loop guard
 * that motivated the original passthrough (hooks making DB queries that
 * include relationships back to the same entity) must still hold.
 */
describe('buildIncludeWithAccessControl — inside a resolveOutput context', () => {
  it('scopes the immediate relation with its access where but does not auto-expand nested relations', async () => {
    const config = chainConfig(4) // L0 → L1 → L2 → L3
    config.lists.L1.access = { operation: { query: () => ({ tenantId: { equals: 'mine' } }) } }

    const result = await buildIncludeWithAccessControl(
      config.lists.L0.fields,
      { session: null, context: makeContext(1) }, // depth > 0 → inside resolveOutput
      config,
      0,
      ['L0'],
    )

    expect(result.kind).toBe('scoped')
    const include = toPrismaInclude(result)
    // L1's own access `where` is applied...
    expect(include).toEqual({ next: { where: { tenantId: { equals: 'mine' } } } })
    // ...but L1's own nested relations (`next` → L2) are NOT auto-included.
    expect(includeDepth(include)).toBe(1)
  })

  it('terminates on a self-referential relationship instead of looping', async () => {
    const config = {
      db: { provider: 'sqlite' },
      lists: {
        Category: {
          fields: {
            name: { type: 'text' } as FieldConfig,
            parent: rel('Category.children'),
            children: rel('Category.parent', true),
          },
          access: { operation: { query: () => true } },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any as OpenSaasConfig

    const result = await buildIncludeWithAccessControl(
      config.lists.Category.fields,
      { session: null, context: makeContext(1) },
      config,
      0,
      ['Category'],
    )

    const include = toPrismaInclude(result)
    expect(include).toEqual({ parent: true, children: true })
  })
})
