import { describe, it, expect } from 'vitest'
import { config, deriveContract, list } from '@opensaas/stack-core'
import { text, relationship } from '@opensaas/stack-core/fields'
import type {
  ContractColumn,
  ContractData,
  ContractModel,
  OpenSaasConfig,
} from '@opensaas/stack-core'
import type { Plugin } from '@opensaas/stack-core/extend'
import { mcp } from '@better-auth/mcp'
import { authPlugin } from '../src/config/plugin.js'
import { adoptBetterAuthTables } from '../src/config/adopt-better-auth-tables.js'

/**
 * Resolve a config through plugin `init` (via `config()`) and each plugin's
 * `beforeGenerate` hook — the same sequence the CLI generate pipeline runs —
 * then derive the contract. Unlike the config-level assertions in
 * `derive-auth-lists.test.ts` and `plugin-schema-placement.test.ts`, this
 * exercises the *derived contract* so the auth FK shape is locked end-to-end
 * (issue #753) against the artifact the runtime actually executes.
 */
async function deriveAuthContract(userConfig: OpenSaasConfig): Promise<ContractData> {
  let current = await config(userConfig)
  const plugins: Plugin[] = current.plugins ?? []
  for (const plugin of plugins) {
    if (plugin.beforeGenerate) {
      current = await plugin.beforeGenerate(current)
    }
  }
  return deriveContract(current)
}

function model(data: ContractData, name: string): ContractModel {
  const found = data.models.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`model ${name} not found in the derived contract`)
  return found
}

function column(data: ContractData, modelName: string, columnName: string): ContractColumn {
  const found = model(data, modelName).columns.find((candidate) => candidate.name === columnName)
  if (!found) throw new Error(`column ${modelName}.${columnName} not found`)
  return found
}

function relation(data: ContractData, modelName: string, relationName: string) {
  const found = model(data, modelName).relations.find(
    (candidate) => candidate.name === relationName,
  )
  if (!found) throw new Error(`relation ${modelName}.${relationName} not found`)
  return found
}

const emailAndPassword = { emailAndPassword: { enabled: true } } as const

describe('derived auth contract — Session/Account/Verification mirror better-auth (issue #679/#753/#937)', () => {
  it('gives Session.user and Account.user a cascading foreign key on a userId column, indexed', async () => {
    const data = await deriveAuthContract({
      db: { provider: 'postgresql' },
      plugins: [authPlugin(emailAndPassword)],
      lists: {},
    })

    for (const modelName of ['Session', 'Account']) {
      // (a) A real foreign key with the cascade, not a bare relation.
      expect(model(data, modelName).foreignKeys).toEqual([
        { column: 'userId', references: { model: 'User', column: 'id' }, onDelete: 'cascade' },
      ])

      // (b) The column is better-auth's own `userId`, not the generator's
      // Keystone-parity default of the field name (`user`) — see issue #935.
      expect(column(data, modelName, 'userId').name).toBe('userId')
      expect(column(data, modelName, 'userId').map).toBeUndefined()

      // (c) The FK column is indexed, matching better-auth's own schema.
      expect(column(data, modelName, 'userId').index).toBe(true)

      expect(relation(data, modelName, 'user')).toMatchObject({
        target: 'User',
        kind: 'belongsTo',
        column: 'userId',
      })
    }
  })

  it('indexes Verification.identifier', async () => {
    const data = await deriveAuthContract({
      db: { provider: 'postgresql' },
      plugins: [authPlugin(emailAndPassword)],
      lists: {},
    })

    expect(column(data, 'Verification', 'identifier').index).toBe(true)
  })

  it('still indexes a non-auth relationship FK by default', async () => {
    const data = await deriveAuthContract({
      db: { provider: 'postgresql' },
      plugins: [authPlugin(emailAndPassword)],
      lists: {
        Widget: list({ fields: { name: text(), owner: relationship({ ref: 'User' }) } }),
      },
    })

    expect(column(data, 'Widget', 'ownerId').index).toBe(true)
  })
})

describe('derived auth contract — account.issuer (better-auth 1.7, issue #986)', () => {
  it('carries a required issuer column on Account, positioned after providerId', async () => {
    const data = await deriveAuthContract({
      db: { provider: 'postgresql' },
      plugins: [authPlugin(emailAndPassword)],
      lists: {},
    })

    const columns = model(data, 'Account').columns.map((candidate) => candidate.name)
    expect(columns).toContain('issuer')
    expect(columns.indexOf('issuer')).toBe(columns.indexOf('providerId') + 1)
    expect(column(data, 'Account', 'issuer').nullable).toBe(false)
  })
})

describe('derived auth contract — adopted table names (issue #937)', () => {
  it('maps every auth model to its Auth-prefixed table under adoptBetterAuthTables()', async () => {
    const data = await deriveAuthContract({
      db: { provider: 'postgresql' },
      plugins: [authPlugin({ ...emailAndPassword, ...adoptBetterAuthTables() })],
      lists: {},
    })

    for (const modelName of ['AuthUser', 'AuthSession', 'AuthAccount', 'AuthVerification']) {
      expect(model(data, modelName).table).toBe(modelName)
    }
  })

  it('still indexes all three columns under adoptBetterAuthTables()', async () => {
    const data = await deriveAuthContract({
      db: { provider: 'postgresql' },
      plugins: [authPlugin({ ...emailAndPassword, ...adoptBetterAuthTables() })],
      lists: {},
    })

    expect(column(data, 'AuthSession', 'userId').index).toBe(true)
    expect(column(data, 'AuthAccount', 'userId').index).toBe(true)
    expect(column(data, 'AuthVerification', 'identifier').index).toBe(true)
  })
})

describe('derived auth contract — required columns mirror better-auth (issue #863)', () => {
  it('makes the userId foreign key non-nullable on Session and Account', async () => {
    const data = await deriveAuthContract({
      db: { provider: 'postgresql' },
      plugins: [authPlugin(emailAndPassword)],
      lists: {},
    })

    expect(column(data, 'Session', 'userId').nullable).toBe(false)
    expect(column(data, 'Account', 'userId').nullable).toBe(false)
  })

  it('makes expiresAt non-nullable on Session and Verification', async () => {
    const data = await deriveAuthContract({
      db: { provider: 'postgresql' },
      plugins: [authPlugin(emailAndPassword)],
      lists: {},
    })

    expect(column(data, 'Session', 'expiresAt').nullable).toBe(false)
    expect(column(data, 'Verification', 'expiresAt').nullable).toBe(false)
  })
})

describe('derived auth contract — table name independent of model name (issue #862)', () => {
  it('keeps the prefixed model name while mapping to a lowercase table', async () => {
    const data = await deriveAuthContract({
      db: { provider: 'postgresql' },
      plugins: [
        authPlugin({
          ...emailAndPassword,
          user: { modelName: 'AuthUser', tableName: 'user' },
        }),
      ],
      lists: {},
    })

    expect(model(data, 'AuthUser').table).toBe('user')
  })
})

describe('derived MCP plugin OAuth contract gets real foreign keys and cascades (issue #992)', () => {
  const withMcp: OpenSaasConfig = {
    db: { provider: 'postgresql' },
    plugins: [
      authPlugin({
        ...emailAndPassword,
        betterAuthPlugins: [
          mcp({
            loginPage: '/sign-in',
            consentPage: '/consent',
            resource: 'https://example.com/mcp',
          }),
        ],
      }),
    ],
    lists: {},
  }

  it('cascades every OAuth table’s user foreign key from an indexed userId column', async () => {
    const data = await deriveAuthContract(withMcp)

    for (const modelName of ['OauthClient', 'OauthAccessToken', 'OauthConsent']) {
      expect(model(data, modelName).foreignKeys).toContainEqual({
        column: 'userId',
        references: { model: 'User', column: 'id' },
        onDelete: 'cascade',
      })
      expect(column(data, modelName, 'userId').index).toBe(true)
    }
  })

  it('maps each OAuth model to its camelCase physical table', async () => {
    const data = await deriveAuthContract(withMcp)

    expect(model(data, 'OauthClient').table).toBe('oauthClient')
    expect(model(data, 'OauthAccessToken').table).toBe('oauthAccessToken')
    expect(model(data, 'OauthConsent').table).toBe('oauthConsent')
    expect(model(data, 'OauthRefreshToken').table).toBe('oauthRefreshToken')
  })

  it('leaves the non-PK clientId reference an indexed plain column, not a relation', async () => {
    const data = await deriveAuthContract(withMcp)

    for (const modelName of ['OauthAccessToken', 'OauthConsent']) {
      expect(column(data, modelName, 'clientId').index).toBe(true)
      expect(model(data, modelName).relations.map((each) => each.name)).not.toContain('client')
      expect(model(data, modelName).foreignKeys.map((each) => each.column)).not.toContain(
        'clientId',
      )
    }
  })

  it('adds a reverse collection on User for every OAuth table referencing it, and on Session for the two token tables', async () => {
    const data = await deriveAuthContract(withMcp)

    const userRelations = model(data, 'User').relations.map((each) => each.name)
    expect(userRelations).toEqual(
      expect.arrayContaining([
        'oauthClients',
        'oauthRefreshTokens',
        'oauthAccessTokens',
        'oauthConsents',
      ]),
    )

    const sessionRelations = model(data, 'Session').relations.map((each) => each.name)
    expect(sessionRelations).toEqual(
      expect.arrayContaining(['oauthRefreshTokens', 'oauthAccessTokens']),
    )

    // Account and Verification are untouched by the MCP plugin.
    expect(model(data, 'Account').relations.map((each) => each.name)).toEqual(['user'])
    expect(model(data, 'Verification').relations).toEqual([])
  })

  it('honours each OAuth table’s own nullability for the user foreign key', async () => {
    const data = await deriveAuthContract(withMcp)

    // Required upstream on the refresh token; optional on the client.
    expect(column(data, 'OauthRefreshToken', 'userId').nullable).toBe(false)
    expect(column(data, 'OauthClient', 'userId').nullable).toBe(true)
  })

  it('sets the session foreign key to SET NULL, not cascade', async () => {
    const data = await deriveAuthContract(withMcp)

    expect(model(data, 'OauthAccessToken').foreignKeys).toContainEqual({
      column: 'sessionId',
      references: { model: 'Session', column: 'id' },
      onDelete: 'setNull',
    })
  })
})

describe('derived RateLimit contract mirrors better-auth exactly (issue #909)', () => {
  it('does not add a RateLimit model when storage is unset', async () => {
    const data = await deriveAuthContract({
      db: { provider: 'postgresql' },
      plugins: [authPlugin(emailAndPassword)],
      lists: {},
    })

    expect(data.models.map((each) => each.name)).not.toContain('RateLimit')
  })

  it('emits key (unique, non-null), count (int), lastRequest (bigint) and no timestamps', async () => {
    const data = await deriveAuthContract({
      db: { provider: 'postgresql' },
      plugins: [authPlugin({ ...emailAndPassword, rateLimit: { storage: 'database' } })],
      lists: {},
    })

    const rateLimit = model(data, 'RateLimit')
    expect(rateLimit.columns).toEqual([
      { name: 'key', type: { pack: 'pg', type: 'text' }, nullable: false, unique: true },
      { name: 'count', type: { pack: 'pg', type: 'int' }, nullable: false },
      { name: 'lastRequest', type: { pack: 'pg', type: 'bigint' }, nullable: false },
    ])
    expect(rateLimit.timestamps).toEqual({ createdAt: false, updatedAt: false })
  })

  it('honours a custom modelName and tableName on the rateLimit model', async () => {
    const data = await deriveAuthContract({
      db: { provider: 'postgresql' },
      plugins: [
        authPlugin({
          ...emailAndPassword,
          rateLimit: {
            storage: 'database',
            modelName: 'ApiThrottle',
            tableName: 'api_throttle',
          },
        }),
      ],
      lists: {},
    })

    expect(model(data, 'ApiThrottle').table).toBe('api_throttle')
  })

  it('produces a RateLimit model even when enabled is false, since better-auth still expects the table', async () => {
    const data = await deriveAuthContract({
      db: { provider: 'postgresql' },
      plugins: [
        authPlugin({
          ...emailAndPassword,
          rateLimit: { storage: 'database', enabled: false },
        }),
      ],
      lists: {},
    })

    expect(data.models.map((each) => each.name)).toContain('RateLimit')
  })
})

describe('app-supplied db.indexes on derived auth lists (issue #985)', () => {
  it('emits a composite index on Verification and suppresses the derived single-column one', async () => {
    const data = await deriveAuthContract({
      db: { provider: 'postgresql' },
      plugins: [
        authPlugin({
          ...emailAndPassword,
          verification: { indexes: [{ fields: ['identifier', 'value'] }] },
        }),
      ],
      lists: {},
    })

    expect(model(data, 'Verification').indexes).toEqual([
      { columns: ['identifier', 'value'], unique: false },
    ])
    // The derived single-column index on identifier is suppressed — only the
    // composite survives (ADR-0035).
    expect(column(data, 'Verification', 'identifier').index).toBeFalsy()
  })

  it('adopts a live named unique constraint on User.email, clearing the derived column unique', async () => {
    const data = await deriveAuthContract({
      db: { provider: 'postgresql' },
      plugins: [
        authPlugin({
          ...emailAndPassword,
          user: { indexes: [{ fields: ['email'], unique: true, name: 'user_email_key' }] },
        }),
      ],
      lists: {},
    })

    expect(model(data, 'User').indexes).toEqual([
      { columns: ['email'], unique: true, name: 'user_email_key' },
    ])
    expect(column(data, 'User', 'email').unique).toBeFalsy()
  })

  it('suppresses per-column only — every other derived index still emits', async () => {
    const data = await deriveAuthContract({
      db: { provider: 'postgresql' },
      plugins: [
        authPlugin({
          ...emailAndPassword,
          user: { indexes: [{ fields: ['email'], unique: true, name: 'user_email_key' }] },
        }),
      ],
      lists: {},
    })

    // Session/Account's derived FK index on the User relation is untouched —
    // suppression only ever applies to the column(s) an app entry names.
    expect(column(data, 'Session', 'userId').index).toBe(true)
    expect(column(data, 'Account', 'userId').index).toBe(true)
  })

  it('suppresses the derived FK index on a relationship field, not just scalars', async () => {
    // A relationship field's own generator defaults its FK index to indexed
    // whenever isIndexed is *omitted* (unlike a scalar field) — suppression
    // must set isIndexed: false explicitly, or the derived index survives and
    // collides with the app's own named entry.
    const data = await deriveAuthContract({
      db: { provider: 'postgresql' },
      plugins: [
        authPlugin({
          ...emailAndPassword,
          session: { indexes: [{ fields: ['user'], name: 'session_user_idx' }] },
        }),
      ],
      lists: {},
    })

    expect(model(data, 'Session').indexes).toEqual([
      { columns: ['userId'], unique: false, name: 'session_user_idx' },
    ])
    expect(column(data, 'Session', 'userId').index).toBeFalsy()
  })

  it("resolves the entry's field key through the model's own column map", async () => {
    const data = await deriveAuthContract({
      db: { provider: 'postgresql' },
      plugins: [
        authPlugin({
          ...emailAndPassword,
          verification: {
            fields: { identifier: 'ident_col' },
            indexes: [{ fields: ['identifier'] }],
          },
        }),
      ],
      lists: {},
    })

    // db.indexes names the OpenSaaS field key; the column carries its own map.
    expect(column(data, 'Verification', 'identifier').map).toBe('ident_col')
    expect(model(data, 'Verification').indexes).toEqual([
      { columns: ['identifier'], unique: false },
    ])
  })

  it('#921: user.email and session.token both round-trip under adopted constraint names', async () => {
    const data = await deriveAuthContract({
      db: { provider: 'postgresql' },
      plugins: [
        authPlugin({
          ...emailAndPassword,
          user: { indexes: [{ fields: ['email'], unique: true, name: 'user_email_key' }] },
          session: { indexes: [{ fields: ['token'], unique: true, name: 'session_token_key' }] },
        }),
      ],
      lists: {},
    })

    expect(model(data, 'User').indexes).toEqual([
      { columns: ['email'], unique: true, name: 'user_email_key' },
    ])
    expect(column(data, 'User', 'email').unique).toBeFalsy()

    expect(model(data, 'Session').indexes).toEqual([
      { columns: ['token'], unique: true, name: 'session_token_key' },
    ])
    expect(column(data, 'Session', 'token').unique).toBeFalsy()
  })

  it('fails generation naming the model, the entry, and the bad field for an unknown field', async () => {
    await expect(
      deriveAuthContract({
        db: { provider: 'postgresql' },
        plugins: [
          authPlugin({
            ...emailAndPassword,
            verification: { indexes: [{ fields: ['doesNotExist'] }] },
          }),
        ],
        lists: {},
      }),
    ).rejects.toThrow(/Verification.*references unknown field "doesNotExist"/)
  })

  it('names the remapped list key when modelName overrides the derived key', async () => {
    await expect(
      deriveAuthContract({
        db: { provider: 'postgresql' },
        plugins: [
          authPlugin({
            ...emailAndPassword,
            verification: {
              modelName: 'AuthVerification',
              indexes: [{ fields: ['doesNotExist'] }],
            },
          }),
        ],
        lists: {},
      }),
    ).rejects.toThrow(/AuthVerification.*references unknown field "doesNotExist"/)
  })

  it('leaves auth-list derivation unchanged when no indexes are configured', async () => {
    const data = await deriveAuthContract({
      db: { provider: 'postgresql' },
      plugins: [authPlugin(emailAndPassword)],
      lists: {},
    })

    for (const modelName of ['User', 'Session', 'Account', 'Verification']) {
      expect(model(data, modelName).indexes).toEqual([])
    }
  })
})
