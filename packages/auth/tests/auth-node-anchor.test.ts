// The plain-Node anchor for better-auth (ADR-0054, ADR-0060): the real `node`
// binary, no flags, no loader, no bundler, creating a user through
// `createAuth` over the natively loaded generated bundle.
//
// `packages/cli/tests/bundle-node-load.test.ts` guards the non-auth half of
// ADR-0054 — that the bundle's module graph loads — and stops before a
// connection is opened. This one dials: it stands the Dev database up in this
// process, hands the subprocess its TCP URL, and asserts a row reaches the
// database through the Auth adapter.
//
// It does not live in `examples/starter-auth`, where ADR-0060 originally put
// it: the examples do not build until the Prisma 8 spec's example conversion
// (#1178), and #1138 deleted the script this replaces rather than re-targeting
// it. The fixture project below is the smallest thing that can actually run
// today — an `opensaas.config.ts` with `authPlugin` and nothing else.
//
// The scratch project sits inside this package so Node resolution reaches its
// `node_modules` for `@opensaas/stack-core`, `better-auth` and
// `@prisma/orm-postgres`, and outside `node_modules` itself so type stripping
// applies. `@opensaas/stack-auth` is linked into the project's own
// `node_modules` because a package does not resolve itself.

import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { config as defineConfig } from '@opensaas/stack-core'
import { createTestDatabase, type TestDatabase } from '@opensaas/stack-core/testing'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { authPlugin } from '../src/config/plugin.js'
import { getAuthListRegistry } from '../src/lists/index.js'
import type { NormalizedAuthConfig } from '../src/config/types.js'

const BOOT = 240_000

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureConfig = path.join(
  packageRoot,
  'tests',
  'fixtures',
  'node-anchor',
  'opensaas.config.ts',
)
const cliEntry = path.join(
  packageRoot,
  'node_modules',
  '@opensaas',
  'stack-cli',
  'bin',
  'opensaas.js',
)
const scratchRoot = fs.mkdtempSync(path.join(packageRoot, 'tests', 'tmp-node-anchor-'))

const ANCHOR_EMAIL = 'anchor@example.com'

/**
 * `process.exit` rather than a natural end: the resolved context holds an open
 * connection to the Dev database, which would otherwise keep the event loop
 * alive past the assertion this probe exists to make.
 */
const PROBE = `import { createAuth } from '@opensaas/stack-auth/server'
import config from './opensaas.config.ts'
import { rawOpensaasContext } from './.opensaas/context.ts'

const auth = createAuth(config, rawOpensaasContext)
const result = await auth.api.signUpEmail({
  body: { email: '${ANCHOR_EMAIL}', password: 'anchor-password-1', name: 'Anchor' },
})

if (typeof result?.user?.id !== 'string') {
  throw new Error('signUpEmail returned no user id under plain Node')
}
console.log('ANCHOR_USER_CREATED', result.user.id)
process.exit(0)
`

/** What a finished child reports, gathered without blocking this process. */
interface Run {
  readonly output: string
  readonly status: number | null
  readonly signal: string | null
}

/**
 * `spawnSync` is what the CLI's own anchor uses, and it cannot be used here:
 * the Dev database is an in-process PGlite served over a socket by *this*
 * process's event loop, so blocking on the child would starve the very server
 * the child is dialling.
 */
function run(
  command: string,
  args: readonly string[],
  env: Record<string, string | undefined>,
): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: projectDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.setEncoding('utf-8')
    child.stderr.setEncoding('utf-8')
    child.stdout.on('data', (chunk: string) => (output += chunk))
    child.stderr.on('data', (chunk: string) => (output += chunk))
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (status, signal) => {
      clearTimeout(timer)
      resolve({ output, status, signal })
    })
  })
}

let database: TestDatabase
let opensaasConfig: OpenSaasConfig
let registry: Record<string, string>
let projectDir = ''
let generate: Run
let probe: Run

describe('the Auth adapter creates a user under plain Node', () => {
  beforeAll(async () => {
    expect(
      fs.existsSync(path.join(packageRoot, 'dist', 'server', 'index.js')),
      'the auth package must be built before this test runs (turbo `test` dependsOn `build`)',
    ).toBe(true)

    opensaasConfig = await defineConfig({
      plugins: [authPlugin({ emailAndPassword: { enabled: true } })],
      db: { provider: 'postgresql' },
      lists: {},
    })
    database = await createTestDatabase(opensaasConfig)
    const normalized = opensaasConfig._pluginData?.auth as NormalizedAuthConfig
    registry = getAuthListRegistry(normalized.models, normalized.betterAuthPlugins)

    projectDir = path.join(scratchRoot, 'auth-project')
    fs.mkdirSync(path.join(projectDir, 'node_modules', '@opensaas'), { recursive: true })
    fs.symlinkSync(
      packageRoot,
      path.join(projectDir, 'node_modules', '@opensaas', 'stack-auth'),
      'dir',
    )
    // The generated `prisma.config.ts` imports `prisma/config`, and this
    // package's own tree carries only the Prisma 7 that better-auth's optional
    // peers still pull into the store (#1178). A real generated project
    // installs the toolchain itself; this is that install.
    fs.symlinkSync(
      path.join(packageRoot, '..', 'cli', 'node_modules', 'prisma'),
      path.join(projectDir, 'node_modules', 'prisma'),
      'dir',
    )
    fs.copyFileSync(fixtureConfig, path.join(projectDir, 'opensaas.config.ts'))

    generate = await run(process.execPath, [cliEntry, 'generate'], process.env)

    fs.writeFileSync(path.join(projectDir, 'probe.mjs'), PROBE, 'utf-8')

    // The provenance of the connection is load-bearing: only on the Dev
    // database's own state file does the generated bundle bind the single
    // connection `pglite-socket` needs, and injecting a `DATABASE_URL` for it
    // is exactly what ADR-0063 forbids. On the escape a real server is there
    // and the variable is the right binding.
    const env: Record<string, string | undefined> = {
      ...process.env,
      BETTER_AUTH_SECRET: 'plain-node-anchor-secret',
      BETTER_AUTH_URL: 'http://localhost:3000',
    }
    if (database.provenance === 'escape') {
      env.DATABASE_URL = database.url
    } else {
      delete env.DATABASE_URL
      delete env.DIRECT_DATABASE_URL
      fs.mkdirSync(path.join(projectDir, '.opensaas'), { recursive: true })
      fs.writeFileSync(
        path.join(projectDir, '.opensaas', 'dev-db.json'),
        JSON.stringify({ url: database.url, pid: process.pid }),
        'utf-8',
      )
    }

    probe = await run(process.execPath, ['probe.mjs'], env)
  }, BOOT)

  afterAll(async () => {
    await database?.close()
    fs.rmSync(scratchRoot, { recursive: true, force: true })
  })

  test('opensaas generate succeeds', () => {
    expect(generate.output, generate.output).toContain('Generation complete')
    expect(generate.status, generate.output).toBe(0)
  })

  test('the real node binary signs a user up with no flags', () => {
    expect(probe.signal, probe.output).toBe(null)
    expect(probe.output, probe.output).toContain('ANCHOR_USER_CREATED')
    expect(probe.status, probe.output).toBe(0)
  })

  test('the row reached the database', async () => {
    const listKey = registry.user
    const listDb = opensaasConfig.lists[listKey]?.db
    const schema = listDb?.schema ?? 'public'
    const table = listDb?.map ?? listKey

    const client = new pg.Client({ connectionString: database.url })
    await client.connect()
    try {
      const found = await client.query<{ email: string }>(
        `select email from "${schema}"."${table}" where email = $1`,
        [ANCHOR_EMAIL],
      )
      expect(found.rows).toHaveLength(1)
    } finally {
      await client.end()
    }
  })
})
