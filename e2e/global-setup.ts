import { FullConfig } from '@playwright/test'
import { setupDatabase } from './utils/db.js'
import * as path from 'path'
import * as fs from 'fs'

async function globalSetup(_config: FullConfig) {
  console.log('=== Global Setup for E2E Tests ===')

  const exampleDir = path.join(process.cwd(), 'examples/starter-auth')

  // Ensure .env file exists
  const envPath = path.join(exampleDir, '.env')
  const envExamplePath = path.join(exampleDir, '.env.example')

  if (!fs.existsSync(envPath)) {
    console.log('Creating .env file from .env.example...')
    if (fs.existsSync(envExamplePath)) {
      let envContent = fs.readFileSync(envExamplePath, 'utf-8')

      // Set default values for testing
      envContent = envContent.replace(
        /BETTER_AUTH_SECRET=.*/,
        'BETTER_AUTH_SECRET="test-secret-key-for-e2e-tests-only-not-for-production-use"',
      )
      envContent = envContent.replace(
        /BETTER_AUTH_URL=.*/,
        'BETTER_AUTH_URL="http://localhost:3000"',
      )
      envContent = envContent.replace(/DATABASE_URL=.*/, 'DATABASE_URL="file:./dev.db"')

      fs.writeFileSync(envPath, envContent)
      console.log('.env file created successfully')
    } else {
      console.warn('.env.example not found, creating minimal .env')
      const minimalEnv = `DATABASE_URL="file:./dev.db"
BETTER_AUTH_SECRET="test-secret-key-for-e2e-tests-only-not-for-production-use"
BETTER_AUTH_URL="http://localhost:3000"
`
      fs.writeFileSync(envPath, minimalEnv)
    }
  }

  // Setup database
  console.log('Setting up database...')
  try {
    setupDatabase(exampleDir)
    console.log('Database setup complete')
  } catch (error) {
    console.error('Database setup failed:', error)
    if (error instanceof Error) {
      console.error('Error details:', error.message)
      console.error('Stack trace:', error.stack)
    }
    throw error
  }

  console.log('=== Global Setup Complete ===\n')
  console.log('Next.js dev server will start shortly...')
  console.log('If server startup fails, check that:')
  console.log('  1. All packages are built (pnpm build)')
  console.log('  2. Dependencies are installed (pnpm install)')
  console.log('  3. Database is set up (pnpm generate && pnpm db:push)')
  console.log('')
}

export default globalSetup
