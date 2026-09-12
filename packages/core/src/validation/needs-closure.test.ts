import { describe, it, expect } from 'vitest'
import { config, list } from '../config/index.js'
import { text, integer, relationship, virtual } from '../fields/index.js'
import { deriveDependencyTable } from '../contract/dependencies.js'
import { validateNeedsDeclarations } from './needs-closure.js'

/**
 * `needs` as the generator sees it (ADR-0025, ADR-0051): what a declaration
 * may name, what it may not, and what the emitted one-hop table holds for the
 * shapes a closure used to refuse.
 */

function buildTestConfig() {
  return config({
    db: { provider: 'postgresql' },
    lists: {
      Tag: list({ fields: { name: text() } }),
      Product: list({ fields: { name: text() } }),
      LineItem: list({
        fields: {
          price: integer(),
          order: relationship({ ref: 'Order.lineItems' }),
          product: relationship({ ref: 'Product' }),
          tag: relationship({ ref: 'Tag' }),
          summary: virtual({
            type: 'string',
            needs: ['product'],
            hooks: { resolveOutput: () => 'x' },
          }),
        },
      }),
      Order: list({
        fields: {
          title: text(),
          lineItems: relationship({ ref: 'LineItem.order', many: true }),
          total: virtual({
            type: 'number',
            needs: ['lineItems'],
            hooks: { resolveOutput: () => 0 },
          }),
        },
      }),
    },
  })
}

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
      db: { provider: 'postgresql' },
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
      db: { provider: 'postgresql' },
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
      db: { provider: 'postgresql' },
      lists,
    })

    expect(validateNeedsDeclarations(deepConfig)).toEqual([])
    const table = deriveDependencyTable(deepConfig)
    expect(table.List0.fields.computed).toEqual({ columns: ['nextId'], relations: ['next'] })
    expect(table.List5.fields.computed).toEqual({ columns: ['nextId'], relations: ['next'] })
  })

  it('emits a table for a mutually recursive needs declaration instead of refusing it', async () => {
    const cyclicConfig = await config({
      db: { provider: 'postgresql' },
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
    // Raw config objects (not the `list()` builder) so a list can legitimately
    // have no `fields` key at all — both validators must skip it rather than
    // crash on `listConfig.fields`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const edgeConfig: any = {
      db: { provider: 'postgresql' },
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
