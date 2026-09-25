import { describe, it, expect, afterAll } from 'vitest'
import { createAuth } from '../src/server/index.js'
import { generateProject, toolchainPresent, type GeneratedProject } from './generated-project.js'

/**
 * Live end-to-end proof for issue #1618 / ADR-0073: a derived Auth list field
 * better-auth itself marks `input: false` (`User.emailVerified`
 * unconditionally, and — once `admin()` is registered — `User.role`,
 * `User.banned`, `User.banReason`, `User.banExpires`, `Session.impersonatedBy`)
 * is write-denied on `context.db` independent of whatever operation-level
 * access the application grants, so a whole-row self-update rule cannot be
 * used to self-elevate. The part a `deriveAuthLists` unit test cannot show:
 * better-auth's own sign-up flow is unaffected, because it writes through the
 * Auth adapter over the Unsafe surface, never through the access-controlled
 * context this deny gates — and `fieldAccess` reopens the deny for a session
 * the application trusts (here, an admin session).
 *
 * Opt-in via an env flag, run only in the `e2e` CI job (ADR-0002); the
 * project, toolchain and database come from `generated-project.ts`.
 */

const guardEnabled = process.env.RUN_FIELD_ACCESS_WRITE_DENY_E2E === '1'
const prerequisitesPresent = guardEnabled && toolchainPresent()

/**
 * The classic self-elevation shape this issue closes: a whole-row owner
 * self-update rule, as the starter/with-auth template and auth-demo ship
 * (before this fix narrows it). `fieldAccess` reopens `role` for an admin
 * session, proving the override composes with the seeded deny rather than
 * only ever being able to add restriction.
 */
function configSource(): string {
  return `import { config } from '@opensaas/stack-core'
import { authPlugin } from '@opensaas/stack-auth'
import { admin } from 'better-auth/plugins'

export default config({
  plugins: [
    authPlugin({
      emailAndPassword: { enabled: true },
      betterAuthPlugins: [admin()],
      sessionFields: ['userId', 'email', 'role'],
      access: {
        user: {
          operation: {
            query: () => true,
            update: ({ session, item }) => session?.userId === item.id || session?.role === 'admin',
          },
        },
      },
      fieldAccess: {
        user: {
          role: { update: ({ session }) => session?.role === 'admin' },
        },
      },
    }),
  ],
  db: { provider: 'postgresql' },
  lists: {},
})
`
}

async function setupProject(): Promise<GeneratedProject> {
  return await generateProject('field-access-write-deny-e2e', configSource(), {
    BETTER_AUTH_SECRET: 'e2e-test-secret-not-for-production-0000000000',
    BETTER_AUTH_URL: 'http://localhost:3000',
  })
}

describe.skipIf(!prerequisitesPresent)(
  'input:false Auth list fields ship write-denied — live end-to-end (issue #1618, ADR-0073)',
  () => {
    it('refuses role/emailVerified/banned self-elevation through context.db while sign-up (Auth adapter) and an admin fieldAccess override are unaffected', async () => {
      const project = await setupProject()
      try {
        const { config, context } = project
        const auth = createAuth(config, context)
        const password = 'correct horse battery staple'

        // Sign-up writes User through the Auth adapter, unaffected by the
        // deny: emailVerified is stored false even though it's input:false.
        const signUpRes = await auth.api.signUpEmail({
          body: { name: 'Mallory', email: 'mallory@example.com', password },
          asResponse: true,
        })
        expect(signUpRes.status).toBe(200)

        const mallory = await context
          .sudo()
          .db.User.where({
            email: { equals: 'mallory@example.com' },
          })
          .first()
        expect(mallory).not.toBeNull()
        expect(mallory?.emailVerified).toBe(false)
        expect(mallory?.role).not.toBe('admin')

        const asMallory = context.withSession({
          userId: mallory!.id,
          email: 'mallory@example.com',
          role: mallory!.role,
        })

        // The classic privilege-escalation attempt this issue closes: a
        // whole-row owner self-update rule does NOT imply every column is
        // writable once a field carries the seeded input:false deny.
        await expect(
          asMallory.db.User.update({
            where: { id: mallory!.id },
            data: { role: 'admin', emailVerified: true, banned: true },
          }),
        ).rejects.toThrow()

        // The row is unchanged — the whole write was refused, not partially applied.
        const unchanged = await context
          .sudo()
          .db.User.where({ id: { equals: mallory!.id } })
          .first()
        expect(unchanged?.role).not.toBe('admin')
        expect(unchanged?.emailVerified).toBe(false)
        expect(unchanged?.banned).toBe(false)

        // A profile field with no seeded deny still updates normally through
        // the same owner rule.
        const renamed = await asMallory.db.User.update({
          where: { id: mallory!.id },
          data: { name: 'Mallory Renamed' },
        })
        expect(renamed?.name).toBe('Mallory Renamed')

        // fieldAccess reopens `role` for a trusted (admin) session — proving
        // the override composes with, rather than merely narrows, the seeded
        // deny.
        await auth.api.signUpEmail({
          body: { name: 'Admin', email: 'admin@example.com', password },
          asResponse: true,
        })
        const adminUser = await context
          .sudo()
          .db.User.where({
            email: { equals: 'admin@example.com' },
          })
          .first()
        await context
          .sudo()
          .db.User.update({ where: { id: adminUser!.id }, data: { role: 'admin' } })

        const asAdmin = context.withSession({
          userId: adminUser!.id,
          email: 'admin@example.com',
          role: 'admin',
        })
        const promoted = await asAdmin.db.User.update({
          where: { id: mallory!.id },
          data: { role: 'admin' },
        })
        expect(promoted?.role).toBe('admin')
      } finally {
        await project.close()
      }
    }, 120_000)
  },
)

// Surface, in a normal unit run, why this guard was skipped.
describe.runIf(!prerequisitesPresent)('field-access write-deny e2e (skipped)', () => {
  it('runs only in the e2e job (set RUN_FIELD_ACCESS_WRITE_DENY_E2E=1 after install + build)', () => {
    expect(prerequisitesPresent).toBe(false)
  })

  afterAll(() => {
    if (!guardEnabled) return
    console.warn(
      '[field-access-write-deny-e2e] RUN_FIELD_ACCESS_WRITE_DENY_E2E=1 was set but prerequisites are missing. ' +
        'Run `pnpm install && pnpm build` (and ensure examples/starter-auth has been installed) first.',
    )
  })
})
