import { describe, it, expect } from 'vitest'
import { filterReadableFields } from './field-visibility.js'
import type { OpenSaasConfig, FieldConfig } from '../config/types.js'
import type { AccessContext } from './types.js'

/**
 * Regression coverage for issue #1082, Field Visibility half.
 *
 * `access-filter.test.ts` covers the pre-query scoping of a synthetic
 * back-relation (`buildAccessScopedInclude`); these tests cover what happens
 * to the rows it fetches. Before this fix, `filterReadableFields` recognised
 * only a DECLARED relationship field (`fieldConfig?.type === 'relationship'`)
 * as something to recurse into — a synthetic key has no declared field on the
 * list it's fetched through, so it fell to the generic non-relationship
 * branch and was copied into the result verbatim: no field-level `read` gate
 * on the related rows, and no virtual field computed on them.
 */

// A relationship field pointing at another list.
function rel(ref: string, many = false): FieldConfig {
  return { type: 'relationship', ref, many } as unknown as FieldConfig
}

// A virtual field computed via resolveOutput.
function virtualField(
  resolveOutput: (args: { item: Record<string, unknown> }) => unknown,
): FieldConfig {
  return {
    type: 'virtual',
    virtual: true,
    hooks: { resolveOutput },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal field config for unit test
  } as any as FieldConfig
}

function makeContext(): AccessContext {
  return {
    session: null,
    _isSudo: false,
    _resolveOutputChain: [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal context for unit test
  } as any
}

// Term ← Bill.term (list-only ref, no field on Term) — schema generation
// synthesizes `from_Bill_term` on Term, which no list config declares.
function syntheticConfig(): OpenSaasConfig {
  return {
    db: { provider: 'sqlite' },
    lists: {
      Term: {
        fields: { name: { type: 'text' } as FieldConfig },
        access: { operation: { query: () => true } },
      },
      Bill: {
        fields: {
          amount: { type: 'integer' } as FieldConfig,
          term: rel('Term'),
          internalNotes: {
            type: 'text',
            access: { read: () => false },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal field config for unit test
          } as any as FieldConfig,
          label: virtualField(({ item }) => `Bill #${item.amount}`),
        },
        access: { operation: { query: () => true } },
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
  } as any as OpenSaasConfig
}

describe('filterReadableFields — synthetic back-relation (#1082)', () => {
  it('applies the owning list field-level read access to rows fetched through a synthetic key', async () => {
    const config = syntheticConfig()
    const termRow = {
      id: 't1',
      name: 'Term 1',
      from_Bill_term: [{ id: 'b1', amount: 5, internalNotes: 'secret' }],
    }

    const result = await filterReadableFields(
      termRow,
      config.lists.Term.fields,
      { session: null, context: makeContext() },
      config,
      0,
      'Term',
    )

    const bills = result.from_Bill_term as Record<string, unknown>[]
    expect(bills).toHaveLength(1)
    expect(bills[0].amount).toBe(5)
    expect('internalNotes' in bills[0]).toBe(false)
  })

  it('computes a virtual field on rows fetched through a synthetic key', async () => {
    const config = syntheticConfig()
    const termRow = {
      id: 't1',
      name: 'Term 1',
      from_Bill_term: [{ id: 'b1', amount: 5 }],
    }

    const result = await filterReadableFields(
      termRow,
      config.lists.Term.fields,
      { session: null, context: makeContext() },
      config,
      0,
      'Term',
    )

    const bills = result.from_Bill_term as Record<string, unknown>[]
    expect(bills[0].label).toBe('Bill #5')
  })

  it('recurses through a to-one value fetched through a synthetic key the same as a to-many', async () => {
    const config = syntheticConfig()
    const termRow = {
      id: 't1',
      name: 'Term 1',
      from_Bill_term: { id: 'b1', amount: 5, internalNotes: 'secret' },
    }

    const result = await filterReadableFields(
      termRow,
      config.lists.Term.fields,
      { session: null, context: makeContext() },
      config,
      0,
      'Term',
    )

    const bill = result.from_Bill_term as Record<string, unknown>
    expect(bill.amount).toBe(5)
    expect(bill.label).toBe('Bill #5')
    expect('internalNotes' in bill).toBe(false)
  })

  it('leaves a declared, non-relationship field on the row untouched by the synthetic path', async () => {
    // `name` is a declared scalar field on Term itself — the synthetic
    // fallback only ever applies to a key ABSENT from `fieldConfigs`, so it
    // must never interfere with the list's own ordinary fields.
    const config = syntheticConfig()
    const termRow = { id: 't1', name: 'Term 1' }

    const result = await filterReadableFields(
      termRow,
      config.lists.Term.fields,
      { session: null, context: makeContext() },
      config,
      0,
      'Term',
    )

    expect(result).toEqual({ id: 't1', name: 'Term 1' })
  })

  it('leaves an undeclared, non-synthetic key untouched (no config supplied)', async () => {
    // Mirrors the pre-#1082 narrow-unit-test contract: without `config`
    // there is nothing to resolve a synthetic key against, so the field
    // passes through as a plain value — the same fallback
    // `filterWritableFields` documents for its own `config`-less callers.
    const config = syntheticConfig()
    const termRow = { id: 't1', name: 'Term 1', from_Bill_term: [{ id: 'b1', amount: 5 }] }

    const result = await filterReadableFields(
      termRow,
      config.lists.Term.fields,
      { session: null, context: makeContext() },
      undefined,
      0,
      'Term',
    )

    expect(result.from_Bill_term).toEqual([{ id: 'b1', amount: 5 }])
  })
})
