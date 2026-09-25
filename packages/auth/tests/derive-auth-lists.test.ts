import { describe, it, expect } from 'vitest'
import { mcp } from '@better-auth/mcp'
import { admin, twoFactor } from 'better-auth/plugins'
import {
  deriveAuthLists as deriveAuthListsImpl,
  type DerivedAuthLists,
} from '../src/config/derive-auth-lists.js'
import type { NormalizedAuthModels } from '../src/config/types.js'
import type { AnyLists } from './helpers/field-types.js'

type TestDerivedAuthLists = Omit<DerivedAuthLists, 'lists'> & { lists: AnyLists }

function deriveAuthLists(...args: Parameters<typeof deriveAuthListsImpl>): TestDerivedAuthLists {
  return deriveAuthListsImpl(...args) as unknown as TestDerivedAuthLists
}

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

  it('marks Session/Verification expiresAt as DB-required, matching better-auth (issue #863)', () => {
    const { lists } = deriveAuthLists(defaultModels)

    expect(lists.Session.fields.expiresAt.db?.isNullable).toBe(false)
    expect(lists.Verification.fields.expiresAt.db?.isNullable).toBe(false)
  })

  it('emits no table @@map and no scalar @map for default keys', () => {
    const { lists } = deriveAuthLists(defaultModels)

    expect(lists.User.db?.map).toBeUndefined()
    expect(lists.Session.db?.map).toBeUndefined()
    expect(lists.Account.db?.map).toBeUndefined()
    expect(lists.Verification.db?.map).toBeUndefined()

    expect(lists.User.fields.name.db?.map).toBeUndefined()
    expect(lists.Session.fields.token.db?.map).toBeUndefined()
    // FK column not overridden -> still defaults to better-auth's own
    // `userId` column name, not the generator's Keystone-parity default
    // (issue #935)
    expect(lists.Session.fields.user.db?.foreignKey).toEqual({ map: 'userId' })
    expect(lists.Account.fields.user.db?.foreignKey).toEqual({ map: 'userId' })
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

describe('deriveAuthLists - user FK shape mirrors better-auth (issue #679/#937)', () => {
  it('indexes the user FK on Session.user and Account.user, matching better-auth', () => {
    const { lists } = deriveAuthLists(defaultModels)

    expect(lists.Session.fields.user.isIndexed).toBe(true)
    expect(lists.Account.fields.user.isIndexed).toBe(true)
  })

  it('indexes Verification.identifier, matching better-auth', () => {
    const { lists } = deriveAuthLists(defaultModels)

    expect(lists.Verification.fields.identifier.isIndexed).toBe(true)
  })

  it('does not touch isIndexed on the email/token unique fields', () => {
    // Existing @@unique mirroring must be unaffected by the FK shape change.
    const { lists } = deriveAuthLists(defaultModels)

    expect(lists.User.fields.email.isIndexed).toBe('unique')
    expect(lists.Session.fields.token.isIndexed).toBe('unique')
  })

  it('declares onDelete: cascade on the user relation', () => {
    const { lists } = deriveAuthLists(defaultModels)

    for (const field of [lists.Session.fields.user, lists.Account.fields.user]) {
      expect(field.db?.onDelete).toBe('cascade')
    }
  })

  it('marks the user FK non-nullable, matching better-auth (issue #863)', () => {
    const { lists } = deriveAuthLists(defaultModels)

    expect(lists.Session.fields.user.db?.isNullable).toBe(false)
    expect(lists.Account.fields.user.db?.isNullable).toBe(false)
  })

  it('keeps the cascade onDelete alongside a userId column override', () => {
    const models: NormalizedAuthModels = {
      user: { modelName: 'User', fields: {} },
      session: { modelName: 'Session', fields: { userId: 'user_id' } },
      account: { modelName: 'Account', fields: { userId: 'user_id' } },
      verification: { modelName: 'Verification', fields: {} },
    }

    const { lists } = deriveAuthLists(models)

    expect(lists.Session.fields.user.db?.foreignKey).toEqual({ map: 'user_id' })
    expect(lists.Session.fields.user.db?.onDelete).toBe('cascade')
    expect(lists.Account.fields.user.db?.foreignKey).toEqual({ map: 'user_id' })
    expect(lists.Account.fields.user.db?.onDelete).toBe('cascade')
  })
})

describe('deriveAuthLists - custom modelName overrides', () => {
  // `deriveAuthLists` is the pure derivation step: it consumes an already-
  // resolved `tableName` rather than re-deriving one from `modelName`. That
  // default derivation (tableName follows modelName when it differs from the
  // better-auth default) lives in `normalizeModelConfig` (config/index.ts) —
  // mirror its output here since these fixtures bypass normalization.
  const customModels: NormalizedAuthModels = {
    user: { modelName: 'AuthUser', tableName: 'AuthUser', fields: {} },
    session: { modelName: 'AuthSession', tableName: 'AuthSession', fields: {} },
    account: { modelName: 'AuthAccount', tableName: 'AuthAccount', fields: {} },
    verification: { modelName: 'AuthVerification', tableName: 'AuthVerification', fields: {} },
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

describe('deriveAuthLists - tableName independent of modelName (issue #862)', () => {
  it('emits @@map from tableName even though modelName is unchanged', () => {
    const models: NormalizedAuthModels = {
      user: { modelName: 'User', tableName: 'users', fields: {} },
      session: { modelName: 'Session', fields: {} },
      account: { modelName: 'Account', fields: {} },
      verification: { modelName: 'Verification', fields: {} },
    }

    const { keys, lists } = deriveAuthLists(models)

    // The list key follows modelName, unaffected by tableName.
    expect(keys.user).toBe('User')
    expect(lists.User.db?.map).toBe('users')
  })

  it('adopts a better-auth default lowercase table under a prefixed list key', () => {
    // The shape issue #862 exists for: a prefixed list key (to avoid
    // colliding with the app's own domain User) whose live table is still
    // better-auth's own default lowercase name.
    const models: NormalizedAuthModels = {
      user: { modelName: 'AuthUser', tableName: 'user', fields: {} },
      session: { modelName: 'AuthSession', tableName: 'session', fields: {} },
      account: { modelName: 'AuthAccount', tableName: 'account', fields: {} },
      verification: { modelName: 'AuthVerification', tableName: 'verification', fields: {} },
    }

    const { keys, lists } = deriveAuthLists(models)

    expect(keys).toEqual({
      user: 'AuthUser',
      session: 'AuthSession',
      account: 'AuthAccount',
      verification: 'AuthVerification',
    })
    expect(lists.AuthUser.db?.map).toBe('user')
    expect(lists.AuthSession.db?.map).toBe('session')
    expect(lists.AuthAccount.db?.map).toBe('account')
    expect(lists.AuthVerification.db?.map).toBe('verification')
  })

  it('emits no @@map when tableName is unset, even with a renamed modelName', () => {
    const models: NormalizedAuthModels = {
      user: { modelName: 'AuthUser', fields: {} },
      session: { modelName: 'Session', fields: {} },
      account: { modelName: 'Account', fields: {} },
      verification: { modelName: 'Verification', fields: {} },
    }

    const { lists } = deriveAuthLists(models)

    expect(lists.AuthUser.db?.map).toBeUndefined()
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

describe('deriveAuthLists - schema placement', () => {
  it('places all lists in the configured schema via db.schema', () => {
    const models: NormalizedAuthModels = {
      user: { modelName: 'AuthUser', fields: {}, schema: 'auth' },
      session: { modelName: 'AuthSession', fields: {}, schema: 'auth' },
      account: { modelName: 'AuthAccount', fields: {}, schema: 'auth' },
      verification: { modelName: 'AuthVerification', fields: {}, schema: 'auth' },
    }

    const { lists } = deriveAuthLists(models)

    expect(lists.AuthUser.db?.schema).toBe('auth')
    expect(lists.AuthSession.db?.schema).toBe('auth')
    expect(lists.AuthAccount.db?.schema).toBe('auth')
    expect(lists.AuthVerification.db?.schema).toBe('auth')
  })

  it('carries both @@map and @@schema for renamed + relocated lists', () => {
    const models: NormalizedAuthModels = {
      user: { modelName: 'AuthUser', tableName: 'AuthUser', fields: {}, schema: 'auth' },
      session: { modelName: 'AuthSession', fields: {}, schema: 'auth' },
      account: { modelName: 'AuthAccount', fields: {}, schema: 'auth' },
      verification: { modelName: 'AuthVerification', fields: {}, schema: 'auth' },
    }

    const { lists } = deriveAuthLists(models)

    // Auth lists always opt into auto-timestamps (ADR-0004) alongside the
    // table @@map and @@schema placement.
    expect(lists.AuthUser.db).toEqual({ timestamps: true, map: 'AuthUser', schema: 'auth' })
  })

  it('honours a per-model schema override alongside a different default schema', () => {
    const models: NormalizedAuthModels = {
      user: { modelName: 'AuthUser', fields: {}, schema: 'auth' },
      session: { modelName: 'AuthSession', fields: {}, schema: 'auth' },
      account: { modelName: 'AuthAccount', fields: {}, schema: 'auth' },
      // One list targets a different schema than the rest
      verification: { modelName: 'AuthVerification', fields: {}, schema: 'auth_internal' },
    }

    const { lists } = deriveAuthLists(models)

    expect(lists.AuthUser.db?.schema).toBe('auth')
    expect(lists.AuthVerification.db?.schema).toBe('auth_internal')
  })

  it('emits no @@schema for the default (no-schema) configuration', () => {
    const { lists } = deriveAuthLists(defaultModels)

    // Auth lists still opt into auto-timestamps (ADR-0004); the greenfield
    // default just carries no schema/map placement.
    expect(lists.User.db).toEqual({ timestamps: true })
    expect(lists.User.db?.schema).toBeUndefined()
    expect(lists.Session.db?.schema).toBeUndefined()
    expect(lists.Account.db?.schema).toBeUndefined()
    expect(lists.Verification.db?.schema).toBeUndefined()
  })
})

describe('deriveAuthLists - RateLimit list (rateLimit.storage === "database")', () => {
  it('is absent when no rateLimit model is supplied', () => {
    const { keys, lists } = deriveAuthLists(defaultModels)

    expect(keys.rateLimit).toBeUndefined()
    expect(lists.RateLimit).toBeUndefined()
    expect(Object.keys(lists).sort()).toEqual(['Account', 'Session', 'User', 'Verification'])
  })

  it('derives a RateLimit list keyed by the default model name when present', () => {
    const models: NormalizedAuthModels = {
      ...defaultModels,
      rateLimit: { modelName: 'RateLimit', fields: {} },
    }

    const { keys, lists } = deriveAuthLists(models)

    expect(keys.rateLimit).toBe('RateLimit')
    expect(Object.keys(lists).sort()).toEqual([
      'Account',
      'RateLimit',
      'Session',
      'User',
      'Verification',
    ])
  })

  it('mirrors better-auth’s rateLimit table shape: key/count/lastRequest, all required, no defaults', () => {
    const models: NormalizedAuthModels = {
      ...defaultModels,
      rateLimit: { modelName: 'RateLimit', fields: {} },
    }

    const { lists } = deriveAuthLists(models)
    const rateLimit = lists.RateLimit

    expect(rateLimit.fields.key.type).toBe('text')
    expect(rateLimit.fields.key.isIndexed).toBe('unique')
    expect(rateLimit.fields.key.validation?.isRequired).toBe(true)
    expect(rateLimit.fields.key.defaultValue).toBeUndefined()

    expect(rateLimit.fields.count.type).toBe('integer')
    expect(rateLimit.fields.count.validation?.isRequired).toBe(true)
    expect(rateLimit.fields.count.db?.isNullable).toBe(false)
    expect(rateLimit.fields.count.defaultValue).toBeUndefined()

    expect(rateLimit.fields.lastRequest.type).toBe('bigInt')
    expect(rateLimit.fields.lastRequest.validation?.isRequired).toBe(true)
    expect(rateLimit.fields.lastRequest.db?.isNullable).toBe(false)
    expect(rateLimit.fields.lastRequest.defaultValue).toBeUndefined()

    // Exactly these three fields — no createdAt/updatedAt columns on this list.
    expect(Object.keys(rateLimit.fields).sort()).toEqual(['count', 'key', 'lastRequest'])
  })

  it('does not opt into auto-timestamps, unlike the other four Auth lists', () => {
    const models: NormalizedAuthModels = {
      ...defaultModels,
      rateLimit: { modelName: 'RateLimit', fields: {} },
    }

    const { lists } = deriveAuthLists(models)

    expect(lists.RateLimit.db?.timestamps).toBeUndefined()
    expect(lists.User.db?.timestamps).toBe(true)
  })

  it('applies a custom modelName, tableName, field column maps, and schema like the other models', () => {
    const models: NormalizedAuthModels = {
      ...defaultModels,
      rateLimit: {
        modelName: 'AuthRateLimit',
        tableName: 'rate_limit',
        fields: { key: 'limit_key', count: 'hit_count', lastRequest: 'last_hit_at' },
        schema: 'auth',
      },
    }

    const { keys, lists } = deriveAuthLists(models)

    expect(keys.rateLimit).toBe('AuthRateLimit')
    const rateLimit = lists.AuthRateLimit
    expect(rateLimit.db?.map).toBe('rate_limit')
    expect(rateLimit.db?.schema).toBe('auth')
    expect(rateLimit.fields.key.db?.map).toBe('limit_key')
    expect(rateLimit.fields.count.db?.map).toBe('hit_count')
    expect(rateLimit.fields.lastRequest.db?.map).toBe('last_hit_at')
  })

  it('ships closed (no access) unless accessConfig.rateLimit is supplied', () => {
    const models: NormalizedAuthModels = {
      ...defaultModels,
      rateLimit: { modelName: 'RateLimit', fields: {} },
    }

    const { lists: closed } = deriveAuthLists(models)
    expect(closed.RateLimit.access).toBeUndefined()

    const rateLimitAccess = { operation: { query: () => true } }
    const { lists: open } = deriveAuthLists(models, {}, { rateLimit: rateLimitAccess })
    expect(open.RateLimit.access).toBe(rateLimitAccess)
  })
})

describe("deriveAuthLists - fields remap collision with another field's own key (issue #1545)", () => {
  it("refuses a remap that sends a bigint field's column onto another field's own key", () => {
    // The issue's own example: lastRequest (bigint) is remapped onto "count",
    // which is also the rateLimit model's own (separately remapped) `count`
    // field key. better-auth's `getDefaultFieldName` would resolve column
    // "count" straight back to the `count` field's attributes — not bigint —
    // so incrementOne would silently skip the BigInt widening `lastRequest`'s
    // int8 column needs.
    const models: NormalizedAuthModels = {
      ...defaultModels,
      rateLimit: {
        modelName: 'RateLimit',
        fields: { count: 'total_count', lastRequest: 'count' },
      },
    }

    expect(() => deriveAuthLists(models)).toThrow(
      /"rateLimit\.fields" remaps "lastRequest" to "count".*"rateLimit\.count"/,
    )
  })

  it('refuses the collision regardless of which field is remapped first', () => {
    const models: NormalizedAuthModels = {
      ...defaultModels,
      rateLimit: { modelName: 'RateLimit', fields: { key: 'count' } },
    }

    expect(() => deriveAuthLists(models)).toThrow(/"key" to "count".*"rateLimit\.count"/)
  })

  it('is unaffected by a remap target that collides with nothing', () => {
    const models: NormalizedAuthModels = {
      ...defaultModels,
      rateLimit: { modelName: 'RateLimit', fields: { count: 'total_count' } },
    }

    expect(() => deriveAuthLists(models)).not.toThrow()
  })

  it('does not treat a field remapped to its own key as a collision', () => {
    const models: NormalizedAuthModels = {
      ...defaultModels,
      rateLimit: { modelName: 'RateLimit', fields: { count: 'count', lastRequest: 'last_seen' } },
    }

    expect(() => deriveAuthLists(models)).not.toThrow()
  })

  it('also refuses the collision on the base models (not just rateLimit)', () => {
    const models: NormalizedAuthModels = {
      ...defaultModels,
      // "name" is remapped onto "email", which is also the user model's own
      // (unmapped) `email` field key.
      user: { modelName: 'User', fields: { name: 'email' } },
    }

    expect(() => deriveAuthLists(models)).toThrow(/"user\.fields" remaps "name" to "email"/)
  })

  it('leaves the #1236 self-collision refusal (a relation field colliding with its own FK column) unaffected', () => {
    // A non-colliding `fields` remap on a base model still generates cleanly
    // alongside the unrelated self-collision check this fix must not disturb.
    const models: NormalizedAuthModels = {
      ...defaultModels,
      session: { modelName: 'Session', fields: { userId: 'user_id' } },
    }

    expect(() => deriveAuthLists(models)).not.toThrow()
  })
})

describe('deriveAuthLists - credential fields ship read-denied (ADR-0036, issue #981)', () => {
  it('denies read on Session.token, Verification.value, and the Account credential fields', async () => {
    const { lists } = deriveAuthLists(defaultModels)

    const denied: Array<[string, string]> = [
      ['Session', 'token'],
      ['Verification', 'value'],
      ['Account', 'password'],
      ['Account', 'accessToken'],
      ['Account', 'refreshToken'],
      ['Account', 'idToken'],
    ]

    for (const [listKey, fieldKey] of denied) {
      const field = lists[listKey].fields[fieldKey]
      expect(field.access?.read).toBeTypeOf('function')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal read-access call fixture
      expect(await field.access!.read!({} as any)).toBe(false)
    }
  })

  it('also curates read-denied credential fields out of the admin default columns (issue #1018)', async () => {
    const { lists } = deriveAuthLists(defaultModels)

    const denied: Array<[string, string]> = [
      ['Session', 'token'],
      ['Verification', 'value'],
      ['Account', 'password'],
      ['Account', 'accessToken'],
      ['Account', 'refreshToken'],
      ['Account', 'idToken'],
    ]

    for (const [listKey, fieldKey] of denied) {
      const field = lists[listKey].fields[fieldKey]
      expect(field.ui?.listView?.defaultColumn).toBe(false)
    }

    // A non-credential field is left with no ui.listView declaration at all.
    expect(lists.Session.fields.ipAddress.ui?.listView).toBeUndefined()
  })

  it('leaves identifying fields open — session/account metadata and every User field', () => {
    const { lists } = deriveAuthLists(defaultModels)

    const open: Array<[string, string]> = [
      ['Session', 'ipAddress'],
      ['Session', 'userAgent'],
      ['Session', 'expiresAt'],
      ['Account', 'providerId'],
      ['Account', 'accountId'],
      ['Account', 'scope'],
      ['Verification', 'identifier'],
      ['Verification', 'expiresAt'],
      ['User', 'name'],
      ['User', 'email'],
    ]

    for (const [listKey, fieldKey] of open) {
      expect(lists[listKey].fields[fieldKey].access).toBeUndefined()
    }
  })

  it('keys the deny to the better-auth model/field, surviving a modelName + column remap', () => {
    const models: NormalizedAuthModels = {
      user: { modelName: 'AuthUser', fields: {} },
      session: { modelName: 'AuthSession', fields: { token: 'session_token' } },
      account: { modelName: 'AuthAccount', fields: { password: 'password_hash' } },
      verification: { modelName: 'AuthVerification', fields: { value: 'verification_value' } },
    }

    const { lists } = deriveAuthLists(models)

    expect(lists.AuthSession.fields.token.access?.read).toBeTypeOf('function')
    expect(lists.AuthSession.fields.token.db?.map).toBe('session_token')
    expect(lists.AuthAccount.fields.password.access?.read).toBeTypeOf('function')
    expect(lists.AuthAccount.fields.password.db?.map).toBe('password_hash')
    expect(lists.AuthVerification.fields.value.access?.read).toBeTypeOf('function')
    expect(lists.AuthVerification.fields.value.db?.map).toBe('verification_value')
  })

  it('does not add access to fields that already have none, beyond the credential set', () => {
    const { lists } = deriveAuthLists(defaultModels)

    // Every other scalar/relationship field across the four base lists stays access-less.
    const nonCredentialFields = [
      ...Object.entries(lists.Session.fields).filter(([k]) => k !== 'token'),
      ...Object.entries(lists.Account.fields).filter(
        ([k]) => !['password', 'accessToken', 'refreshToken', 'idToken'].includes(k),
      ),
      ...Object.entries(lists.Verification.fields).filter(([k]) => k !== 'value'),
    ]
    for (const [, field] of nonCredentialFields) {
      expect(field.access).toBeUndefined()
    }
  })
})

describe('deriveAuthLists - credential fields on plugin tables (issue #1014)', () => {
  const mcpPlugin = mcp({
    loginPage: '/sign-in',
    consentPage: '/consent',
    resource: 'https://example.com/mcp',
  })

  it('denies read on the mcp/oauth-provider credential fields', async () => {
    const { lists } = deriveAuthLists(defaultModels, {}, {}, [mcpPlugin])

    const denied: Array<[string, string]> = [
      ['OauthClient', 'clientSecret'],
      ['OauthAccessToken', 'token'],
      ['OauthRefreshToken', 'token'],
    ]

    for (const [listKey, fieldKey] of denied) {
      const field = lists[listKey].fields[fieldKey]
      expect(field.access?.read).toBeTypeOf('function')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal read-access call fixture
      expect(await field.access!.read!({} as any)).toBe(false)
      expect(field.ui?.listView?.defaultColumn).toBe(false)
    }
  })

  it('leaves identifying oauth-provider fields open', () => {
    const { lists } = deriveAuthLists(defaultModels, {}, {}, [mcpPlugin])

    expect(lists.OauthClient.fields.name.access).toBeUndefined()
    expect(lists.OauthClient.fields.uri.access).toBeUndefined()
    expect(lists.OauthClient.fields.clientId.access).toBeUndefined()
    expect(lists.OauthAccessToken.fields.scopes.access).toBeUndefined()
    expect(lists.OauthAccessToken.fields.expiresAt.access).toBeUndefined()
  })

  it('denies read on twoFactor.secret and twoFactor.backupCodes', async () => {
    const { lists } = deriveAuthLists(defaultModels, {}, {}, [twoFactor()])

    for (const fieldKey of ['secret', 'backupCodes']) {
      const field = lists.TwoFactor.fields[fieldKey]
      expect(field.access?.read).toBeTypeOf('function')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal read-access call fixture
      expect(await field.access!.read!({} as any)).toBe(false)
      expect(field.ui?.listView?.defaultColumn).toBe(false)
    }
  })

  it('write-denies twoFactor.verified (input:false upstream, issue #1618), and leaves twoFactor.userId open despite carrying returned: false upstream', async () => {
    const { lists } = deriveAuthLists(defaultModels, {}, {}, [twoFactor()])

    const verified = lists.TwoFactor.fields.verified
    expect(verified.access?.read).toBeUndefined()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal field-access call fixture
    expect(await verified.access!.create!({} as any)).toBe(false)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal field-access call fixture
    expect(await verified.access!.update!({} as any)).toBe(false)
    // userId is a relationship field (references user.id), not a scalar —
    // it's never routed through the credential-deny or write-deny paths at all.
    expect(lists.TwoFactor.fields.user.access).toBeUndefined()
  })

  it('survives a plugin-table modelName + column remap', () => {
    const plugin = {
      id: 'test-remap',
      schema: {
        widget: {
          modelName: 'Gadget',
          fields: {
            apiKey: { type: 'string' as const, required: true, fieldName: 'api_key' },
          },
        },
      },
    }

    const { lists } = deriveAuthLists(defaultModels, {}, {}, [plugin], {
      widget: ['apiKey'],
    })

    expect(lists.Gadget.fields.apiKey.access?.read).toBeTypeOf('function')
    expect(lists.Gadget.fields.apiKey.db?.map).toBe('api_key')
  })

  it('authPlugin({ credentialFields }) marks an additional field on a synthetic plugin table', async () => {
    const plugin = {
      id: 'test-passkey',
      schema: {
        passkey: {
          fields: {
            publicKey: { type: 'string' as const, required: true },
            deviceType: { type: 'string' as const, required: true },
          },
        },
      },
    }

    const { lists } = deriveAuthLists(defaultModels, {}, {}, [plugin], {
      passkey: ['publicKey'],
    })

    expect(await lists.Passkey.fields.publicKey.access!.read!({} as never)).toBe(false)
    expect(lists.Passkey.fields.deviceType.access).toBeUndefined()
  })

  it('cannot unmark a stack-seeded credential field', async () => {
    // An empty (or omitted) field list for a seeded model must not remove its
    // seeded deny — credentialFields is additive-only.
    const { lists } = deriveAuthLists(defaultModels, {}, {}, [], { session: [] })

    expect(await lists.Session.fields.token.access!.read!({} as never)).toBe(false)
  })

  it('throws, naming the model and field, when credentialFields names a field missing from a derived model', () => {
    const plugin = {
      id: 'test-typo',
      schema: {
        widget: { fields: { apiKey: { type: 'string' as const } } },
      },
    }

    expect(() => deriveAuthLists(defaultModels, {}, {}, [plugin], { widget: ['apiKye'] })).toThrow(
      /widget\.apiKye.*no field "apiKye"/,
    )
  })

  it('is a silent no-op when credentialFields names a model that is not derived at all', () => {
    // No plugin registers `passkey` here, so `tables` never contains it.
    expect(() =>
      deriveAuthLists(defaultModels, {}, {}, [], { passkey: ['publicKey'] }),
    ).not.toThrow()
  })

  it('throws, naming the model and field, when credentialFields names an id-referencing relationship field', () => {
    // An id-referencing field (references.field === 'id') derives to a
    // relationship(), never a scalar — withCredentialAccess only ever runs on
    // the scalar-field path, so a deny registered against one would silently
    // never apply. Reject the config instead of accepting a no-op.
    const plugin = {
      id: 'test-fk-credential',
      schema: {
        widget: {
          fields: {
            ownerId: { type: 'string' as const, references: { model: 'user', field: 'id' } },
          },
        },
      },
    }

    expect(() => deriveAuthLists(defaultModels, {}, {}, [plugin], { widget: ['ownerId'] })).toThrow(
      /widget\.ownerId.*relationship field.*"user\.id"/,
    )
  })

  it('accepts and applies credentialFields on an id-referencing field whose name does not end in "Id"', async () => {
    // Unlike `ownerId` above, `owner` derives to a scalar column (#1222) —
    // stripping `Id` would be a no-op, so it never reaches the
    // relationship() path withCredentialAccess can't apply to.
    const plugin = {
      id: 'test-fk-credential-no-id-suffix',
      schema: {
        widget: {
          fields: {
            owner: {
              type: 'string' as const,
              required: false,
              references: { model: 'user', field: 'id' },
            },
          },
        },
      },
    }

    const { lists } = deriveAuthLists(defaultModels, {}, {}, [plugin], { widget: ['owner'] })

    expect(await lists.Widget.fields.owner.access!.read!({} as never)).toBe(false)
  })
})

describe('deriveAuthLists - input:false fields ship write-denied (issue #1618)', () => {
  it('denies create and update on User.emailVerified, which better-auth marks input:false unconditionally', async () => {
    const { lists } = deriveAuthLists(defaultModels)
    const field = lists.User.fields.emailVerified

    expect(field.access?.create).toBeTypeOf('function')
    expect(field.access?.update).toBeTypeOf('function')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal field-access call fixture
    expect(await field.access!.create!({} as any)).toBe(false)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal field-access call fixture
    expect(await field.access!.update!({} as any)).toBe(false)
    // Reads are unaffected — emailVerified is not a credential.
    expect(field.access?.read).toBeUndefined()
  })

  it('denies create and update on the admin() plugin fields role/banned/banReason/banExpires/session.impersonatedBy', async () => {
    const { lists } = deriveAuthLists(defaultModels, {}, {}, [admin()])

    const denied: Array<[string, string]> = [
      ['User', 'role'],
      ['User', 'banned'],
      ['User', 'banReason'],
      ['User', 'banExpires'],
      ['Session', 'impersonatedBy'],
    ]

    for (const [listKey, fieldKey] of denied) {
      const field = lists[listKey].fields[fieldKey]
      expect(field.access?.create).toBeTypeOf('function')
      expect(field.access?.update).toBeTypeOf('function')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal field-access call fixture
      expect(await field.access!.create!({} as any)).toBe(false)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal field-access call fixture
      expect(await field.access!.update!({} as any)).toBe(false)
    }
  })

  it('is keyed on the upstream input flag, not a hardcoded field list — a never-seen plugin field with input:false is write-denied automatically', async () => {
    const plugin = {
      id: 'test-input-false',
      schema: {
        widget: {
          fields: {
            secretFlag: { type: 'boolean' as const, required: false, input: false },
            label: { type: 'string' as const, required: false },
          },
        },
      },
    }

    const { lists } = deriveAuthLists(defaultModels, {}, {}, [plugin])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal field-access call fixture
    expect(await lists.Widget.fields.secretFlag.access!.create!({} as any)).toBe(false)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal field-access call fixture
    expect(await lists.Widget.fields.secretFlag.access!.update!({} as any)).toBe(false)
    expect(lists.Widget.fields.label.access).toBeUndefined()
  })

  it('also write-denies an id-referencing FK field marked input:false (dormant today, no built-in plugin hits it — found in review)', async () => {
    const plugin = {
      id: 'test-input-false-fk',
      schema: {
        widget: {
          fields: {
            ownerId: {
              type: 'string' as const,
              required: false,
              input: false,
              references: { model: 'user', field: 'id' },
            },
          },
        },
      },
    }

    const { lists } = deriveAuthLists(defaultModels, {}, {}, [plugin])
    const field = lists.Widget.fields.owner

    expect(field.access?.create).toBeTypeOf('function')
    expect(field.access?.update).toBeTypeOf('function')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal field-access call fixture
    expect(await field.access!.create!({} as any)).toBe(false)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal field-access call fixture
    expect(await field.access!.update!({} as any)).toBe(false)
  })

  it('leaves every other User/Session field unaffected', () => {
    const { lists } = deriveAuthLists(defaultModels, {}, {}, [admin()])

    expect(lists.User.fields.name.access).toBeUndefined()
    expect(lists.User.fields.email.access).toBeUndefined()
    expect(lists.User.fields.image.access).toBeUndefined()
    expect(lists.Session.fields.ipAddress.access).toBeUndefined()
  })

  it('composes a write-deny with an existing credential read-deny on the same field, rather than overwriting it', async () => {
    const plugin = {
      id: 'test-input-false-credential',
      schema: {
        widget: {
          fields: {
            apiKey: { type: 'string' as const, required: false, input: false },
          },
        },
      },
    }

    const { lists } = deriveAuthLists(defaultModels, {}, {}, [plugin], { widget: ['apiKey'] })
    const field = lists.Widget.fields.apiKey

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal field-access call fixture
    expect(await field.access!.read!({} as any)).toBe(false)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal field-access call fixture
    expect(await field.access!.create!({} as any)).toBe(false)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal field-access call fixture
    expect(await field.access!.update!({} as any)).toBe(false)
  })
})

describe('deriveAuthLists - fieldAccess override (issue #1618)', () => {
  it('replaces the seeded update deny for one field, leaving the seeded create deny standing', async () => {
    const isAdmin = () => true
    const { lists } = deriveAuthLists(
      defaultModels,
      {},
      {},
      [admin()],
      {},
      {
        user: { role: { update: isAdmin } },
      },
    )

    const field = lists.User.fields.role
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal field-access call fixture
    expect(await field.access!.update!({} as any)).toBe(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal field-access call fixture
    expect(await field.access!.create!({} as any)).toBe(false)
  })

  it('throws at config time when an entry sets `read` on a credential field (ADR-0036 cannot be reopened)', () => {
    expect(() =>
      deriveAuthLists(
        defaultModels,
        {},
        {},
        [],
        {},
        {
          session: { token: { read: () => true } },
        },
      ),
    ).toThrow(/fieldAccess.*"session\.token".*credential/)
  })

  it('throws even when the credential override explicitly sets `read: undefined` (ADR-0036 cannot be reopened by omission either)', () => {
    // `{ read: undefined }` is a shape TypeScript's optional-property syntax
    // accepts, and a naive `access.read !== undefined` check would let it
    // through — only to have `withFieldAccess`'s merge clear the seeded
    // DENY_READ with that same `undefined`, reopening the credential (found
    // in review of #1618/ADR-0073).
    expect(() =>
      deriveAuthLists(
        defaultModels,
        {},
        {},
        [],
        {},
        {
          session: { token: { read: undefined } },
        },
      ),
    ).toThrow(/fieldAccess.*"session\.token".*credential/)
  })

  it('never lets an override key explicitly set to `undefined` clear a seeded deny', async () => {
    // Even if validation didn't reject it, the merge itself must not treat
    // an own `undefined` value as "clear this rule" — otherwise
    // `fieldAccess: { user: { role: { update: undefined } } }` would silently
    // reopen the seeded input:false write-deny on a non-credential field too.
    const { lists } = deriveAuthLists(
      defaultModels,
      {},
      {},
      [admin()],
      {},
      {
        user: { role: { update: undefined } },
      },
    )

    const field = lists.User.fields.role
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal field-access call fixture
    expect(await field.access!.update!({} as any)).toBe(false)
  })

  it('throws, naming the model and field, when fieldAccess names a field missing from a derived model', () => {
    expect(() =>
      deriveAuthLists(
        defaultModels,
        {},
        {},
        [],
        {},
        {
          user: { nickname: { update: () => true } },
        },
      ),
    ).toThrow(/user\.nickname.*no field "nickname"/)
  })

  it('is a silent no-op when fieldAccess names a model that is not derived at all', () => {
    expect(() =>
      deriveAuthLists(
        defaultModels,
        {},
        {},
        [],
        {},
        {
          passkey: { publicKey: { update: () => true } },
        },
      ),
    ).not.toThrow()
  })

  it('throws, naming the model and field, when fieldAccess names an id-referencing relationship field', () => {
    const plugin = {
      id: 'test-field-access-fk',
      schema: {
        widget: {
          fields: {
            ownerId: { type: 'string' as const, references: { model: 'user', field: 'id' } },
          },
        },
      },
    }

    expect(() =>
      deriveAuthLists(
        defaultModels,
        {},
        {},
        [plugin],
        {},
        {
          widget: { ownerId: { update: () => true } },
        },
      ),
    ).toThrow(/widget\.ownerId.*relationship field.*"user\.id"/)
  })

  it('can reopen create as well as update, leaving unspecified operations at their seeded value', async () => {
    const canWrite = () => true
    const { lists } = deriveAuthLists(
      defaultModels,
      {},
      {},
      [admin()],
      {},
      {
        user: { role: { create: canWrite, update: canWrite } },
      },
    )

    const field = lists.User.fields.role
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal field-access call fixture
    expect(await field.access!.create!({} as any)).toBe(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal field-access call fixture
    expect(await field.access!.update!({} as any)).toBe(true)
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
