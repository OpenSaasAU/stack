import { FullConfig } from '@playwright/test'
import { cleanupDatabase } from './utils/db.js'

async function globalTeardown(_config: FullConfig) {
  console.log('\n=== Global Teardown for E2E Tests ===')
  await cleanupDatabase()
  console.log('=== Global Teardown Complete ===')
}

export default globalTeardown
