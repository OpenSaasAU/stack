import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { text, timestamp } from '../fields/index.js'
import { createTestContext, type TestContext } from '../testing/context.js'

const BOOT = 120_000
const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

function config(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Declared: {
        fields: {
          name: text(),
          createdAt: text(),
          updatedAt: timestamp(),
          stamped: timestamp({ defaultValue: { kind: 'now' } }),
        },
        access: { operation: OPEN },
      },
      Hidden: {
        fields: { name: text(), createdAt: text({ access: { read: () => false } }) },
        access: { operation: OPEN },
      },
      Auto: {
        fields: { name: text() },
        db: { timestamps: true },
        access: { operation: OPEN },
      },
    },
  }
}

describe('system fields follow the contract, not the name', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(config(), { userId: 'u1' })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  test('a declared createdAt/updatedAt stores what the caller writes', async () => {
    const date = new Date('2000-01-01T00:00:00Z')
    const row = await harness.context.db.Declared.create({
      data: { name: 'n', createdAt: 'hello', updatedAt: date },
    })
    expect(row?.createdAt).toBe('hello')
    expect(new Date(String(row?.updatedAt)).getTime()).toBe(date.getTime())
  })

  test('a declared createdAt with read denied is stripped and not queryable', async () => {
    await harness.context.sudo().db.Hidden.create({ data: { name: 'n', createdAt: 'SSN-1' } })
    const rows = await harness.context.db.Hidden.all()
    expect(rows[0]).not.toHaveProperty('createdAt')
    await expect(
      harness.context.db.Hidden.where({ createdAt: { contains: 'SSN' } }).all(),
    ).rejects.toThrow()
  })

  test.each(['id', 'createdAt', 'updatedAt'])(
    'an auto list refuses %s in a payload',
    async (key) => {
      const data = { name: 'n', [key]: key === 'id' ? 'x' : new Date() }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const create = (ctx: typeof harness.context) => ctx.db.Auto.create({ data: data as any })
      await expect(create(harness.context)).rejects.toThrow(/system-managed/)
      await expect(create(harness.context.sudo())).rejects.toThrow(/system-managed/)
    },
  )

  test('an auto list still maintains and returns its timestamps', async () => {
    const row = await harness.context.db.Auto.create({ data: { name: 'n' } })
    expect(Number.isNaN(new Date(String(row?.createdAt)).getTime())).toBe(false)
  })
})
