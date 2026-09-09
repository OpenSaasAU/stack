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

let database: TestDatabase
let authorId: string
let readerId: string
let postId: string

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
}, BOOT)

afterAll(async () => {
  await database?.close()
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
