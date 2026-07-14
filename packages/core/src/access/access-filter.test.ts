import { describe, it, expect } from 'vitest'
import { buildIncludeWithAccessControl, mergeIncludeWithAccessControl } from './access-filter.js'
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

function makeContext(): AccessContext {
  return {
    session: null,
    _isSudo: false,
    _resolveOutputCounter: { depth: 0 },
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

describe('buildIncludeWithAccessControl — cyclic graph', () => {
  it('stops re-descending a relationship cycle instead of walking to MAX_DEPTH', async () => {
    const config = cyclicConfig()
    const include = await buildIncludeWithAccessControl(
      config.lists.A.fields,
      { session: null, context: makeContext() },
      config,
      0,
      ['A'],
    )

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
      db: { provider: 'sqlite', url: 'file:./dev.db' },
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

    const include = await buildIncludeWithAccessControl(
      config.lists.Category.fields,
      { session: null, context: makeContext() },
      config,
      0,
      ['Category'],
    )

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
    )

    expect(merged).toEqual({
      b: { include: { c: { include: { a: true } } } },
    })
    // Still bounded to the acyclic path length.
    expect(includeDepth(merged)).toBeLessThanOrEqual(3)
  })
})
