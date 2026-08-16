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
 * Live end-to-end proof that the database-backed rate limiter (issue #909)
 * actually works: it generates a real Prisma schema (with the derived
 * `RateLimit` list), pushes it to a real SQLite database, constructs real
 * `betterAuth()` instances against that database via `createAuth()` (the
 * package's own source, not a stale build), and drives them through real
 * HTTP-shaped requests via `auth.handler()`.
 *
 * This is the one guard in the suite that touches a live database, so it
 * follows the same pattern as
 * `packages/create-opensaas-app/tests/scaffold-first-run-guard.test.ts`
 * (see ADR-0002): opt-in via an env flag, kept out of the fast unit lane, run
 * only in the `e2e` CI job where `pnpm install && pnpm build` have already
 * run. It borrows the `opensaas`/`prisma` binaries and the
 * `@prisma/adapter-better-sqlite3` dependency from `examples/starter-auth`'s
 * already-installed `node_modules` (symlinked into an OS temp dir) instead of
 * adding a live-database toolchain to this package's own dependencies.
 */

const run = promisify(execFile)
const here = path.dirname(new URL(import.meta.url).pathname)
const repoRoot = path.resolve(here, '../../..')

/** The `opensaas` CLI the temp project's `generate` step invokes. */
const opensaasCli = path.join(repoRoot, 'packages/cli/dist/index.js')
/** `createAuth()` (imported from source above) resolves `@opensaas/stack-core` through this build. */
const coreDist = path.join(repoRoot, 'packages/core/dist')

/** The toolchain (opensaas/prisma binaries + the sqlite adapter) borrowed from a working example. */
const toolchainNodeModules = path.join(repoRoot, 'examples/starter-auth/node_modules')

const guardEnabled = process.env.RUN_RATE_LIMIT_E2E === '1'

const prerequisitesPresent =
  guardEnabled &&
  existsSync(opensaasCli) &&
  existsSync(coreDist) &&
  existsSync(path.join(toolchainNodeModules, '.bin', 'opensaas')) &&
  existsSync(path.join(toolchainNodeModules, '.bin', 'prisma')) &&
  existsSync(path.join(toolchainNodeModules, '@prisma', 'adapter-better-sqlite3'))

/** Build the temp project's `opensaas.config.ts`: sqlite + a database-backed rate limiter. */
function makeConfigSource(window: number, max: number): string {
  return `import { config } from '@opensaas/stack-core'
import { authPlugin } from '@opensaas/stack-auth'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

export default config({
  plugins: [
    authPlugin({
      emailAndPassword: { enabled: true },
      rateLimit: { enabled: true, window: ${window}, max: ${max}, storage: 'database' },
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

/** A GET request against a real (rate-limited) better-auth endpoint from a fixed "client". */
function sessionRequest(ip: string): Request {
  return new Request('http://localhost:3000/api/auth/get-session', {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  })
}

/** Scaffold a fresh temp project with the given window/max and push its schema. Returns the project dir. */
async function setupProject(window: number, max: number): Promise<string> {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'opensaas-ratelimit-e2e-'))
  const dir = path.join(tmpRoot, 'project')
  await fsp.mkdir(dir, { recursive: true })

  await fsp.writeFile(path.join(dir, 'opensaas.config.ts'), makeConfigSource(window, max))
  await fsp.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify(
      { name: 'ratelimit-e2e-project', version: '0.0.0', private: true, type: 'module' },
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

/**
 * Import the temp project's config + generated context and build a real auth
 * instance via `createAuth()`. Each call produces a genuinely separate
 * `betterAuth()` instance — `createAuth()`'s lazy proxy calls `betterAuth()`
 * fresh on first use inside its own closure (see `src/server/index.ts`), so
 * two calls here are two independently-constructed `Auth` objects even when
 * (as here) they resolve through the same imported `rawOpensaasContext`
 * module — itself just the standard Prisma-connection-pooling shape a real
 * app would also share across requests. What distinguishes this from
 * in-memory rate-limit storage is that each `betterAuth()` instance keeps no
 * limiter state of its own — every read/write round-trips through Prisma to
 * the shared on-disk table, which is exactly the property under test.
 */
async function createAuthInstanceForProject(dir: string) {
  // The config's `prismaClientConstructor` reads `process.env.DATABASE_URL` at
  // runtime (unlike the `generate`/`db push` subprocesses, which received it
  // via their own `env`). An absolute path avoids it resolving relative to
  // the test process's cwd instead of the temp project dir.
  process.env.DATABASE_URL = `file:${path.join(dir, 'dev.db')}`

  // `@vite-ignore` suppresses Vite's static analysis of this computed,
  // external (outside the package root) specifier — it isn't something Vite
  // could usefully pre-bundle anyway.
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

/** Unlink the borrowed node_modules symlink (never recurse into/delete the real one) and remove the temp root. */
async function cleanupProject(dir: string): Promise<void> {
  // The generated `.opensaas/context.ts` caches its Prisma client on
  // `globalThis.prisma` outside `NODE_ENV === 'production'` (the standard
  // dev-mode HMR pattern, so a hot reload doesn't open a fresh connection
  // every time). That's process-wide, not per-module — so the NEXT temp
  // project created in this same test process would otherwise inherit THIS
  // one's already-cached client, silently pointed at a temp dir this
  // function is about to delete. Clear it so each project's own
  // `prismaClientConstructor` runs fresh.
  delete (globalThis as { prisma?: unknown }).prisma

  const linkPath = path.join(dir, 'node_modules')
  if (existsSync(linkPath)) {
    await fsp.unlink(linkPath)
  }
  await fsp.rm(path.dirname(dir), { recursive: true, force: true })
}

describe.skipIf(!prerequisitesPresent)(
  'database-backed rate limiter — live end-to-end (issue #909)',
  () => {
    it('rejects requests once the count exceeds max within the window, against a real generated RateLimit table', async () => {
      const dir = await setupProject(60, 3)
      try {
        const { auth, context } = await createAuthInstanceForProject(dir)
        const ip = '203.0.113.10'

        const statuses: number[] = []
        for (let i = 0; i < 5; i++) {
          const res = await auth.handler(sessionRequest(ip))
          statuses.push(res.status)
        }

        // First `max` (3) requests succeed, everything past it is rejected.
        expect(statuses.slice(0, 3)).toEqual([200, 200, 200])
        expect(statuses.slice(3)).toEqual([429, 429])
        await context.prisma.$disconnect()
      } finally {
        await cleanupProject(dir)
      }
    }, 120_000)

    it('persists the counter across two separately-constructed auth instances sharing the database', async () => {
      const dir = await setupProject(60, 3)
      try {
        const ip = '198.51.100.20'

        // Two independently-constructed betterAuth() instances (via two
        // separate createAuth() lazy proxies), sharing one sqlite file —
        // the property in-memory storage does not have.
        const { auth: authA } = await createAuthInstanceForProject(dir)
        const { auth: authB, context } = await createAuthInstanceForProject(dir)

        expect((await authA.handler(sessionRequest(ip))).status).toBe(200)
        expect((await authA.handler(sessionRequest(ip))).status).toBe(200)
        expect((await authA.handler(sessionRequest(ip))).status).toBe(200)

        // Instance B, constructed fresh and never having handled a request
        // for this IP, must see A's persisted counter via the database and
        // reject — proof the limiter state lives in the DB, not in-process.
        expect((await authB.handler(sessionRequest(ip))).status).toBe(429)
        await context.prisma.$disconnect()
      } finally {
        await cleanupProject(dir)
      }
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
    // The guard is opted in but its build/toolchain prerequisites are
    // missing — surface why, mirroring the scaffold guard's message.
    console.warn(
      '[rate-limit-e2e] RUN_RATE_LIMIT_E2E=1 was set but prerequisites are missing. ' +
        'Run `pnpm install && pnpm build` (and ensure examples/starter-auth has been installed) first.',
    )
  })
})
