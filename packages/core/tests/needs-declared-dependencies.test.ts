import { describe, it, expect, vi } from 'vitest'
import { getContext } from '../src/context/index.js'
import { config, list } from '../src/config/index.js'
import { text, integer, relationship, virtual } from '../src/fields/index.js'
import { defineFragment } from '../src/query/index.js'

/**
 * Coverage for ADR-0025 / issue #850: a computed field may declare (via
 * `needs`) the immediate relations its `resolveOutput` hook cannot compute
 * without. The read fetches exactly those, scoped through the Access Filter
 * like any other relation a read asks for, and strips them from the result
 * unless the caller named them too — a declared dependency is private
 * plumbing, not an implicit `include` (see the "Declared dependency" and
 * "Session-relative value" glossary entries in CONTEXT.md).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockPrisma(): any {
  const model = () => ({
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  })
  return {
    order: model(),
    lineItem: model(),
    product: model(),
    tag: model(),
  }
}

function buildTestConfig(options?: {
  lineItemQuery?: () => boolean | Record<string, unknown>
  lineItemsFieldAccess?: () => boolean
  // Adds a second declaring field on LineItem, pointed back at Order, so
  // Order.total needs lineItems AND LineItem.orderTitle needs order form a
  // genuine two-list declaration cycle. Opt-in — most tests want a shallow,
  // acyclic closure.
  withDeclarationCycle?: boolean
}) {
  return config({
    db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
    lists: {
      Tag: list({
        fields: { name: text() },
        access: { operation: { query: () => true } },
      }),
      Product: list({
        fields: { name: text() },
        access: { operation: { query: () => true } },
      }),
      LineItem: list({
        fields: {
          price: integer(),
          order: relationship({ ref: 'Order.lineItems' }),
          product: relationship({ ref: 'Product' }),
          tag: relationship({ ref: 'Tag' }),
          // Declares a dependency on a SIBLING relation (`product`) — the
          // shape every acceptance criterion below exercises.
          summary: virtual({
            type: 'string',
            needs: ['product'],
            hooks: {
              resolveOutput: ({ item }) => {
                const typedItem = item as { product?: { name?: string } | null }
                return typedItem.product ? `${typedItem.product.name} x1` : 'unknown product x1'
              },
            },
          }),
          ...(options?.withDeclarationCycle
            ? {
                orderTitle: virtual({
                  type: 'string',
                  needs: ['order'],
                  hooks: {
                    resolveOutput: ({ item }) => {
                      const typedItem = item as { order?: { title?: string } | null }
                      return typedItem.order?.title ?? 'no-order'
                    },
                  },
                }),
              }
            : {}),
        },
        access: {
          operation: { query: options?.lineItemQuery ?? (() => true) },
        },
      }),
      Order: list({
        fields: {
          title: text(),
          lineItems: relationship({
            ref: 'LineItem.order',
            many: true,
            ...(options?.lineItemsFieldAccess
              ? { access: { read: options.lineItemsFieldAccess } }
              : {}),
          }),
          total: virtual({
            type: 'number',
            needs: ['lineItems'],
            hooks: {
              resolveOutput: ({ item }) => {
                const typedItem = item as { lineItems?: Array<{ price?: number }> }
                return (typedItem.lineItems ?? []).reduce((sum, li) => sum + (li.price ?? 0), 0)
              },
            },
          }),
        },
        access: { operation: { query: () => true } },
      }),
    },
  })
}

describe('a computed field declares the relations it needs (#850, ADR-0025)', () => {
  it('is available to resolveOutput on a bare read (no caller include), and absent from the result', async () => {
    const testConfig = await buildTestConfig()
    const mockPrisma = createMockPrisma()
    mockPrisma.order.findMany.mockResolvedValue([
      {
        id: 'o1',
        title: 'Order 1',
        lineItems: [
          { id: 'li1', price: 10, orderId: 'o1' },
          { id: 'li2', price: 5, orderId: 'o1' },
        ],
      },
    ])

    const context = getContext(testConfig, mockPrisma, null)
    const result = await context.db.order.findMany({})

    // The declared relation WAS fetched (folded into the include even though
    // the caller asked for nothing).
    expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ lineItems: expect.anything() }),
      }),
    )

    // ...but it never widens the result: the field computes from it, and the
    // relation itself is stripped because the caller never named it.
    expect(result[0].total).toBe(15)
    expect(result[0]).not.toHaveProperty('lineItems')
  })

  it('a caller include naming the same relation still receives it, unchanged', async () => {
    const testConfig = await buildTestConfig()
    const mockPrisma = createMockPrisma()
    mockPrisma.order.findFirst.mockResolvedValue({
      id: 'o1',
      title: 'Order 1',
      lineItems: [{ id: 'li1', price: 10, orderId: 'o1' }],
    })

    const context = getContext(testConfig, mockPrisma, null)
    const result = await context.db.order.findUnique({
      where: { id: 'o1' },
      include: { lineItems: true },
    })

    expect(result?.total).toBe(10)
    // Caller-named, so present and unchanged (its own `summary` field also
    // computes as normal — LineItem's fields are unaffected by this feature).
    expect(result?.lineItems?.[0]).toMatchObject({ id: 'li1', price: 10, orderId: 'o1' })
  })

  it('folds a declared dependency into an EXPLICIT nested caller include, and strips only the added key', async () => {
    const testConfig = await buildTestConfig()
    const mockPrisma = createMockPrisma()
    // Simulates what Prisma would actually return given the fold: `tag`
    // (caller-named) AND `product` (declaration-added) both present on the
    // fetched row.
    mockPrisma.order.findFirst.mockResolvedValue({
      id: 'o1',
      title: 'Order 1',
      lineItems: [
        {
          id: 'li1',
          price: 10,
          orderId: 'o1',
          tag: { id: 't1', name: 'Sale' },
          product: { id: 'p1', name: 'Widget' },
        },
      ],
    })

    const context = getContext(testConfig, mockPrisma, null)
    const result = await context.db.order.findUnique({
      where: { id: 'o1' },
      include: { lineItems: { include: { tag: true } } },
    })

    // The Prisma call's nested include for `lineItems` folds `product` in
    // alongside the caller's own `tag` selection.
    expect(mockPrisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          lineItems: { include: { tag: true, product: true } },
        }),
      }),
    )

    // The hook saw the declared relation and computed from it...
    expect(result?.lineItems?.[0].summary).toBe('Widget x1')
    // ...`tag` (caller-named) survives unchanged...
    expect(result?.lineItems?.[0].tag).toEqual({ id: 't1', name: 'Sale' })
    // ...but `product` (declaration-only at this level) is stripped.
    expect(result?.lineItems?.[0]).not.toHaveProperty('product')
  })

  it('scopes a declared dependency through the Access Filter: a filtered relation yields a session-relative value', async () => {
    // Only line items priced >= 10 are visible to this session.
    const testConfig = await buildTestConfig({ lineItemQuery: () => ({ price: { gte: 10 } }) })
    const mockPrisma = createMockPrisma()
    mockPrisma.order.findMany.mockResolvedValue([
      {
        id: 'o1',
        title: 'Order 1',
        // Simulates the DB honouring the access `where` folded into the
        // declared relation — only the visible row comes back.
        lineItems: [{ id: 'li1', price: 10, orderId: 'o1' }],
      },
    ])

    const context = getContext(testConfig, mockPrisma, null)
    const result = await context.db.order.findMany({})

    // The access filter's `where` rode along on the declaration-added relation.
    expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          lineItems: expect.objectContaining({ where: { price: { gte: 10 } } }),
        }),
      }),
    )
    // total reflects only the visible row (5 would be the "true" total if the
    // denied row leaked in) — a projection of what the session can see.
    expect(result[0].total).toBe(10)
  })

  it('a field whose declared dependency is entirely denied still computes, and is not withheld', async () => {
    const testConfig = await buildTestConfig({ lineItemQuery: () => false })
    const mockPrisma = createMockPrisma()
    mockPrisma.order.findMany.mockResolvedValue([{ id: 'o1', title: 'Order 1' }])

    const context = getContext(testConfig, mockPrisma, null)
    const result = await context.db.order.findMany({})

    // The field is present with a value computed over nothing, not withheld.
    expect(result[0]).toHaveProperty('total')
    expect(result[0].total).toBe(0)
    expect(result[0]).not.toHaveProperty('lineItems')
  })

  it('a field-level read denial on the declared relation also still lets the field compute', async () => {
    const testConfig = await buildTestConfig({ lineItemsFieldAccess: () => false })
    const mockPrisma = createMockPrisma()
    mockPrisma.order.findMany.mockResolvedValue([
      { id: 'o1', title: 'Order 1', lineItems: [{ id: 'li1', price: 10, orderId: 'o1' }] },
    ])

    const context = getContext(testConfig, mockPrisma, null)
    const result = await context.db.order.findMany({})

    expect(result[0].total).toBe(0)
    expect(result[0]).not.toHaveProperty('lineItems')
  })

  it('holds for fragment (query) reads too: the fold feeds the hook, the fragment projection still governs what returns', async () => {
    const testConfig = await buildTestConfig()
    const mockPrisma = createMockPrisma()
    mockPrisma.order.findFirst.mockResolvedValue({
      id: 'o1',
      title: 'Order 1',
      lineItems: [{ id: 'li1', price: 10, orderId: 'o1' }],
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orderFragment = defineFragment<any>()({ title: true, total: true } as const)

    const context = getContext(testConfig, mockPrisma, null)
    const result = await context.db.order.findUnique({
      where: { id: 'o1' },
      query: orderFragment,
    })

    expect(result?.total).toBe(10)
    expect(result).not.toHaveProperty('lineItems')
    expect(result).toHaveProperty('title')
  })

  it('a declaration cycle across two lists terminates via the existing relationship-graph cycle guard (ADR-0026 note)', async () => {
    // Order.total needs lineItems; LineItem.orderTitle needs order — a
    // two-list declaration cycle. This must not hang or crash: it rides the
    // SAME `visitedLists` cycle guard `buildIncludeWithAccessControl` already
    // uses for the relationship graph, not a separate mechanism.
    const testConfig = await buildTestConfig({ withDeclarationCycle: true })
    const mockPrisma = createMockPrisma()
    mockPrisma.order.findMany.mockResolvedValue([
      {
        id: 'o1',
        title: 'Order 1',
        lineItems: [
          {
            id: 'li1',
            price: 10,
            orderId: 'o1',
            // The cycle-pruned back-edge: LineItem's own `order` is a flat
            // fetch (no further nested `lineItems` beneath IT).
            order: { id: 'o1', title: 'Order 1' },
          },
        ],
      },
    ])

    const context = getContext(testConfig, mockPrisma, null)
    const result = await context.db.order.findMany({})

    expect(result[0].total).toBe(10)
  })
})

describe('needs — generate-time validation (ADR-0025)', () => {
  it('rejects a `needs` entry that does not name a relationship field on the same list', async () => {
    const { validateNeedsDeclarations } = await import('../src/validation/needs-closure.js')
    const testConfig = await buildTestConfig()
    // Reach in and corrupt a `needs` array the way an un-typed (plain JS)
    // config author might — the type constraint only helps when the list is
    // annotated with its generated `Lists.X.TypeInfo`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(testConfig.lists.LineItem.fields.summary as any).needs = ['price']

    const errors = validateNeedsDeclarations(testConfig)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      listKey: 'LineItem',
      fieldKey: 'summary',
      reason: 'invalid-relation',
    })
  })

  it('rejects a needs closure that cannot fit within the read-include depth cap from any starting point', async () => {
    const { validateNeedsClosureDepth } = await import('../src/validation/needs-closure.js')

    // A straight-line chain of 6 lists, each needing the next — deeper than
    // READ_INCLUDE_MAX_DEPTH (5) even starting at List0 itself.
    const listNames = ['List0', 'List1', 'List2', 'List3', 'List4', 'List5', 'List6']
    const lists: Record<string, ReturnType<typeof list>> = {}
    for (let i = 0; i < listNames.length; i++) {
      const name = listNames[i]
      const nextName = listNames[i + 1]
      lists[name] = list({
        fields: {
          ...(nextName
            ? {
                next: relationship({ ref: `${nextName}.prev`, many: false }),
                computed: virtual({
                  type: 'string',
                  needs: ['next'],
                  hooks: { resolveOutput: () => 'x' },
                }),
              }
            : {}),
          ...(i > 0 ? { prev: relationship({ ref: `${listNames[i - 1]}.next`, many: true }) } : {}),
        },
      })
    }

    const deepConfig = await config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists,
    })

    const errors = validateNeedsClosureDepth(deepConfig)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0].reason).toBe('depth')
  })

  it('rejects a cyclic needs declaration closure', async () => {
    const { validateNeedsClosureDepth } = await import('../src/validation/needs-closure.js')

    const cyclicConfig = await config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        A: list({
          fields: {
            b: relationship({ ref: 'B.a', many: false }),
            computed: virtual({
              type: 'string',
              needs: ['b'],
              hooks: { resolveOutput: () => 'x' },
            }),
          },
        }),
        B: list({
          fields: {
            a: relationship({ ref: 'A.b', many: false }),
            computed: virtual({
              type: 'string',
              needs: ['a'],
              hooks: { resolveOutput: () => 'x' },
            }),
          },
        }),
      },
    })

    const errors = validateNeedsClosureDepth(cyclicConfig)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.reason === 'cycle')).toBe(true)
  })

  it('accepts a shallow, acyclic needs closure', async () => {
    const { validateNeedsDeclarations, validateNeedsClosureDepth } =
      await import('../src/validation/needs-closure.js')
    const testConfig = await buildTestConfig()

    expect(validateNeedsDeclarations(testConfig)).toEqual([])
    expect(validateNeedsClosureDepth(testConfig)).toEqual([])
  })

  it('handles the edges of closure resolution without crashing: a fieldless list, an unresolvable ref, a needs entry naming a non-relationship field, one naming a field that does not exist at all, and two needs entries with different depths', async () => {
    const { validateNeedsDeclarations, validateNeedsClosureDepth } =
      await import('../src/validation/needs-closure.js')

    // Raw config objects (not the `list()` builder) so a list can legitimately
    // have no `fields` key at all — both validators must skip it rather than
    // crash on `listConfig.fields`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const edgeConfig: any = {
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        // No `fields` at all.
        Empty: {},
        Tag: { fields: { name: { type: 'text' } } },
        LineItem: {
          fields: {
            order: { type: 'relationship', ref: 'Order.lineItems' },
            price: { type: 'text' },
          },
        },
        Dangling: {
          fields: {
            // Resolves to a real list that has no fields (closure bottoms out at 0).
            target: { type: 'relationship', ref: 'Empty.field' },
            // Does not resolve to any list at all.
            dangling: { type: 'relationship', ref: 'DoesNotExist.field' },
            computed: {
              type: 'virtual',
              needs: ['target', 'dangling'],
              hooks: { resolveOutput: () => 'x' },
            },
          },
        },
        Order: {
          fields: {
            lineItems: { type: 'relationship', ref: 'LineItem.order' },
            tag: { type: 'relationship', ref: 'Tag' },
            price: { type: 'text' },
            // Both dependencies resolve to a 0-deep closure — the second
            // does not exceed the first's recorded depth.
            multi: {
              type: 'virtual',
              needs: ['tag', 'lineItems'],
              hooks: { resolveOutput: () => 'x' },
            },
            // Names a real, non-relationship field.
            usesNonRelation: {
              type: 'virtual',
              needs: ['price'],
              hooks: { resolveOutput: () => 'x' },
            },
            // Names a field that does not exist on this list at all.
            typo: {
              type: 'virtual',
              needs: ['nonexistentField'],
              hooks: { resolveOutput: () => 'x' },
            },
          },
        },
      },
    }

    expect(() => validateNeedsDeclarations(edgeConfig)).not.toThrow()
    expect(() => validateNeedsClosureDepth(edgeConfig)).not.toThrow()

    const declErrors = validateNeedsDeclarations(edgeConfig)
    expect(declErrors.some((e) => e.fieldKey === 'usesNonRelation')).toBe(true)
    const typoError = declErrors.find((e) => e.fieldKey === 'typo')
    expect(typoError?.message).toContain('has no field named')

    // None of this forms a cycle or an over-deep closure.
    expect(validateNeedsClosureDepth(edgeConfig)).toEqual([])
  })
})
