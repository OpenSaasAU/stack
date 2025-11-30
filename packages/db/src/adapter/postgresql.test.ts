/**
 * PostgreSQL adapter tests
 *
 * NOTE: These tests require a PostgreSQL database to be running.
 * Set DATABASE_URL environment variable to run these tests.
 *
 * Example:
 *   DATABASE_URL=postgresql://localhost:5432/test pnpm test postgresql
 *
 * Or skip these tests if DATABASE_URL is not set (they'll be skipped automatically)
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { PostgreSQLAdapter } from './postgresql.js'
import { QueryBuilder } from '../query/builder.js'
import type { TableDefinition } from '../types/index.js'
import type { PostgresDriver } from './postgresql.js'

// Skip tests if DATABASE_URL is not set
const DATABASE_URL = process.env.DATABASE_URL
const shouldRun = DATABASE_URL && DATABASE_URL.includes('postgres')

describe.skipIf(!shouldRun)('PostgreSQLAdapter', () => {
  let adapter: PostgreSQLAdapter
  let driver: PostgresDriver

  beforeAll(async () => {
    if (!shouldRun) {
      console.log('⏭️  Skipping PostgreSQL tests (DATABASE_URL not set)')
    }
  })

  beforeEach(async () => {
    if (!DATABASE_URL) return

    // Create driver instance (dependency injection pattern)
    const pg = await import('pg')
    const { Pool } = pg.default

    driver = new Pool({
      connectionString: DATABASE_URL,
    })

    // Create adapter with driver
    adapter = new PostgreSQLAdapter({
      provider: 'postgresql',
      driver,
    })

    await adapter.connect()

    // Clean up test tables
    await adapter.execute('DROP TABLE IF EXISTS posts CASCADE')
    await adapter.execute('DROP TABLE IF EXISTS users CASCADE')
    await adapter.execute('DROP TABLE IF EXISTS articles CASCADE')
    await adapter.execute('DROP TABLE IF EXISTS "Post" CASCADE')
    await adapter.execute('DROP TABLE IF EXISTS "User" CASCADE')
  })

  afterEach(async () => {
    if (!adapter) return

    // Clean up
    await adapter.execute('DROP TABLE IF EXISTS posts CASCADE')
    await adapter.execute('DROP TABLE IF EXISTS users CASCADE')
    await adapter.execute('DROP TABLE IF EXISTS articles CASCADE')
    await adapter.execute('DROP TABLE IF EXISTS "Post" CASCADE')
    await adapter.execute('DROP TABLE IF EXISTS "User" CASCADE')

    await adapter.disconnect()
  })

  it('should create a simple table', async () => {
    const table: TableDefinition = {
      name: 'users',
      columns: [
        { name: 'id', type: 'TEXT', primaryKey: true },
        { name: 'name', type: 'TEXT', nullable: false },
        { name: 'email', type: 'TEXT', unique: true },
        { name: 'createdAt', type: 'TIMESTAMP' },
        { name: 'updatedAt', type: 'TIMESTAMP' },
      ],
    }

    await adapter.createTable(table)

    const exists = await adapter.tableExists('users')
    expect(exists).toBe(true)
  })

  it('should perform basic CRUD operations', async () => {
    // Create table
    const table: TableDefinition = {
      name: 'posts',
      columns: [
        { name: 'id', type: 'TEXT', primaryKey: true },
        { name: 'title', type: 'TEXT', nullable: false },
        { name: 'content', type: 'TEXT' },
        { name: 'published', type: 'BOOLEAN', default: false },
        { name: 'createdAt', type: 'TIMESTAMP' },
        { name: 'updatedAt', type: 'TIMESTAMP' },
      ],
    }

    await adapter.createTable(table)

    const queryBuilder = new QueryBuilder(adapter, 'posts', table)

    // Create
    const post = await queryBuilder.create({
      data: {
        title: 'Hello World',
        content: 'This is my first post',
        published: true,
      },
    })

    expect(post.title).toBe('Hello World')
    expect(post.id).toBeDefined()
    expect(post.createdAt).toBeDefined()
    expect(post.published).toBe(true) // PostgreSQL returns actual boolean

    // FindUnique
    const found = await queryBuilder.findUnique({ where: { id: post.id as string } })
    expect(found).toBeDefined()
    expect(found!.title).toBe('Hello World')

    // Update
    const updated = await queryBuilder.update({
      where: { id: post.id as string },
      data: { title: 'Updated Title' },
    })
    expect(updated!.title).toBe('Updated Title')
    expect(updated!.updatedAt).not.toBe(post.updatedAt)

    // FindMany
    const posts = await queryBuilder.findMany()
    expect(posts).toHaveLength(1)

    // Count
    const count = await queryBuilder.count()
    expect(count).toBe(1)

    // Delete
    const deleted = await queryBuilder.delete({ where: { id: post.id as string } })
    expect(deleted).toBeDefined()

    // Verify deletion
    const afterDelete = await queryBuilder.findUnique({ where: { id: post.id as string } })
    expect(afterDelete).toBeNull()
  })

  it('should handle filters correctly', async () => {
    const table: TableDefinition = {
      name: 'articles',
      columns: [
        { name: 'id', type: 'TEXT', primaryKey: true },
        { name: 'title', type: 'TEXT', nullable: false },
        { name: 'status', type: 'TEXT' },
        { name: 'views', type: 'INTEGER' },
        { name: 'createdAt', type: 'TIMESTAMP' },
        { name: 'updatedAt', type: 'TIMESTAMP' },
      ],
    }

    await adapter.createTable(table)
    const queryBuilder = new QueryBuilder(adapter, 'articles', table)

    // Create test data
    await queryBuilder.create({
      data: { title: 'Published Post', status: 'published', views: 100 },
    })
    await queryBuilder.create({
      data: { title: 'Draft Post', status: 'draft', views: 0 },
    })
    await queryBuilder.create({
      data: { title: 'Another Published', status: 'published', views: 50 },
    })

    // Test equals filter
    const published = await queryBuilder.findMany({
      where: { status: { equals: 'published' } },
    })
    expect(published).toHaveLength(2)

    // Test contains filter
    const withPublished = await queryBuilder.findMany({
      where: { title: { contains: 'Published' } },
    })
    expect(withPublished).toHaveLength(2)

    // Test gt filter
    const highViews = await queryBuilder.findMany({
      where: { views: { gt: 25 } },
    })
    expect(highViews).toHaveLength(2)

    // Test AND filter
    const publishedHighViews = await queryBuilder.findMany({
      where: {
        AND: [{ status: { equals: 'published' } }, { views: { gte: 50 } }],
      },
    })
    expect(publishedHighViews).toHaveLength(2)

    // Test OR filter
    const draftOrHighViews = await queryBuilder.findMany({
      where: {
        OR: [{ status: { equals: 'draft' } }, { views: { gte: 100 } }],
      },
    })
    expect(draftOrHighViews).toHaveLength(2)

    // Test count with filter
    const publishedCount = await queryBuilder.count({
      where: { status: { equals: 'published' } },
    })
    expect(publishedCount).toBe(2)
  })

  it('should handle foreign keys', async () => {
    // Create user table
    const userTable: TableDefinition = {
      name: 'User',
      columns: [
        { name: 'id', type: 'TEXT', primaryKey: true },
        { name: 'name', type: 'TEXT' },
        { name: 'createdAt', type: 'TIMESTAMP' },
        { name: 'updatedAt', type: 'TIMESTAMP' },
      ],
    }

    // Create post table with foreign key
    const postTable: TableDefinition = {
      name: 'Post',
      columns: [
        { name: 'id', type: 'TEXT', primaryKey: true },
        { name: 'title', type: 'TEXT' },
        { name: 'authorId', type: 'TEXT', references: { table: 'User', column: 'id' } },
        { name: 'createdAt', type: 'TIMESTAMP' },
        { name: 'updatedAt', type: 'TIMESTAMP' },
      ],
    }

    await adapter.createTable(userTable)
    await adapter.createTable(postTable)

    const userBuilder = new QueryBuilder(adapter, 'User', userTable)
    const postBuilder = new QueryBuilder(adapter, 'Post', postTable)

    // Create user
    const user = await userBuilder.create({ data: { name: 'John Doe' } })

    // Create post with author
    const post = await postBuilder.create({
      data: { title: 'My Post', authorId: user.id },
    })

    expect(post.authorId).toBe(user.id)

    // Verify foreign key constraint
    const posts = await postBuilder.findMany({
      where: { authorId: { equals: user.id } },
    })
    expect(posts).toHaveLength(1)
  })
})
