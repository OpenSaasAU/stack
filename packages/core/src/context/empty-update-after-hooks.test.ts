import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { text } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'

const BOOT = 120_000

const seen: { hook: string; sameItem: boolean }[] = []

const config: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    Doc: {
      fields: { title: text() },
      access: {
        operation: {
          query: () => true,
          create: () => true,
          update: () => true,
          delete: () => true,
        },
      },
      hooks: {
        resolveInput: async ({ operation, resolvedData }) =>
          operation === 'update' ? { title: undefined } : resolvedData,
        afterOperation: async (args) => {
          if (args.operation === 'update') {
            seen.push({
              hook: 'afterOperation',
              sameItem: JSON.stringify(args.item) === JSON.stringify(args.originalItem),
            })
          }
        },
        afterTransaction: async (args) => {
          if (args.operation === 'update') {
            seen.push({
              hook: `afterTransaction:${args.status}`,
              sameItem: JSON.stringify(args.item) === JSON.stringify(args.originalItem),
            })
          }
        },
      },
    },
  },
}

describe('an update whose resolved payload is empty', () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase(config)
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(async () => {
    await database.truncate()
    seen.length = 0
  })

  test('writes nothing but still runs afterOperation and reports committed with item equal to originalItem', async () => {
    const created = await database
      .context(null)
      .sudo()
      .db.Doc.create({ data: { title: 'a' } })
    const id = String(created?.id)
    seen.length = 0

    const row = await database.context({ userId: 'u' }).db.Doc.update({
      where: { id },
      data: { title: 'b' },
    })

    expect(row?.title).toBe('a')
    expect(row?.updatedAt).toEqual(created?.updatedAt)
    expect(seen).toContainEqual({ hook: 'afterOperation', sameItem: true })
    expect(seen).toContainEqual({ hook: 'afterTransaction:committed', sameItem: true })
  })
})
