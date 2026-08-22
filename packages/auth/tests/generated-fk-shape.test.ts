import { describe, it, expect } from 'vitest'
import { config, list } from '@opensaas/stack-core'
import { text, relationship } from '@opensaas/stack-core/fields'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import type { Plugin } from '@opensaas/stack-core/extend'
import { mcp } from '@better-auth/mcp'
import { generatePrismaSchema } from '@opensaas/stack-cli/generator/prisma'
import { authPlugin } from '../src/config/plugin.js'
import { adoptBetterAuthTables } from '../src/config/adopt-better-auth-tables.js'

/**
 * Resolve a config through plugin `init` (via `config()`) and each plugin's
 * `beforeGenerate` hook — the same sequence the CLI generate pipeline runs —
 * then hand the result to the Prisma generator. Unlike the config-level
 * assertions in `derive-auth-lists.test.ts` and `plugin-schema-placement.test.ts`,
 * this exercises the *assembled generated schema text* so the auth FK shape is
 * locked end-to-end (issue #753).
 */
async function generateSchema(userConfig: OpenSaasConfig): Promise<string> {
  let current = await config(userConfig)
  const plugins: Plugin[] = current.plugins ?? []
  for (const plugin of plugins) {
    if (plugin.beforeGenerate) {
      current = await plugin.beforeGenerate(current)
    }
  }
  return generatePrismaSchema(current)
}

/** Slice out a single `model X { ... }` block from generated schema text. */
function modelBlock(schema: string, modelName: string): string {
  const start = schema.indexOf(`model ${modelName} {`)
  if (start === -1) throw new Error(`model ${modelName} not found in generated schema`)
  const end = schema.indexOf('\n}', start)
  return schema.slice(start, end === -1 ? undefined : end + 2)
}

describe('generated auth schema — Session/Account/Verification mirror better-auth (issue #679/#753/#937)', () => {
  it('emits onDelete: Cascade, a userId @map, and @@index([userId]) on Session.user and Account.user', async () => {
    const schema = await generateSchema({
      db: { provider: 'sqlite' },
      plugins: [authPlugin({ emailAndPassword: { enabled: true } })],
      lists: {},
    })

    for (const model of ['Session', 'Account']) {
      const block = modelBlock(schema, model)

      // (a) The user relation carries the cascade referential action. Match on
      // the whitespace-stable attribute substring rather than the padded line,
      // since raw generator output and prisma-formatted output differ only in
      // column alignment.
      expect(block).toContain('@relation(onDelete: Cascade, fields: [userId], references: [id])')

      // (b) The FK column maps to better-auth's own `userId` column name,
      // not the generator's Keystone-parity default of the field name
      // (`user`) — see issue #935.
      expect(block).toContain('@map("userId")')

      // (c) The FK index is emitted, matching better-auth's own
      // `session_userId_idx` / `account_userId_idx` — see issue #937 and
      // ADR-0007. It is never emitted against the wrong field name.
      expect(block).toContain('@@index([userId])')
      expect(block).not.toContain('@@index([user])')
    }
  })

  it('emits @@index([identifier]) on Verification', async () => {
    const schema = await generateSchema({
      db: { provider: 'sqlite' },
      plugins: [authPlugin({ emailAndPassword: { enabled: true } })],
      lists: {},
    })

    const block = modelBlock(schema, 'Verification')
    expect(block).toContain('@@index([identifier])')
  })

  it('still emits the default @@index for a non-auth relationship FK', async () => {
    // Contrast case: the generic FK-index path is untouched by the
    // auth-specific FK/index shape above.
    const schema = await generateSchema({
      db: { provider: 'sqlite' },
      plugins: [authPlugin({ emailAndPassword: { enabled: true } })],
      lists: {
        Widget: list({
          fields: {
            title: text({ validation: { isRequired: true } }),
            owner: relationship({ ref: 'User' }),
          },
        }),
      },
    })

    const widget = modelBlock(schema, 'Widget')
    expect(widget).toContain('@@index([ownerId])')
  })
})

describe('generated auth schema — account.issuer (better-auth 1.7, issue #986)', () => {
  it('emits a required, non-nullable issuer column on Account, positioned after providerId', async () => {
    const schema = await generateSchema({
      db: { provider: 'sqlite' },
      plugins: [authPlugin({ emailAndPassword: { enabled: true } })],
      lists: {},
    })

    const block = modelBlock(schema, 'Account')
    expect(block).toMatch(/issuer\s+String\s/)
    expect(block).not.toMatch(/issuer\s+String\?/)

    // FIELD_ORDER groups issuer with accountId/providerId — the fields that
    // together form better-auth's table-level @@unique([issuer, accountId]),
    // which this derivation does not yet emit (blocked on #985's table-level
    // db.indexes derivation).
    const providerIdLine = block.indexOf('providerId')
    const issuerLine = block.indexOf('issuer')
    expect(providerIdLine).toBeGreaterThan(-1)
    expect(issuerLine).toBeGreaterThan(providerIdLine)

    // Not yet emitted — see the migration note in the auth package's
    // CHANGELOG and issue #985.
    expect(block).not.toContain('@@unique([issuer, accountId])')
  })
})

describe('generated auth schema — adopted index names match better-auth exactly (issue #937)', () => {
  it('derives session_userId_idx / account_userId_idx / verification_identifier_idx under adoptBetterAuthTables()', async () => {
    const schema = await generateSchema({
      db: { provider: 'postgresql' },
      plugins: [
        authPlugin({
          ...adoptBetterAuthTables({ useBetterAuthTableNames: true }),
          emailAndPassword: { enabled: true },
        }),
      ],
      lists: {},
    })

    // No explicit `map:` is set on these auto FK/scalar indexes — Prisma's own
    // implicit naming convention (<mapped table>_<mapped column>_idx) is what
    // has to line up with better-auth's migrator-assigned names, so assert
    // against the raw @@index lines rather than a `map:` argument.
    const session = modelBlock(schema, 'AuthSession')
    expect(session).toContain('@@map("session")')
    expect(session).toContain('@@index([userId])')

    const account = modelBlock(schema, 'AuthAccount')
    expect(account).toContain('@@map("account")')
    expect(account).toContain('@@index([userId])')

    const verification = modelBlock(schema, 'AuthVerification')
    expect(verification).toContain('@@map("verification")')
    expect(verification).toContain('@@index([identifier])')
  })

  it('still indexes all three columns under the default adoptBetterAuthTables() (Auth-prefixed physical tables)', async () => {
    // Without useBetterAuthTableNames, the physical table stays the prefixed
    // model name (@@map("AuthSession"), not better-auth's own lowercase
    // "session") — the index name won't match better-auth's naming
    // convention here, but the columns must still be indexed regardless of
    // table naming.
    const schema = await generateSchema({
      db: { provider: 'postgresql' },
      plugins: [
        authPlugin({
          ...adoptBetterAuthTables(),
          emailAndPassword: { enabled: true },
        }),
      ],
      lists: {},
    })

    for (const model of ['AuthSession', 'AuthAccount']) {
      const block = modelBlock(schema, model)
      expect(block).toContain(`@@map("${model}")`)
      expect(block).toContain('@@index([userId])')
    }

    const verification = modelBlock(schema, 'AuthVerification')
    expect(verification).toContain('@@index([identifier])')
  })
})

describe('generated auth schema — required columns mirror better-auth (issue #863)', () => {
  it('emits a required (non-nullable) userId FK and user relation on Session and Account', async () => {
    const schema = await generateSchema({
      db: { provider: 'sqlite' },
      plugins: [authPlugin({ emailAndPassword: { enabled: true } })],
      lists: {},
    })

    for (const model of ['Session', 'Account']) {
      const block = modelBlock(schema, model)

      expect(block).toMatch(/userId\s+String\s/)
      expect(block).not.toMatch(/userId\s+String\?/)
      expect(block).toMatch(/user\s+User\s+@relation/)
      expect(block).not.toMatch(/user\s+User\?/)

      // The physical column must be userId, not the Keystone-parity default
      // of the relationship field name ("user") — issue #935.
      expect(block).not.toContain('@map("user")')
    }
  })

  it('emits a required (non-nullable) expiresAt on Session and Verification', async () => {
    const schema = await generateSchema({
      db: { provider: 'sqlite' },
      plugins: [authPlugin({ emailAndPassword: { enabled: true } })],
      lists: {},
    })

    for (const model of ['Session', 'Verification']) {
      const block = modelBlock(schema, model)

      expect(block).toMatch(/expiresAt\s+DateTime\s/)
      expect(block).not.toMatch(/expiresAt\s+DateTime\?/)
    }
  })
})

describe('generated auth schema — tableName independent of modelName (issue #862)', () => {
  it('emits a prefixed model name with a @@map to a better-auth default lowercase table', async () => {
    const schema = await generateSchema({
      db: { provider: 'postgresql' },
      plugins: [
        authPlugin({
          user: { modelName: 'AuthUser', tableName: 'user' },
          session: { modelName: 'AuthSession', tableName: 'session' },
          account: { modelName: 'AuthAccount', tableName: 'account' },
          verification: { modelName: 'AuthVerification', tableName: 'verification' },
          emailAndPassword: { enabled: true },
        }),
      ],
      lists: {},
    })

    for (const [model, table] of [
      ['AuthUser', 'user'],
      ['AuthSession', 'session'],
      ['AuthAccount', 'account'],
      ['AuthVerification', 'verification'],
    ]) {
      const block = modelBlock(schema, model)
      // The generated model keeps the prefixed name but maps to the live
      // lowercase table — no DROP/CREATE rename against a real better-auth
      // install using its own default table names.
      expect(block).toContain(`@@map("${table}")`)
    }
  })
})

describe('generated MCP plugin OAuth schema gets real foreign keys and cascades (issue #992)', () => {
  it('emits onDelete: Cascade, a userId @map, and @@index([userId]) on every OAuth table’s user relation', async () => {
    const schema = await generateSchema({
      db: { provider: 'sqlite' },
      plugins: [
        authPlugin({
          emailAndPassword: { enabled: true },
          betterAuthPlugins: [mcp({ loginPage: '/sign-in', resource: 'https://example.com/mcp' })],
        }),
      ],
      lists: {},
    })

    for (const model of ['OauthClient', 'OauthAccessToken', 'OauthConsent']) {
      const block = modelBlock(schema, model)
      expect(block).toContain('@relation(onDelete: Cascade, fields: [userId], references: [id])')
      expect(block).toContain('@map("userId")')
      expect(block).toContain('@@index([userId])')
    }
  })

  it('maps each OAuth table to its camelCase physical table name via @@map', async () => {
    const schema = await generateSchema({
      db: { provider: 'sqlite' },
      plugins: [
        authPlugin({
          emailAndPassword: { enabled: true },
          betterAuthPlugins: [mcp({ loginPage: '/sign-in', resource: 'https://example.com/mcp' })],
        }),
      ],
      lists: {},
    })

    expect(modelBlock(schema, 'OauthClient')).toContain('@@map("oauthClient")')
    expect(modelBlock(schema, 'OauthAccessToken')).toContain('@@map("oauthAccessToken")')
    expect(modelBlock(schema, 'OauthConsent')).toContain('@@map("oauthConsent")')
  })

  it('leaves the non-PK clientId reference (oauthAccessToken/oauthConsent -> oauthClient.clientId) as an indexed plain column, not a relation', async () => {
    const schema = await generateSchema({
      db: { provider: 'sqlite' },
      plugins: [
        authPlugin({
          emailAndPassword: { enabled: true },
          betterAuthPlugins: [mcp({ loginPage: '/sign-in', resource: 'https://example.com/mcp' })],
        }),
      ],
      lists: {},
    })

    for (const model of ['OauthAccessToken', 'OauthConsent']) {
      const block = modelBlock(schema, model)
      expect(block).toMatch(/clientId\s+String\s/)
      expect(block).not.toContain('clientId  OauthClient')
      expect(block).toContain('@@index([clientId])')
    }
  })

  it('adds a reverse collection on User for every OAuth table referencing it, and on Session for the two token tables that also reference it, leaving Account/Verification unchanged', async () => {
    const withMcp = await generateSchema({
      db: { provider: 'sqlite' },
      plugins: [
        authPlugin({
          emailAndPassword: { enabled: true },
          betterAuthPlugins: [mcp({ loginPage: '/sign-in', resource: 'https://example.com/mcp' })],
        }),
      ],
      lists: {},
    })
    const withoutMcp = await generateSchema({
      db: { provider: 'sqlite' },
      plugins: [authPlugin({ emailAndPassword: { enabled: true } })],
      lists: {},
    })

    const user = modelBlock(withMcp, 'User')
    expect(user).toContain('oauthClients')
    expect(user).toContain('oauthAccessTokens')
    expect(user).toContain('oauthRefreshTokens')
    expect(user).toContain('oauthConsents')

    // oauthAccessToken.sessionId / oauthRefreshToken.sessionId both reference
    // session.id (unlike better-auth's pre-1.7 MCP schema, which had no
    // session-scoped OAuth tables at all) — Session gains reverse collections
    // for both, Account/Verification stay untouched by the MCP plugin.
    const session = modelBlock(withMcp, 'Session')
    expect(session).toContain('oauthAccessTokens')
    expect(session).toContain('oauthRefreshTokens')

    for (const model of ['Account', 'Verification']) {
      expect(modelBlock(withMcp, model)).toBe(modelBlock(withoutMcp, model))
    }
  })

  it('generates a required, non-nullable userId FK on OauthRefreshToken (required upstream), and an optional one on OauthClient (optional upstream)', async () => {
    const schema = await generateSchema({
      db: { provider: 'sqlite' },
      plugins: [
        authPlugin({
          emailAndPassword: { enabled: true },
          betterAuthPlugins: [mcp({ loginPage: '/sign-in', resource: 'https://example.com/mcp' })],
        }),
      ],
      lists: {},
    })

    const refreshToken = modelBlock(schema, 'OauthRefreshToken')
    expect(refreshToken).toMatch(/userId\s+String\s/)
    expect(refreshToken).not.toMatch(/userId\s+String\?/)

    const client = modelBlock(schema, 'OauthClient')
    expect(client).toMatch(/userId\s+String\?/)
  })
})

describe('generated RateLimit schema mirrors better-auth exactly (issue #909)', () => {
  it('does not add a RateLimit model when storage is unset', async () => {
    const schema = await generateSchema({
      db: { provider: 'sqlite' },
      plugins: [authPlugin({ emailAndPassword: { enabled: true } })],
      lists: {},
    })

    expect(schema).not.toContain('model RateLimit')
  })

  it('emits key (unique, non-null), count (non-null Int), lastRequest (non-null BigInt), no createdAt/updatedAt, no @default', async () => {
    const schema = await generateSchema({
      db: { provider: 'sqlite' },
      plugins: [
        authPlugin({
          emailAndPassword: { enabled: true },
          rateLimit: { enabled: true, storage: 'database' },
        }),
      ],
      lists: {},
    })

    const block = modelBlock(schema, 'RateLimit')

    expect(block).toMatch(/key\s+String\s+@unique/)
    expect(block).toMatch(/count\s+Int\s/)
    expect(block).not.toMatch(/count\s+Int\?/)
    expect(block).toMatch(/lastRequest\s+BigInt\s/)
    expect(block).not.toMatch(/lastRequest\s+BigInt\?/)

    expect(block).not.toContain('createdAt')
    expect(block).not.toContain('updatedAt')
    // The system `id` field carries its own @default(cuid()) — only the
    // three better-auth-mirrored columns must carry none.
    expect(block).not.toMatch(/key\s+String\s+@unique\s+@default/)
    expect(block).not.toMatch(/count\s+Int\s+@default/)
    expect(block).not.toMatch(/lastRequest\s+BigInt\s+@default/)
  })

  it('honours a custom modelName/tableName/fields/schema on the rateLimit model', async () => {
    const schema = await generateSchema({
      db: { provider: 'postgresql' },
      plugins: [
        authPlugin({
          emailAndPassword: { enabled: true },
          rateLimit: {
            enabled: true,
            storage: 'database',
            modelName: 'AuthRateLimit',
            tableName: 'rate_limit',
            fields: { key: 'limit_key', count: 'hit_count', lastRequest: 'last_hit_at' },
          },
        }),
      ],
      lists: {},
    })

    const block = modelBlock(schema, 'AuthRateLimit')
    expect(block).toContain('@@map("rate_limit")')
    expect(block).toContain('@map("limit_key")')
    expect(block).toContain('@map("hit_count")')
    expect(block).toContain('@map("last_hit_at")')
  })

  it('produces a RateLimit model even when enabled is false, since better-auth still expects the table', async () => {
    const schema = await generateSchema({
      db: { provider: 'sqlite' },
      plugins: [
        authPlugin({
          emailAndPassword: { enabled: true },
          rateLimit: { enabled: false, storage: 'database' },
        }),
      ],
      lists: {},
    })

    expect(schema).toContain('model RateLimit')
  })
})
