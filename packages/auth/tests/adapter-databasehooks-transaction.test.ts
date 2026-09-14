// #1252: a `databaseHooks` hook's second argument is a `GenericEndpointContext`
// whose `.context` is the `AuthContext` — carrying `.adapter`, the ROOT
// adapter instance. better-auth never swaps that reference for the
// transaction-bound one; only its own AsyncLocalStorage
// (`runWithTransaction` -> `getCurrentAdapter`) does, and `databaseHooks`
// hooks read `context.context.adapter` instead of going through that. Before
// the fix, a hook that reached through `context.context.adapter` during
// sign-up queried the OUTER lane while the sign-up transaction held the
// database's only connection: on the Dev database (and this harness's own
// `max: 1` pool, which mirrors it) that request for a second connection can
// never be granted, so the hook — and sign-up with it — hung until the pool's
// own acquire timeout.
//
// Both tests below bound their own timeout well under the harness pool's
// `connectionTimeoutMillis` (10s), so a regression is reported as a timed-out
// test rather than a 10-second wait for the pool's own error.

import { afterAll, beforeAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { betterAuth, type Auth } from 'better-auth'
import { config as defineConfig } from '@opensaas/stack-core'
import { createTestDatabase, type TestDatabase } from '@opensaas/stack-core/testing'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { authPlugin } from '../src/config/plugin.js'
import { getAuthListRegistry } from '../src/lists/index.js'
import { opensaasAuthAdapter } from '../src/adapter/index.js'
import type { NormalizedAuthConfig } from '../src/config/types.js'

const BOOT = 120_000
const HANG_GUARD = 5_000

async function standUpConfig(): Promise<{
  opensaasConfig: OpenSaasConfig
  database: TestDatabase
  registry: Record<string, string>
}> {
  const opensaasConfig = await defineConfig({
    plugins: [authPlugin({ emailAndPassword: { enabled: true } })],
    db: { provider: 'postgresql' },
    lists: {},
  })
  const database = await createTestDatabase(opensaasConfig)
  const normalized = opensaasConfig._pluginData?.auth as NormalizedAuthConfig
  const registry = getAuthListRegistry(normalized.models, normalized.betterAuthPlugins)
  return { opensaasConfig, database, registry }
}

function tableOf(
  opensaasConfig: OpenSaasConfig,
  registry: Record<string, string>,
  model: string,
): { schema: string; table: string } {
  const listKey = registry[model]
  if (listKey === undefined) throw new Error(`no derived list for better-auth model "${model}"`)
  const listDb = opensaasConfig.lists[listKey]?.db
  return { schema: listDb?.schema ?? 'public', table: listDb?.map ?? listKey }
}

async function onDatabase<T>(url: string, body: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    return await body(client)
  } finally {
    await client.end()
  }
}

async function rowCount(
  database: TestDatabase,
  opensaasConfig: OpenSaasConfig,
  registry: Record<string, string>,
  model: string,
): Promise<number> {
  const { schema, table } = tableOf(opensaasConfig, registry, model)
  return await onDatabase(database.url, async (client) => {
    const result = await client.query<{ n: string }>(
      `select count(*) as n from "${schema}"."${table}"`,
    )
    return Number(result.rows[0]?.n ?? '0')
  })
}

let readDb: TestDatabase
let readConfig: OpenSaasConfig
let readRegistry: Record<string, string>
let readAuth: Auth
let hookRan = false
let hookFoundDuringCreate: unknown = 'not set'

beforeAll(async () => {
  const stood = await standUpConfig()
  readDb = stood.database
  readConfig = stood.opensaasConfig
  readRegistry = stood.registry

  const context = readDb.context()
  readAuth = betterAuth({
    baseURL: 'http://localhost:3000',
    secret: 'databasehooks-read-test-secret',
    emailAndPassword: { enabled: true },
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            hookRan = true
            if (context === null) throw new Error('no endpoint context reached the hook')
            // The read this issue is about: the adapter `AuthContext.adapter`
            // hands the hook, queried mid sign-up-transaction.
            hookFoundDuringCreate = await context.context.adapter.findOne({
              model: 'user',
              where: [{ field: 'email', value: (user as { email: string }).email }],
            })
            return { data: user }
          },
        },
      },
    },
    database: opensaasAuthAdapter({
      config: readConfig,
      unsafe: context.unsafe,
      registry: readRegistry,
      transaction: (body) => context.transaction((tx) => body(tx.unsafe)),
    }),
  }) as unknown as Auth
}, BOOT)

afterAll(async () => {
  await readDb?.close()
})

test(
  'a databaseHooks before hook reading through context.context.adapter does not hang sign-up',
  async () => {
    const email = `hook-read-${randomUUID()}@example.com`

    await expect(
      readAuth.api.signUpEmail({
        body: { email, password: randomUUID(), name: 'Hook Read' },
      }),
    ).resolves.toBeDefined()

    expect(hookRan).toBe(true)
    // The user row does not exist yet when `create.before` runs, so the read
    // resolving (rather than hanging) is what this test pins — not its value.
    expect(hookFoundDuringCreate).toBeNull()
  },
  HANG_GUARD,
)

let writeDb: TestDatabase
let writeConfig: OpenSaasConfig
let writeRegistry: Record<string, string>
let writeAuth: Auth

beforeAll(async () => {
  const stood = await standUpConfig()
  writeDb = stood.database
  writeConfig = stood.opensaasConfig
  writeRegistry = stood.registry

  const account = tableOf(writeConfig, writeRegistry, 'account')
  await onDatabase(writeDb.url, async (client) => {
    await client.query(
      `alter table "${account.schema}"."${account.table}" add constraint account_write_refused check (false)`,
    )
  })

  const context = writeDb.context()
  writeAuth = betterAuth({
    baseURL: 'http://localhost:3000',
    secret: 'databasehooks-write-test-secret',
    emailAndPassword: { enabled: true },
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            if (context === null) throw new Error('no endpoint context reached the hook')
            // A write through the same adapter reference, so its atomicity
            // with the rest of sign-up (which fails below) is on the line
            // too, not only whether the read above hangs.
            await context.context.adapter.create({
              model: 'verification',
              data: {
                identifier: `hook-write-${(user as { email: string }).email}`,
                value: 'probe',
                expiresAt: new Date(Date.now() + 60_000),
              },
            })
            return { data: user }
          },
        },
      },
    },
    database: opensaasAuthAdapter({
      config: writeConfig,
      unsafe: context.unsafe,
      registry: writeRegistry,
      transaction: (body) => context.transaction((tx) => body(tx.unsafe)),
    }),
  }) as unknown as Auth
}, BOOT)

afterAll(async () => {
  await writeDb?.close()
})

test(
  "a databaseHooks before hook's write through context.context.adapter is atomic with the rest of sign-up",
  async () => {
    await expect(
      writeAuth.api.signUpEmail({
        body: {
          email: `hook-write-${randomUUID()}@example.com`,
          password: randomUUID(),
          name: 'Hook Write',
        },
      }),
    ).rejects.toThrow()

    expect(await rowCount(writeDb, writeConfig, writeRegistry, 'verification')).toBe(0)
    expect(await rowCount(writeDb, writeConfig, writeRegistry, 'user')).toBe(0)
    expect(await rowCount(writeDb, writeConfig, writeRegistry, 'account')).toBe(0)
  },
  HANG_GUARD,
)
