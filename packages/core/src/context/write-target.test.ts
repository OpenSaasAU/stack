import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'

const BOOT = 120_000

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    User: {
      fields: { name: text(), posts: relationship({ ref: 'Post.author', many: true }) },
      access: { operation: { query: () => true, create: () => true } },
    },
    Post: {
      fields: { title: text(), author: relationship({ ref: 'User.posts' }) },
      access: {
        operation: {
          query: () => true,
          create: () => true,
          update: ({ item }) => item?.author.name === 'alice',
          delete: () => {
            throw new Error('delete rule failed')
          },
        },
      },
    },
  },
}

describe('the target an update or delete resolves', () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase(config)
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(async () => {
    await database.truncate()
  })

  async function seed(): Promise<string> {
    const admin = database.context(null).sudo()
    const author = await admin.db.User.create({ data: { name: 'alice' } })
    const post = await admin.db.Post.create({
      data: { title: 't', author: { connect: { id: String(author?.id) } } },
    })
    return String(post?.id)
  }

  test('an operation rule reaching a relation the row does not carry denies the update', async () => {
    const id = await seed()

    const result = await database
      .context({ userId: 'alice' })
      .db.Post.update({ where: { id }, data: { title: 'changed' } })

    expect(result).toBeNull()
    const row = await database
      .context(null)
      .db.Post.where({ id: { equals: id } })
      .first()
    expect(row).toMatchObject({ title: 't' })
  })

  test('an operation rule that throws for another reason rejects the delete', async () => {
    const id = await seed()

    await expect(
      database.context({ userId: 'alice' }).db.Post.delete({ where: { id } }),
    ).rejects.toThrow('delete rule failed')
    expect(
      await database
        .context(null)
        .db.Post.where({ id: { equals: id } })
        .first(),
    ).not.toBeNull()
  })
})
