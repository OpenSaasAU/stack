import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { text } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'

const BOOT = 120_000

let moveOwner: (() => Promise<unknown>) | undefined
const seenOriginal: unknown[] = []

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Post: {
      fields: { title: text(), ownerId: text() },
      access: {
        operation: {
          query: () => true,
          create: () => true,
          update: ({ session }) => ({ ownerId: { equals: String(session?.userId) } }),
          delete: ({ session, item }) => item?.ownerId === session?.userId,
        },
      },
      hooks: {
        beforeTransaction: async () => {
          const move = moveOwner
          moveOwner = undefined
          await move?.()
        },
        beforeOperation: async ({ operation, ...rest }) => {
          if (
            operation === 'update' &&
            'resolvedData' in rest &&
            rest.resolvedData.title !== undefined
          )
            seenOriginal.push(rest.resolvedData)
        },
      },
    },
  },
}

describe('a root update or delete resolves its target under the row lock', () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase(config)
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(async () => {
    await database.truncate()
    moveOwner = undefined
    seenOriginal.length = 0
  })

  async function seed(): Promise<string> {
    const row = await database
      .context(null)
      .sudo()
      .db.Post.create({ data: { title: 't', ownerId: 'alice' } })
    return String(row?.id)
  }

  test('an update whose row left the Access Filter after the gate returns null and writes nothing', async () => {
    const id = await seed()
    const admin = database.context(null).sudo()
    moveOwner = () => admin.db.Post.update({ where: { id }, data: { ownerId: 'bob' } })

    const result = await database
      .context({ userId: 'alice' })
      .db.Post.update({ where: { id }, data: { title: 'pwned' } })

    expect(result).toBeNull()
    expect(seenOriginal).toEqual([])
    const row = await admin.db.Post.where({ id: { equals: id } }).first()
    expect(row).toMatchObject({ title: 't', ownerId: 'bob' })
  })

  test('a delete whose item-based rule fails after the gate returns null and deletes nothing', async () => {
    const id = await seed()
    const admin = database.context(null).sudo()
    moveOwner = () => admin.db.Post.update({ where: { id }, data: { ownerId: 'bob' } })

    const result = await database.context({ userId: 'alice' }).db.Post.delete({ where: { id } })

    expect(result).toBeNull()
    expect(await admin.db.Post.where({ id: { equals: id } }).first()).not.toBeNull()
  })

  test('an update still lands when the row stays in scope', async () => {
    const id = await seed()
    const result = await database
      .context({ userId: 'alice' })
      .db.Post.update({ where: { id }, data: { title: 'ok' } })
    expect(result).toMatchObject({ title: 'ok' })
  })
})
