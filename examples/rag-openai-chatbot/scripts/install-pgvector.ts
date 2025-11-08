#!/usr/bin/env tsx

/**
 * Install pgvector extension in PostgreSQL database
 * Run with: npx tsx scripts/install-pgvector.ts
 */

import { PrismaClient } from '@/.opensaas/prisma-client/client'

async function main() {
  const prisma = new PrismaClient()

  try {
    console.log('Installing pgvector extension...')

    // Install pgvector extension
    await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector;')

    console.log('✅ pgvector extension installed successfully!')

    // Verify installation
    const result = await prisma.$queryRawUnsafe<Array<{ extname: string }>>(
      "SELECT extname FROM pg_extension WHERE extname = 'vector';"
    )

    if (result.length > 0) {
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
    await prisma.$disconnect()
  }
}

main()
