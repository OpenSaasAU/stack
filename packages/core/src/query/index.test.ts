import { describe, it, expect, vi } from 'vitest'
import { defineFragment, runQuery, runQueryOne } from './index.js'
import type { ResultOf, Fragment, FieldSelection, QueryRunnerContext } from './index.js'

// ─────────────────────────────────────────────────────────────
// Test model types (stand-ins for Prisma-generated types)
// ─────────────────────────────────────────────────────────────

type Tag = {
  id: string
  name: string
  slug: string
}

type User = {
  id: string
  name: string
  email: string
  role: 'admin' | 'user'
  bio: string | null
}

type Post = {
  id: string
  title: string
  content: string | null
  published: boolean
  createdAt: Date
  authorId: string | null
  author: User | null
  tags: Tag[]
}

type Comment = {
  id: string
  body: string
  post: Post | null
  author: User | null
}

// ─────────────────────────────────────────────────────────────
// Helpers for building a fake context.db delegate
// ─────────────────────────────────────────────────────────────

function makeDelegate(rows: unknown[], findFirstRow?: unknown) {
  return {
    findMany: vi.fn(async (_args?: unknown) => rows),
    findFirst: vi.fn(async (_args?: unknown) => findFirstRow ?? rows[0] ?? null),
  }
}

function makeContext(delegates: Record<string, ReturnType<typeof makeDelegate>>): QueryRunnerContext {
  return { db: delegates }
}

// ─────────────────────────────────────────────────────────────
// defineFragment — construction
// ─────────────────────────────────────────────────────────────

describe('defineFragment', () => {
  it('returns an object with _type: "fragment" and the field selection', () => {
    const frag = defineFragment<User>()({ id: true, name: true } as const)

    expect(frag._type).toBe('fragment')
    expect(frag._fields).toEqual({ id: true, name: true })
  })

  it('accepts true for all field types', () => {
    const frag = defineFragment<Post>()({
      id: true,
      title: true,
      content: true,
      published: true,
      createdAt: true,
      authorId: true,
    } as const)

    expect(Object.keys(frag._fields)).toEqual([
      'id', 'title', 'content', 'published', 'createdAt', 'authorId',
    ])
  })

  it('accepts a nested fragment for a relationship field', () => {
    const userFrag = defineFragment<User>()({ id: true, name: true } as const)
    const postFrag = defineFragment<Post>()({ id: true, author: userFrag } as const)

    expect(postFrag._fields.author).toBe(userFrag)
  })

  it('accepts a nested fragment for a many relationship', () => {
    const tagFrag = defineFragment<Tag>()({ id: true, name: true } as const)
    const postFrag = defineFragment<Post>()({ id: true, tags: tagFrag } as const)

    expect(postFrag._fields.tags).toBe(tagFrag)
  })
})

// ─────────────────────────────────────────────────────────────
// ResultOf — static type tests (compile-time checks)
// ─────────────────────────────────────────────────────────────

describe('ResultOf (type-level checks)', () => {
  it('scalar fragment produces a plain picked type', () => {
    const frag = defineFragment<User>()({ id: true, name: true, email: true } as const)
    // TypeScript compile check: ResultOf<typeof frag> must have id, name, email
    type Result = ResultOf<typeof frag>
    const r: Result = { id: '1', name: 'Alice', email: 'a@test.com' }
    expect(r).toBeTruthy()
    expect(frag._type).toBe('fragment')
  })

  it('nullable scalar fields are preserved', () => {
    const frag = defineFragment<Post>()({ id: true, content: true } as const)
    type Result = ResultOf<typeof frag>
    // content should be string | null
    const r: Result = { id: '1', content: null }
    expect(r.content).toBeNull()
    expect(frag._type).toBe('fragment')
  })

  it('nested fragment on a nullable relationship preserves null', () => {
    const userFrag = defineFragment<User>()({ id: true, name: true } as const)
    const postFrag = defineFragment<Post>()({ id: true, author: userFrag } as const)
    type PostResult = ResultOf<typeof postFrag>
    // author should be { id: string; name: string } | null
    const r: PostResult = { id: '1', author: null }
    expect(r.author).toBeNull()
    expect(postFrag._type).toBe('fragment')
  })

  it('nested fragment on a many relationship produces an array', () => {
    const tagFrag = defineFragment<Tag>()({ id: true, name: true } as const)
    const postFrag = defineFragment<Post>()({ id: true, tags: tagFrag } as const)
    type PostResult = ResultOf<typeof postFrag>
    const r: PostResult = { id: '1', tags: [{ id: 't1', name: 'ts' }] }
    expect(r.tags).toHaveLength(1)
    expect(postFrag._type).toBe('fragment')
  })

  it('deep nesting (comment → post → author) resolves correctly', () => {
    const userFrag = defineFragment<User>()({ id: true, name: true } as const)
    const postFrag = defineFragment<Post>()({ id: true, title: true, author: userFrag } as const)
    const commentFrag = defineFragment<Comment>()({
      id: true,
      body: true,
      post: postFrag,
    } as const)
    type CommentResult = ResultOf<typeof commentFrag>
    const r: CommentResult = {
      id: 'c1',
      body: 'hi',
      post: {
        id: 'p1',
        title: 'Hello',
        author: { id: 'u1', name: 'Alice' },
      },
    }
    expect(r.post?.author?.name).toBe('Alice')
    expect(commentFrag._type).toBe('fragment')
  })
})

// ─────────────────────────────────────────────────────────────
// runQuery — runtime behaviour
// ─────────────────────────────────────────────────────────────

describe('runQuery', () => {
  const userFrag = defineFragment<User>()({ id: true, name: true, email: true } as const)

  const rawUsers: User[] = [
    { id: 'u1', name: 'Alice', email: 'alice@test.com', role: 'admin', bio: null },
    { id: 'u2', name: 'Bob', email: 'bob@test.com', role: 'user', bio: 'Hey there' },
  ]

  it('calls context.db[dbKey].findMany with no args when none supplied', async () => {
    const delegate = makeDelegate(rawUsers)
    const ctx = makeContext({ user: delegate })

    await runQuery(ctx, 'User', userFrag)

    expect(delegate.findMany).toHaveBeenCalledWith(undefined)
  })

  it('returns only the fields specified in the fragment', async () => {
    const ctx = makeContext({ user: makeDelegate(rawUsers) })
    const results = await runQuery(ctx, 'User', userFrag)

    expect(results).toHaveLength(2)
    // Only id, name, email — not role or bio
    expect(results[0]).toEqual({ id: 'u1', name: 'Alice', email: 'alice@test.com' })
    expect(results[1]).toEqual({ id: 'u2', name: 'Bob', email: 'bob@test.com' })
    expect(results[0]).not.toHaveProperty('role')
    expect(results[0]).not.toHaveProperty('bio')
  })

  it('passes where, orderBy, take, skip to findMany', async () => {
    const delegate = makeDelegate(rawUsers)
    const ctx = makeContext({ user: delegate })

    await runQuery(ctx, 'User', userFrag, {
      where: { role: 'admin' },
      orderBy: { name: 'asc' },
      take: 5,
      skip: 2,
    })

    expect(delegate.findMany).toHaveBeenCalledWith({
      where: { role: 'admin' },
      orderBy: { name: 'asc' },
      take: 5,
      skip: 2,
    })
  })

  it('converts PascalCase listKey to camelCase for db access', async () => {
    const delegate = makeDelegate([])
    const ctx = makeContext({ blogPost: delegate })

    await runQuery(ctx, 'BlogPost', defineFragment<Post>()({ id: true } as const))

    expect(delegate.findMany).toHaveBeenCalled()
  })

  it('returns an empty array when findMany returns nothing', async () => {
    const ctx = makeContext({ user: makeDelegate([]) })
    const results = await runQuery(ctx, 'User', userFrag)
    expect(results).toEqual([])
  })

  describe('with nested fragment (relationship)', () => {
    const tagFrag = defineFragment<Tag>()({ id: true, name: true } as const)
    const postFrag = defineFragment<Post>()({
      id: true,
      title: true,
      author: userFrag,
      tags: tagFrag,
    } as const)

    const rawPosts = [
      {
        id: 'p1',
        title: 'Hello World',
        content: 'body',
        published: true,
        createdAt: new Date('2024-01-01'),
        authorId: 'u1',
        author: {
          id: 'u1',
          name: 'Alice',
          email: 'alice@test.com',
          role: 'admin',
          bio: null,
        },
        tags: [
          { id: 't1', name: 'TypeScript', slug: 'typescript' },
          { id: 't2', name: 'Node', slug: 'node' },
        ],
      },
    ]

    it('passes include for relationship fields to findMany', async () => {
      const delegate = makeDelegate(rawPosts)
      const ctx = makeContext({ post: delegate })

      await runQuery(ctx, 'Post', postFrag)

      expect(delegate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { author: true, tags: true },
        }),
      )
    })

    it('picks only the selected nested fields', async () => {
      const ctx = makeContext({ post: makeDelegate(rawPosts) })
      const results = await runQuery(ctx, 'Post', postFrag)

      expect(results[0].author).toEqual({ id: 'u1', name: 'Alice', email: 'alice@test.com' })
      // role and bio are NOT selected in userFrag
      expect(results[0].author).not.toHaveProperty('role')
      expect(results[0].author).not.toHaveProperty('bio')
    })

    it('maps tag arrays and strips unselected fields', async () => {
      const ctx = makeContext({ post: makeDelegate(rawPosts) })
      const results = await runQuery(ctx, 'Post', postFrag)

      // slug is not in tagFrag, so it must be absent
      expect(results[0].tags[0]).not.toHaveProperty('slug')
      expect(results[0].tags[0]).toEqual({ id: 't1', name: 'TypeScript' })
      expect(results[0].tags[1]).toEqual({ id: 't2', name: 'Node' })
    })
  })

  describe('with null relationship', () => {
    it('preserves null for an unset relationship', async () => {
      const authorFrag = defineFragment<User>()({ id: true, name: true } as const)
      const postFrag = defineFragment<Post>()({ id: true, author: authorFrag } as const)

      const rawPost = {
        id: 'p2',
        title: 'Draft',
        content: null,
        published: false,
        createdAt: new Date(),
        authorId: null,
        author: null,
        tags: [],
      }

      const ctx = makeContext({ post: makeDelegate([rawPost]) })
      const results = await runQuery(ctx, 'Post', postFrag)

      expect(results[0].author).toBeNull()
    })
  })

  describe('deeply nested (three levels)', () => {
    it('recursively builds include and picks fields', async () => {
      const authorFrag = defineFragment<User>()({ id: true, name: true } as const)
      const postFrag = defineFragment<Post>()({
        id: true,
        title: true,
        author: authorFrag,
      } as const)
      const commentFrag = defineFragment<Comment>()({
        id: true,
        body: true,
        post: postFrag,
      } as const)

      const raw = [
        {
          id: 'c1',
          body: 'Nice post!',
          post: {
            id: 'p1',
            title: 'Hello',
            content: 'body',
            published: true,
            createdAt: new Date(),
            authorId: 'u1',
            author: { id: 'u1', name: 'Alice', email: 'a@t.com', role: 'user', bio: null },
            tags: [],
          },
          author: null,
        },
      ]

      const delegate = makeDelegate(raw)
      const ctx = makeContext({ comment: delegate })

      const results = await runQuery(ctx, 'Comment', commentFrag)

      // include passed to findMany
      expect(delegate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            post: { include: { author: true } },
          },
        }),
      )

      // result shape
      expect(results[0]).toEqual({
        id: 'c1',
        body: 'Nice post!',
        post: {
          id: 'p1',
          title: 'Hello',
          author: { id: 'u1', name: 'Alice' },
        },
      })
    })
  })
})

// ─────────────────────────────────────────────────────────────
// runQueryOne — runtime behaviour
// ─────────────────────────────────────────────────────────────

describe('runQueryOne', () => {
  const userFrag = defineFragment<User>()({ id: true, name: true, email: true } as const)

  const rawUser: User = {
    id: 'u1',
    name: 'Alice',
    email: 'alice@test.com',
    role: 'admin',
    bio: null,
  }

  it('calls context.db[dbKey].findFirst with the where clause', async () => {
    const delegate = makeDelegate([rawUser], rawUser)
    const ctx = makeContext({ user: delegate })

    await runQueryOne(ctx, 'User', userFrag, { id: 'u1' })

    expect(delegate.findFirst).toHaveBeenCalledWith({ where: { id: 'u1' } })
  })

  it('returns only the fields specified in the fragment', async () => {
    const ctx = makeContext({ user: makeDelegate([rawUser], rawUser) })
    const result = await runQueryOne(ctx, 'User', userFrag, { id: 'u1' })

    expect(result).toEqual({ id: 'u1', name: 'Alice', email: 'alice@test.com' })
    expect(result).not.toHaveProperty('role')
    expect(result).not.toHaveProperty('bio')
  })

  it('returns null when findFirst returns null', async () => {
    const delegate = makeDelegate([], null)
    const ctx = makeContext({ user: delegate })

    const result = await runQueryOne(ctx, 'User', userFrag, { id: 'nope' })

    expect(result).toBeNull()
  })

  it('returns null when findFirst returns undefined', async () => {
    const delegate = {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => undefined),
    }
    const ctx = makeContext({ user: delegate })

    const result = await runQueryOne(ctx, 'User', userFrag, { id: 'nope' })

    expect(result).toBeNull()
  })

  it('passes include for relationship fields to findFirst', async () => {
    const authorFrag = defineFragment<User>()({ id: true, name: true } as const)
    const postFrag = defineFragment<Post>()({ id: true, title: true, author: authorFrag } as const)

    const rawPost = {
      id: 'p1',
      title: 'Hello',
      content: null,
      published: true,
      createdAt: new Date(),
      authorId: 'u1',
      author: { id: 'u1', name: 'Alice', email: 'a@t.com', role: 'user', bio: null },
      tags: [],
    }

    const delegate = makeDelegate([rawPost], rawPost)
    const ctx = makeContext({ post: delegate })

    const result = await runQueryOne(ctx, 'Post', postFrag, { id: 'p1' })

    expect(delegate.findFirst).toHaveBeenCalledWith({
      where: { id: 'p1' },
      include: { author: true },
    })
    expect(result).toEqual({
      id: 'p1',
      title: 'Hello',
      author: { id: 'u1', name: 'Alice' },
    })
  })

  it('converts PascalCase listKey to camelCase', async () => {
    const delegate = makeDelegate([], null)
    const ctx = makeContext({ blogPost: delegate })

    await runQueryOne(ctx, 'BlogPost', defineFragment<Post>()({ id: true } as const), {
      id: 'p1',
    })

    expect(delegate.findFirst).toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────
// Fragment composition — reusability
// ─────────────────────────────────────────────────────────────

describe('fragment composition', () => {
  it('the same fragment can be reused in multiple parent fragments', async () => {
    const userFrag = defineFragment<User>()({ id: true, name: true } as const)
    const postFrag = defineFragment<Post>()({ id: true, author: userFrag } as const)
    const commentFrag = defineFragment<Comment>()({ id: true, author: userFrag } as const)

    // Both refer to the exact same userFrag instance
    expect(postFrag._fields.author).toBe(userFrag)
    expect(commentFrag._fields.author).toBe(userFrag)
  })

  it('composes three levels deep without mutation', async () => {
    const userFrag = defineFragment<User>()({ id: true, name: true } as const)
    const postFrag = defineFragment<Post>()({
      id: true,
      title: true,
      author: userFrag,
    } as const)
    const commentFrag = defineFragment<Comment>()({
      id: true,
      body: true,
      post: postFrag,
    } as const)

    // Verify structure without executing any query
    expect(commentFrag._type).toBe('fragment')
    const postFieldInComment = commentFrag._fields.post as Fragment<Post, FieldSelection<Post>>
    expect(postFieldInComment._type).toBe('fragment')
    const authorFieldInPost = postFieldInComment._fields.author as Fragment<User, FieldSelection<User>>
    expect(authorFieldInPost._fields).toEqual({ id: true, name: true })
  })
})
