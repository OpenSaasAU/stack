import { describe, it, expect, afterAll } from 'vitest'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createAuth } from '../src/server/index.js'
import { generateProject, toolchainPresent, type GeneratedProject } from './generated-project.js'

/**
 * Live end-to-end proof for issue #981 / ADR-0036: the credential-bearing
 * fields the auth plugin ships read-denied (`Session.token`,
 * `Verification.value`, `Account.password`/`accessToken`/`refreshToken`/
 * `idToken`) are actually stripped from an opened list's `context.db` reads,
 * `sudo()` still reads them, and — the part a unit test on `deriveAuthLists`
 * cannot show — better-auth's own sign-up/sign-in/password-reset flows are
 * unaffected because they write through the Auth adapter over the Unsafe
 * surface, never through the access-controlled context these denies gate.
 *
 * Opt-in via an env flag, run only in the `e2e` CI job (ADR-0002); the
 * project, toolchain and database come from `generated-project.ts`.
 */

const guardEnabled = process.env.RUN_CREDENTIAL_DENY_E2E === '1'
const prerequisitesPresent = guardEnabled && toolchainPresent()

/**
 * Every derived Auth list is opened for `query`, so a `context.db` read is
 * what exercises the field-level deny (a closed list would return `[]`
 * outright and prove nothing about field stripping). `sendResetPassword`
 * writes the reset token to a file the test reads back, since it runs in the
 * temp project's own module scope, not the test process's.
 */
function configSource(resetTokenFile: string): string {
  return `import { config } from '@opensaas/stack-core'
import { authPlugin } from '@opensaas/stack-auth'
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
  db: { provider: 'postgresql' },
  lists: {},
})
`
}

function isCookieConverter(
  value: unknown,
): value is { convertSetCookieToCookie: (h: Headers) => Headers } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'convertSetCookieToCookie') === 'function'
  )
}

async function setupProject(): Promise<{ project: GeneratedProject; resetTokenFile: string }> {
  const resetTokenFile = path.join(
    await fsp.mkdtemp(path.join(await fsp.realpath(process.env.TMPDIR ?? '/tmp'), 'reset-')),
    'reset-token.txt',
  )
  const project = await generateProject('credential-deny-e2e', configSource(resetTokenFile), {
    BETTER_AUTH_SECRET: 'e2e-test-secret-not-for-production-0000000000',
    BETTER_AUTH_URL: 'http://localhost:3000',
  })
  return { project, resetTokenFile }
}

describe.skipIf(!prerequisitesPresent)(
  'plugin-derived credential fields ship read-denied — live end-to-end (issue #981, ADR-0036)',
  () => {
    it('strips credential fields from an opened context.db read, keeps them under sudo(), and leaves sign-up/sign-in/session-refresh/password-reset unaffected', async () => {
      const { project, resetTokenFile } = await setupProject()
      try {
        const { config, context } = project
        const auth = createAuth(config, context)
        const testUtils = await project.toolchainModule('better-auth/dist/test-utils/index.mjs')
        if (!isCookieConverter(testUtils)) throw new Error('better-auth test-utils not loadable')
        const { convertSetCookieToCookie } = testUtils

        const email = 'reader@example.com'
        const password = 'correct horse battery staple'

        // Sign-up writes User + Account (with the hashed password) through
        // the Auth adapter — unaffected by the deny.
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

        // `.all()` is the whole opened list: better-auth signs a new user in
        // on sign-up, so sign-up plus sign-in is exactly two sessions.
        const sessions = await context.db.Session.all()
        expect(sessions).toHaveLength(2)
        for (const s of sessions) {
          expect(s.token).toBeUndefined()
          expect(s.ipAddress === null || typeof s.ipAddress === 'string').toBe(true)
        }

        const accounts = await context.db.Account.all()
        expect(accounts).toHaveLength(1)
        for (const a of accounts) {
          expect(a.password).toBeUndefined()
          expect(a.accessToken).toBeUndefined()
          expect(a.refreshToken).toBeUndefined()
          expect(a.idToken).toBeUndefined()
          // Identifying fields stay open.
          expect(a.providerId).toBe('credential')
        }

        // --- sudo() still reads every one of these fields ---

        const sudoAccount = await context.sudo().db.Account.first()
        expect(typeof sudoAccount?.password).toBe('string')
        expect(String(sudoAccount?.password).length).toBeGreaterThan(0)

        const sudoSession = await context.sudo().db.Session.first()
        expect(typeof sudoSession?.token).toBe('string')
        const token = String(sudoSession?.token)
        expect(token.length).toBeGreaterThan(0)

        // Naming a denied field in a read's predicate is rejected up front by
        // the predicate-time read-access check, not silently stripped.
        await expect(context.db.Session.where({ token: { equals: token } }).all()).rejects.toThrow()
        await expect(
          context
            .sudo()
            .db.Session.where({ token: { equals: token } })
            .all(),
        ).resolves.toHaveLength(1)

        // --- password reset: exercises Verification.value end-to-end ---

        const resetReq = await auth.api.requestPasswordReset({
          body: { email },
          asResponse: true,
        })
        expect(resetReq.status).toBe(200)

        // context.db strips Verification.value even though a live reset token exists.
        const verifications = await context.db.Verification.all()
        expect(verifications.length).toBeGreaterThan(0)
        for (const v of verifications) {
          expect(v.value).toBeUndefined()
          expect(typeof v.identifier).toBe('string')
        }
        const sudoVerification = await context.sudo().db.Verification.first()
        expect(typeof sudoVerification?.value).toBe('string')

        const resetToken = (await fsp.readFile(resetTokenFile, 'utf-8')).trim()
        expect(resetToken.length).toBeGreaterThan(0)

        const newPassword = 'a new correct horse battery staple'
        const resetRes = await auth.api.resetPassword({
          body: { newPassword, token: resetToken },
          asResponse: true,
        })
        expect(resetRes.status).toBe(200)

        // Sign in with the new password proves the reset (through the Auth
        // adapter, past the field-level deny) actually took effect.
        const signInAfterReset = await auth.api.signInEmail({
          body: { email, password: newPassword },
          asResponse: true,
        })
        expect(signInAfterReset.status).toBe(200)
      } finally {
        await project.close()
        await fsp.rm(path.dirname(resetTokenFile), { recursive: true, force: true })
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
