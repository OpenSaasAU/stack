/**
 * SQLite adapter tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteAdapter } from './sqlite.js'
import { QueryBuilder } from '../query/builder.js'
import type { TableDefinition } from '../types/index.js'
import * as fs from 'fs'

const TEST_DB_PATH = './test-db.sqlite'

describe('SQLiteAdapter', () => {
  let adapter: SQLiteAdapter

  beforeEach(async () => {
    // Clean up test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH)
    }

    adapter = new SQLiteAdapter({
      provider: 'sqlite',
      url: `file:${TEST_DB_PATH}`,
    })

    await adapter.connect()
  })

  afterEach(async () => {
    await adapter.disconnect()

    // Clean up
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH)
    }
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
