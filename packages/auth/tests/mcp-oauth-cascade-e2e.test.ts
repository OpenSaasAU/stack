import { describe, it, expect } from 'vitest'
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
 * Live end-to-end proof that consolidating the plugin-table derivation onto
 * `deriveAuthLists` (issue #992) actually closes the orphaned-row defect
 * #992's own triage confirmed: generates a real Prisma schema (MCP plugin
 * enabled, so the OAuth tables are derived with real foreign keys), pushes
 * it to a real SQLite database, signs up a real user through a real
 * `betterAuth()` instance (via `createAuth()`, the package's own source, not
 * a stale build), attaches OAuth rows to that user via the raw Prisma client
 * (the same path better-auth's own adapter writes through — these lists ship
 * closed per ADR-0013), deletes the user through better-auth's own
 * `/delete-user` endpoint (the exact `internalAdapter.deleteUser` path
 * #992's triage traced), and asserts the database cascade removed every
 * OAuth row rather than leaving them orphaned.
 *
 * Follows the same opt-in/offline-toolchain pattern as `rate-limit-e2e.test.ts`
 * (see ADR-0002) — kept out of the fast unit lane, run only in the `e2e` CI
 * job where `pnpm install && pnpm build` have already run.
 */

const run = promisify(execFile)
const here = path.dirname(new URL(import.meta.url).pathname)
const repoRoot = path.resolve(here, '../../..')

const opensaasCli = path.join(repoRoot, 'packages/cli/dist/index.js')
const coreDist = path.join(repoRoot, 'packages/core/dist')
const authDist = path.join(repoRoot, 'packages/auth/dist')
const toolchainNodeModules = path.join(repoRoot, 'examples/starter-auth/node_modules')

const guardEnabled = process.env.RUN_MCP_OAUTH_CASCADE_E2E === '1'

const prerequisitesPresent =
  guardEnabled &&
  existsSync(opensaasCli) &&
  existsSync(coreDist) &&
  existsSync(authDist) &&
  existsSync(path.join(toolchainNodeModules, '.bin', 'opensaas')) &&
  existsSync(path.join(toolchainNodeModules, '.bin', 'prisma')) &&
  existsSync(path.join(toolchainNodeModules, '@prisma', 'adapter-better-sqlite3'))

/** The temp project's `opensaas.config.ts`: sqlite + the MCP plugin + self-service account deletion enabled. */
function configSource(): string {
  return `import { config } from '@opensaas/stack-core'
import { authPlugin } from '@opensaas/stack-auth'
import { mcp } from '@opensaas/stack-auth/plugins'
import { jwt } from 'better-auth/plugins'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

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
        mcp({ loginPage: '/sign-in', resource: 'http://localhost:3000/api/mcp' }),
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

/** Scaffold a fresh temp project with the MCP plugin enabled and push its schema. Returns the project dir. */
async function setupProject(): Promise<string> {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'opensaas-mcp-cascade-e2e-'))
  const dir = path.join(tmpRoot, 'project')
  await fsp.mkdir(dir, { recursive: true })

  await fsp.writeFile(path.join(dir, 'opensaas.config.ts'), configSource())
  await fsp.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify(
      { name: 'mcp-cascade-e2e-project', version: '0.0.0', private: true, type: 'module' },
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

  return dir
}

/** Import the temp project's config + generated context and build a real auth instance via `createAuth()`. */
async function createAuthInstanceForProject(dir: string) {
  process.env.DATABASE_URL = `file:${path.join(dir, 'dev.db')}`

  // `@vite-ignore` suppresses Vite's static analysis of this computed,
  // external (outside the package root) specifier.
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
  // See rate-limit-e2e.test.ts for why this global must be cleared between projects.
  delete (globalThis as { prisma?: unknown }).prisma

  const linkPath = path.join(dir, 'node_modules')
  if (existsSync(linkPath)) {
    await fsp.unlink(linkPath)
  }
  await fsp.rm(path.dirname(dir), { recursive: true, force: true })
}

describe.skipIf(!prerequisitesPresent)(
  'MCP plugin OAuth tables cascade on user deletion — live end-to-end (issue #992)',
  () => {
    it('deleting a user via better-auth’s own /delete-user removes their OAuth clients, access tokens and consents; another user’s rows survive', async () => {
      const dir = await setupProject()
      try {
        const { auth, context } = await createAuthInstanceForProject(dir)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the temp project's own generated Prisma Client, not a type this package can import
        const prisma = context.prisma as any

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

        // OAuth rows are created through the raw Prisma client — these lists
        // ship closed (ADR-0013), and this is the same path better-auth's own
        // OAuth flows write through in production. better-auth 1.7's OAuth
        // Provider (issue #986) splits what the pre-1.7 MCP plugin modelled
        // as a single "application" with embedded access/refresh tokens into
        // oauthClient (the registered client) plus a standalone
        // oauthAccessToken (no more combined access+refresh token row).
        for (const [suffix, userId] of [
          ['deleted', deletedUserId],
          ['survivor', survivorUserId],
        ]) {
          await prisma.oauthClient.create({
            data: {
              name: `App ${suffix}`,
              clientId: `client-${suffix}`,
              redirectUris: 'http://localhost/callback',
              userId,
            },
          })
          await prisma.oauthAccessToken.create({
            data: {
              token: `access-${suffix}`,
              clientId: `client-${suffix}`,
              scopes: 'openid',
              expiresAt: new Date(Date.now() + 3_600_000),
              // oauthAccessToken declares createdAt but not updatedAt
              // upstream, so it derives as an ordinary required column with
              // no DB-level default (see hasSymmetricTimestamps in
              // derive-auth-lists.ts) — better-auth's own adapter always
              // supplies it explicitly, so this raw-Prisma seed must too.
              createdAt: new Date(),
              userId,
            },
          })
          await prisma.oauthConsent.create({
            data: { clientId: `client-${suffix}`, scopes: 'openid', userId },
          })
        }

        expect(await prisma.oauthClient.count()).toBe(2)
        expect(await prisma.oauthAccessToken.count()).toBe(2)
        expect(await prisma.oauthConsent.count()).toBe(2)

        const deleteResult = await auth.api.deleteUser({
          body: {},
          headers: new Headers({ cookie: deletedCookie }),
        })
        expect(deleteResult).toEqual({ success: true, message: 'User deleted' })

        expect(await prisma.user.findUnique({ where: { id: deletedUserId } })).toBeNull()

        // No orphans: every row belonging to the deleted user is gone via the
        // database cascade, not just the user row itself.
        expect(await prisma.oauthClient.findFirst({ where: { userId: deletedUserId } })).toBeNull()
        expect(
          await prisma.oauthAccessToken.findFirst({ where: { userId: deletedUserId } }),
        ).toBeNull()
        expect(await prisma.oauthConsent.findFirst({ where: { userId: deletedUserId } })).toBeNull()

        // The other user's rows are untouched — the cascade is scoped to the
        // deleted user's own foreign key, not a wholesale table wipe.
        expect(await prisma.user.findUnique({ where: { id: survivorUserId } })).not.toBeNull()
        expect(await prisma.oauthClient.count()).toBe(1)
        expect(await prisma.oauthAccessToken.count()).toBe(1)
        expect(await prisma.oauthConsent.count()).toBe(1)

        await context.prisma.$disconnect()
      } finally {
        await cleanupProject(dir)
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
