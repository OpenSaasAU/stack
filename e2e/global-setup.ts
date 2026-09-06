import * as fs from 'node:fs'
import * as path from 'node:path'
import { FullConfig } from '@playwright/test'
import { setupDatabase } from './utils/db.js'

/**
 * The example's `.env` is written without a `DATABASE_URL`: setting one is the
 * Database escape, and the app would then take the `'env'` branch of the
 * lookup rather than finding the Dev database this run starts (ADR-0063). In
 * CI the variable is on the job, which is exactly how the container is chosen.
 */
function writeEnvFile(exampleDir: string): void {
  fs.writeFileSync(
    path.join(exampleDir, '.env'),
    [
      'BETTER_AUTH_SECRET="test-secret-key-for-e2e-tests-only-not-for-production-use"',
      'BETTER_AUTH_URL="http://localhost:3000"',
      'NEXT_PUBLIC_APP_URL="http://localhost:3000"',
      '',
    ].join('\n'),
    'utf8',
  )
}

async function globalSetup(_config: FullConfig) {
  console.log('=== Global Setup for E2E Tests ===')

  const exampleDir = path.join(process.cwd(), 'examples/starter-auth')
  writeEnvFile(exampleDir)

  const { url, provenance } = await setupDatabase(exampleDir)
  console.log(
    `Database ready (${provenance}): ${provenance === 'dev-database' ? url : 'the DATABASE_URL server'}`,
  )

  console.log('=== Global Setup Complete ===\n')
}

export default globalSetup
