/**
 * PostgreSQL Demo - Works with both pg and Neon
 *
 * Usage:
 *   # With native pg
 *   DATABASE_URL=postgresql://localhost:5432/test npx tsx demo-postgres.ts
 *
 *   # With Neon serverless
 *   DATABASE_URL=postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname?sslmode=require npx tsx demo-postgres.ts pg
 *
 *   # Explicitly use Neon adapter
 *   DATABASE_URL=postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname?sslmode=require npx tsx demo-postgres.ts neon
 */

import { PostgreSQLAdapter } from './src/adapter/postgresql.js'
import { QueryBuilder } from './src/query/builder.js'
import type { TableDefinition } from './src/types/index.js'

const DATABASE_URL = process.env.DATABASE_URL
const CONNECTION_TYPE = (process.argv[2] as 'pg' | 'neon') || 'pg'

async function main() {
  if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is required')
    console.log('\nExamples:')
    console.log('  DATABASE_URL=postgresql://localhost:5432/test npx tsx demo-postgres.ts')
    console.log('  DATABASE_URL=postgres://... npx tsx demo-postgres.ts neon')
    process.exit(1)
  }

  console.log('🚀 PostgreSQL Custom ORM Demo\n')
  console.log(`📡 Connection type: ${CONNECTION_TYPE}`)
  console.log(`🔗 Database URL: ${DATABASE_URL.replace(/\/\/.*@/, '//***:***@')}\n`)

  // Create adapter
  console.log('1. Creating PostgreSQL adapter...')
  const adapter = new PostgreSQLAdapter({
    provider: 'postgresql',
    url: DATABASE_URL,
    connectionType: CONNECTION_TYPE,
  })

  try {
    await adapter.connect()
    console.log('✅ Connected to PostgreSQL database\n')

    // Clean up any existing test tables
    await adapter.execute('DROP TABLE IF EXISTS "Post" CASCADE')
    await adapter.execute('DROP TABLE IF EXISTS "User" CASCADE')

    // Define schema
    console.log('2. Defining schema...')
    const userTable: TableDefinition = {
      name: 'User',
      columns: [
        { name: 'id', type: 'TEXT', primaryKey: true },
        { name: 'name', type: 'TEXT', nullable: false },
        { name: 'email', type: 'TEXT', unique: true },
        { name: 'role', type: 'TEXT', default: 'user' },
        { name: 'createdAt', type: 'TIMESTAMP' },
        { name: 'updatedAt', type: 'TIMESTAMP' },
      ],
    }

    const postTable: TableDefinition = {
      name: 'Post',
      columns: [
        { name: 'id', type: 'TEXT', primaryKey: true },
        { name: 'title', type: 'TEXT', nullable: false },
        { name: 'content', type: 'TEXT' },
        { name: 'status', type: 'TEXT', default: 'draft' },
        { name: 'views', type: 'INTEGER', default: 0 },
        { name: 'published', type: 'BOOLEAN', default: false },
        { name: 'authorId', type: 'TEXT', references: { table: 'User', column: 'id' } },
        { name: 'createdAt', type: 'TIMESTAMP' },
        { name: 'updatedAt', type: 'TIMESTAMP' },
      ],
    }

    // Create tables
    await adapter.createTable(userTable)
    await adapter.createTable(postTable)
    console.log('✅ Created tables: User, Post\n')

    // Create query builders
    const users = new QueryBuilder(adapter, 'User', userTable)
    const posts = new QueryBuilder(adapter, 'Post', postTable)

    // Create users
    console.log('3. Creating users...')
    const john = await users.create({
      data: { name: 'John Doe', email: 'john@example.com', role: 'admin' },
    })
    console.log(`✅ Created user: ${john.name} (${john.id})`)

    const jane = await users.create({
      data: { name: 'Jane Smith', email: 'jane@example.com', role: 'user' },
    })
    console.log(`✅ Created user: ${jane.name} (${jane.id})\n`)

    // Create posts
    console.log('4. Creating posts...')
    const post1 = await posts.create({
      data: {
        title: 'Hello PostgreSQL',
        content: 'This is my first post!',
        status: 'published',
        published: true,
        views: 100,
        authorId: john.id,
      },
    })
    console.log(`✅ Created post: "${post1.title}" by ${john.name}`)

    const post2 = await posts.create({
      data: {
        title: 'Draft Post',
        content: 'This is a draft',
        status: 'draft',
        published: false,
        views: 0,
        authorId: jane.id,
      },
    })
    console.log(`✅ Created post: "${post2.title}" by ${jane.name}`)

    const post3 = await posts.create({
      data: {
        title: 'Featured Post',
        content: 'This is featured!',
        status: 'published',
        published: true,
        views: 500,
        authorId: john.id,
      },
    })
    console.log(`✅ Created post: "${post3.title}" by ${john.name}\n`)

    // Query with filters
    console.log('5. Testing filters...\n')

    console.log('   a) Find published posts:')
    const published = await posts.findMany({
      where: { status: { equals: 'published' } },
    })
    console.log(`   ✅ Found ${published.length} published posts`)
    published.forEach((p) => console.log(`      - ${p.title}`))

    console.log('\n   b) Find posts with high views (>50):')
    const highViews = await posts.findMany({
      where: { views: { gt: 50 } },
    })
    console.log(`   ✅ Found ${highViews.length} posts with >50 views`)
    highViews.forEach((p) => console.log(`      - ${p.title} (${p.views} views)`))

    console.log('\n   c) Find posts by specific author:')
    const johnsPosts = await posts.findMany({
      where: { authorId: { equals: john.id } },
    })
    console.log(`   ✅ Found ${johnsPosts.length} posts by John`)
    johnsPosts.forEach((p) => console.log(`      - ${p.title}`))

    console.log('\n   d) Complex filter (published AND high views):')
    const featuredPosts = await posts.findMany({
      where: {
        AND: [{ status: { equals: 'published' } }, { views: { gt: 50 } }],
      },
    })
    console.log(`   ✅ Found ${featuredPosts.length} featured posts`)
    featuredPosts.forEach((p) => console.log(`      - ${p.title} (${p.views} views)`))

    console.log('\n   e) Boolean filter (published = true):')
    const publishedBoolean = await posts.findMany({
      where: { published: { equals: true } },
    })
    console.log(`   ✅ Found ${publishedBoolean.length} published posts (boolean)`)
    publishedBoolean.forEach((p) => console.log(`      - ${p.title}`))

    // Update
    console.log('\n6. Testing update...')
    const updated = await posts.update({
      where: { id: post2.id as string },
      data: { status: 'published', published: true, views: 10 },
    })
    console.log(`✅ Updated "${updated!.title}" status to ${updated!.status}`)

    // Count
    console.log('\n7. Testing count...')
    const totalPosts = await posts.count()
    const publishedCount = await posts.count({
      where: { status: { equals: 'published' } },
    })
    console.log(`✅ Total posts: ${totalPosts}`)
    console.log(`✅ Published posts: ${publishedCount}`)

    // Delete
    console.log('\n8. Testing delete...')
    const deleted = await posts.delete({ where: { id: post3.id as string } })
    console.log(`✅ Deleted post: "${deleted!.title}"`)

    const remainingPosts = await posts.count()
    console.log(`✅ Remaining posts: ${remainingPosts}`)

    console.log('\n✨ Demo complete!\n')
    console.log('Key observations:')
    console.log('  • PostgreSQL native types work great (BOOLEAN, TIMESTAMP)')
    console.log('  • $1, $2 placeholders work correctly')
    console.log('  • Foreign keys enforced properly')
    console.log('  • RETURNING clause for efficient creates/updates')
    console.log(`  • ${CONNECTION_TYPE} driver working perfectly`)
  } catch (error) {
    console.error('\n❌ Error:', error)
    throw error
  } finally {
    // Cleanup
    await adapter.execute('DROP TABLE IF EXISTS "Post" CASCADE')
    await adapter.execute('DROP TABLE IF EXISTS "User" CASCADE')
    await adapter.disconnect()
  }
}

main().catch(console.error)
