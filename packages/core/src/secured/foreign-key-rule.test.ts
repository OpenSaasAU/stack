import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'

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
}, BOOT)

afterAll(async () => {
  await database?.close()
  await scoped?.close()
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
})
