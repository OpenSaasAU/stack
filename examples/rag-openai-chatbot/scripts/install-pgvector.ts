#!/usr/bin/env tsx

/**
 * Install pgvector extension in PostgreSQL database
 * Run with: npx tsx scripts/install-pgvector.ts
 *
 * Runs on its own `pg` connection rather than through the stack context: this
 * is a bootstrap step for the database the context is later built over, and
 * `CREATE EXTENSION` is DDL that neither `context.db` nor the typed lanes of
 * `context.unsafe` express.
 */

import pg from 'pg'

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set')

  const client = new pg.Client({ connectionString })
  await client.connect()

  try {
    console.log('Installing pgvector extension...')

    await client.query('CREATE EXTENSION IF NOT EXISTS vector;')

    console.log('✅ pgvector extension installed successfully!')

    const result = await client.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname = 'vector';"
    )

    if (result.rows.length > 0) {
      console.log('✅ Verified: pgvector extension is active')
    } else {
      console.warn('⚠️  Warning: Could not verify pgvector installation')
    }
  } catch (error) {
    console.error('❌ Failed to install pgvector extension:', error)
    console.error('\nPossible solutions:')
    console.error('1. Install pgvector on your PostgreSQL server:')
    console.error('   - Mac (Homebrew): brew install pgvector')
    console.error('   - Ubuntu: sudo apt install postgresql-16-pgvector')
    console.error('   - Docker: Use postgres image with pgvector')
    console.error('\n2. Use a managed PostgreSQL service with pgvector support:')
    console.error('   - Supabase')
    console.error('   - Neon')
    console.error('   - AWS RDS with pgvector')
    console.error('\n3. Fallback to JSON storage (slower, no vector indexes):')
    console.error('   - Change storage config to: jsonStorage()')
    process.exit(1)
  } finally {
    await client.end()
  }
}

main()
