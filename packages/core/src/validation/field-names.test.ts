import { describe, expect, it } from 'vitest'
import type { BaseFieldConfig, OpenSaasConfig, TypeInfo } from '../config/types.js'
import { relationship, text, timestamp, virtual } from '../fields/index.js'
import { validateDatabaseConfig } from './database-config.js'
import { validateFieldNames } from './field-names.js'

function partsField(
  ...names: Array<string | ((fieldKey: string) => string)>
): BaseFieldConfig<TypeInfo> {
  return {
    type: 'parts',
    getContractField: (fieldKey) => ({
      kind: 'columns',
      columns: names.map((name) => ({
        name: typeof name === 'function' ? name(fieldKey) : name,
        type: { pack: 'pg', type: 'text' },
        nullable: true,
      })),
    }),
  }
}

const computed = () => virtual({ type: 'string', hooks: { resolveOutput: () => '' } })

function configWith(
  lists: OpenSaasConfig['lists'],
  db: Partial<OpenSaasConfig['db']> = {},
): OpenSaasConfig {
  return { db: { provider: 'postgresql', ...db }, lists }
}

describe('validateFieldNames', () => {
  it('accepts fields that stay clear of the derived members, including a declared createdAt', () => {
    const config = configWith(
      {
        User: {
          fields: {
            createdAt: timestamp(),
            posts: relationship({ ref: 'Post.author', many: true }),
            postsId: text(),
          },
        },
        Post: {
          fields: {
            author: relationship({ ref: 'User.posts' }),
            authorName: text(),
            category: relationship({ ref: 'Category' }),
          },
        },
        Category: { fields: { from_Post_tags: text() } },
      },
      { timestamps: true },
    )
    expect(validateFieldNames(config)).toEqual([])
  })

  it.each(['AND', 'OR', 'NOT'])('refuses a field named %s, naming the field', (name) => {
    const refusals = validateFieldNames(configWith({ Post: { fields: { [name]: text() } } }))
    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatchObject({
      listKey: 'Post',
      entry: `fields.${name}`,
      reason: 'reserved-field-name',
    })
  })

  it('refuses a field named __proto__, naming the field', () => {
    const refusals = validateFieldNames(
      configWith({
        Post: {
          fields: Object.defineProperty({}, '__proto__', { value: text(), enumerable: true }),
        },
      }),
    )
    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatchObject({ entry: 'fields.__proto__', reason: 'reserved-field-name' })
  })

  it.each(['some', 'every', 'none'])(
    'refuses a relationship named %s but not a text field',
    (name) => {
      const lists = (field: BaseFieldConfig<TypeInfo>) => ({
        Post: { fields: { [name]: field } },
        Tag: { fields: { label: text() } },
      })
      expect(
        validateFieldNames(configWith(lists(relationship({ ref: 'Tag', many: true })))),
      ).toHaveLength(1)
      expect(validateFieldNames(configWith(lists(text())))).toEqual([])
    },
  )

  it('refuses a multi-column field that emits a part column named AND', () => {
    const location: BaseFieldConfig<TypeInfo> = {
      type: 'location',
      getContractField: () => ({
        kind: 'columns',
        columns: [{ name: 'AND', type: { pack: 'pg', type: 'text' }, nullable: true }],
      }),
    }
    const refusals = validateFieldNames(configWith({ Post: { fields: { location } } }))
    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatchObject({ entry: 'fields.location', reason: 'reserved-field-name' })
    expect(refusals[0].message).toContain('"AND"')
  })

  it('refuses a field named id, naming the list and the fix', () => {
    const refusals = validateFieldNames(configWith({ Post: { fields: { id: text() } } }))
    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatchObject({
      listKey: 'Post',
      entry: 'fields.id',
      reason: 'reserved-field-name',
    })
    expect(refusals[0].message).toContain('List "Post": fields.id is reserved')
    expect(refusals[0].message).toContain('db.idField')
  })

  it('refuses a field whose column is the foreign-key column another relationship owns', () => {
    const refusals = validateFieldNames(
      configWith({
        Post: { fields: { author: relationship({ ref: 'User' }), authorId: text() } },
        User: { fields: { name: text() } },
      }),
    )
    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatchObject({
      listKey: 'Post',
      entry: 'fields.authorId',
      reason: 'foreign-key-column-collision',
    })
    expect(refusals[0].message).toContain(
      'List "Post": fields.authorId collides with the foreign-key column "authorId" that fields.author derives',
    )
    expect(refusals[0].message).toContain('Rename fields.authorId')
  })

  it('refuses a relationship or multi-column field that claims an owned foreign-key column too', () => {
    const tiles: BaseFieldConfig<TypeInfo> = {
      type: 'tiles',
      getContractField: () => ({
        kind: 'columns',
        columns: [{ name: 'ownerId', type: { pack: 'pg', type: 'text' }, nullable: true }],
      }),
    }
    const refusals = validateFieldNames(
      configWith({
        Post: {
          fields: {
            author: relationship({ ref: 'User' }),
            authorId: relationship({ ref: 'User' }),
            owner: relationship({ ref: 'User' }),
            map: tiles,
          },
        },
        User: { fields: { name: text() } },
      }),
    )
    expect(refusals.map((refusal) => [refusal.entry, refusal.reason])).toEqual([
      ['fields.authorId', 'foreign-key-column-collision'],
      ['fields.map', 'foreign-key-column-collision'],
    ])
  })

  it.each([
    ['a virtual field', computed],
    ['a multi-column field', () => partsField('authorId_line', 'authorId_city')],
  ])('refuses %s keyed like an owned foreign-key column (#2445)', (_kind, field) => {
    const refusals = validateFieldNames(
      configWith({
        Post: { fields: { author: relationship({ ref: 'Author' }), authorId: field() } },
        Author: { fields: { name: text() } },
      }),
    )
    expect(refusals).toEqual([
      {
        listKey: 'Post',
        entry: 'fields.authorId',
        reason: 'foreign-key-column-collision',
        message:
          'List "Post": fields.authorId collides with the foreign-key column "authorId" that ' +
          'fields.author derives for its relationship. Rename fields.authorId, or remove it and ' +
          'read the key through fields.author.',
      },
    ])
  })

  it.each([
    ['a virtual field', computed],
    ['a multi-column field', () => partsField('address_city_a', 'address_city_b')],
    ['a text field', () => text()],
  ])("refuses %s keyed like another field's part column (#2445)", (_kind, field) => {
    const refusals = validateFieldNames(
      configWith({
        Post: {
          fields: { address: partsField('address_line', 'address_city'), address_city: field() },
        },
      }),
    )
    expect(refusals).toEqual([
      {
        listKey: 'Post',
        entry: 'fields.address_city',
        reason: 'part-column-collision',
        message:
          'List "Post": fields.address_city collides with the part column "address_city" that ' +
          'fields.address derives for its multi-column field. Rename fields.address_city.',
      },
    ])
  })

  it('names a remedy that works when a part column collides with a foreign key (#2505)', () => {
    const lists = (partName: string, authorKey: string) => ({
      A: { fields: { [authorKey]: relationship({ ref: 'B' }), geo: partsField(partName) } },
      B: { fields: { name: text() } },
    })
    const [refusal] = validateFieldNames(configWith(lists('authorId', 'author')))
    expect(refusal?.message).toBe(
      'List "A": the part column "authorId" of fields.geo collides with the foreign-key column ' +
        '"authorId" that fields.author derives for its relationship. Rename that part column, or rename fields.author.',
    )
    expect(validateFieldNames(configWith(lists('geoId', 'author')))).toEqual([])
    expect(validateFieldNames(configWith(lists('authorId', 'writer')))).toEqual([])
  })

  it('refuses a field keyed like a part column declared after it, naming the declared field', () => {
    const refusals = validateFieldNames(
      configWith({
        Post: {
          fields: { address_city: text(), address: partsField('address_line', 'address_city') },
        },
      }),
    )
    expect(refusals.map((refusal) => [refusal.entry, refusal.reason])).toEqual([
      ['fields.address_city', 'part-column-collision'],
    ])
  })

  it('accepts a multi-column field whose own part shares its key', () => {
    const refusals = validateFieldNames(
      configWith({
        Post: {
          fields: {
            price: partsField(
              (key) => key,
              (key) => `${key}_currency`,
            ),
            summary: computed(),
          },
        },
      }),
    )
    expect(refusals).toEqual([])
  })

  it('does not refuse a name that only matches a foreign key the other side owns', () => {
    const refusals = validateFieldNames(
      configWith({
        User: {
          fields: { profile: relationship({ ref: 'Profile.user' }), profileId: text() },
        },
        Profile: {
          fields: { user: relationship({ ref: 'User.profile', db: { foreignKey: true } }) },
        },
      }),
    )
    expect(refusals).toEqual([])
  })

  it('refuses a field named after the back-relation a list-only ref synthesises on its target', () => {
    const refusals = validateFieldNames(
      configWith({
        Post: { fields: { category: relationship({ ref: 'Category' }) } },
        Category: { fields: { from_Post_category: text() } },
      }),
    )
    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatchObject({
      listKey: 'Category',
      entry: 'fields.from_Post_category',
      reason: 'synthetic-relation-collision',
    })
    expect(refusals[0].message).toContain(
      'List "Category": fields.from_Post_category collides with the back-relation the list-only ref on "Post.category" synthesises',
    )
    expect(refusals[0].message).toContain("ref: 'Category.<field>'")
  })

  it('is part of validateDatabaseConfig', () => {
    const config = configWith({
      Post: { fields: { id: text(), author: relationship({ ref: 'User' }), authorId: text() } },
      User: { fields: { name: text() } },
    })
    expect(validateDatabaseConfig(config).map((refusal) => refusal.reason)).toEqual([
      'reserved-field-name',
      'foreign-key-column-collision',
    ])
  })
})
