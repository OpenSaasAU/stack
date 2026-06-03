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
