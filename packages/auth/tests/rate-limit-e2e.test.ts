import { describe, it, expect, afterAll } from 'vitest'
import { createAuth } from '../src/server/index.js'
import { generateProject, toolchainPresent, type GeneratedProject } from './generated-project.js'

/**
 * Live end-to-end proof that the database-backed rate limiter (issue #909)
 * actually works: it generates a real contract (with the derived `RateLimit`
 * list), applies it to a real Postgres, constructs real `betterAuth()`
 * instances against that database via `createAuth()` (the package's own
 * source, not a stale build), and drives them through real HTTP-shaped
 * requests via `auth.handler()`.
 *
 * Opt-in via an env flag, kept out of the fast unit lane, run only in the
 * `e2e` CI job where `pnpm install && pnpm build` have already run (ADR-0002);
 * the project, toolchain and database come from `generated-project.ts`.
 */

const guardEnabled = process.env.RUN_RATE_LIMIT_E2E === '1'
const prerequisitesPresent = guardEnabled && toolchainPresent()

function configSource(window: number, max: number): string {
  return `import { config } from '@opensaas/stack-core'
import { authPlugin } from '@opensaas/stack-auth'

export default config({
  plugins: [
    authPlugin({
      emailAndPassword: { enabled: true },
      rateLimit: { enabled: true, window: ${window}, max: ${max}, storage: 'database' },
    }),
  ],
  db: { provider: 'postgresql' },
  lists: {},
})
`
}

/** A GET request against a real (rate-limited) better-auth endpoint from a fixed "client". */
function sessionRequest(ip: string): Request {
  return new Request('http://localhost:3000/api/auth/get-session', {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  })
}

function setupProject(window: number, max: number): Promise<GeneratedProject> {
  return generateProject('ratelimit-e2e', configSource(window, max), {
    BETTER_AUTH_SECRET: 'e2e-test-secret-not-for-production-0000000000',
    BETTER_AUTH_URL: 'http://localhost:3000',
  })
}

describe.skipIf(!prerequisitesPresent)(
  'database-backed rate limiter — live end-to-end (issue #909)',
  () => {
    it('rejects requests once the count exceeds max within the window, against a real generated RateLimit table', async () => {
      const project = await setupProject(60, 3)
      try {
        const auth = createAuth(project.config, project.context)
        const ip = '203.0.113.10'

        const statuses: number[] = []
        for (let i = 0; i < 5; i++) {
          const res = await auth.handler(sessionRequest(ip))
          statuses.push(res.status)
        }

        // First `max` (3) requests succeed, everything past it is rejected.
        expect(statuses.slice(0, 3)).toEqual([200, 200, 200])
        expect(statuses.slice(3)).toEqual([429, 429])
      } finally {
        await project.close()
      }
    }, 120_000)

    it('persists the counter across two separately-constructed auth instances sharing the database', async () => {
      const project = await setupProject(60, 3)
      try {
        const ip = '198.51.100.20'

        // Two independently-constructed betterAuth() instances (via two
        // separate createAuth() lazy proxies) over one database — the
        // property in-memory storage does not have.
        const authA = createAuth(project.config, project.context)
        const authB = createAuth(project.config, project.context)

        expect((await authA.handler(sessionRequest(ip))).status).toBe(200)
        expect((await authA.handler(sessionRequest(ip))).status).toBe(200)
        expect((await authA.handler(sessionRequest(ip))).status).toBe(200)

        // Instance B, constructed fresh and never having handled a request
        // for this IP, must see A's persisted counter via the database and
        // reject — proof the limiter state lives in the DB, not in-process.
        expect((await authB.handler(sessionRequest(ip))).status).toBe(429)
      } finally {
        await project.close()
      }
    }, 120_000)

    it('leaves the process as it found it, so the next project starts from a clean environment', async () => {
      const before = { ...process.env }
      const cwd = process.cwd()
      const project = await setupProject(60, 3)
      expect(process.env.BETTER_AUTH_SECRET).toBe('e2e-test-secret-not-for-production-0000000000')
      await project.close()

      expect(process.cwd()).toBe(cwd)
      expect(process.env.BETTER_AUTH_SECRET).toBe(before.BETTER_AUTH_SECRET)
      expect(process.env.BETTER_AUTH_URL).toBe(before.BETTER_AUTH_URL)
      expect(process.env.DATABASE_URL).toBe(before.DATABASE_URL)
      expect(Reflect.get(globalThis, 'opensaasClient')).toBeUndefined()
    }, 120_000)
  },
)

// Surface, in a normal unit run, why this guard was skipped.
describe.runIf(!prerequisitesPresent)('database-backed rate limiter e2e (skipped)', () => {
  it('runs only in the e2e job (set RUN_RATE_LIMIT_E2E=1 after install + build)', () => {
    expect(prerequisitesPresent).toBe(false)
  })

  afterAll(() => {
    if (!guardEnabled) return
    console.warn(
      '[rate-limit-e2e] RUN_RATE_LIMIT_E2E=1 was set but prerequisites are missing. ' +
        'Run `pnpm install && pnpm build` (and ensure examples/starter-auth has been installed) first.',
    )
  })
})
