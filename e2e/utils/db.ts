import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Setup database for E2E tests
 * Creates a fresh database and runs migrations
 */
export function setupDatabase(exampleDir: string) {
  const dbPath = path.join(exampleDir, 'dev.db')
  const prismaDir = path.join(exampleDir, 'prisma')

  console.log(`Setting up database in: ${exampleDir}`)

  // Remove existing database
  if (fs.existsSync(dbPath)) {
    console.log('Removing existing database...')
    fs.unlinkSync(dbPath)
  }

  // Remove existing migrations
  const migrationsDir = path.join(prismaDir, 'migrations')
  if (fs.existsSync(migrationsDir)) {
    console.log('Removing existing migrations...')
    fs.rmSync(migrationsDir, { recursive: true, force: true })
  }

  // Generate schema
  console.log('Generating Prisma schema and types...')
  try {
    execSync('pnpm generate', {
      cwd: exampleDir,
      stdio: 'inherit',
    })
  } catch (error) {
    console.error('Failed to generate schema')
    throw error
  }

  // Push schema to database
  console.log('Pushing schema to database...')
  try {
    execSync('pnpm db:push --accept-data-loss', {
      cwd: exampleDir,
      stdio: 'inherit',
    })
  } catch (error) {
    console.error('Failed to push schema to database')
    throw error
  }

  console.log('Database setup completed successfully')
}

/**
 * Clean up database after tests
 */
export function cleanupDatabase(exampleDir: string) {
  const dbPath = path.join(exampleDir, 'dev.db')

  // Remove database file
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath)
  }

  // Remove journal file if it exists
  const journalPath = `${dbPath}-journal`
  if (fs.existsSync(journalPath)) {
    fs.unlinkSync(journalPath)
  }
}
