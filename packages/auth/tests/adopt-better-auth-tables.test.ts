import { describe, it, expect } from 'vitest'
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import type { Plugin } from '@opensaas/stack-core/extend'
import { authPlugin } from '../src/config/plugin.js'
import { adoptBetterAuthTables } from '../src/config/adopt-better-auth-tables.js'

/**
 * Run a config through plugin `init` (via `config()`) and then the auth
 * plugin's `beforeGenerate` hook — mirroring the CLI generate pipeline — to
 * observe the final config the generator would consume. Mirrors the helper in
 * `plugin-schema-placement.test.ts`.
 */
async function generationConfig(userConfig: OpenSaasConfig): Promise<OpenSaasConfig> {
  const resolved = await config(userConfig)
  let current = resolved
  const plugins: Plugin[] = resolved.plugins ?? []
  for (const plugin of plugins) {
    if (plugin.beforeGenerate) {
      current = await plugin.beforeGenerate(current)
    }
  }
  return current
}

describe('adoptBetterAuthTables - recipe defaults', () => {
  it('produces the standard separate-schema better-auth defaults', () => {
    const fragment = adoptBetterAuthTables()

    expect(fragment).toEqual({
      schema: 'auth',
      user: { modelName: 'AuthUser' },
      session: { modelName: 'AuthSession' },
      account: { modelName: 'AuthAccount' },
      verification: { modelName: 'AuthVerification' },
    })
  })

  it('honours a custom schema and model-name prefix', () => {
    const fragment = adoptBetterAuthTables({ schema: 'identity', modelNamePrefix: 'BA' })

    expect(fragment).toEqual({
      schema: 'identity',
      user: { modelName: 'BAUser' },
      session: { modelName: 'BASession' },
      account: { modelName: 'BAAccount' },
      verification: { modelName: 'BAVerification' },
    })
  })

  it('merges per-model field column maps when provided', () => {
    const fragment = adoptBetterAuthTables({
      fields: {
        user: { name: 'full_name', emailVerified: 'is_verified' },
        session: { userId: 'user_id' },
      },
    })

    expect(fragment.user).toEqual({
      modelName: 'AuthUser',
      fields: { name: 'full_name', emailVerified: 'is_verified' },
    })
    expect(fragment.session).toEqual({
      modelName: 'AuthSession',
      fields: { userId: 'user_id' },
    })
    // Models without a field map carry no `fields` key (no empty object)
    expect(fragment.account).toEqual({ modelName: 'AuthAccount' })
    expect(fragment.verification).toEqual({ modelName: 'AuthVerification' })
  })

  it('omits the schema when explicitly set to public', () => {
    const fragment = adoptBetterAuthTables({ schema: 'public' })
    expect(fragment.schema).toBe('public')
  })
})

describe('adoptBetterAuthTables - table names (issue #862)', () => {
  it('sets no tableName by default (prefixed modelName also pins the table, as before)', () => {
    const fragment = adoptBetterAuthTables()

    expect(fragment.user).toEqual({ modelName: 'AuthUser' })
    expect(fragment.session).toEqual({ modelName: 'AuthSession' })
  })

  it('useBetterAuthTableNames sets every model tableName to the better-auth default lowercase name', () => {
    const fragment = adoptBetterAuthTables({ useBetterAuthTableNames: true })

    expect(fragment.user).toEqual({ modelName: 'AuthUser', tableName: 'user' })
    expect(fragment.session).toEqual({ modelName: 'AuthSession', tableName: 'session' })
    expect(fragment.account).toEqual({ modelName: 'AuthAccount', tableName: 'account' })
    expect(fragment.verification).toEqual({
      modelName: 'AuthVerification',
      tableName: 'verification',
    })
  })

  it('tableNames sets explicit per-model table names', () => {
    const fragment = adoptBetterAuthTables({
      tableNames: { user: 'users', session: 'user_sessions' },
    })

    expect(fragment.user).toEqual({ modelName: 'AuthUser', tableName: 'users' })
    expect(fragment.session).toEqual({ modelName: 'AuthSession', tableName: 'user_sessions' })
    // Models without an explicit tableName entry stay unset.
    expect(fragment.account).toEqual({ modelName: 'AuthAccount' })
  })

  it('tableNames takes precedence over useBetterAuthTableNames for the same model', () => {
    const fragment = adoptBetterAuthTables({
      useBetterAuthTableNames: true,
      tableNames: { user: 'custom_user_table' },
    })

    expect(fragment.user?.tableName).toBe('custom_user_table')
    // Other models still fall back to the better-auth default.
    expect(fragment.session?.tableName).toBe('session')
  })

  it('combines tableName with a field column map on the same model', () => {
    const fragment = adoptBetterAuthTables({
      useBetterAuthTableNames: true,
      fields: { user: { name: 'full_name' } },
    })

    expect(fragment.user).toEqual({
      modelName: 'AuthUser',
      tableName: 'user',
      fields: { name: 'full_name' },
    })
  })
})

describe('adoptBetterAuthTables - clean-diff adoption with better-auth default table names', () => {
  it('produces Auth lists that @@map to the live lowercase tables under prefixed list keys', async () => {
    const result = await generationConfig({
      db: { provider: 'postgresql' },
      plugins: [
        authPlugin({
          ...adoptBetterAuthTables({ useBetterAuthTableNames: true }),
          emailAndPassword: { enabled: true },
        }),
      ],
      lists: {
        User: list({
          fields: { subjectId: text({ validation: { isRequired: true } }) },
        }),
      },
    })

    // List keys stay prefixed (no collision with the app's own User)...
    expect(result.lists).toHaveProperty('AuthUser')
    // ...but the physical table is better-auth's own default lowercase name.
    expect(result.lists.AuthUser.db).toEqual({ timestamps: true, map: 'user', schema: 'auth' })
    expect(result.lists.AuthSession.db).toEqual({
      timestamps: true,
      map: 'session',
      schema: 'auth',
    })
    expect(result.lists.AuthAccount.db).toEqual({
      timestamps: true,
      map: 'account',
      schema: 'auth',
    })
    expect(result.lists.AuthVerification.db).toEqual({
      timestamps: true,
      map: 'verification',
      schema: 'auth',
    })

    // The app's own domain User is untouched.
    expect(result.lists.User.fields).toHaveProperty('subjectId')
    expect(result.lists.User.fields).not.toHaveProperty('email')
  })
})

describe('adoptBetterAuthTables - composes with authPlugin', () => {
  it('spreads into authPlugin alongside the rest of the auth config', async () => {
    const result = await config({
      db: { provider: 'postgresql' },
      plugins: [
        authPlugin({
          ...adoptBetterAuthTables(),
          emailAndPassword: { enabled: true },
          sessionFields: ['userId', 'email', 'name'],
        }),
      ],
      lists: {},
    })

    // The recipe's derived Auth lists are present...
    expect(result.lists).toHaveProperty('AuthUser')
    expect(result.lists).toHaveProperty('AuthSession')
    expect(result.lists).toHaveProperty('AuthAccount')
    expect(result.lists).toHaveProperty('AuthVerification')
    // ...keyed off the recipe's model names, not the default `User`/`Session`.
    expect(result.lists).not.toHaveProperty('User')
    expect(result.lists).not.toHaveProperty('Session')

    // The rest of the auth config still applies (stored for runtime).
    const authData = result._pluginData?.auth as { emailAndPassword?: { enabled?: boolean } }
    expect(authData?.emailAndPassword?.enabled).toBe(true)
  })
})

describe('adoptBetterAuthTables - clean-diff adoption (Auth lists ≠ app User)', () => {
  it('lands every Auth list in the auth schema with @@map + @@schema and leaves the app User untouched', async () => {
    const result = await generationConfig({
      db: { provider: 'postgresql' },
      plugins: [
        authPlugin({
          ...adoptBetterAuthTables(),
          emailAndPassword: { enabled: true },
        }),
      ],
      // The migrating app keeps its own domain User (public.User), keyed by
      // its own subjectId — a DIFFERENT model from the better-auth user.
      lists: {
        User: list({
          fields: {
            subjectId: text({ validation: { isRequired: true } }),
          },
        }),
      },
    })

    // Each Auth list is pinned to its live table name (@@map) and the `auth`
    // schema (@@schema), with auto-timestamps preserved (ADR-0004) — exactly the
    // shape that diffs CLEAN against a live separate-schema better-auth install.
    expect(result.lists.AuthUser.db).toEqual({ timestamps: true, map: 'AuthUser', schema: 'auth' })
    expect(result.lists.AuthSession.db).toEqual({
      timestamps: true,
      map: 'AuthSession',
      schema: 'auth',
    })
    expect(result.lists.AuthAccount.db).toEqual({
      timestamps: true,
      map: 'AuthAccount',
      schema: 'auth',
    })
    expect(result.lists.AuthVerification.db).toEqual({
      timestamps: true,
      map: 'AuthVerification',
      schema: 'auth',
    })

    // The app's own domain User is preserved: its field shape is intact, NOT
    // merged with auth fields, and it stays in `public` (not the auth schema).
    const appUser = result.lists.User
    expect(appUser.fields).toHaveProperty('subjectId')
    expect(appUser.fields).not.toHaveProperty('email')
    expect(appUser.fields).not.toHaveProperty('emailVerified')
    expect(appUser.fields).not.toHaveProperty('sessions')
    expect(appUser.db?.schema).toBe('public')

    // The datasource lists both schemas so the multi-schema Prisma schema is valid.
    expect(result.db.schemas).toEqual(['public', 'auth'])
  })

  it('carries field column maps through to the derived Auth lists for renamed columns', async () => {
    const result = await config({
      db: { provider: 'postgresql' },
      plugins: [
        authPlugin({
          ...adoptBetterAuthTables({
            fields: {
              user: { name: 'full_name' },
              session: { userId: 'user_id' },
            },
          }),
        }),
      ],
      lists: {},
    })

    // Renamed columns flow through to the derived field-level @map / FK @map so
    // the lists match the live columns.
    expect(result.lists.AuthUser.fields.name.db?.map).toBe('full_name')
    expect(result.lists.AuthSession.fields.user.db?.foreignKey).toEqual({ map: 'user_id' })
  })
})

describe('adoptBetterAuthTables - rateLimit adoption (issue #909)', () => {
  it('omits rateLimit from the fragment by default', () => {
    const fragment = adoptBetterAuthTables()

    expect(fragment.rateLimit).toBeUndefined()
  })

  it('adds a prefixed, database-storage rateLimit fragment when opted in', () => {
    const fragment = adoptBetterAuthTables({ rateLimit: true })

    expect(fragment.rateLimit).toEqual({
      enabled: true,
      storage: 'database',
      modelName: 'AuthRateLimit',
    })
  })

  it('honours a custom schema/prefix on the rateLimit fragment like the other four models', () => {
    const fragment = adoptBetterAuthTables({
      rateLimit: true,
      schema: 'identity',
      modelNamePrefix: 'BA',
    })

    expect(fragment.rateLimit).toEqual({
      enabled: true,
      storage: 'database',
      modelName: 'BARateLimit',
    })
  })

  it('useBetterAuthTableNames sets the rateLimit tableName to the better-auth default', () => {
    const fragment = adoptBetterAuthTables({ rateLimit: true, useBetterAuthTableNames: true })

    expect(fragment.rateLimit).toEqual({
      enabled: true,
      storage: 'database',
      modelName: 'AuthRateLimit',
      tableName: 'rateLimit',
    })
  })

  it('merges a rateLimit field column map when provided', () => {
    const fragment = adoptBetterAuthTables({
      rateLimit: true,
      fields: { rateLimit: { key: 'limit_key' } },
    })

    expect(fragment.rateLimit).toEqual({
      enabled: true,
      storage: 'database',
      modelName: 'AuthRateLimit',
      fields: { key: 'limit_key' },
    })
  })

  it('composes with authPlugin to actually derive the fifth Auth list', async () => {
    const result = await generationConfig({
      db: { provider: 'postgresql' },
      plugins: [
        authPlugin({
          ...adoptBetterAuthTables({ rateLimit: true }),
          emailAndPassword: { enabled: true },
        }),
      ],
      lists: {},
    })

    expect(result.lists).toHaveProperty('AuthRateLimit')
    expect(result.lists.AuthRateLimit.db?.schema).toBe('auth')
  })
})
