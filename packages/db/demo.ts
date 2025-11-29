/**
 * Demo script showing custom ORM in action
 *
 * Run with: npx tsx demo.ts
 */

import { SQLiteAdapter } from './src/adapter/sqlite.js'
import { QueryBuilder } from './src/query/builder.js'
import type { TableDefinition } from './src/types/index.js'
import * as fs from 'fs'

const DB_PATH = './demo.db'

async function main() {
  console.log('🚀 Custom ORM Demo\n')

  // Clean up
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH)
  }

  // Create adapter
  console.log('1. Creating SQLite adapter...')
  const adapter = new SQLiteAdapter({
    provider: 'sqlite',
    url: `file:${DB_PATH}`,
  })

  await adapter.connect()
  console.log('✅ Connected to database\n')

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
      { name: 'authorId', type: 'TEXT', references: { table: 'User', column: 'id' } },
      { name: 'createdAt', type: 'TIMESTAMP' },
      { name: 'updatedAt', type: 'TIMESTAMP' },
    ],
  }

  // Create tables
  await adapter.createTable(userTable)
  await adapter.createTable(postTable)
  console.log('✅ Created tables: User, Post\n')

  // Create query builders with relationship metadata
  const users = new QueryBuilder(adapter, 'User', userTable, {
    posts: {
      name: 'posts',
      type: 'one-to-many',
      targetTable: 'Post',
      foreignKey: 'authorId',
    },
  })

  const posts = new QueryBuilder(adapter, 'Post', postTable, {
    author: {
      name: 'author',
      type: 'many-to-one',
      targetTable: 'User',
      foreignKey: 'authorId',
    },
  })

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
      title: 'Hello World',
      content: 'This is my first post!',
      status: 'published',
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

  console.log('\n   e) Access control simulation (merge filters):')
  // Simulate access control: user can only see their own drafts
  const userFilter = { authorId: { equals: jane.id } }
  const accessFilter = { status: { equals: 'draft' } }
  const mergedFilter = {
    AND: [userFilter, accessFilter],
  }
  const userDrafts = await posts.findMany({ where: mergedFilter })
  console.log(`   ✅ Found ${userDrafts.length} draft posts by Jane`)
  userDrafts.forEach((p) => console.log(`      - ${p.title}`))

  // Update
  console.log('\n6. Testing update...')
  const updated = await posts.update({
    where: { id: post2.id as string },
    data: { status: 'published', views: 10 },
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

  // Relationship loading with include
  console.log('\n9. Testing relationship loading (include)...\n')

  console.log('   a) Load post with author (many-to-one):')
  const postWithAuthor = await posts.findUnique({
    where: { id: post1.id as string },
    include: { author: true },
  })
  console.log(`   ✅ Post: "${postWithAuthor!.title}"`)
  console.log(
    `      Author: ${(postWithAuthor!.author as any).name} (${(postWithAuthor!.author as any).email})`,
  )

  console.log('\n   b) Load user with all posts (one-to-many):')
  const userWithPosts = await users.findUnique({
    where: { id: john.id as string },
    include: { posts: true },
  })
  console.log(`   ✅ User: ${userWithPosts!.name}`)
  console.log(`      Posts: ${(userWithPosts!.posts as any[]).length} total`)
  ;(userWithPosts!.posts as any[]).forEach((p: any) => {
    console.log(`      - ${p.title} (${p.status})`)
  })

  console.log('\n   c) Load user with filtered posts (published only):')
  const userWithPublishedPosts = await users.findUnique({
    where: { id: john.id as string },
    include: {
      posts: {
        where: { status: { equals: 'published' } },
      },
    },
  })
  console.log(`   ✅ User: ${userWithPublishedPosts!.name}`)
  console.log(`      Published posts: ${(userWithPublishedPosts!.posts as any[]).length}`)
  ;(userWithPublishedPosts!.posts as any[]).forEach((p: any) => {
    console.log(`      - ${p.title}`)
  })

  console.log('\n   d) Load all posts with authors:')
  const postsWithAuthors = await posts.findMany({
    where: { status: { equals: 'published' } },
    include: { author: true },
  })
  console.log(`   ✅ Found ${postsWithAuthors.length} published posts with authors`)
  postsWithAuthors.forEach((p: any) => {
    console.log(`      - "${p.title}" by ${p.author.name}`)
  })

  // Cleanup
  await adapter.disconnect()
  fs.unlinkSync(DB_PATH)

  console.log('\n✨ Demo complete!\n')
  console.log('Key observations:')
  console.log('  • Filter syntax is clean and composable')
  console.log('  • Access control merging is trivial (just AND filters)')
  console.log('  • No impedance mismatch - direct config to DB')
  console.log('  • Type-safe and predictable')
  console.log('  • No generated code needed')
  console.log('  • Relationship loading works seamlessly with include')
  console.log('  • Nested where filters in includes for fine-grained control')
}

main().catch(console.error)
