// Sign-up writes user, account and session; a failure part-way through must
// leave none of them (ADR-0060). better-auth brackets those writes in
// `adapter.transaction`, so this runs a real `signUpEmail` against a real
// better-auth instance over the Auth adapter and makes the account INSERT fail
// at the database.
//
// The failure is a CHECK constraint added after the schema is applied, rather
// than a stubbed adapter method: better-auth reaches the transaction-bound
// adapter through its own AsyncLocalStorage, so an override on the outer
// adapter is not what the account write would call. This pins the mechanism —
// with the factory's transaction option off, the user row survives the
// rejected account write and the assertion below fails.

import { afterAll, beforeAll, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { betterAuth } from 'better-auth'
import { config as defineConfig } from '@opensaas/stack-core'
import { createTestDatabase, type TestDatabase } from '@opensaas/stack-core/testing'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { authPlugin } from '../src/config/plugin.js'
import { getAuthListRegistry } from '../src/lists/index.js'
import { opensaasAuthAdapter } from '../src/adapter/index.js'
import type { NormalizedAuthConfig } from '../src/config/types.js'

const BOOT = 120_000

let database: TestDatabase
let auth: ReturnType<typeof betterAuth>
let opensaasConfig: OpenSaasConfig
let registry: Record<string, string>

function tableOf(model: string): { schema: string; table: string } {
  const listKey = registry[model]
  if (listKey === undefined) throw new Error(`no derived list for better-auth model "${model}"`)
  const listDb = opensaasConfig.lists[listKey]?.db
  return { schema: listDb?.schema ?? 'public', table: listDb?.map ?? listKey }
}

async function onDatabase<T>(body: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: database.url })
  await client.connect()
  try {
    return await body(client)
  } finally {
    await client.end()
  }
}

async function rowCount(model: string): Promise<number> {
  const { schema, table } = tableOf(model)
  return await onDatabase(async (client) => {
    const result = await client.query<{ n: string }>(
      `select count(*) as n from "${schema}"."${table}"`,
    )
    return Number(result.rows[0]?.n ?? '0')
  })
}

beforeAll(async () => {
  opensaasConfig = await defineConfig({
    plugins: [authPlugin({ emailAndPassword: { enabled: true } })],
    db: { provider: 'postgresql' },
    lists: {},
  })
  database = await createTestDatabase(opensaasConfig)
  const normalized = opensaasConfig._pluginData?.auth as NormalizedAuthConfig
  registry = getAuthListRegistry(normalized.models, normalized.betterAuthPlugins)

  const account = tableOf('account')
  await onDatabase(async (client) => {
    await client.query(
      `alter table "${account.schema}"."${account.table}" add constraint account_write_refused check (false)`,
    )
  })

  const context = database.context()
  auth = betterAuth({
    baseURL: 'http://localhost:3000',
    secret: 'sign-up-atomicity-test-secret',
    emailAndPassword: { enabled: true },
    database: opensaasAuthAdapter({
      config: opensaasConfig,
      unsafe: context.unsafe,
      registry,
      transaction: (body) => context.transaction((tx) => body(tx.unsafe)),
    }),
  })
}, BOOT)

afterAll(async () => {
  await database?.close()
})

test('a failing account write during sign-up leaves no user row', async () => {
  await expect(
    auth.api.signUpEmail({
      body: {
        email: `atomicity-${randomUUID()}@example.com`,
        password: randomUUID(),
        name: 'Atomicity',
      },
    }),
  ).rejects.toThrow()

  expect(await rowCount('account')).toBe(0)
  expect(await rowCount('user')).toBe(0)
  expect(await rowCount('session')).toBe(0)
})
