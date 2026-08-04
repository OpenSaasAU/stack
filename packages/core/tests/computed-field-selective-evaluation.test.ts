import { describe, it, expect, vi } from 'vitest'
import { getContext } from '../src/context/index.js'
import { config, list } from '../src/config/index.js'
import { text, integer, relationship, virtual } from '../src/fields/index.js'
import { defineFragment } from '../src/query/index.js'
import type { FieldConfig } from '../src/config/types.js'

/**
 * Coverage for issue #855 / ADR-0027: a computed field — any field carrying a
 * `resolveOutput` hook, virtual or not — is computed if and only if the read
 * is going to return it, its declared relations (`needs`, ADR-0025) are
 * fetched under exactly that same condition, and no computed field ever sees
 * another computed field's resolved output.
 *
 * `tests/needs-declared-dependencies.test.ts` covers ADR-0025 itself (fetch
 * folding, access scoping of a declared relation); this file covers the
 * selectivity ADR-0027 adds on top of it.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockPrisma(): any {
  const model = () => ({
    findFirst: vi.fn(),
    findMany: vi.fn(),
  })
  return { order: model(), lineItem: model(), product: model() }
}

function buildTestConfig(spies: {
  totalHook: ReturnType<typeof vi.fn>
  doubleTotalHook: ReturnType<typeof vi.fn>
  secretAccess: ReturnType<typeof vi.fn>
  secretHook: ReturnType<typeof vi.fn>
  unreachableAccess: ReturnType<typeof vi.fn>
  unreachableHook: ReturnType<typeof vi.fn>
  summaryHook: ReturnType<typeof vi.fn>
  hooklessAccess: ReturnType<typeof vi.fn>
  peekerHook: ReturnType<typeof vi.fn>
}) {
  return config({
    db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
    lists: {
      Product: list({
        fields: { name: text() },
        access: { operation: { query: () => true } },
      }),
      LineItem: list({
        fields: {
          price: integer(),
          order: relationship({ ref: 'Order.lineItems' }),
          product: relationship({ ref: 'Product' }),
          summary: virtual({
            type: 'string',
            needs: ['product'],
            hooks: {
              resolveOutput: (hookArgs: unknown) => {
                spies.summaryHook(hookArgs)
                const typedItem = (hookArgs as { item: { product?: { name?: string } | null } })
                  .item
                return typedItem.product ? `${typedItem.product.name} x1` : 'unknown product x1'
              },
            },
          }),
        },
        access: { operation: { query: () => true } },
      }),
      Order: list({
        fields: {
          title: text(),
          lineItems: relationship({ ref: 'LineItem.order', many: true }),
          total: virtual({
            type: 'number',
            needs: ['lineItems'],
            hooks: {
              resolveOutput: (hookArgs: unknown) => {
                spies.totalHook(hookArgs)
                const typedItem = (hookArgs as { item: { lineItems?: Array<{ price?: number }> } })
                  .item
                return (typedItem.lineItems ?? []).reduce((sum, li) => sum + (li.price ?? 0), 0)
              },
            },
          }),
          // Declares the SAME relation as `total` — exercises "fetched once,
          // even when only one of the two declaring fields is selected."
          doubleTotal: virtual({
            type: 'number',
            needs: ['lineItems'],
            hooks: {
              resolveOutput: (hookArgs: unknown) => {
                spies.doubleTotalHook(hookArgs)
                const typedItem = (hookArgs as { item: { lineItems?: Array<{ price?: number }> } })
                  .item
                return (typedItem.lineItems ?? []).reduce((sum, li) => sum + (li.price ?? 0), 0) * 2
              },
            },
          }),
          // A stored field with its own resolveOutput (a "computed field" per
          // ADR-0027, not only virtual ones) whose access AND hook are spied
          // on so a fragment that never selects it can be asserted to have
          // invoked neither.
          secret: text({
            access: {
              read: spies.secretAccess,
            },
            hooks: {
              resolveOutput: (hookArgs: unknown) => {
                spies.secretHook(hookArgs)
                return `wrapped:${(hookArgs as { value: unknown }).value}`
              },
            },
          }),
          // A virtual field never selected by any fragment in these tests —
          // stands in for "a field the read is never going to return."
          unreachable: virtual({
            type: 'string',
            access: {
              read: (accessArgs: unknown) => {
                spies.unreachableAccess(accessArgs)
                return true
              },
            },
            hooks: {
              resolveOutput: (hookArgs: unknown) => {
                spies.unreachableHook(hookArgs)
                return 'unreachable-value'
              },
            },
          }),
          // Reads a SIBLING computed field (`secret`) without declaring it —
          // must see `undefined`, never `secret`'s resolved ("wrapped:...")
          // value, and never its raw stored value either when `secret` is
          // skipped by a fragment's own selection.
          peeker: virtual({
            type: 'string',
            hooks: {
              resolveOutput: (hookArgs: unknown) => {
                spies.peekerHook(hookArgs)
                const value = (hookArgs as { item: Record<string, unknown> }).item.secret
                return value === undefined ? 'saw-nothing' : `saw:${String(value)}`
              },
            },
          }),
          // A hookless virtual field — can never produce a value on ANY
          // read. Constructed as a raw FieldConfig (bypassing the `virtual()`
          // builder, which throws without a `resolveOutput`) the way a
          // third-party field package might legitimately shape one.
          hooklessVirtual: {
            type: 'text',
            virtual: true,
            access: {
              read: (accessArgs: unknown) => {
                spies.hooklessAccess(accessArgs)
                return true
              },
            },
            hooks: {},
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal raw field config for a test double
          } as any as FieldConfig,
        },
        access: { operation: { query: () => true } },
      }),
    },
  })
}

function makeSpies() {
  return {
    totalHook: vi.fn(),
    doubleTotalHook: vi.fn(),
    secretAccess: vi.fn(() => true),
    secretHook: vi.fn(),
    unreachableAccess: vi.fn(),
    unreachableHook: vi.fn(),
    summaryHook: vi.fn(),
    hooklessAccess: vi.fn(),
    peekerHook: vi.fn(),
  }
}

describe('a computed field runs only when it is going to be returned (#855, ADR-0027)', () => {
  it('a fragment that does not select a computed field runs neither its read access nor its hook, and does not fold its needs into the include', async () => {
    const spies = makeSpies()
    const testConfig = await buildTestConfig(spies)
    const mockPrisma = createMockPrisma()
    mockPrisma.order.findFirst.mockResolvedValue({ id: 'o1', title: 'Order 1' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fragment = defineFragment<any>()({ title: true } as const)
    const context = getContext(testConfig, mockPrisma, null)
    const result = await context.db.order.findUnique({ where: { id: 'o1' }, query: fragment })

    // None of the unselected computed fields' declared relations were folded
    // into the include — `lineItems` is only ever needed by `total`/
    // `doubleTotal`, neither of which was selected, so there is nothing to
    // fold and `include` stays exactly `undefined` (the bare-read shape).
    const callArgs = mockPrisma.order.findFirst.mock.calls[0][0]
    expect(callArgs.include).toBeUndefined()

    expect(spies.totalHook).not.toHaveBeenCalled()
    expect(spies.doubleTotalHook).not.toHaveBeenCalled()
    expect(spies.secretAccess).not.toHaveBeenCalled()
    expect(spies.secretHook).not.toHaveBeenCalled()
    expect(spies.unreachableAccess).not.toHaveBeenCalled()
    expect(spies.unreachableHook).not.toHaveBeenCalled()

    expect(result).toEqual({ title: 'Order 1' })
  })

  it('a fragment that DOES select a computed field computes it correctly and fetches its declared relation, unchanged', async () => {
    const spies = makeSpies()
    const testConfig = await buildTestConfig(spies)
    const mockPrisma = createMockPrisma()
    mockPrisma.order.findFirst.mockResolvedValue({
      id: 'o1',
      title: 'Order 1',
      lineItems: [{ id: 'li1', price: 10, orderId: 'o1' }],
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fragment = defineFragment<any>()({ title: true, total: true } as const)
    const context = getContext(testConfig, mockPrisma, null)
    const result = await context.db.order.findUnique({ where: { id: 'o1' }, query: fragment })

    const callArgs = mockPrisma.order.findFirst.mock.calls[0][0]
    expect(callArgs.include).toMatchObject({ lineItems: expect.anything() })
    expect(spies.totalHook).toHaveBeenCalledTimes(1)
    expect(result?.total).toBe(10)
    expect(result).not.toHaveProperty('lineItems')
  })

  it('two fields declaring the same relation, only one selected, still fetch that relation exactly once — and only the selected field computes', async () => {
    const spies = makeSpies()
    const testConfig = await buildTestConfig(spies)
    const mockPrisma = createMockPrisma()
    mockPrisma.order.findFirst.mockResolvedValue({
      id: 'o1',
      title: 'Order 1',
      lineItems: [{ id: 'li1', price: 10, orderId: 'o1' }],
    })

    // `doubleTotal` also needs `lineItems` but is NOT selected.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fragment = defineFragment<any>()({ title: true, total: true } as const)
    const context = getContext(testConfig, mockPrisma, null)
    const result = await context.db.order.findUnique({ where: { id: 'o1' }, query: fragment })

    expect(mockPrisma.order.findFirst).toHaveBeenCalledTimes(1)
    const callArgs = mockPrisma.order.findFirst.mock.calls[0][0]
    // Exactly one `lineItems` entry in the include — folded once for `total`.
    expect(Object.keys(callArgs.include)).toEqual(['lineItems'])

    expect(result?.total).toBe(10)
    expect(spies.totalHook).toHaveBeenCalledTimes(1)
    expect(spies.doubleTotalHook).not.toHaveBeenCalled()
  })

  it('nested level: a nested fragment selecting a subset computes only that subset', async () => {
    const spies = makeSpies()
    const testConfig = await buildTestConfig(spies)
    const mockPrisma = createMockPrisma()
    mockPrisma.order.findFirst.mockResolvedValue({
      id: 'o1',
      title: 'Order 1',
      lineItems: [{ id: 'li1', price: 10, orderId: 'o1' }],
    })

    const lineItemFragment = defineFragment<{ price: number }>()({ price: true } as const)
    const orderFragment = defineFragment<{ title: string; lineItems: unknown[] }>()({
      title: true,
      lineItems: lineItemFragment,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const context = getContext(testConfig, mockPrisma, null)
    const result = await context.db.order.findUnique({
      where: { id: 'o1' },
      query: orderFragment,
    })

    // `summary` (needs `product`) was not selected inside the nested
    // fragment, so neither its hook ran nor was `product` folded in beneath
    // `lineItems`.
    expect(spies.summaryHook).not.toHaveBeenCalled()
    const callArgs = mockPrisma.order.findFirst.mock.calls[0][0]
    expect(callArgs.include.lineItems).not.toMatchObject({
      include: expect.objectContaining({ product: expect.anything() }),
    })
    expect(result?.lineItems?.[0]).toEqual({ price: 10 })
  })

  it('nested level: an include (not a fragment) still computes every computed field, unchanged', async () => {
    const spies = makeSpies()
    const testConfig = await buildTestConfig(spies)
    const mockPrisma = createMockPrisma()
    mockPrisma.order.findFirst.mockResolvedValue({
      id: 'o1',
      title: 'Order 1',
      lineItems: [{ id: 'li1', price: 10, orderId: 'o1', product: { id: 'p1', name: 'Widget' } }],
    })

    const context = getContext(testConfig, mockPrisma, null)
    const result = await context.db.order.findUnique({
      where: { id: 'o1' },
      include: { lineItems: { include: { product: true } } },
    })

    expect(spies.summaryHook).toHaveBeenCalledTimes(1)
    expect(result?.lineItems?.[0].summary).toBe('Widget x1')
  })

  it("a hook's item never carries another computed field's resolved output, even on a bare read where both survive", async () => {
    const spies = makeSpies()
    const testConfig = await buildTestConfig(spies)
    const mockPrisma = createMockPrisma()
    mockPrisma.order.findFirst.mockResolvedValue({ id: 'o1', title: 'Order 1', secret: 'hunter2' })

    const context = getContext(testConfig, mockPrisma, null)
    // Bare read: every computed field computes, including `secret` (a stored
    // field with its own resolveOutput) and `peeker` (a virtual field with no
    // `needs` at all, reading `item.secret` without declaring it). `secret`
    // is a plain stored scalar column, always fetched on any read (ADR-0024)
    // regardless of declarations — only RELATIONS are conditionally fetched.
    const result = await context.db.order.findUnique({ where: { id: 'o1' } })

    // `secret`'s OWN resolveOutput wraps its stored value for the caller...
    expect(result?.secret).toBe('wrapped:hunter2')
    // ...but `peeker`, reading the same key from its own hook's `item`, sees
    // the raw STORED column ('hunter2'), never `secret`'s resolved output
    // ('wrapped:hunter2') — the "no computed field sees another's computed
    // value" rule, proven by the two hooks disagreeing about the same key.
    expect(result?.peeker).toBe('saw:hunter2')
  })

  it("a skipped field's key is absent from a sibling hook's item, never present holding its raw stored value", async () => {
    const spies = makeSpies()
    const testConfig = await buildTestConfig(spies)
    const mockPrisma = createMockPrisma()
    mockPrisma.order.findFirst.mockResolvedValue({ id: 'o1', title: 'Order 1', secret: 'hunter2' })

    // `secret` is NOT selected; `peeker` is, and reads `item.secret`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fragment = defineFragment<any>()({ title: true, peeker: true } as const)
    const context = getContext(testConfig, mockPrisma, null)
    const result = await context.db.order.findUnique({ where: { id: 'o1' }, query: fragment })

    // `secret`'s own access/hook never ran (it was never going to be returned).
    expect(spies.secretAccess).not.toHaveBeenCalled()
    expect(spies.secretHook).not.toHaveBeenCalled()
    // `peeker` sees the key absent, never the raw pre-hook stored value.
    expect(result?.peeker).toBe('saw-nothing')
    expect(result).not.toHaveProperty('secret')
  })

  it('field-level read access still gates a field that IS selected: denied means absent and its hook does not run', async () => {
    const spies = makeSpies()
    spies.secretAccess.mockImplementation(() => false)
    const testConfigDenied = await buildTestConfig(spies)
    const mockPrisma = createMockPrisma()
    mockPrisma.order.findFirst.mockResolvedValue({ id: 'o1', title: 'Order 1', secret: 'hunter2' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fragment = defineFragment<any>()({ title: true, secret: true } as const)
    const context = getContext(testConfigDenied, mockPrisma, null)
    const result = await context.db.order.findUnique({ where: { id: 'o1' }, query: fragment })

    expect(spies.secretAccess).toHaveBeenCalled()
    expect(spies.secretHook).not.toHaveBeenCalled()
    expect(result?.secret).toBeUndefined()
  })

  it('a hookless virtual field does no work at all — its read access is never invoked on any read', async () => {
    const spies = makeSpies()
    const testConfig = await buildTestConfig(spies)
    const mockPrisma = createMockPrisma()
    mockPrisma.order.findFirst.mockResolvedValue({ id: 'o1', title: 'Order 1' })
    mockPrisma.order.findMany.mockResolvedValue([{ id: 'o1', title: 'Order 1' }])

    const context = getContext(testConfig, mockPrisma, null)

    // Bare read.
    await context.db.order.findUnique({ where: { id: 'o1' } })
    expect(spies.hooklessAccess).not.toHaveBeenCalled()

    // include-based read naming it explicitly.
    await context.db.order.findUnique({ where: { id: 'o1' }, include: { hooklessVirtual: true } })
    expect(spies.hooklessAccess).not.toHaveBeenCalled()

    // fragment selecting it explicitly.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fragment = defineFragment<any>()({ title: true, hooklessVirtual: true } as const)
    await context.db.order.findUnique({ where: { id: 'o1' }, query: fragment })
    expect(spies.hooklessAccess).not.toHaveBeenCalled()
  })

  it('include/bare reads still return every computed field on the list, unchanged', async () => {
    const spies = makeSpies()
    const testConfig = await buildTestConfig(spies)
    const mockPrisma = createMockPrisma()
    mockPrisma.order.findMany.mockResolvedValue([
      {
        id: 'o1',
        title: 'Order 1',
        secret: 'hunter2',
        lineItems: [{ id: 'li1', price: 10, orderId: 'o1' }],
      },
    ])

    const context = getContext(testConfig, mockPrisma, null)
    const result = await context.db.order.findMany({})

    expect(result[0].total).toBe(10)
    expect(result[0].doubleTotal).toBe(20)
    expect(result[0].secret).toBe('wrapped:hunter2')
    expect(spies.totalHook).toHaveBeenCalledTimes(1)
    expect(spies.doubleTotalHook).toHaveBeenCalledTimes(1)
    expect(spies.secretHook).toHaveBeenCalledTimes(1)
  })
})
