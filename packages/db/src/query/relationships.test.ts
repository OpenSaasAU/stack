/**
 * Relationship loading tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteAdapter } from '../adapter/sqlite.js'
import { QueryBuilder } from './builder.js'
import type { TableDefinition, DatabaseRow } from '../types/index.js'
import * as fs from 'fs'

const TEST_DB_PATH = './test-relationships.sqlite'

// Type definitions for test records
interface User extends DatabaseRow {
  name: string
  email: string
}

interface Post extends DatabaseRow {
  title: string
  content: string
  status: string
  authorId: string | null
}

interface UserWithPosts extends User {
  posts: Post[]
}

interface PostWithAuthor extends Post {
  author: User | null
}

describe('Relationship Loading', () => {
  let adapter: SQLiteAdapter
  let users: QueryBuilder
  let posts: QueryBuilder
  let userId1: string
  let userId2: string
  let postId1: string
  let _postId2: string
  let _postId3: string

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

    // Create tables
    const userTable: TableDefinition = {
      name: 'User',
      columns: [
        { name: 'id', type: 'TEXT', primaryKey: true },
        { name: 'name', type: 'TEXT', nullable: false },
        { name: 'email', type: 'TEXT', unique: true },
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
        {
          name: 'authorId',
          type: 'TEXT',
          nullable: true,
          references: { table: 'User', column: 'id' },
        },
        { name: 'createdAt', type: 'TIMESTAMP' },
        { name: 'updatedAt', type: 'TIMESTAMP' },
      ],
    }

    await adapter.createTable(userTable)
    await adapter.createTable(postTable)

    // Create query builders with relationships
    users = new QueryBuilder(adapter, 'User', userTable, {
      posts: {
        name: 'posts',
        type: 'one-to-many',
        targetTable: 'Post',
        foreignKey: 'authorId',
      },
    })

    posts = new QueryBuilder(adapter, 'Post', postTable, {
      author: {
        name: 'author',
        type: 'many-to-one',
        targetTable: 'User',
        foreignKey: 'authorId',
      },
    })

    // Create test data
    const user1 = await users.create({
      data: { name: 'John Doe', email: 'john@example.com' },
    })
    userId1 = user1.id as string

    const user2 = await users.create({
      data: { name: 'Jane Smith', email: 'jane@example.com' },
    })
    userId2 = user2.id as string

    const post1 = await posts.create({
      data: {
        title: 'First Post',
        content: 'Content 1',
        status: 'published',
        authorId: userId1,
      },
    })
    postId1 = post1.id as string

    const post2 = await posts.create({
      data: {
        title: 'Second Post',
        content: 'Content 2',
        status: 'draft',
        authorId: userId1,
      },
    })
    _postId2 = post2.id as string

    const post3 = await posts.create({
      data: {
        title: 'Third Post',
        content: 'Content 3',
        status: 'published',
        authorId: userId2,
      },
    })
    _postId3 = post3.id as string
  })

  afterEach(async () => {
    await adapter.disconnect()

    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH)
    }
  })

  describe('Many-to-one relationships', () => {
    it('should load author for a post (include: true)', async () => {
      const post = await posts.findUnique({
        where: { id: postId1 },
        include: { author: true },
      })

      expect(post).toBeDefined()
      expect(post!.title).toBe('First Post')
      expect(post!.author).toBeDefined()
      const author = (post as PostWithAuthor).author!
      expect(author.name).toBe('John Doe')
      expect(author.email).toBe('john@example.com')
    })

    it('should load author for multiple posts', async () => {
      const allPosts = await posts.findMany({
        include: { author: true },
      })

      expect(allPosts).toHaveLength(3)
      allPosts.forEach((post) => {
        const postWithAuthor = post as PostWithAuthor
        expect(postWithAuthor.author).toBeDefined()
        expect(postWithAuthor.author!.name).toBeDefined()
      })
    })

    it('should handle null foreign key gracefully', async () => {
      // Create a post without an author
      const orphanPost = await posts.create({
        data: { title: 'Orphan Post', content: 'No author' },
      })

      const post = await posts.findUnique({
        where: { id: orphanPost.id as string },
        include: { author: true },
      })

      expect(post).toBeDefined()
      expect(post!.author).toBeNull()
    })
  })

  describe('One-to-many relationships', () => {
    it('should load all posts for a user (include: true)', async () => {
      const user = await users.findUnique({
        where: { id: userId1 },
        include: { posts: true },
      })

      expect(user).toBeDefined()
      expect(user!.name).toBe('John Doe')
      expect(user!.posts).toBeDefined()
      const userWithPosts = user as UserWithPosts
      expect(userWithPosts.posts.length).toBe(2)

      const titles = userWithPosts.posts.map((p) => p.title)
      expect(titles).toContain('First Post')
      expect(titles).toContain('Second Post')
    })

    it('should return empty array for user with no posts', async () => {
      const newUser = await users.create({
        data: { name: 'No Posts', email: 'noposts@example.com' },
      })

      const user = await users.findUnique({
        where: { id: newUser.id as string },
        include: { posts: true },
      })

      expect(user).toBeDefined()
      expect(user!.posts).toBeDefined()
      const userWithPosts = user as UserWithPosts
      expect(userWithPosts.posts.length).toBe(0)
    })

    it('should load posts for multiple users', async () => {
      const allUsers = await users.findMany({
        include: { posts: true },
      })

      expect(allUsers.length).toBeGreaterThanOrEqual(2)

      const john = allUsers.find((u) => u.name === 'John Doe') as UserWithPosts
      expect(john).toBeDefined()
      expect(john.posts.length).toBe(2)

      const jane = allUsers.find((u) => u.name === 'Jane Smith') as UserWithPosts
      expect(jane).toBeDefined()
      expect(jane.posts.length).toBe(1)
    })
  })

  describe('Include with where filters', () => {
    it('should filter related records in one-to-many (published posts only)', async () => {
      const user = await users.findUnique({
        where: { id: userId1 },
        include: {
          posts: {
            where: { status: { equals: 'published' } },
          },
        },
      })

      expect(user).toBeDefined()
      const userWithPosts = user as UserWithPosts
      expect(userWithPosts.posts.length).toBe(1)
      expect(userWithPosts.posts[0].title).toBe('First Post')
      expect(userWithPosts.posts[0].status).toBe('published')
    })

    it('should filter related records in many-to-one', async () => {
      // This tests the where filter on the author side
      // If the author doesn't match the filter, it should return null
      const post = await posts.findUnique({
        where: { id: postId1 },
        include: {
          author: {
            where: { name: { equals: 'Wrong Name' } },
          },
        },
      })

      expect(post).toBeDefined()
      expect(post!.author).toBeNull()
    })

    it('should match author when filter is correct', async () => {
      const post = await posts.findUnique({
        where: { id: postId1 },
        include: {
          author: {
            where: { name: { equals: 'John Doe' } },
          },
        },
      })

      expect(post).toBeDefined()
      expect(post!.author).toBeDefined()
      const postWithAuthor = post as PostWithAuthor
      expect(postWithAuthor.author!.name).toBe('John Doe')
    })

    it('should filter in findMany with complex where', async () => {
      const publishedPosts = await posts.findMany({
        where: { status: { equals: 'published' } },
        include: { author: true },
      })

      expect(publishedPosts.length).toBe(2)
      publishedPosts.forEach((post) => {
        expect(post.status).toBe('published')
        expect(post.author).toBeDefined()
      })
    })
  })

  describe('Without include', () => {
    it('should not load relationships when include is not specified', async () => {
      const post = await posts.findUnique({
        where: { id: postId1 },
      })

      expect(post).toBeDefined()
      expect(post!.author).toBeUndefined()
      expect(post!.authorId).toBeDefined() // FK should still exist
    })

    it('should work normally for findMany without include', async () => {
      const allPosts = await posts.findMany()

      expect(allPosts.length).toBe(3)
      allPosts.forEach((post) => {
        expect(post.author).toBeUndefined()
      })
    })
  })
})
