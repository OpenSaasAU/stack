import { describe, it, expect, vi } from 'vitest'
import { getContext } from '../src/context/index.js'
import { config, list } from '../src/config/index.js'
import { text, integer, relationship, virtual } from '../src/fields/index.js'
import { defineFragment } from '../src/query/index.js'
import { validateNeedsDeclarations } from '../src/validation/needs-closure.js'

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

  it('a declared stored column reaches the hook under a fragment that did not select it, and stays out of the result (ADR-0051)', async () => {
    const productConfig = await config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        Product: list({
          fields: {
            name: text(),
            price: integer(),
            doubled: virtual({
              type: 'number',
              needs: ['price'],
              hooks: {
                resolveOutput: ({ item }) => {
                  const typedItem = item as { price?: number }
                  return typedItem.price === undefined ? 'no price' : typedItem.price * 2
                },
              },
            }),
          },
          access: { operation: { query: () => true } },
        }),
      },
    })
    const mockPrisma = createMockPrisma()
    mockPrisma.product.findFirst.mockResolvedValue({ id: 'p1', name: 'Widget', price: 10 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const productFragment = defineFragment<any>()({ doubled: true } as const)

    const context = getContext(productConfig, mockPrisma, null)
    const result = await context.db.product.findUnique({
      where: { id: 'p1' },
      query: productFragment,
    })

    expect(result?.doubled).toBe(20)
    expect(result).not.toHaveProperty('price')
    expect(result).not.toHaveProperty('name')
    // A column is already on every row — nothing to include for it.
    const callArgs = mockPrisma.product.findFirst.mock.calls[0][0]
    expect(callArgs.include).toBeUndefined()
  })

  it('reads the sets from the table the generated bundle emitted, not from the config', async () => {
    // The same fragment read as above, but the config carries `_tables` the
    // way the generated context supplies it (ADR-0051). The emitted table is
    // authoritative: it declares nothing for `doubled`, so `price` is not
    // carried onto the hook's `item` even though the config's `needs` names
    // it — proof the engine is reading the emitted fact rather than walking
    // the config.
    const productConfig = await config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        Product: list({
          fields: {
            name: text(),
            price: integer(),
            doubled: virtual({
              type: 'number',
              needs: ['price'],
              hooks: {
                resolveOutput: ({ item }) => {
                  const typedItem = item as { price?: number }
                  return typedItem.price === undefined ? 'no price' : typedItem.price * 2
                },
              },
            }),
          },
          access: { operation: { query: () => true } },
        }),
      },
    })
    const mockPrisma = createMockPrisma()
    mockPrisma.product.findFirst.mockResolvedValue({ id: 'p1', name: 'Widget', price: 10 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const productFragment = defineFragment<any>()({ doubled: true } as const)

    const emptyTables = await getContext(
      {
        ...productConfig,
        _tables: {
          dependencies: {
            Product: { systemFields: ['id'], fields: { doubled: { columns: [], relations: [] } } },
          },
          constraints: {},
        },
      },
      mockPrisma,
      null,
    ).db.product.findUnique({ where: { id: 'p1' }, query: productFragment })

    expect(emptyTables?.doubled).toBe('no price')

    // With the emitted table naming the column, the hook sees it again.
    const withColumn = await getContext(
      {
        ...productConfig,
        _tables: {
          dependencies: {
            Product: {
              systemFields: ['id'],
              fields: { doubled: { columns: ['price'], relations: [] } },
            },
          },
          constraints: {},
        },
      },
      mockPrisma,
      null,
    ).db.product.findUnique({ where: { id: 'p1' }, query: productFragment })

    expect(withColumn?.doubled).toBe(20)
    expect(withColumn).not.toHaveProperty('price')
  })

  it('falls back to the config for a list a stale emitted table does not describe', async () => {
    // The bundle predates the list — regenerated for someone else's change, or
    // not regenerated at all. An empty row would silently stop `price`
    // reaching the hook; deriving that one list's row keeps the pre-emission
    // answer instead.
    const productConfig = await config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        Product: list({
          fields: {
            price: integer(),
            doubled: virtual({
              type: 'number',
              needs: ['price'],
              hooks: {
                resolveOutput: ({ item }) => {
                  const typedItem = item as { price?: number }
                  return typedItem.price === undefined ? 'no price' : typedItem.price * 2
                },
              },
            }),
          },
          access: { operation: { query: () => true } },
        }),
      },
    })

    const mockPrisma = createMockPrisma()
    mockPrisma.product.findFirst.mockResolvedValue({ id: 'p1', price: 10 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const productFragment = defineFragment<any>()({ doubled: true } as const)

    const result = await getContext(
      { ...productConfig, _tables: { dependencies: {}, constraints: {} } },
      mockPrisma,
      null,
    ).db.product.findUnique({ where: { id: 'p1' }, query: productFragment })

    expect(result?.doubled).toBe(20)
    expect(result).not.toHaveProperty('price')
  })

  it('widens the read for a relation the emitted table names, and strips it again', async () => {
    const orderConfig = await config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        Order: list({
          fields: {
            title: text(),
            lineItems: relationship({ ref: 'LineItem.order', many: true }),
            total: virtual({
              type: 'number',
              needs: ['lineItems'],
              hooks: {
                resolveOutput: ({ item }) => {
                  const items = (item.lineItems ?? []) as { price: number }[]
                  return items.reduce((sum, line) => sum + line.price, 0)
                },
              },
            }),
          },
          access: { operation: { query: () => true } },
        }),
        LineItem: list({
          fields: {
            price: integer(),
            order: relationship({ ref: 'Order.lineItems' }),
          },
          access: { operation: { query: () => true } },
        }),
      },
    })

    const mockPrisma = createMockPrisma()
    mockPrisma.order.findFirst.mockResolvedValue({
      id: 'o1',
      title: 'Order 1',
      lineItems: [{ id: 'li1', price: 7 }],
    })

    const context = getContext(
      {
        ...orderConfig,
        _tables: {
          dependencies: {
            Order: {
              systemFields: ['id'],
              fields: { total: { columns: [], relations: ['lineItems'] } },
            },
            LineItem: { systemFields: ['id'], fields: {} },
          },
          constraints: {},
        },
      },
      mockPrisma,
      null,
    )
    const result = await context.db.order.findUnique({ where: { id: 'o1' } })

    expect(mockPrisma.order.findFirst.mock.calls[0][0].include).toEqual({ lineItems: true })
    expect(result?.total).toBe(7)
    expect(result).not.toHaveProperty('lineItems')
  })

  it('runs no computed field on a branch the widening added, even one whose hook would throw (ADR-0051)', async () => {
    const testConfig = await buildTestConfig()
    const mockPrisma = createMockPrisma()

    // LineItem.summary's own declaration (`product`) is NOT paid for: the
    // one-hop set stops at `lineItems`, so the include carries no `product`
    // and a hook reading `item.product.name` would throw.
    const ranOnAddedBranch: string[] = []
    const lineItem = testConfig.lists.LineItem.fields
    lineItem.summary.hooks = {
      resolveOutput: ({ item }) => {
        ranOnAddedBranch.push('LineItem.summary')
        return `${(item as { product: { name: string } }).product.name} x1`
      },
    }

    mockPrisma.order.findMany.mockImplementation((args: { include?: Record<string, unknown> }) => {
      const included = args.include ?? {}
      return Promise.resolve([
        {
          id: 'o1',
          title: 'O',
          ...('lineItems' in included
            ? { lineItems: [{ id: 'li1', price: 10, orderId: 'o1' }] }
            : {}),
        },
      ])
    })

    const context = getContext(testConfig, mockPrisma, null)
    const result = await context.db.order.findMany({})

    expect(mockPrisma.order.findMany.mock.calls[0][0].include).toEqual({ lineItems: true })
    expect(ranOnAddedBranch).toEqual([])
    expect(result).toEqual([{ id: 'o1', title: 'O', total: 10 }])
  })

  it('a declaration cycle across two lists terminates by construction, with no cycle guard (ADR-0051)', async () => {
    // Order.total needs lineItems; LineItem.orderTitle needs order — a
    // two-list declaration cycle. It cannot recurse: the widening never
    // descends into a branch it added. That is why the runtime `visitedLists`
    // guard and `validateNeedsClosureDepth` are both deleted.
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

    expect(mockPrisma.order.findMany.mock.calls[0][0].include).toEqual({ lineItems: true })
    expect(result).toEqual([{ id: 'o1', title: 'Order 1', total: 10 }])
  })
})

describe('needs — generate-time validation (ADR-0025)', () => {
  it('accepts a `needs` entry naming a stored column on the same list (ADR-0051)', async () => {
    const testConfig = await buildTestConfig()
    // Reach in the way an un-typed (plain JS) config author might — the type
    // constraint only helps when the list is annotated with its generated
    // `Lists.X.TypeInfo`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(testConfig.lists.LineItem.fields.summary as any).needs = ['price']

    expect(validateNeedsDeclarations(testConfig)).toEqual([])
  })

  it('rejects a `needs` entry naming a computed sibling, naming the list and field', async () => {
    const computedConfig = await config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        Person: list({
          fields: {
            firstName: text(),
            fullName: virtual({
              type: 'string',
              needs: ['firstName'],
              hooks: { resolveOutput: ({ item }) => String(item.firstName) },
            }),
            greeting: virtual({
              type: 'string',
              needs: ['fullName'],
              hooks: { resolveOutput: () => 'hi' },
            }),
          },
        }),
      },
    })

    const errors = validateNeedsDeclarations(computedConfig)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      listKey: 'Person',
      fieldKey: 'greeting',
      reason: 'invalid-dependency',
    })
    expect(errors[0].message).toContain('"Person.greeting"')
    expect(errors[0].message).toContain('computed field')
  })

  it('rejects a `needs` declaration on a field with no resolveOutput hook, naming the list and field', async () => {
    const hooklessConfig = await config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        Order: list({
          fields: {
            price: integer(),
            label: text({ needs: ['price'] }),
          },
        }),
      },
    })

    const errors = validateNeedsDeclarations(hooklessConfig)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      listKey: 'Order',
      fieldKey: 'label',
      reason: 'no-resolve-output',
    })
    expect(errors[0].message).toContain('"Order.label"')
    expect(errors[0].message).toContain('no resolveOutput hook')
  })

  it('resolves a long needs chain into one-hop sets rather than a closure', async () => {
    const { deriveDependencyTable } = await import('../src/contract/dependencies.js')

    // A straight-line chain of 6 lists, each needing the next. Under a
    // transitive closure this was deeper than READ_INCLUDE_MAX_DEPTH and
    // refused; the set is one hop, so each list simply names its own
    // neighbour and generation has nothing to refuse (ADR-0051).
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

    expect(validateNeedsDeclarations(deepConfig)).toEqual([])
    const table = deriveDependencyTable(deepConfig)
    expect(table.List0.fields.computed).toEqual({ columns: ['nextId'], relations: ['next'] })
    expect(table.List5.fields.computed).toEqual({ columns: ['nextId'], relations: ['next'] })
  })

  it('emits a table for a mutually recursive needs declaration instead of refusing it', async () => {
    const { deriveDependencyTable } = await import('../src/contract/dependencies.js')

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

    expect(validateNeedsDeclarations(cyclicConfig)).toEqual([])
    const table = deriveDependencyTable(cyclicConfig)
    expect(table.A.fields.computed.relations).toEqual(['b'])
    expect(table.B.fields.computed.relations).toEqual(['a'])
  })

  it('accepts a config whose declarations all name something on their own list', async () => {
    const testConfig = await buildTestConfig()
    expect(validateNeedsDeclarations(testConfig)).toEqual([])
  })

  it('handles the edges of declaration resolution without crashing: a fieldless list, an unresolvable ref, a needs entry naming a non-relationship field, one naming a field that does not exist at all, and two needs entries', async () => {
    const { deriveDependencyTable } = await import('../src/contract/dependencies.js')

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
    expect(() => deriveDependencyTable(edgeConfig)).not.toThrow()

    const declErrors = validateNeedsDeclarations(edgeConfig)
    // A stored column is a legitimate dependency (ADR-0051).
    expect(declErrors.some((e) => e.fieldKey === 'usesNonRelation')).toBe(false)
    const typoError = declErrors.find((e) => e.fieldKey === 'typo')
    expect(typoError?.message).toContain('has no field named')

    // An entry naming a field the list does not have contributes nothing to
    // the set rather than putting a phantom key in it.
    const table = deriveDependencyTable(edgeConfig)
    expect(table.Order.fields.typo).toEqual({ columns: [], relations: [] })
    expect(table.Order.fields.usesNonRelation).toEqual({ columns: ['price'], relations: [] })
    expect(table.Empty.systemFields).toEqual(['id'])
  })
})
