import { describe, it, expect } from 'vitest'
import { getDependencyTable, resolveDeclaredDependencies } from './declared-dependencies.js'
import type { OpenSaasConfig, FieldConfig } from '../config/types.js'

/** The dependency sets a read is widened by come from the emitted table (ADR-0051). */

function relField(ref: string, many = false): FieldConfig {
  return { type: 'relationship', ref, many } as unknown as FieldConfig
}

function virtualNeeds(needs: string[]): FieldConfig {
  return {
    type: 'virtual',
    virtual: true,
    needs,
    hooks: { resolveOutput: () => 'x' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal field config for unit test
  } as any
}

const orderConfig: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Order: {
      fields: {
        lineItems: relField('LineItem.order', true),
        total: virtualNeeds(['lineItems']),
      },
    },
    LineItem: {
      fields: {
        product: relField('Product'),
        tag: relField('Tag'),
        summary: virtualNeeds(['product']),
      },
    },
    Product: { fields: { name: { type: 'text' } as FieldConfig } },
    Tag: { fields: { name: { type: 'text' } as FieldConfig } },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
} as any

describe('the emitted table backs the read', () => {
  it('prefers the table the generated bundle supplied over deriving one', () => {
    const emitted = {
      Order: {
        systemFields: ['id'],
        fields: { total: { columns: [], relations: ['lineItems'] } },
      },
    }
    const config: OpenSaasConfig = {
      ...orderConfig,
      _tables: { dependencies: emitted, constraints: {} },
    }

    expect(getDependencyTable(config)).toBe(emitted)
    // The bundle's table is authoritative wherever it speaks — `Order` reads
    // from it, not from the config.
    expect([...resolveDeclaredDependencies(config, 'Order').relations]).toEqual(['lineItems'])
    // `LineItem` is absent from it, which means a bundle older than the
    // config rather than a list with no declarations. Answering with an empty
    // set would silently stop `product` reaching the hook, so that one row is
    // derived from the config instead.
    expect([...resolveDeclaredDependencies(config, 'LineItem').relations]).toEqual(['product'])
    // A key neither the table nor the config has still yields nothing.
    expect(resolveDeclaredDependencies(config, 'Nonexistent').relations.size).toBe(0)
  })

  it('derives the same table once, and reuses it, for a config with none', () => {
    const first = getDependencyTable(orderConfig)
    expect(getDependencyTable(orderConfig)).toBe(first)
    expect(first.Order.fields.total).toEqual({ columns: [], relations: ['lineItems'] })
  })

  it('restricts the union to the fields a fragment selects (ADR-0027)', () => {
    expect(resolveDeclaredDependencies(orderConfig, 'Order', new Set(['id'])).relations.size).toBe(
      0,
    )
    expect([
      ...resolveDeclaredDependencies(orderConfig, 'Order', new Set(['total'])).relations,
    ]).toEqual(['lineItems'])
  })
})
