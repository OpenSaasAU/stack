import { describe, it, expect } from 'vitest'
import { relationship } from './index.js'

describe('relationship field builder: db.foreignKey validation', () => {
  it('rejects a boolean db.foreignKey on a list-only ref', () => {
    expect(() => relationship({ ref: 'User', db: { foreignKey: true } })).toThrow(
      'db.foreignKey cannot be a boolean on list-only refs',
    )
    expect(() => relationship({ ref: 'User', db: { foreignKey: false } })).toThrow(
      'db.foreignKey cannot be a boolean on list-only refs',
    )
  })

  it('allows an object db.foreignKey (map) on a list-only ref', () => {
    expect(() =>
      relationship({ ref: 'User', db: { foreignKey: { map: 'user_id' } } }),
    ).not.toThrow()
  })

  it('still allows a boolean db.foreignKey on a bidirectional ref', () => {
    expect(() => relationship({ ref: 'User.posts', db: { foreignKey: true } })).not.toThrow()
  })

  it('still rejects db.foreignKey on a many relationship regardless of ref shape', () => {
    expect(() =>
      relationship({ ref: 'User', many: true, db: { foreignKey: { map: 'user_id' } } }),
    ).toThrow('db.foreignKey can only be used on single relationships')
  })
})
