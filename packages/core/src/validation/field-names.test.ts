import { describe, expect, it } from 'vitest'
import type { BaseFieldConfig, OpenSaasConfig, TypeInfo } from '../config/types.js'
import { relationship, text, timestamp } from '../fields/index.js'
import { validateDatabaseConfig } from './database-config.js'
import { validateFieldNames } from './field-names.js'

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
