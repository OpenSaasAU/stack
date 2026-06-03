import { describe, it, expect } from 'vitest'
import { deriveAuthLists } from '../src/config/derive-auth-lists.js'
import type { NormalizedAuthModels } from '../src/config/types.js'

const defaultModels: NormalizedAuthModels = {
  user: { modelName: 'User', fields: {} },
  session: { modelName: 'Session', fields: {} },
  account: { modelName: 'Account', fields: {} },
  verification: { modelName: 'Verification', fields: {} },
}

describe('deriveAuthLists - default behaviour (no overrides)', () => {
  it('keeps the historical User/Session/Account/Verification keys', () => {
    const { keys, lists } = deriveAuthLists(defaultModels)

    expect(keys).toEqual({
      user: 'User',
      session: 'Session',
      account: 'Account',
      verification: 'Verification',
    })
    expect(Object.keys(lists).sort()).toEqual(['Account', 'Session', 'User', 'Verification'])
  })

  it('keeps the original User field shape', () => {
    const { lists } = deriveAuthLists(defaultModels)
    const user = lists.User

    expect(user.fields).toHaveProperty('name')
    expect(user.fields).toHaveProperty('email')
    expect(user.fields).toHaveProperty('emailVerified')
    expect(user.fields).toHaveProperty('image')
    expect(user.fields).toHaveProperty('sessions')
    expect(user.fields).toHaveProperty('accounts')
    expect(user.fields.email.isIndexed).toBe('unique')
    expect(user.fields.name.validation?.isRequired).toBe(true)
  })

  it('wires relationship refs to the default keys', () => {
    const { lists } = deriveAuthLists(defaultModels)
    expect(lists.Session.fields.user.ref).toBe('User.sessions')
    expect(lists.Account.fields.user.ref).toBe('User.accounts')
    expect(lists.User.fields.sessions.ref).toBe('Session.user')
    expect(lists.User.fields.accounts.ref).toBe('Account.user')
  })

  it('emits no table @@map and no scalar @map for default keys', () => {
    const { lists } = deriveAuthLists(defaultModels)

    expect(lists.User.db?.map).toBeUndefined()
    expect(lists.Session.db?.map).toBeUndefined()
    expect(lists.Account.db?.map).toBeUndefined()
    expect(lists.Verification.db?.map).toBeUndefined()

    expect(lists.User.fields.name.db?.map).toBeUndefined()
    expect(lists.Session.fields.token.db?.map).toBeUndefined()
    // FK column not overridden -> no foreignKey map on the relationship
    expect(lists.Session.fields.user.db).toBeUndefined()
  })

  it('opts every auth list into auto-timestamps', () => {
    // Auto-timestamps are OFF by default (ADR-0004), but better-auth's adapter
    // writes createdAt/updatedAt on every auth row and the schema converter
    // returns null for those columns assuming the generator injects them. Each
    // derived auth list must therefore re-enable them via db.timestamps.
    const { lists } = deriveAuthLists(defaultModels)

    expect(lists.User.db?.timestamps).toBe(true)
    expect(lists.Session.db?.timestamps).toBe(true)
    expect(lists.Account.db?.timestamps).toBe(true)
    expect(lists.Verification.db?.timestamps).toBe(true)
  })
})

describe('deriveAuthLists - custom modelName overrides', () => {
  const customModels: NormalizedAuthModels = {
    user: { modelName: 'AuthUser', fields: {} },
    session: { modelName: 'AuthSession', fields: {} },
    account: { modelName: 'AuthAccount', fields: {} },
    verification: { modelName: 'AuthVerification', fields: {} },
  }

  it('derives list keys from modelName', () => {
    const { keys, lists } = deriveAuthLists(customModels)

    expect(keys).toEqual({
      user: 'AuthUser',
      session: 'AuthSession',
      account: 'AuthAccount',
      verification: 'AuthVerification',
    })
    expect(Object.keys(lists).sort()).toEqual([
      'AuthAccount',
      'AuthSession',
      'AuthUser',
      'AuthVerification',
    ])
    // The app's own `User` key must NOT be produced by the plugin
    expect(lists).not.toHaveProperty('User')
  })

  it('wires relationship refs to the derived keys', () => {
    const { lists } = deriveAuthLists(customModels)
    expect(lists.AuthSession.fields.user.ref).toBe('AuthUser.sessions')
    expect(lists.AuthAccount.fields.user.ref).toBe('AuthUser.accounts')
    expect(lists.AuthUser.fields.sessions.ref).toBe('AuthSession.user')
    expect(lists.AuthUser.fields.accounts.ref).toBe('AuthAccount.user')
  })

  it('pins each renamed list to a table @@map equal to the model name', () => {
    const { lists } = deriveAuthLists(customModels)

    expect(lists.AuthUser.db?.map).toBe('AuthUser')
    expect(lists.AuthSession.db?.map).toBe('AuthSession')
    expect(lists.AuthAccount.db?.map).toBe('AuthAccount')
    expect(lists.AuthVerification.db?.map).toBe('AuthVerification')
  })

  it('keeps auto-timestamps enabled alongside the table @@map', () => {
    const { lists } = deriveAuthLists(customModels)

    expect(lists.AuthUser.db?.timestamps).toBe(true)
    expect(lists.AuthSession.db?.timestamps).toBe(true)
    expect(lists.AuthAccount.db?.timestamps).toBe(true)
    expect(lists.AuthVerification.db?.timestamps).toBe(true)
  })
})

describe('deriveAuthLists - custom field column maps', () => {
  const models: NormalizedAuthModels = {
    user: { modelName: 'AuthUser', fields: { name: 'full_name', emailVerified: 'is_verified' } },
    session: { modelName: 'AuthSession', fields: { token: 'session_token', userId: 'user_id' } },
    account: { modelName: 'AuthAccount', fields: { userId: 'user_id' } },
    verification: { modelName: 'AuthVerification', fields: {} },
  }

  it('applies @map column overrides to scalar fields', () => {
    const { lists } = deriveAuthLists(models)

    expect(lists.AuthUser.fields.name.db?.map).toBe('full_name')
    expect(lists.AuthUser.fields.emailVerified.db?.map).toBe('is_verified')
    expect(lists.AuthSession.fields.token.db?.map).toBe('session_token')
  })

  it('applies the userId column override to the relationship foreign key', () => {
    const { lists } = deriveAuthLists(models)

    expect(lists.AuthSession.fields.user.db?.foreignKey).toEqual({ map: 'user_id' })
    expect(lists.AuthAccount.fields.user.db?.foreignKey).toEqual({ map: 'user_id' })
  })

  it('only maps fields that have an override, leaving others unmapped', () => {
    const { lists } = deriveAuthLists(models)
    // name is mapped, email is not
    expect(lists.AuthUser.fields.name.db?.map).toBe('full_name')
    expect(lists.AuthUser.fields.email.db?.map).toBeUndefined()
  })
})

describe('deriveAuthLists - extendUserList', () => {
  it('adds custom fields to the derived user list', () => {
    const { lists } = deriveAuthLists(
      { ...defaultModels, user: { modelName: 'AuthUser', fields: {} } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal custom field config for test
      { fields: { role: { type: 'text' } as any } },
    )

    expect(lists.AuthUser.fields).toHaveProperty('role')
    // Base fields still present
    expect(lists.AuthUser.fields).toHaveProperty('email')
  })
})
