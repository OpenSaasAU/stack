import { describe, it, expect } from 'vitest'
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import type { Plugin } from '@opensaas/stack-core/extend'
import { authPlugin } from '../src/config/plugin.js'

/**
 * Run a config through plugin `init` (via `config()`) and then the auth
 * plugin's `beforeGenerate` hook — mirroring the CLI generate pipeline — to
 * observe the final config the generator would consume.
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

describe('authPlugin - schema placement (greenfield default)', () => {
  it('places Auth lists in no schema and leaves the datasource untouched when no schema option is set', async () => {
    const result = await generationConfig({
      db: { provider: 'postgresql' },
      plugins: [authPlugin({})],
      lists: {},
    })

    // Default keys, no @@schema, no @@map. Auth lists still opt into
    // auto-timestamps (ADR-0004), so db carries only `timestamps: true`.
    expect(result.lists.User.db).toEqual({ timestamps: true })
    expect(result.lists.User.db?.schema).toBeUndefined()
    expect(result.lists.User.db?.map).toBeUndefined()
    expect(result.lists.Session.db?.schema).toBeUndefined()
    expect(result.lists.Account.db?.schema).toBeUndefined()
    expect(result.lists.Verification.db?.schema).toBeUndefined()

    // Datasource is NOT switched to multi-schema
    expect(result.db.schemas).toBeUndefined()
  })
})

describe('authPlugin - schema placement (adopt existing auth-schema install)', () => {
  it('places all Auth lists in the configured schema with @@schema + @@map and wires the datasource', async () => {
    const result = await generationConfig({
      db: { provider: 'postgresql' },
      plugins: [
        authPlugin({
          schema: 'auth',
          user: { modelName: 'AuthUser' },
          session: { modelName: 'AuthSession' },
          account: { modelName: 'AuthAccount' },
          verification: { modelName: 'AuthVerification' },
        }),
      ],
      // The app keeps its own domain User in the default schema
      lists: {
        User: list({
          fields: { subjectId: text({ validation: { isRequired: true } }) },
        }),
      },
    })

    // Auth lists land in the `auth` schema, pinned to their live table names.
    // Auto-timestamps stay enabled (ADR-0004) alongside the @@map + @@schema.
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

    // The app's own User is left in `public` (not extended/overwritten, not in `auth`)
    expect(result.lists.User.fields).toHaveProperty('subjectId')
    expect(result.lists.User.fields).not.toHaveProperty('email')
    expect(result.lists.User.db?.schema).toBe('public')

    // Datasource gains both schemas (public always included) so the multi-schema
    // Prisma schema is valid
    expect(result.db.schemas).toEqual(['public', 'auth'])
  })

  it('honours a per-list schema override on a single Auth list', async () => {
    const result = await generationConfig({
      db: { provider: 'postgresql' },
      plugins: [
        authPlugin({
          schema: 'auth',
          user: { modelName: 'AuthUser' },
          session: { modelName: 'AuthSession' },
          account: { modelName: 'AuthAccount' },
          // Override: verification lives in a different schema
          verification: { modelName: 'AuthVerification', schema: 'auth_internal' },
        }),
      ],
      lists: {},
    })

    expect(result.lists.AuthUser.db?.schema).toBe('auth')
    expect(result.lists.AuthVerification.db?.schema).toBe('auth_internal')

    // All used schemas are listed on the datasource (order: public, then discovered)
    expect(result.db.schemas).toContain('public')
    expect(result.db.schemas).toContain('auth')
    expect(result.db.schemas).toContain('auth_internal')
  })
})

describe('authPlugin - RateLimit list schema placement', () => {
  it('places the RateLimit list in the configured schema and wires the datasource', async () => {
    const result = await generationConfig({
      db: { provider: 'postgresql' },
      plugins: [
        authPlugin({
          schema: 'auth',
          rateLimit: { enabled: true, storage: 'database', modelName: 'AuthRateLimit' },
        }),
      ],
      lists: {},
    })

    expect(result.lists.AuthRateLimit.db).toEqual({ map: 'AuthRateLimit', schema: 'auth' })
    expect(result.db.schemas).toContain('auth')
  })

  it('honours a per-model schema override independent of the plugin-level schema', async () => {
    const result = await generationConfig({
      db: { provider: 'postgresql' },
      plugins: [
        authPlugin({
          schema: 'auth',
          rateLimit: {
            enabled: true,
            storage: 'database',
            modelName: 'AuthRateLimit',
            schema: 'auth_internal',
          },
        }),
      ],
      lists: {},
    })

    expect(result.lists.AuthRateLimit.db?.schema).toBe('auth_internal')
    expect(result.db.schemas).toContain('auth_internal')
  })
})
