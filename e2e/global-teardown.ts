import { FullConfig } from '@playwright/test'
import { cleanupDatabase } from './utils/db.js'
import * as path from 'path'

async function globalTeardown(_config: FullConfig) {
  console.log('\n=== Global Teardown for E2E Tests ===')

  const exampleDir = path.join(process.cwd(), 'examples/starter-auth')

  // Cleanup database
  console.log('Cleaning up database...')
  try {
    cleanupDatabase(exampleDir)
    console.log('Database cleanup complete')
  } catch (error) {
    console.warn('Database cleanup failed (this is ok):', error)
  }

  console.log('=== Global Teardown Complete ===')
}

export default globalTeardown
