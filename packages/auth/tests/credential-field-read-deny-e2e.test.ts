import { describe, it, expect, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createAuth } from '../src/server/index.js'
import type { OpenSaasConfig, AccessContext } from '@opensaas/stack-core'

/**
 * Live end-to-end proof for issue #981 / ADR-0036: the credential-bearing
 * fields the auth plugin now ships read-denied (`Session.token`,
 * `Verification.value`, `Account.password`/`accessToken`/`refreshToken`/
 * `idToken`) are actually stripped from an opened list's `context.db` reads,
 * `sudo()` still reads them, and — the part a unit test on `deriveAuthLists`
 * cannot show — better-auth's own sign-up/sign-in/password-reset flows are
 * unaffected because they write through the raw Prisma adapter, never
 * through the access-controlled context these denies gate.
 *
 * Generates a real Prisma schema, pushes it to a real SQLite database,
 * drives a real `betterAuth()` instance (via `createAuth()`, this package's
 * own source) through real sign-up/sign-in/password-reset requests, and
 * reads the resulting rows back through both an access-opened context and a
 * sudo context. Follows the same opt-in/offline-toolchain pattern as
 * `rate-limit-e2e.test.ts` (see ADR-0002) — kept out of the fast unit lane,
 * run only in the `e2e` CI job where `pnpm install && pnpm build` have
 * already run.
 */

const run = promisify(execFile)
const here = path.dirname(new URL(import.meta.url).pathname)
const repoRoot = path.resolve(here, '../../..')

const opensaasCli = path.join(repoRoot, 'packages/cli/dist/index.js')
const coreDist = path.join(repoRoot, 'packages/core/dist')
const authDist = path.join(repoRoot, 'packages/auth/dist')
const toolchainNodeModules = path.join(repoRoot, 'examples/starter-auth/node_modules')

const guardEnabled = process.env.RUN_CREDENTIAL_DENY_E2E === '1'

const prerequisitesPresent =
  guardEnabled &&
  existsSync(opensaasCli) &&
  existsSync(coreDist) &&
  existsSync(authDist) &&
  existsSync(path.join(toolchainNodeModules, '.bin', 'opensaas')) &&
  existsSync(path.join(toolchainNodeModules, '.bin', 'prisma')) &&
  existsSync(path.join(toolchainNodeModules, '@prisma', 'adapter-better-sqlite3')) &&
  existsSync(path.join(toolchainNodeModules, 'better-auth', 'dist', 'test-utils'))

/**
 * The temp project's `opensaas.config.ts` — sqlite + email/password auth with
 * every derived Auth list opened for `query`, so a `context.db` read is what
 * exercises the field-level deny (a closed list would return `null`/`[]`
 * outright and prove nothing about field stripping). `sendResetPassword`
 * writes the reset token to a file the test reads back, since it runs in the
 * temp project's own module scope, not the test process's.
 */
function configSource(resetTokenFile: string): string {
  return `import { config } from '@opensaas/stack-core'
import { authPlugin } from '@opensaas/stack-auth'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { writeFile } from 'node:fs/promises'

const openQuery = { operation: { query: () => true } }

export default config({
  plugins: [
    authPlugin({
      emailAndPassword: {
        enabled: true,
        sendResetPassword: async ({ token }) => {
          await writeFile(${JSON.stringify(resetTokenFile)}, token, 'utf-8')
        },
      },
      passwordReset: { enabled: true },
      access: {
        user: openQuery,
        session: openQuery,
        account: openQuery,
        verification: openQuery,
      },
    }),
  ],
  db: {
    provider: 'sqlite',
    prismaClientConstructor: (PrismaClient) => {
      const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || './dev.db' })
      return new PrismaClient({ adapter })
    },
  },
  lists: {},
})
`
}

async function setupProject(): Promise<{ dir: string; resetTokenFile: string }> {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'opensaas-credential-deny-e2e-'))
  const dir = path.join(tmpRoot, 'project')
  await fsp.mkdir(dir, { recursive: true })
  const resetTokenFile = path.join(dir, 'reset-token.txt')

  await fsp.writeFile(path.join(dir, 'opensaas.config.ts'), configSource(resetTokenFile))
  await fsp.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify(
      { name: 'credential-deny-e2e-project', version: '0.0.0', private: true, type: 'module' },
      null,
      2,
    ),
  )
  await fsp.writeFile(path.join(dir, '.env'), 'DATABASE_URL=file:./dev.db\n')
  await fsp.symlink(toolchainNodeModules, path.join(dir, 'node_modules'))

  const env = {
    ...process.env,
    DATABASE_URL: 'file:./dev.db',
    BETTER_AUTH_SECRET: 'e2e-test-secret-not-for-production-0000000000',
    BETTER_AUTH_URL: 'http://localhost:3000',
  }
  const binDir = path.join(dir, 'node_modules', '.bin')
  await run(path.join(binDir, 'opensaas'), ['generate'], { cwd: dir, env })
  await run(path.join(binDir, 'prisma'), ['db', 'push'], { cwd: dir, env })

  return { dir, resetTokenFile }
}

/** Import the temp project's config + generated context and build a real auth instance via `createAuth()`. */
async function createAuthInstanceForProject(dir: string) {
  process.env.DATABASE_URL = `file:${path.join(dir, 'dev.db')}`

  const config = (
    (await import(/* @vite-ignore */ pathToFileURL(path.join(dir, 'opensaas.config.ts')).href)) as {
      default: OpenSaasConfig | Promise<OpenSaasConfig>
    }
  ).default
  const { rawOpensaasContext } = (await import(
    /* @vite-ignore */ pathToFileURL(path.join(dir, '.opensaas/context.ts')).href
  )) as { rawOpensaasContext: Promise<AccessContext> }

  const resolvedContext = await rawOpensaasContext

  return { auth: createAuth(config, resolvedContext), context: resolvedContext }
}

async function cleanupProject(dir: string): Promise<void> {
  delete (globalThis as { prisma?: unknown }).prisma
  const linkPath = path.join(dir, 'node_modules')
  if (existsSync(linkPath)) {
    await fsp.unlink(linkPath)
  }
  await fsp.rm(path.dirname(dir), { recursive: true, force: true })
}

describe.skipIf(!prerequisitesPresent)(
  'plugin-derived credential fields ship read-denied — live end-to-end (issue #981, ADR-0036)',
  () => {
    it('strips credential fields from an opened context.db read, keeps them under sudo(), and leaves sign-up/sign-in/session-refresh/password-reset unaffected', async () => {
      const { dir, resetTokenFile } = await setupProject()
      try {
        const { auth, context } = await createAuthInstanceForProject(dir)
        const { convertSetCookieToCookie } = (await import(
          /* @vite-ignore */ pathToFileURL(
            path.join(dir, 'node_modules/better-auth/dist/test-utils/index.mjs'),
          ).href
        )) as { convertSetCookieToCookie: (h: Headers) => Headers }

        const email = 'reader@example.com'
        const password = 'correct horse battery staple'

        // Sign-up writes User + Account (with the hashed password) through
        // better-auth's own raw-Prisma adapter — unaffected by the deny.
        const signUpRes = await auth.api.signUpEmail({
          body: { name: 'Reader', email, password },
          asResponse: true,
        })
        expect(signUpRes.status).toBe(200)

        // Sign-in writes a Session row and returns a session cookie.
        const signInRes = await auth.api.signInEmail({
          body: { email, password },
          asResponse: true,
        })
        expect(signInRes.status).toBe(200)
        const cookieHeaders = convertSetCookieToCookie(signInRes.headers)

        // Session refresh: the cookie from sign-in resolves a session twice.
        for (let i = 0; i < 2; i++) {
          const session = await auth.api.getSession({ headers: cookieHeaders })
          expect(session?.user.email).toBe(email)
        }

        // --- context.db reads, with operation-level access opened ---

        const sessions = await context.db.session.findMany({})
        expect(sessions.length).toBeGreaterThan(0)
        for (const s of sessions) {
          expect(s.token).toBeUndefined()
          expect(s.ipAddress === null || typeof s.ipAddress === 'string').toBe(true)
        }

        const accounts = await context.db.account.findMany({})
        expect(accounts.length).toBeGreaterThan(0)
        for (const a of accounts) {
          expect(a.password).toBeUndefined()
          expect(a.accessToken).toBeUndefined()
          expect(a.refreshToken).toBeUndefined()
          expect(a.idToken).toBeUndefined()
          // Identifying fields stay open.
          expect(a.providerId).toBe('credential')
        }

        // --- sudo() still reads every one of these fields ---

        const sudoAccounts = await context.sudo().db.account.findMany({})
        expect(sudoAccounts.length).toBeGreaterThan(0)
        expect(typeof sudoAccounts[0].password).toBe('string')
        expect(sudoAccounts[0].password!.length).toBeGreaterThan(0)

        const sudoSessions = await context.sudo().db.session.findMany({})
        expect(typeof sudoSessions[0].token).toBe('string')
        expect(sudoSessions[0].token!.length).toBeGreaterThan(0)

        // Naming a denied field in findMany's where/orderBy is rejected up
        // front by the predicate-time read-access check, not silently
        // stripped (findUnique's `where` isn't walked by that check at all —
        // it only unique-selects the row, so it still returns the row with
        // `token` stripped from the output, same as any other read).
        await expect(
          context.db.session.findMany({ where: { token: sudoSessions[0].token } }),
        ).rejects.toThrow()
        await expect(
          context.sudo().db.session.findMany({ where: { token: sudoSessions[0].token } }),
        ).resolves.not.toHaveLength(0)

        // --- password reset: exercises Verification.value end-to-end ---

        const resetReq = await auth.api.requestPasswordReset({
          body: { email },
          asResponse: true,
        })
        expect(resetReq.status).toBe(200)

        // context.db strips Verification.value even though a live reset token exists.
        const verifications = await context.db.verification.findMany({})
        expect(verifications.length).toBeGreaterThan(0)
        for (const v of verifications) {
          expect(v.value).toBeUndefined()
          expect(typeof v.identifier).toBe('string')
        }
        const sudoVerifications = await context.sudo().db.verification.findMany({})
        expect(typeof sudoVerifications[0].value).toBe('string')

        const resetToken = (await fsp.readFile(resetTokenFile, 'utf-8')).trim()
        expect(resetToken.length).toBeGreaterThan(0)

        const newPassword = 'a new correct horse battery staple'
        const resetRes = await auth.api.resetPassword({
          body: { newPassword, token: resetToken },
          asResponse: true,
        })
        expect(resetRes.status).toBe(200)

        // Sign in with the new password proves the reset (through the raw
        // adapter, past the field-level deny) actually took effect.
        const signInAfterReset = await auth.api.signInEmail({
          body: { email, password: newPassword },
          asResponse: true,
        })
        expect(signInAfterReset.status).toBe(200)

        await context.ormHandle.$disconnect()
      } finally {
        await cleanupProject(dir)
      }
    }, 120_000)
  },
)

// Surface, in a normal unit run, why this guard was skipped.
describe.runIf(!prerequisitesPresent)('credential field read-deny e2e (skipped)', () => {
  it('runs only in the e2e job (set RUN_CREDENTIAL_DENY_E2E=1 after install + build)', () => {
    expect(prerequisitesPresent).toBe(false)
  })

  afterAll(() => {
    if (!guardEnabled) return
    console.warn(
      '[credential-field-read-deny-e2e] RUN_CREDENTIAL_DENY_E2E=1 was set but prerequisites are missing. ' +
        'Run `pnpm install && pnpm build` (and ensure examples/starter-auth has been installed) first.',
    )
  })
})
