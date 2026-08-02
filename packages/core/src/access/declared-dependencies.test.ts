import { describe, it, expect } from 'vitest'
import { foldDeclaredDependencies, emptyDeclaredOnlyTree } from './declared-dependencies.js'
import type { OpenSaasConfig, FieldConfig } from '../config/types.js'

/**
 * Unit coverage for `foldDeclaredDependencies` (ADR-0025), focused on the
 * behaviour ADR-0026 requires of it once the read pipeline stopped
 * auto-expanding a named relation's own subtree: a declared dependency no
 * longer rides that expansion "for free" and must be folded recursively —
 * at every level a field is computed, however that level was reached
 * (declaration-added, caller-named bare, or caller-named with its own nested
 * include).
 *
 * End-to-end coverage of the fold feeding an actual read (mocked Prisma, real
 * `resolveOutput` hooks) lives in `tests/needs-declared-dependencies.test.ts`;
 * these tests exercise the fold function directly so a regression here fails
 * fast with a small, precise reproduction.
 */

function relField(ref: string, many = false): FieldConfig {
  return { type: 'relationship', ref, many } as unknown as FieldConfig
}

function virtualNeeds(needs: string[]): FieldConfig {
  return {
    type: 'virtual',
    needs,
    hooks: { resolveOutput: () => 'x' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal field config for unit test
  } as any
}

describe('foldDeclaredDependencies', () => {
  it('returns the exact same reference when there is nothing to fold', () => {
    const fields: Record<string, FieldConfig> = { name: { type: 'text' } as FieldConfig }
    const config = { db: { provider: 'sqlite' }, lists: {} } as unknown as OpenSaasConfig

    const result = foldDeclaredDependencies(undefined, fields, config, 'List')
    expect(result.include).toBeUndefined()
    expect(result.declaredOnly).toEqual(emptyDeclaredOnlyTree())
  })

  it('folds a declaration-added bare relation whose own related list has further needs', () => {
    // Order.total needs lineItems (declaration-added, no caller include at
    // all). LineItem.summary needs product. Without recursing into the
    // declaration-added branch, `product` would never be fetched, and
    // LineItem.summary would silently compute over `undefined`.
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite' },
      lists: {
        Order: {
          fields: {
            lineItems: relField('LineItem.order', true),
            total: virtualNeeds(['lineItems']),
          },
        },
        LineItem: {
          fields: { product: relField('Product'), summary: virtualNeeds(['product']) },
        },
        Product: { fields: { name: { type: 'text' } as FieldConfig } },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any

    const result = foldDeclaredDependencies(undefined, config.lists.Order.fields, config, 'Order')

    expect(result.include).toEqual({ lineItems: { include: { product: true } } })
    // The whole `lineItems` branch is declaration-only at Order's level, so it
    // needs no fine-grained nested tracking — the entire branch is stripped
    // regardless of what's nested inside it.
    expect(result.declaredOnly.keys.has('lineItems')).toBe(true)
    expect(result.declaredOnly.nested.lineItems).toBeUndefined()
  })

  it('folds a caller-named BARE relation whose related list has its own needs, tracking the addition for fine-grained stripping', () => {
    // The caller explicitly asked for `lineItems` (bare) — NOT declaration-only
    // at Order's level — but LineItem's own `product` still has to be folded
    // in for LineItem.summary's hook. Because the caller DID ask for
    // `lineItems`, `product` must be tracked as declaration-only ONE LEVEL
    // DOWN so it (and only it) gets stripped from each returned line item.
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite' },
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

    const result = foldDeclaredDependencies(
      { lineItems: true },
      config.lists.Order.fields,
      config,
      'Order',
    )

    expect(result.include).toEqual({ lineItems: { include: { product: true } } })
    // `lineItems` itself is caller-named, not declaration-only...
    expect(result.declaredOnly.keys.has('lineItems')).toBe(false)
    // ...but `product`, nested beneath it, IS — so it gets stripped from each
    // line item while `lineItems` (and its other fields, e.g. `tag`) survive.
    expect(result.declaredOnly.nested.lineItems?.keys.has('product')).toBe(true)
  })

  it("recurses into an explicit caller-nested include so the nested list's own needs are satisfied there too", () => {
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite' },
      lists: {
        Order: { fields: { lineItems: relField('LineItem.order', true) } },
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

    const result = foldDeclaredDependencies(
      { lineItems: { include: { tag: true } } },
      config.lists.Order.fields,
      config,
      'Order',
    )

    expect(result.include).toEqual({ lineItems: { include: { tag: true, product: true } } })
    expect(result.declaredOnly.nested.lineItems?.keys.has('product')).toBe(true)
    expect(result.declaredOnly.nested.lineItems?.keys.has('tag')).toBe(false)
  })

  it('does not fold anything beneath a relation whose related list has no needs of its own', () => {
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite' },
      lists: {
        Order: { fields: { customer: relField('Customer') } },
        Customer: { fields: { name: { type: 'text' } as FieldConfig } },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any

    const result = foldDeclaredDependencies(
      { customer: true },
      config.lists.Order.fields,
      config,
      'Order',
    )

    // Untouched — no needs anywhere in reach, so the bare relation stays bare.
    expect(result.include).toEqual({ customer: true })
    expect(result.declaredOnly).toEqual(emptyDeclaredOnlyTree())
  })

  it('defensively terminates a two-list mutual `needs` cycle instead of recursing without bound', () => {
    // Order.total needs lineItems; LineItem.orderRef needs order — a cycle
    // `validateNeedsClosureDepth` (needs-closure.ts) rejects at generate time.
    // This constructs it directly to exercise the fold's OWN defensive guard,
    // independent of that generate-time backstop.
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite' },
      lists: {
        Order: {
          fields: {
            lineItems: relField('LineItem.order', true),
            total: virtualNeeds(['lineItems']),
          },
        },
        LineItem: {
          fields: { order: relField('Order.lineItems'), orderRef: virtualNeeds(['order']) },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any

    const result = foldDeclaredDependencies(undefined, config.lists.Order.fields, config, 'Order')

    // Terminates (would hang/stack-overflow without the guard) and still
    // produces a usable, finite include: `lineItems` folds in, but `order`
    // beneath it stops at a flat fetch rather than looping back to `lineItems` again.
    expect(result.include).toEqual({ lineItems: { include: { order: true } } })
  })
})
