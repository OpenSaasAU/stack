import { describe, it, expect } from 'vitest'
import { betterAuth } from 'better-auth'
import { buildBetterAuthOptions } from '../src/server/index.js'
import { generateProject, toolchainPresent } from './generated-project.js'

/**
 * Live end-to-end proof that consolidating the plugin-table derivation onto
 * `deriveAuthLists` (issue #992) actually closes the orphaned-row defect
 * #992's own triage confirmed: generates a real contract (MCP plugin enabled,
 * so the OAuth tables are derived with real foreign keys), applies it to a
 * real Postgres, signs up a real user through a real `betterAuth()` instance
 * (over `buildBetterAuthOptions()`, the package's own source), attaches OAuth
 * rows to that user through better-auth's own adapter (these lists ship
 * closed, ADR-0013), deletes the user through better-auth's own `/delete-user`
 * endpoint (the exact `internalAdapter.deleteUser` path #992's triage
 * traced), and asserts the database cascade removed every OAuth row rather
 * than leaving them orphaned.
 *
 * Opt-in via an env flag, run only in the `e2e` CI job (ADR-0002); the
 * project, toolchain and database come from `generated-project.ts`.
 */

const guardEnabled = process.env.RUN_MCP_OAUTH_CASCADE_E2E === '1'
const prerequisitesPresent = guardEnabled && toolchainPresent()

/** The temp project's `opensaas.config.ts`: the MCP plugin + self-service account deletion enabled. */
function configSource(): string {
  return `import { config } from '@opensaas/stack-core'
import { authPlugin } from '@opensaas/stack-auth'
import { mcp } from '@opensaas/stack-auth/plugins'
import { jwt } from 'better-auth/plugins'

export default config({
  plugins: [
    authPlugin({
      emailAndPassword: { enabled: true },
      // better-auth 1.7's mcp() is built on the OAuth Provider, which issues
      // JWT-based access tokens and requires better-auth's own jwt() plugin
      // to be registered alongside it (throws BetterAuthError: jwt_config
      // otherwise) — see @better-auth/mcp's own usage example.
      betterAuthPlugins: [
        jwt(),
        mcp({ loginPage: '/sign-in', consentPage: '/consent', resource: 'http://localhost:3000/api/mcp' }),
      ],
      // Not modelled by AuthConfig — passed through verbatim so /delete-user
      // deletes immediately instead of requiring an email-verification
      // round trip (see packages/auth/CLAUDE.md, "betterAuthOptions").
      // baseURL is explicit rather than relying on the BETTER_AUTH_URL env
      // var: better-auth 1.7's OAuth Provider needs a resolvable URL to build
      // its own endpoint/issuer URLs during init, and this test constructs
      // \`auth\` in-process via createAuth() (not through the CLI subprocess
      // that does see BETTER_AUTH_URL), so the auto-detected origin would be
      // undefined here.
      betterAuthOptions: {
        baseURL: 'http://localhost:3000',
        user: { deleteUser: { enabled: true } },
      },
    }),
  ],
  db: { provider: 'postgresql' },
  lists: {},
})
`
}

describe.skipIf(!prerequisitesPresent)(
  'MCP plugin OAuth tables cascade on user deletion — live end-to-end (issue #992)',
  () => {
    it('deleting a user via better-auth’s own /delete-user removes their OAuth clients, access tokens and consents; another user’s rows survive', async () => {
      const project = await generateProject('mcp-cascade-e2e', configSource(), {
        BETTER_AUTH_SECRET: 'e2e-test-secret-not-for-production-0000000000',
        BETTER_AUTH_URL: 'http://localhost:3000',
      })
      try {
        // A real instance rather than `createAuth()`'s lazy proxy: `$context`
        // is read below, and the proxy surfaces every member through an async
        // wrapper (packages/auth/CLAUDE.md, "Typed auth.api.* reads").
        const auth = betterAuth(await buildBetterAuthOptions(project.config, project.context))
        // The OAuth lists ship closed (ADR-0013). They are seeded through
        // better-auth's own adapter — the path its OAuth flows write through
        // — and read back under `sudo()`.
        const { adapter } = await auth.$context
        const seeded = project.context.sudo().db
        const count = async (list: 'OauthClient' | 'OauthAccessToken' | 'OauthConsent') =>
          (await seeded[list].aggregate((aggregate) => ({ n: aggregate.count() }))).n

        const { headers: deletedHeaders } = await auth.api.signUpEmail({
          body: { email: 'deleted@example.com', password: 'password1234', name: 'Deleted User' },
          returnHeaders: true,
        })
        const deletedCookie = deletedHeaders.get('set-cookie') ?? ''
        const deletedSession = await auth.api.getSession({
          headers: new Headers({ cookie: deletedCookie }),
        })
        const deletedUserId = deletedSession!.user.id

        const { headers: survivorHeaders } = await auth.api.signUpEmail({
          body: { email: 'survivor@example.com', password: 'password1234', name: 'Survivor User' },
          returnHeaders: true,
        })
        const survivorSession = await auth.api.getSession({
          headers: new Headers({ cookie: survivorHeaders.get('set-cookie') ?? '' }),
        })
        const survivorUserId = survivorSession!.user.id

        // better-auth 1.7's OAuth Provider (issue #986) splits what the pre-1.7
        // MCP plugin modelled as a single "application" with embedded tokens
        // into oauthClient (the registered client) plus a standalone
        // oauthAccessToken. `clientId` on the token and consent rows is a
        // plain scalar, not an id-based foreign key (packages/auth/CLAUDE.md).
        for (const [suffix, userId] of [
          ['deleted', deletedUserId],
          ['survivor', survivorUserId],
        ]) {
          await adapter.create({
            model: 'oauthClient',
            data: {
              name: `App ${suffix}`,
              clientId: `client-${suffix}`,
              redirectUris: 'http://localhost/callback',
              userId,
            },
          })
          await adapter.create({
            model: 'oauthAccessToken',
            data: {
              token: `access-${suffix}`,
              clientId: `client-${suffix}`,
              scopes: 'openid',
              expiresAt: new Date(Date.now() + 3_600_000),
              // oauthAccessToken declares createdAt but not updatedAt
              // upstream, so it derives as an ordinary required column with
              // no default (see hasSymmetricTimestamps in
              // derive-auth-lists.ts) — better-auth's own adapter always
              // supplies it explicitly, so this seed must too.
              createdAt: new Date(),
              userId,
            },
          })
          await adapter.create({
            model: 'oauthConsent',
            data: { clientId: `client-${suffix}`, scopes: 'openid', userId },
          })
        }

        expect(await count('OauthClient')).toBe(2)
        expect(await count('OauthAccessToken')).toBe(2)
        expect(await count('OauthConsent')).toBe(2)

        const deleteResult = await auth.api.deleteUser({
          body: {},
          headers: new Headers({ cookie: deletedCookie }),
        })
        expect(deleteResult).toEqual({ success: true, message: 'User deleted' })

        expect(await seeded.User.where({ id: { equals: deletedUserId } }).first()).toBeNull()

        // No orphans: every row belonging to the deleted user is gone via the
        // database cascade, not just the user row itself.
        const ownedBy = { userId: { equals: deletedUserId } }
        expect(await seeded.OauthClient.where(ownedBy).first()).toBeNull()
        expect(await seeded.OauthAccessToken.where(ownedBy).first()).toBeNull()
        expect(await seeded.OauthConsent.where(ownedBy).first()).toBeNull()

        // The other user's rows are untouched — the cascade is scoped to the
        // deleted user's own foreign key, not a wholesale table wipe.
        expect(await seeded.User.where({ id: { equals: survivorUserId } }).first()).not.toBeNull()
        expect(await count('OauthClient')).toBe(1)
        expect(await count('OauthAccessToken')).toBe(1)
        expect(await count('OauthConsent')).toBe(1)
      } finally {
        await project.close()
      }
    }, 120_000)
  },
)

// Surface, in a normal unit run, why this guard was skipped.
describe.runIf(!prerequisitesPresent)('MCP OAuth cascade e2e (skipped)', () => {
  it('runs only in the e2e job (set RUN_MCP_OAUTH_CASCADE_E2E=1 after install + build)', () => {
    expect(prerequisitesPresent).toBe(false)
  })
})
