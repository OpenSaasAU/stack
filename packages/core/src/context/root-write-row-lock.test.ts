import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { integer, text } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import { RowLockUnavailableError } from '../secured/lock.js'

const BOOT = 120_000

const locked: string[] = []
const refused: unknown[] = []

const config: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    Bill: {
      fields: { name: text(), total: integer() },
      access: { operation: { query: () => true, create: () => true } },
    },
    BillItem: {
      fields: {
        billId: text(),
        amount: integer(),
        note: text({
          hooks: {
            resolveInput: async ({ context, resolvedData, fieldKey }) => {
              const rows = await context.db.Bill.forUpdate().all()
              locked.push(`field:${rows.length}`)
              return resolvedData[fieldKey]
            },
          },
        }),
      },
      access: {
        operation: {
          query: () => true,
          create: () => true,
          update: () => true,
          delete: () => true,
        },
      },
      hooks: {
        resolveInput: async ({ context, resolvedData }) => {
          const rows = await context.db.Bill.forUpdate().all()
          locked.push(`resolveInput:${rows.length}`)
          return resolvedData
        },
        validate: async ({ context, operation }) => {
          if (operation !== 'delete') return
          const rows = await context.db.Bill.forUpdate().all()
          locked.push(`validate:${rows.length}`)
        },
        beforeOperation: async ({ context, operation }) => {
          if (operation === 'delete') return
          const rows = await context.db.Bill.forUpdate().all()
          locked.push(`beforeOperation:${rows.length}`)
        },
        beforeTransaction: async ({ context }) => {
          try {
            await context.db.Bill.forUpdate().all()
          } catch (error) {
            refused.push(error)
          }
        },
        afterTransaction: async ({ context }) => {
          try {
            await context.db.Bill.forUpdate().all()
          } catch (error) {
            refused.push(error)
          }
        },
      },
    },
  },
}

describe('a root write’s own transaction carries a row lock lane', () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase(config)
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(async () => {
    await database.truncate()
    locked.length = 0
    refused.length = 0
    await database.context(null).db.Bill.create({ data: { name: 'b', total: 0 } })
  })

  test('create, update and delete take the lock from list and field hooks', async () => {
    const context = database.context(null)
    const created = await context.db.BillItem.create({
      data: { billId: 'x', amount: 1, note: 'n' },
    })
    expect(created).not.toBeNull()
    expect(locked).toEqual(
      expect.arrayContaining(['resolveInput:1', 'field:1', 'beforeOperation:1']),
    )

    locked.length = 0
    const updated = await context.db.BillItem.update({
      where: { id: String(created?.id) },
      data: { amount: 2, note: 'm' },
    })
    expect(updated).not.toBeNull()
    expect(locked).toEqual(
      expect.arrayContaining(['resolveInput:1', 'field:1', 'beforeOperation:1']),
    )

    locked.length = 0
    const deleted = await context.db.BillItem.delete({ where: { id: String(created?.id) } })
    expect(deleted).not.toBeNull()
    expect(locked).toContain('validate:1')
  })

  test('a root write through sudo takes the lock too', async () => {
    const created = await database
      .context(null)
      .sudo()
      .db.BillItem.create({ data: { billId: 'x', amount: 1, note: 'n' } })
    expect(created).not.toBeNull()
    expect(locked).toContain('resolveInput:1')
  })

  test('the boundary hooks run outside the transaction and are still refused', async () => {
    await database.context(null).db.BillItem.create({ data: { billId: 'x', amount: 1, note: 'n' } })
    expect(refused).toHaveLength(2)
    for (const error of refused) expect(error).toBeInstanceOf(RowLockUnavailableError)
  })
})
