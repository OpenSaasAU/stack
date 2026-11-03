import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { text } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'

const BOOT = 120_000

const seen: Record<string, unknown>[] = []

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Job: {
      fields: {
        title: text(),
        webhookUrl: text({ access: { read: ({ session }) => session?.role === 'admin' } }),
        slug: text({ hooks: { resolveOutput: ({ value }) => `/jobs/${String(value)}` } }),
      },
      access: {
        operation: { query: () => true, create: () => true, update: () => true },
      },
      hooks: {
        afterTransaction: async (args) => {
          if (args.operation === 'update' && args.status === 'committed') {
            seen.push({ item: args.item, originalItem: args.originalItem })
          }
        },
      },
    },
    Hidden: {
      fields: { title: text() },
      access: {
        operation: { query: () => false, create: () => true, update: () => true },
      },
      hooks: {
        afterTransaction: async (args) => {
          if (args.status === 'committed') seen.push({ hidden: args.item })
        },
      },
    },
  },
}

describe('afterTransaction.item is the persisted row', () => {
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

  test('item and originalItem differ only in what the write changed', async () => {
    const job = await database
      .context(null)
      .sudo()
      .db.Job.create({ data: { title: 't', webhookUrl: 'https://hook', slug: 'a' } })
    seen.length = 0
    const result = await database
      .context({ userId: 'u', role: 'user' })
      .db.Job.update({ where: { id: String(job?.id) }, data: { title: 't2' } })

    const { item, originalItem } = seen[0] as {
      item: Record<string, unknown>
      originalItem: Record<string, unknown>
    }
    expect(item.webhookUrl).toBe(originalItem.webhookUrl)
    expect(item.slug).toBe(originalItem.slug)
    expect(item.title).toBe('t2')
    expect(result).not.toHaveProperty('webhookUrl')
    expect(result?.slug).toBe('/jobs/a')
  })

  test('a list the session cannot query still reports every column', async () => {
    const row = await database.context({ userId: 'u' }).db.Hidden.create({ data: { title: 'x' } })
    expect(row).toEqual({ id: expect.anything() })
    expect(seen).toContainEqual({ hidden: expect.objectContaining({ title: 'x' }) })
  })
})
