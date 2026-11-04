import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import type { Session } from '../access/types.js'
import { relationship, text } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'

const BOOT = 120_000

let result: unknown = null

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    User: {
      fields: {
        name: text(),
        posts: relationship({ ref: 'Post.author', many: true }),
      },
      access: {
        operation: {
          query: ({ session }: { session: Session | null }) => {
            void session
            return result as boolean
          },
        },
      },
    },
    Post: {
      fields: { title: text(), author: relationship({ ref: 'User.posts' }) },
      access: { operation: { query: () => true } },
    },
  },
}

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase(config)
  const admin = database.context({ userId: 'u1' }).sudo()
  const user = await admin.db.User.create({ data: { name: 'a' } })
  if (user === null) throw new Error('seed failed')
  await admin.db.Post.create({ data: { title: 'p', author: { connect: { id: user.id } } } })
}, BOOT)

afterAll(async () => {
  await database?.close()
})

describe.each([null, undefined])('an access rule returning %s', (value) => {
  test('denies the list and leaves unrelated lists readable', async () => {
    result = value
    const anonymous = database.context(null)
    expect(await anonymous.db.User.all()).toEqual([])
    expect(await anonymous.db.Post.all()).toHaveLength(1)
  })
})
