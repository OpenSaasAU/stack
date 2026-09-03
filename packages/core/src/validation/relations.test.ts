import { describe, it, expect } from 'vitest'
import { validateRelations } from './relations.js'
import { relationship, text } from '../fields/index.js'
import type { ListConfig, OpenSaasConfig, TypeInfo } from '../config/types.js'

function configWith(lists: OpenSaasConfig['lists']): OpenSaasConfig {
  return { db: { provider: 'postgresql' }, lists }
}

describe('validateRelations', () => {
  it('accepts one-to-many, list-only, and one-to-one relationships with typed referential actions', () => {
    const config = configWith({
      User: {
        fields: {
          name: text(),
          posts: relationship({ ref: 'Post.author', many: true }),
          profile: relationship({ ref: 'Profile.user' }),
        },
      },
      Post: {
        fields: {
          author: relationship({
            ref: 'User.posts',
            db: { onDelete: 'cascade', onUpdate: 'noAction' },
          }),
          category: relationship({ ref: 'Category', many: true }),
        },
      },
      Profile: {
        fields: {
          user: relationship({ ref: 'User.profile', db: { isNullable: false } }),
        },
      },
      Category: { fields: { name: text() } },
    })

    expect(validateRelations(config)).toEqual([])
  })

  describe('many: true on both sides', () => {
    it('is refused once, naming both lists, both fields and the junction fix', () => {
      const config = configWith({
        Lesson: { fields: { teachers: relationship({ ref: 'Teacher.lessons', many: true }) } },
        Teacher: { fields: { lessons: relationship({ ref: 'Lesson.teachers', many: true }) } },
      })

      const refusals = validateRelations(config)

      expect(refusals).toHaveLength(1)
      expect(refusals[0]).toMatchObject({
        listKey: 'Lesson',
        entry: 'fields.teachers',
        reason: 'many-to-many',
      })
      expect(refusals[0].message).toContain('List "Lesson": fields.teachers')
      expect(refusals[0].message).toContain('list "Teacher": fields.lessons')
      expect(refusals[0].message).toContain('junction')
    })

    it('is refused for a self-referential pair', () => {
      const config = configWith({
        Person: {
          fields: {
            friends: relationship({ ref: 'Person.friends', many: true }),
          },
        },
      })

      expect(validateRelations(config)).toMatchObject([
        { listKey: 'Person', entry: 'fields.friends', reason: 'many-to-many' },
      ])
    })
  })

  describe('one-to-one ownership (ADR-0064)', () => {
    it('refuses db.foreignKey: true on both sides once, naming both entries', () => {
      const config = configWith({
        User: {
          fields: { account: relationship({ ref: 'Account.user', db: { foreignKey: true } }) },
        },
        Account: {
          fields: { user: relationship({ ref: 'User.account', db: { foreignKey: true } }) },
        },
      })

      const refusals = validateRelations(config)

      expect(refusals).toHaveLength(1)
      expect(refusals[0]).toMatchObject({
        listKey: 'Account',
        entry: 'fields.user',
        reason: 'foreign-key-on-both-sides',
      })
      expect(refusals[0].message).toContain('List "Account": fields.user')
      expect(refusals[0].message).toContain('list "User": fields.account')
      expect(refusals[0].message).toContain('Remove db.foreignKey from one of them')
    })

    it('refuses db.isNullable: false on the non-owning side chosen by db.foreignKey', () => {
      const config = configWith({
        User: {
          fields: { account: relationship({ ref: 'Account.user', db: { isNullable: false } }) },
        },
        Account: {
          fields: { user: relationship({ ref: 'User.account', db: { foreignKey: true } }) },
        },
      })

      const refusals = validateRelations(config)

      expect(refusals).toHaveLength(1)
      expect(refusals[0]).toMatchObject({
        listKey: 'User',
        entry: 'fields.account',
        reason: 'non-owning-side-nullability',
      })
      expect(refusals[0].message).toContain('List "User": fields.account')
      expect(refusals[0].message).toContain('"Account.user"')
      expect(refusals[0].message).toContain('db.foreignKey: true')
    })

    it('refuses db.isNullable: false on the non-owning side chosen alphabetically', () => {
      const config = configWith({
        Profile: {
          fields: { user: relationship({ ref: 'User.profile', db: { isNullable: false } }) },
        },
        User: { fields: { profile: relationship({ ref: 'Profile.user' }) } },
      })

      expect(validateRelations(config)).toEqual([])

      const flipped = configWith({
        Profile: { fields: { user: relationship({ ref: 'User.profile' }) } },
        User: {
          fields: { profile: relationship({ ref: 'Profile.user', db: { isNullable: false } }) },
        },
      })

      expect(validateRelations(flipped)).toMatchObject([
        { listKey: 'User', entry: 'fields.profile', reason: 'non-owning-side-nullability' },
      ])
    })

    it('picks the owner of a self-referential one-to-one by field name', () => {
      const config = configWith({
        Person: {
          fields: {
            spouse: relationship({ ref: 'Person.partner', db: { isNullable: false } }),
            partner: relationship({ ref: 'Person.spouse' }),
          },
        },
      })

      expect(validateRelations(config)).toMatchObject([
        { listKey: 'Person', entry: 'fields.spouse', reason: 'non-owning-side-nullability' },
      ])
    })

    it('refuses a db.indexes entry naming the non-owning side, naming the list and the entry', () => {
      const config = configWith({
        User: {
          fields: { name: text(), account: relationship({ ref: 'Account.user' }) },
          db: { indexes: [{ fields: ['name'] }, { fields: [{ field: 'account' }], unique: true }] },
        },
        Account: {
          fields: { user: relationship({ ref: 'User.account', db: { foreignKey: true } }) },
        },
      })

      const refusals = validateRelations(config)

      expect(refusals).toHaveLength(1)
      expect(refusals[0]).toMatchObject({
        listKey: 'User',
        entry: 'db.indexes[1]',
        reason: 'non-owning-side-index',
      })
      expect(refusals[0].message).toContain('List "User": db.indexes[1]')
      expect(refusals[0].message).toContain('"account"')
      expect(refusals[0].message).toContain('"Account.user"')
      expect(refusals[0].message).toContain('db.foreignKey: true')
    })

    it('accepts a db.indexes entry naming the owning side', () => {
      const config = configWith({
        User: { fields: { account: relationship({ ref: 'Account.user' }) } },
        Account: {
          fields: { user: relationship({ ref: 'User.account', db: { foreignKey: true } }) },
          db: { indexes: [{ fields: ['user'], unique: true }] },
        },
      })

      expect(validateRelations(config)).toEqual([])
    })
  })

  it('refuses a relationship at a composite-keyed list, naming the list and the entry', () => {
    const Order: ListConfig<TypeInfo> = { fields: { total: text() } }
    const config = configWith({
      Order: Object.assign(Order, { db: { idField: { fields: ['tenantId', 'sequence'] } } }),
      LineItem: { fields: { order: relationship({ ref: 'Order' }) } },
    })

    const refusals = validateRelations(config)

    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatchObject({
      listKey: 'LineItem',
      entry: 'fields.order',
      reason: 'composite-keyed-target',
    })
    expect(refusals[0].message).toContain('List "LineItem": fields.order')
    expect(refusals[0].message).toContain('list "Order"')
    expect(refusals[0].message).toContain('composite primary key')
  })
})
