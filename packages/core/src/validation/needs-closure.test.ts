import { describe, it, expect } from 'vitest'
import { config, list } from '../config/index.js'
import { text, integer, relationship, virtual } from '../fields/index.js'
import { deriveDependencyTable, nestedSetOf } from '../contract/dependencies.js'
import { findChainedNeeds, validateNeedsDeclarations } from './needs-closure.js'

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

describe('needs — the object form (ADR-0085)', () => {
  const hooks = { resolveOutput: () => 'x' }

  function schoolConfig(label: ReturnType<typeof virtual>) {
    return config({
      db: { provider: 'postgresql' },
      lists: {
        Attendance: list({
          fields: { note: text(), enrolment: relationship({ ref: 'Enrolment' }), label },
        }),
        Enrolment: list({
          fields: {
            ref: text(),
            student: relationship({ ref: 'Student' }),
            display: virtual({ type: 'string', needs: ['student'], hooks }),
          },
        }),
        Student: list({
          fields: {
            name: text(),
            shout: virtual({ type: 'string', needs: ['name'], hooks }),
          },
        }),
      },
    })
  }

  async function messages(needs: unknown): Promise<string[]> {
    const label = virtual({ type: 'string', hooks })
    Object.assign(label, { needs })
    return validateNeedsDeclarations(await schoolConfig(label)).map((error) => error.message)
  }

  it('accepts columns, relations and synthetic back-relations at any depth', async () => {
    expect(
      await messages({
        note: true,
        enrolment: {
          ref: true,
          student: ['name', 'from_Enrolment_student'],
          from_Attendance_enrolment: { enrolment: { student: true } },
        },
      }),
    ).toEqual([])
    expect(await messages(['note', 'enrolment'])).toEqual([])
    expect(await messages({})).toEqual([])
  })

  it('emits it as nested sets, with the foreign key of each owned relation', async () => {
    const label = virtual({
      type: 'string',
      needs: { enrolment: { student: ['name'], from_Attendance_enrolment: true } },
      hooks,
    })
    expect(deriveDependencyTable(await schoolConfig(label)).Attendance.fields.label).toEqual({
      columns: ['enrolmentId'],
      relations: ['enrolment'],
      nested: {
        enrolment: {
          columns: ['studentId'],
          relations: ['from_Attendance_enrolment', 'student'],
          nested: { student: { columns: ['name'], relations: [] } },
        },
      },
    })
  })

  it.each([
    [{ gone: true }, 'has no field named "gone"', '{ gone: … }'],
    [{ enrolment: ['gone'] }, '"Enrolment" has no field named "gone"', "{ enrolment: ['gone'] }"],
    [
      { enrolment: { student: ['shout'] } },
      '"shout" is a computed field on "Student"',
      "{ enrolment: { student: ['shout'] } }",
    ],
    [{ enrolment: { display: true } }, 'computed field on "Enrolment"', '{ display: … }'],
    [{ note: ['x'] }, 'takes only `true`', '{ note: … }'],
    [{ enrolment: { ref: {} } }, 'takes only `true`', '{ ref: … }'],
    [{ enrolment: false }, 'must be true, an array', '{ enrolment: … }'],
    [{ enrolment: null }, 'must be true, an array', '{ enrolment: … }'],
    [{ enrolment: { constructor: true } }, 'no field named "constructor"', '{ constructor: … }'],
    ['enrolment', 'neither an array', ''],
    [[1], 'neither an array', ''],
    [null, 'neither an array', ''],
    [new Set(['note']), 'neither an array', ''],
    [{ enrolment: new Map() }, 'must be true, an array', '{ enrolment: … }'],
  ])('refuses %j by list, field and path', async (needs, why, path) => {
    const found = await messages(needs)
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('"Attendance.label"')
    expect(found[0]).toContain(why)
    expect(found[0]).toContain(path)
  })

  it('resolves prototype-named relations from the declaration alone', async () => {
    const named = await config({
      db: { provider: 'postgresql' },
      lists: {
        Post: list({
          fields: {
            constructor: relationship({ ref: 'User' }),
            label: virtual({ type: 'string', needs: { constructor: true as const }, hooks }),
            deep: virtual({ type: 'string', needs: { constructor: ['toString'] }, hooks }),
          },
        }),
        User: list({ fields: { toString: text() } }),
      },
    })
    expect(validateNeedsDeclarations(named)).toEqual([])
    const { label, deep } = deriveDependencyTable(named).Post.fields
    expect(nestedSetOf(label, 'constructor')).toBeUndefined()
    expect(nestedSetOf({ ...label, nested: {} }, 'constructor')).toBeUndefined()
    expect(nestedSetOf(deep, 'constructor')).toEqual({ columns: ['toString'], relations: [] })
  })

  it('refuses an object that contains itself', async () => {
    const loop: Record<string, unknown> = {}
    loop.from_Attendance_enrolment = { enrolment: loop }
    expect((await messages({ enrolment: loop }))[0]).toContain('refers back')
  })

  it('warns once per field, with a bounded message, on a dense schema', async () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F']
    const lists = Object.fromEntries(
      names.map((name) => [
        name,
        list({
          fields: {
            ...Object.fromEntries(
              names.map((other) => [`to${other}`, relationship({ ref: other })]),
            ),
            one: virtual({ type: 'string', needs: names.map((other) => `to${other}`), hooks }),
            two: virtual({ type: 'string', needs: names.map((other) => `to${other}`), hooks }),
          },
        }),
      ]),
    )
    const warnings = findChainedNeeds(await config({ db: { provider: 'postgresql' }, lists }))
    expect(warnings).toHaveLength(names.length * 2)
    for (const { message } of warnings) expect(message.length).toBeLessThan(2500)
  })

  it('refuses a computed field named by its descriptor alone', async () => {
    const label = virtual({ type: 'string', needs: ['derived'], hooks })
    const base = await schoolConfig(label)
    Object.assign(base.lists.Attendance.fields, {
      derived: { type: 'derived', getContractField: () => ({ kind: 'computed' }) },
    })
    expect(validateNeedsDeclarations(base)[0].message).toContain('computed field on "Attendance"')
  })

  it('warns on an array form whose chain stops, naming both fields and an accepted remedy', async () => {
    const chained = await schoolConfig(virtual({ type: 'string', needs: ['enrolment'], hooks }))
    const warnings = findChainedNeeds(chained)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ targets: ['Enrolment.display'] })
    expect(warnings[0].message).toContain('"Attendance.label"')
    expect(warnings[0].message).toContain('"Enrolment.display"')
    expect(warnings[0].message).toContain('needs: { enrolment: { student: true } }')

    for (const needs of [warnings[0].replacement, { enrolment: true as const }]) {
      const fixed = await schoolConfig(virtual({ type: 'string', needs, hooks }))
      expect(validateNeedsDeclarations(fixed)).toEqual([])
      expect(findChainedNeeds(fixed)).toEqual([])
    }
  })

  it('warns on the issue repro, and bounds a mutual chain', async () => {
    const virtualNeeding = (needs: string[]) => virtual({ type: 'string', needs, hooks })
    const repro = await config({
      db: { provider: 'postgresql' },
      lists: {
        Author: list({ fields: { name: text() } }),
        Post: list({
          fields: {
            author: relationship({ ref: 'Author' }),
            comments: relationship({ ref: 'Comment.post', many: true }),
            label: virtualNeeding(['author']),
          },
        }),
        Comment: list({
          fields: {
            post: relationship({ ref: 'Post.comments' }),
            label: virtualNeeding(['post']),
          },
        }),
        A: list({
          fields: { b: relationship({ ref: 'B.a' }), label: virtualNeeding(['b']) },
        }),
        B: list({
          fields: {
            a: relationship({ ref: 'A.b', many: true }),
            label: virtualNeeding(['a']),
          },
        }),
      },
    })
    expect(
      findChainedNeeds(repro).map(({ listKey, replacement }) => [listKey, replacement]),
    ).toEqual([
      ['Comment', { post: { author: true } }],
      ['A', { b: { a: true } }],
      ['B', { a: { b: true } }],
    ])
  })
})
