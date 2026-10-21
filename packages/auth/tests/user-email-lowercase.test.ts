import { afterAll, beforeAll, expect, test } from 'vitest'
import { betterAuth, type Auth } from 'better-auth'
import { config as defineConfig } from '@opensaas/stack-core'
import { createTestDatabase, type TestDatabase } from '@opensaas/stack-core/testing'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { authPlugin } from '../src/config/plugin.js'
import { getAuthListRegistry } from '../src/lists/index.js'
import { opensaasAuthAdapter } from '../src/adapter/index.js'
import type { NormalizedAuthConfig } from '../src/config/types.js'

const BOOT = 120_000
const PASSWORD = 'correct-horse-battery'

let database: TestDatabase
let auth: Auth
let opensaasConfig: OpenSaasConfig

beforeAll(async () => {
  opensaasConfig = await defineConfig({
    plugins: [
      authPlugin({
        emailAndPassword: { enabled: true },
        access: {
          user: { operation: { query: () => true, create: () => true, update: () => true } },
        },
      }),
    ],
    db: { provider: 'postgresql' },
    lists: {},
  })
  database = await createTestDatabase(opensaasConfig)
  const normalized = opensaasConfig._pluginData?.auth as NormalizedAuthConfig
  const registry = getAuthListRegistry(normalized.models, normalized.betterAuthPlugins)

  const context = database.context()
  auth = betterAuth({
    baseURL: 'http://localhost:3000',
    secret: 'email-lowercase-test-secret-0123456789',
    emailAndPassword: { enabled: true },
    database: opensaasAuthAdapter({
      config: opensaasConfig,
      unsafe: context.unsafe,
      registry,
      transaction: (body) => context.transaction((tx) => body(tx.unsafe)),
    }),
  }) as unknown as Auth
}, BOOT)

afterAll(async () => {
  await database?.close()
})

test('a mixed-case email written through context.db can sign in, and a lowercase sign-up is a duplicate', async () => {
  const context = database.context()
  const user = await context.db.User.create({
    data: { name: 'Alice', email: 'Alice@Corp.com' },
  })
  expect(user?.email).toBe('alice@corp.com')
  if (user === null) throw new Error('create denied')

  const hash = await (await auth.$context).password.hash(PASSWORD)
  const account = await context.sudo().db.Account.create({
    data: {
      accountId: user.id,
      providerId: 'credential',
      password: hash,
      user: { connect: { id: user.id } },
    },
  })
  expect(account).not.toBeNull()

  const signedIn = await auth.api.signInEmail({
    body: { email: 'alice@corp.com', password: PASSWORD },
  })
  expect(signedIn.user.id).toBe(user.id)

  await expect(
    auth.api.signUpEmail({
      body: { email: 'alice@corp.com', password: PASSWORD, name: 'Second Alice' },
    }),
  ).rejects.toThrow()

  expect(
    await context
      .sudo()
      .db.User.where({ email: { equals: 'alice@corp.com' } })
      .all(),
  ).toHaveLength(1)
})
