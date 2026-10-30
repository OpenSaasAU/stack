import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'

const BOOT = 120_000

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    User: {
      fields: {
        name: text({ validation: { isRequired: true } }),
        posts: relationship({ ref: 'Post.author', many: true }),
      },
      access: {
        operation: {
          query: ({ session }) =>
            typeof session?.userId !== 'string' ? false : { id: { equals: session.userId } },
        },
      },
    },
    Category: {
      fields: {
        name: text({ validation: { isRequired: true } }),
        posts: relationship({ ref: 'Post.category', many: true }),
      },
      access: { operation: { query: () => true } },
    },
    Post: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        author: relationship({ ref: 'User.posts' }),
        category: relationship({ ref: 'Category.posts' }),
        reviewer: relationship({
          ref: 'User',
          access: { read: ({ item }) => item?.title === 'a1' },
        }),
        comments: relationship({ ref: 'Comment.post', many: true }),
      },
      access: { operation: { query: () => true } },
    },
    Comment: {
      fields: {
        body: text({ validation: { isRequired: true } }),
        post: relationship({ ref: 'Post.comments' }),
        writer: relationship({ ref: 'User' }),
      },
      access: { operation: { query: () => true } },
    },
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rowsOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function postsOf(categories: unknown, branch?: string): Record<string, unknown>[] {
  const first = rowsOf(categories)[0]
  const posts = first?.posts
  return rowsOf(branch === undefined ? posts : isRecord(posts) ? posts[branch] : undefined)
}

function column(rows: readonly Record<string, unknown>[], key: string): unknown[] {
  return rows.map((row) => row[key])
}

let database: TestDatabase
let aliceId: string
let bobId: string

beforeAll(async () => {
  database = await createTestDatabase(config)
  const sudo = database.context(null).sudo()
  const alice = await sudo.db.User.create({ data: { name: 'alice' } })
  const bob = await sudo.db.User.create({ data: { name: 'bob' } })
  const category = await sudo.db.Category.create({ data: { name: 'c' } })
  if (!alice || !bob || !category) throw new Error('seed')
  aliceId = String(alice.id)
  bobId = String(bob.id)
  for (const [title, owner] of [
    ['a1', alice],
    ['b2', bob],
  ] as const) {
    const post = await sudo.db.Post.create({
      data: {
        title,
        author: { connect: { id: owner.id } },
        reviewer: { connect: { id: owner.id } },
        category: { connect: { id: category.id } },
      },
    })
    if (!post) throw new Error('seed post')
    await sudo.db.Comment.create({
      data: {
        body: title,
        post: { connect: { id: post.id } },
        writer: { connect: { id: owner.id } },
      },
    })
  }
}, BOOT)

afterAll(async () => {
  await database?.close()
})

describe('a combine() rows branch narrows un-included foreign keys like a plain include', () => {
  test(
    'authorId of a row the related list scopes away is null',
    async () => {
      const ctx = database.context({ userId: aliceId })
      const plain = await ctx.db.Category.include('posts', (p) => p.orderBy({ title: 'asc' })).all()
      const combined = await ctx.db.Category.include('posts', (p) =>
        p.combine({ items: p.orderBy({ title: 'asc' }), total: p.count() }),
      ).all()
      expect(column(postsOf(plain), 'authorId')).toEqual([aliceId, null])
      expect(column(postsOf(combined, 'items'), 'authorId')).toEqual([aliceId, null])
    },
    BOOT,
  )

  test(
    'a row-dependent relationship read rule nulls the key on the rows branch',
    async () => {
      const ctx = database.context({ userId: aliceId })
      const plain = await ctx.db.Category.include('posts', (p) => p.orderBy({ title: 'asc' })).all()
      const combined = await ctx.db.Category.include('posts', (p) =>
        p.combine({ items: p.orderBy({ title: 'asc' }), total: p.count() }),
      ).all()
      expect(column(postsOf(combined, 'items'), 'reviewerId')).toEqual(
        column(postsOf(plain), 'reviewerId'),
      )
      expect(column(postsOf(combined, 'items'), 'reviewerId')).toEqual([aliceId, null])
    },
    BOOT,
  )

  test(
    'a projected rows branch is narrowed too',
    async () => {
      const ctx = database.context({ userId: aliceId })
      const combined = await ctx.db.Category.include('posts', (p) =>
        p.combine({ items: p.select('title', 'authorId').orderBy({ title: 'asc' }) }),
      ).all()
      expect(column(postsOf(combined, 'items'), 'authorId')).toEqual([aliceId, null])
    },
    BOOT,
  )

  test(
    'a nested to-many under a combine rows branch is narrowed',
    async () => {
      const ctx = database.context({ userId: aliceId })
      const combined = await ctx.db.Category.include('posts', (p) =>
        p.combine({
          items: p.orderBy({ title: 'asc' }).include('comments', (c) => c.orderBy({ body: 'asc' })),
        }),
      ).all()
      const writers = postsOf(combined, 'items').flatMap((p) =>
        column(rowsOf(p.comments), 'writerId'),
      )
      expect(writers).toEqual([aliceId, null])
      expect(writers).not.toContain(bobId)
    },
    BOOT,
  )
})
