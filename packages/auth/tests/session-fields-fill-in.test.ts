import type { Auth, BetterAuthOptions } from 'better-auth'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { config as defineConfig } from '@opensaas/stack-core'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { createTestDatabase, type TestDatabase } from '@opensaas/stack-core/testing'
import { authPlugin } from '../src/config/plugin.js'
import { SESSION_FILL_IN } from '../src/server/session-fill-in.js'
import { buildBetterAuthOptions, createAuth, getSessionFromAuth } from '../src/server/index.js'

const BOOT = 120_000

async function buildConfig(sessionFields: string[]): Promise<OpenSaasConfig> {
  return await defineConfig({
    plugins: [
      authPlugin({
        emailAndPassword: { enabled: true },
        sessionFields,
        extendUserList: { fields: { tier: text({ defaultValue: 'free' }) } },
      }),
    ],
    db: { provider: 'postgresql' },
    lists: {},
  })
}

let database: TestDatabase
let opensaasConfig: OpenSaasConfig

beforeAll(async () => {
  process.env.BETTER_AUTH_SECRET = 'session-fill-in-test-secret-0000000000'
  process.env.BETTER_AUTH_URL = 'http://localhost:3000'
  opensaasConfig = await buildConfig(['userId', 'email', 'tier'])
  database = await createTestDatabase(opensaasConfig)
}, BOOT)

afterAll(async () => {
  await database?.close()
})

async function signUp(auth: Auth<BetterAuthOptions>) {
  const email = `fill-in-${randomUUID()}@example.com`
  const response = await auth.api.signUpEmail({
    body: { email, password: randomUUID(), name: 'Fill In' },
    returnHeaders: true,
  })
  const cookie = response.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ')
  return { email, headers: new Headers({ cookie }), userId: response.response.user.id }
}

describe('sessionFields fill-in from the user row (#1649)', () => {
  it(
    'projects an extendUserList field and reflects later updates',
    async () => {
      const auth = createAuth(opensaasConfig, database.context())
      const { headers, userId } = await signUp(auth)

      const first = await getSessionFromAuth(auth, ['userId', 'email', 'tier'], headers)
      expect(first).toMatchObject({ userId, tier: 'free' })

      await database
        .context()
        .sudo()
        .db.User.update({ where: { id: userId }, data: { tier: 'pro' } })

      const second = await getSessionFromAuth(auth, ['userId', 'tier'], headers)
      expect(second).toMatchObject({ tier: 'pro' })
    },
    BOOT,
  )

  it(
    'runs no user-row query when every field comes from better-auth',
    async () => {
      const auth = createAuth(opensaasConfig, database.context())
      const { headers } = await signUp(auth)
      const session = await getSessionFromAuth(auth, ['userId', 'email', 'name'], headers)
      expect(session).toMatchObject({ email: expect.any(String), name: 'Fill In' })

      const read = vi.fn(async () => null)
      const stub = {
        api: { getSession: async () => ({ user: { id: 'u', email: 'e', name: 'n' } }) },
        [SESSION_FILL_IN]: async () => ({ userFields: new Set(['tier']), read }),
      }
      await getSessionFromAuth(stub, ['userId', 'email', 'name'], headers)
      expect(read).not.toHaveBeenCalled()
    },
    BOOT,
  )

  it(
    'does not add the filled-in field to better-auth session endpoint',
    async () => {
      const auth = createAuth(opensaasConfig, database.context())
      const { headers } = await signUp(auth)
      const raw = await auth.api.getSession({ headers })
      expect(raw?.user).not.toHaveProperty('tier')
    },
    BOOT,
  )

  it(
    'yields null when the user row is gone mid-session',
    async () => {
      const auth = createAuth(opensaasConfig, database.context())
      const { headers, userId } = await signUp(auth)
      const stub = {
        api: { getSession: async () => ({ user: { id: userId } }) },
        [SESSION_FILL_IN]: async () => ({
          userFields: new Set(['tier']),
          read: async () => null,
        }),
      }
      expect(await getSessionFromAuth(stub, ['userId', 'tier'], headers)).toBeNull()
    },
    BOOT,
  )

  it(
    'throws at startup for a sessionFields entry that exists nowhere',
    async () => {
      const bad = await buildConfig(['userId', 'nope'])
      await expect(buildBetterAuthOptions(bad, database.context())).rejects.toThrow(/"nope"/)
    },
    BOOT,
  )

  it(
    'accepts a better-auth session field that is not a user field',
    async () => {
      const ok = await buildConfig(['userId', 'token', 'ipAddress'])
      await expect(buildBetterAuthOptions(ok, database.context())).resolves.toBeDefined()
    },
    BOOT,
  )
})
