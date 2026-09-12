import * as fs from 'node:fs'
import * as path from 'node:path'
import { FullConfig } from '@playwright/test'
import { exampleDatabaseUrl, setupDatabase } from './utils/db.js'

const REQUIRED_ENV: readonly (readonly [string, string])[] = [
  ['BETTER_AUTH_SECRET', 'test-secret-key-for-e2e-tests-only-not-for-production-use'],
  ['BETTER_AUTH_URL', 'http://localhost:3000'],
  ['NEXT_PUBLIC_APP_URL', 'http://localhost:3000'],
]

/**
 * Adds the variables the app needs to serve, without touching anything already
 * in the file — a contributor's `.env` can hold real OAuth secrets.
 *
 * No `DATABASE_URL` is added: setting one is the Database escape, and the app
 * would then take the `'env'` branch of the lookup rather than finding the Dev
 * database this run starts (ADR-0063). One a contributor put there themselves
 * is left alone, because that escape is theirs to take. In CI the variable is
 * on the job, which is exactly how the container is chosen.
 */
function writeEnvFile(exampleDir: string): void {
  const envPath = path.join(exampleDir, '.env')
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
  const missing = REQUIRED_ENV.filter(
    ([key]) => !new RegExp(`^\\s*(export\\s+)?${key}\\s*=`, 'm').test(existing),
  )
  if (missing.length === 0) return

  const prefix = existing === '' || existing.endsWith('\n') ? existing : `${existing}\n`
  const added = missing.map(([key, value]) => `${key}="${value}"`).join('\n')
  fs.writeFileSync(envPath, `${prefix}${added}\n`, 'utf8')
}

/**
 * Runs `fn` with `DATABASE_URL` swapped to `override` for its duration, so a
 * `setupDatabase` call for one example reconciles against that example's own
 * database rather than the job-level one every process inherits. A no-op when
 * `override` is `undefined` (the `dev-database` leg, where nothing needs it).
 */
async function withDatabaseUrl<T>(override: string | undefined, fn: () => Promise<T>): Promise<T> {
  if (override === undefined) return fn()
  const original = process.env.DATABASE_URL
  process.env.DATABASE_URL = override
  try {
    return await fn()
  } finally {
    if (original === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = original
  }
}

async function globalSetup(_config: FullConfig) {
  console.log('=== Global Setup for E2E Tests ===')

  const exampleDir = path.join(process.cwd(), 'examples/starter-auth')
  writeEnvFile(exampleDir)

  const { url, provenance } = await setupDatabase(exampleDir)
  console.log(
    `Database ready (${provenance}): ${provenance === 'dev-database' ? url : 'the DATABASE_URL server'}`,
  )

  // Neither example wires authPlugin, so neither needs a `.env`.
  const jsonDemoDir = path.join(process.cwd(), 'examples/json-demo')
  await withDatabaseUrl(exampleDatabaseUrl('json_demo_example'), () => setupDatabase(jsonDemoDir))
  console.log('Database ready for examples/json-demo')

  const tiptapDemoDir = path.join(process.cwd(), 'examples/tiptap-demo')
  await withDatabaseUrl(exampleDatabaseUrl('tiptap_demo_example'), () =>
    setupDatabase(tiptapDemoDir),
  )
  console.log('Database ready for examples/tiptap-demo')

  console.log('=== Global Setup Complete ===\n')
}

export default globalSetup
