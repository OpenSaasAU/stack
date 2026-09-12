import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'

/**
 * The same two rule shapes, one level deeper: `Blog.posts` is a to-many the
 * top-level read always reaches, and `Post.author` is the nested to-one the
 * two field rules read `item.authorId` off. Before #1236 this nesting was
 * refused outright (`NestedToOneIncludeError`); now that the foreign key's
 * physical column no longer collides with the relation's own alias, the read
 * executes, and `restoreForeignKeys`'s removal must not have reopened the
 * fail-open the flat shapes above close (issue #1236, comment recording the
 * asymmetry between `restoreForeignKeys` and `applyForeignKeys`).
 */
const nestedConfig: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Blog: {
      fields: {
        name: text({ validation: { isRequired: true } }),
        posts: relationship({ ref: 'Post.blog', many: true }),
      },
      access: { operation: { query: () => true } },
    },
    User: {
      fields: { name: text({ validation: { isRequired: true } }) },
      // Denied outright, exactly like `scopedConfig.User` — the include's own
      // subquery scopes `author` away regardless of the outer read.
      access: { operation: { query: () => false } },
    },
    Post: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        blog: relationship({ ref: 'Blog.posts' }),
        author: relationship({ ref: 'User' }),
        ownerNotes: text({
          access: { read: ({ session, item }) => session?.userId === item?.authorId },
        }),
        orphanNotes: text({ access: { read: ({ item }) => item?.authorId == null } }),
      },
      access: { operation: { query: () => true } },
    },
  },
}

const BOOT = 120_000

/**
 * A scalar whose `read` rule compares the row's foreign key with the session.
 * On the include path the ORM hands the related row back under the foreign
 * key's own key, so this is the rule that observes whether the engine folds
 * it to the id before or after Field Visibility runs.
 */
const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    User: {
      fields: {
        name: text({ validation: { isRequired: true } }),
        posts: relationship({ ref: 'Post.author', many: true }),
      },
      access: { operation: { query: () => true } },
    },
    Post: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        internalNotes: text({
          access: {
            read: ({ session, item }) => session?.userId === item?.authorId,
          },
        }),
        author: relationship({ ref: 'User.posts' }),
      },
      access: { operation: { query: () => true } },
    },
  },
}

/**
 * The same two rules over a related list the session may not query at all, so
 * the include's own subquery scopes the author away and the foreign key's key
 * comes back empty. `orphanNotes` is the inverse rule — it opens the field on
 * rows that have no author — and is the direction in which a foreign key the
 * engine reports as `null` DISCLOSES rather than denies.
 */
const scopedConfig: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    User: {
      fields: {
        name: text({ validation: { isRequired: true } }),
        posts: relationship({ ref: 'Post.author', many: true }),
      },
      access: { operation: { query: () => false } },
    },
    Post: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        ownerNotes: text({
          access: { read: ({ session, item }) => session?.userId === item?.authorId },
        }),
        orphanNotes: text({ access: { read: ({ item }) => item?.authorId == null } }),
        author: relationship({ ref: 'User.posts' }),
      },
      access: { operation: { query: () => true } },
    },
  },
}

let database: TestDatabase
let authorId: string
let readerId: string
let postId: string

let scoped: TestDatabase
let scopedAuthorId: string
let scopedPostId: string
let orphanPostId: string

let nested: TestDatabase
let nestedAuthorId: string
let nestedBlogId: string
let nestedAuthoredPostId: string
let nestedOrphanPostId: string

beforeAll(async () => {
  database = await createTestDatabase(config)
  const sudo = database.context(null).sudo()
  const author = await sudo.db.User.create({ data: { name: 'author' } })
  const reader = await sudo.db.User.create({ data: { name: 'reader' } })
  if (!author || !reader) throw new Error('seed users')
  authorId = String(author.id)
  readerId = String(reader.id)
  const post = await sudo.db.Post.create({
    data: { title: 'post', internalNotes: 'secret', author: { connect: { id: authorId } } },
  })
  if (!post) throw new Error('seed post')
  postId = String(post.id)

  scoped = await createTestDatabase(scopedConfig)
  const scopedSudo = scoped.context(null).sudo()
  const scopedAuthor = await scopedSudo.db.User.create({ data: { name: 'author' } })
  if (!scopedAuthor) throw new Error('seed scoped user')
  scopedAuthorId = String(scopedAuthor.id)
  const scopedPost = await scopedSudo.db.Post.create({
    data: {
      title: 'authored',
      ownerNotes: 'OWNER',
      orphanNotes: 'ORPHAN',
      author: { connect: { id: scopedAuthorId } },
    },
  })
  const orphanPost = await scopedSudo.db.Post.create({
    data: { title: 'orphan', ownerNotes: 'OWNER', orphanNotes: 'ORPHAN' },
  })
  if (!scopedPost || !orphanPost) throw new Error('seed scoped posts')
  scopedPostId = String(scopedPost.id)
  orphanPostId = String(orphanPost.id)

  nested = await createTestDatabase(nestedConfig)
  const nestedSudo = nested.context(null).sudo()
  const nestedAuthor = await nestedSudo.db.User.create({ data: { name: 'author' } })
  if (!nestedAuthor) throw new Error('seed nested user')
  nestedAuthorId = String(nestedAuthor.id)
  const blog = await nestedSudo.db.Blog.create({ data: { name: 'blog' } })
  if (!blog) throw new Error('seed nested blog')
  nestedBlogId = String(blog.id)
  const authoredPost = await nestedSudo.db.Post.create({
    data: {
      title: 'authored',
      ownerNotes: 'OWNER',
      orphanNotes: 'ORPHAN',
      blog: { connect: { id: nestedBlogId } },
      author: { connect: { id: nestedAuthorId } },
    },
  })
  const orphanPostNested = await nestedSudo.db.Post.create({
    data: {
      title: 'orphan',
      ownerNotes: 'OWNER',
      orphanNotes: 'ORPHAN',
      blog: { connect: { id: nestedBlogId } },
    },
  })
  if (!authoredPost || !orphanPostNested) throw new Error('seed nested posts')
  nestedAuthoredPostId = String(authoredPost.id)
  nestedOrphanPostId = String(orphanPostNested.id)
}, BOOT)

afterAll(async () => {
  await database?.close()
  await scoped?.close()
  await nested?.close()
})

describe('a read rule comparing the foreign key', () => {
  test(
    'holds for the author on a bare read and on the include path alike',
    async () => {
      const asAuthor = database.context({ userId: authorId })
      const bare = await asAuthor.db.Post.where({ id: { equals: postId } }).first()
      expect(bare?.internalNotes).toBe('secret')

      const included = await asAuthor.db.Post.where({ id: { equals: postId } })
        .include('author')
        .first()
      expect(included?.internalNotes).toBe('secret')
      expect(included?.authorId).toBe(authorId)
    },
    BOOT,
  )

  test(
    'denies another session on both paths',
    async () => {
      const asReader = database.context({ userId: readerId })
      const bare = await asReader.db.Post.where({ id: { equals: postId } }).first()
      expect(bare?.internalNotes).toBeUndefined()

      const included = await asReader.db.Post.where({ id: { equals: postId } })
        .include('author')
        .first()
      expect(included?.internalNotes).toBeUndefined()
      expect(included?.authorId).toBe(authorId)
    },
    BOOT,
  )
})

describe('a read rule comparing the foreign key of an unreadable relation', () => {
  test(
    'still opens the field to the author when the read includes the relation',
    async () => {
      const asAuthor = scoped.context({ userId: scopedAuthorId })
      const bare = await asAuthor.db.Post.where({ id: { equals: scopedPostId } }).first()
      expect(bare?.ownerNotes).toBe('OWNER')

      const included = await asAuthor.db.Post.where({ id: { equals: scopedPostId } })
        .include('author')
        .first()
      expect(included?.ownerNotes).toBe('OWNER')
    },
    BOOT,
  )

  test(
    'keeps an "unowned rows are public" field closed on an owned row under include',
    async () => {
      const asAuthor = scoped.context({ userId: scopedAuthorId })
      const bare = await asAuthor.db.Post.where({ id: { equals: scopedPostId } }).first()
      expect(bare?.orphanNotes).toBeUndefined()

      const included = await asAuthor.db.Post.where({ id: { equals: scopedPostId } })
        .include('author')
        .first()
      expect(included?.orphanNotes).toBeUndefined()
    },
    BOOT,
  )

  test(
    'still opens an "unowned rows are public" field on a row that really has no author',
    async () => {
      const asAuthor = scoped.context({ userId: scopedAuthorId })
      const included = await asAuthor.db.Post.where({ id: { equals: orphanPostId } })
        .include('author')
        .first()
      expect(included?.orphanNotes).toBe('ORPHAN')
      expect(included?.author).toBeNull()
    },
    BOOT,
  )

  test(
    'answers a page of rows the same way one row at a time is answered',
    async () => {
      const asAuthor = scoped.context({ userId: scopedAuthorId })
      const page = await asAuthor.db.Post.orderBy({ title: 'asc' }).include('author').all()
      expect(page.map((row) => row.title)).toEqual(['authored', 'orphan'])
      expect(page.map((row) => row.ownerNotes)).toEqual(['OWNER', undefined])
      expect(page.map((row) => row.orphanNotes)).toEqual([undefined, 'ORPHAN'])
    },
    BOOT,
  )

  test(
    'reports the foreign key of a relation the caller may not see as null',
    async () => {
      const asAuthor = scoped.context({ userId: scopedAuthorId })
      const included = await asAuthor.db.Post.where({ id: { equals: scopedPostId } })
        .include('author')
        .first()
      expect(included?.author).toBeNull()
      expect(included?.authorId).toBeNull()
    },
    BOOT,
  )

  test(
    'reports the same foreign key as null on a bare read that never named the relation (issue #1243)',
    async () => {
      const asAuthor = scoped.context({ userId: scopedAuthorId })
      const bare = await asAuthor.db.Post.where({ id: { equals: scopedPostId } }).first()
      expect(bare?.author).toBeUndefined()
      expect(bare?.authorId).toBeNull()
    },
    BOOT,
  )

  test(
    'holds across a page of bare reads the same way it holds for one row',
    async () => {
      const asAuthor = scoped.context({ userId: scopedAuthorId })
      const page = await asAuthor.db.Post.orderBy({ title: 'asc' }).all()
      expect(page.map((row) => row.title)).toEqual(['authored', 'orphan'])
      expect(page.map((row) => row.authorId)).toEqual([null, null])
    },
    BOOT,
  )
})

/** The row type here carries no generated contract, so `.posts` reads as `unknown`. */
function postsOf(row: unknown): Record<string, unknown>[] {
  const posts = (row as { posts?: unknown })?.posts
  return Array.isArray(posts) ? (posts as Record<string, unknown>[]) : []
}

describe('the same rule, one level deeper (#1236)', () => {
  test(
    'the nested to-one executes rather than being refused',
    async () => {
      const asAuthor = nested.context({ userId: nestedAuthorId })
      const rows = await asAuthor.db.Blog.where({ id: { equals: nestedBlogId } })
        .include('posts', (posts) => posts.orderBy({ title: 'asc' }).include('author'))
        .all()

      expect(rows).toHaveLength(1)
      expect(postsOf(rows[0]).map((post) => post.title)).toEqual(['authored', 'orphan'])
    },
    BOOT,
  )

  test(
    'still opens an owner-only field to the author, nested exactly as flat',
    async () => {
      const asAuthor = nested.context({ userId: nestedAuthorId })
      const [row] = await asAuthor.db.Blog.where({ id: { equals: nestedBlogId } })
        .include('posts', (posts) => posts.where({ id: { equals: nestedAuthoredPostId } }))
        .all()

      expect(postsOf(row)[0]?.ownerNotes).toBe('OWNER')
    },
    BOOT,
  )

  test(
    'keeps an "unowned rows are public" field closed on an owned row, nested',
    async () => {
      const asAuthor = nested.context({ userId: nestedAuthorId })
      const [row] = await asAuthor.db.Blog.where({ id: { equals: nestedBlogId } })
        .include('posts', (posts) => posts.where({ id: { equals: nestedAuthoredPostId } }))
        .all()

      expect(postsOf(row)[0]?.orphanNotes).toBeUndefined()
    },
    BOOT,
  )

  test(
    'still opens an "unowned rows are public" field on a row that really has no author, nested',
    async () => {
      const asAuthor = nested.context({ userId: nestedAuthorId })
      const [row] = await asAuthor.db.Blog.where({ id: { equals: nestedBlogId } })
        .include('posts', (posts) =>
          posts.where({ id: { equals: nestedOrphanPostId } }).include('author'),
        )
        .all()

      expect(postsOf(row)[0]?.orphanNotes).toBe('ORPHAN')
      expect(postsOf(row)[0]?.author).toBeNull()
    },
    BOOT,
  )

  test(
    'reports the nested foreign key of a relation the caller may not see as null',
    async () => {
      const asAuthor = nested.context({ userId: nestedAuthorId })
      const [row] = await asAuthor.db.Blog.where({ id: { equals: nestedBlogId } })
        .include('posts', (posts) =>
          posts.where({ id: { equals: nestedAuthoredPostId } }).include('author'),
        )
        .all()

      expect(postsOf(row)[0]?.author).toBeNull()
      expect(postsOf(row)[0]?.authorId).toBeNull()
    },
    BOOT,
  )
})
