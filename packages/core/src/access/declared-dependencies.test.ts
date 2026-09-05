import { describe, it, expect } from 'vitest'
import {
  getDependencyTable,
  noDependencyAdditions,
  resolveDeclaredDependencies,
  widenIncludeForDependencies,
} from './declared-dependencies.js'
import type { OpenSaasConfig, FieldConfig } from '../config/types.js'

/**
 * Unit coverage for the read-time widening (ADR-0051): the sets come from the
 * emitted dependency table, the widening is one hop, and a branch it adds is
 * never descended into — which is what removes the recursion the deleted
 * `visitedLists` guard existed to bound.
 *
 * End-to-end coverage of the widening feeding an actual read (mocked Prisma,
 * real `resolveOutput` hooks) lives in `tests/needs-declared-dependencies.test.ts`;
 * these tests exercise the function directly so a regression here fails fast
 * with a small, precise reproduction.
 */

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

describe('widenIncludeForDependencies', () => {
  it('returns the exact same reference when there is nothing to widen', () => {
    const fields: Record<string, FieldConfig> = { name: { type: 'text' } as FieldConfig }
    const config = {
      db: { provider: 'postgresql' },
      lists: { List: { fields } },
    } as unknown as OpenSaasConfig

    const result = widenIncludeForDependencies(undefined, fields, config, 'List')
    expect(result.include).toBeUndefined()
    expect(result.additions).toEqual(noDependencyAdditions())
  })

  it('adds a declared relation bare and does not descend into it', () => {
    // `lineItems` is fetched for `Order.total` and returned to nobody, so no
    // computed field runs on it and `LineItem.summary`'s own `product` is not
    // fetched (ADR-0051: a declared branch stops computing).
    const result = widenIncludeForDependencies(
      undefined,
      orderConfig.lists.Order.fields,
      orderConfig,
      'Order',
    )

    expect(result.include).toEqual({ lineItems: true })
    expect(result.additions.keys.has('lineItems')).toBe(true)
    expect(result.additions.nested.lineItems).toBeUndefined()
  })

  it('descends into a caller-named bare relation and tracks the addition one level down', () => {
    // The caller asked for `lineItems`, so its rows ARE returned and
    // `LineItem.summary` computes on them — which means `product` is fetched
    // there, and stripped from each returned line item afterwards.
    const result = widenIncludeForDependencies(
      { lineItems: true },
      orderConfig.lists.Order.fields,
      orderConfig,
      'Order',
    )

    expect(result.include).toEqual({ lineItems: { include: { product: true } } })
    expect(result.additions.keys.has('lineItems')).toBe(false)
    expect(result.additions.nested.lineItems?.keys.has('product')).toBe(true)
  })

  it("descends into an explicit caller-nested include so the nested list's own needs are met", () => {
    const result = widenIncludeForDependencies(
      { lineItems: { include: { tag: true } } },
      orderConfig.lists.Order.fields,
      orderConfig,
      'Order',
    )

    expect(result.include).toEqual({ lineItems: { include: { tag: true, product: true } } })
    expect(result.additions.nested.lineItems?.keys.has('product')).toBe(true)
    expect(result.additions.nested.lineItems?.keys.has('tag')).toBe(false)
  })

  it('leaves a caller include alone when nothing in reach declares anything', () => {
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        Order: { fields: { customer: relField('Customer') } },
        Customer: { fields: { name: { type: 'text' } as FieldConfig } },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any

    const result = widenIncludeForDependencies(
      { customer: true },
      config.lists.Order.fields,
      config,
      'Order',
    )

    expect(result.include).toEqual({ customer: true })
    expect(result.additions).toEqual(noDependencyAdditions())
  })

  it("widens a revisited list's own needs beneath a relation the request named", () => {
    // Post → author → posts revisits Post. Nothing can loop — the include is a
    // finite literal the caller wrote out — so the widening keeps going and
    // satisfies Post.blurb's `needs` at THAT level too.
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        Post: {
          fields: {
            author: relField('User.posts'),
            comments: relField('Comment', true),
            tags: relField('Tag', true),
            blurb: virtualNeeds(['tags']),
          },
        },
        User: { fields: { posts: relField('Post.author', true) } },
        Comment: { fields: { body: { type: 'text' } as FieldConfig } },
        Tag: { fields: { label: { type: 'text' } as FieldConfig } },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any

    const result = widenIncludeForDependencies(
      { author: { include: { posts: { include: { comments: true } } } } },
      config.lists.Post.fields,
      config,
      'Post',
    )

    expect(result.include).toEqual({
      tags: true,
      author: { include: { posts: { include: { comments: true, tags: true } } } },
    })
    expect(result.additions.keys.has('tags')).toBe(true)
    expect(result.additions.nested.author?.nested.posts?.keys.has('tags')).toBe(true)
    expect(result.additions.nested.author?.nested.posts?.keys.has('comments')).toBe(false)
  })

  it('terminates on a two-list mutual `needs` cycle by construction, with no guard', () => {
    // Order.total needs lineItems; LineItem.orderRef needs order. The widening
    // never descends into a branch it added, so the cycle is unreachable —
    // this is why `validateNeedsClosureDepth` and the runtime `visitedLists`
    // guard are both deleted (ADR-0051).
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
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

    const result = widenIncludeForDependencies(
      undefined,
      config.lists.Order.fields,
      config,
      'Order',
    )

    expect(result.include).toEqual({ lineItems: true })
  })

  it('stays on the bare-read path when a list declares columns alone', () => {
    // A column is already on the row, so nothing is added to `include` and the
    // read keeps `include: undefined` (ADR-0024).
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        Product: {
          fields: {
            price: { type: 'integer' } as FieldConfig,
            doubled: virtualNeeds(['price']),
          },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
    } as any

    const result = widenIncludeForDependencies(
      undefined,
      config.lists.Product.fields,
      config,
      'Product',
    )

    expect(result.include).toBeUndefined()
    expect([...resolveDeclaredDependencies(config, 'Product').columns]).toEqual(['price'])
  })
})
