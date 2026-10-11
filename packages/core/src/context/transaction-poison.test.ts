import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text } from '../fields/index.js'
import { ValidationError } from '../hooks/index.js'
import { createTestContext, type TestContext } from '../testing/context.js'
import { TransactionRolledBackError } from './index.js'

const BOOT = 120_000

const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

const afterTransaction = vi.fn()
const bridge = vi.fn()

function schemaConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      Bill: {
        fields: { name: text(), credit: relationship({ ref: 'Credit' }) },
        access: { operation: OPEN },
        hooks: { afterTransaction },
      },
      Credit: {
        fields: { code: text({ isIndexed: 'unique', validation: { isRequired: true } }) },
        access: { operation: OPEN },
        hooks: { afterTransaction },
      },
      Guarded: {
        fields: { name: text() },
        access: { operation: { ...OPEN, create: () => false } },
      },
      Audited: {
        fields: { name: text() },
        access: { operation: OPEN },
        hooks: {
          afterOperation: async ({ context }) => {
            await bridge(context)
          },
        },
      },
      Parent: {
        fields: { name: text() },
        access: { operation: OPEN },
        hooks: {
          beforeOperation: async ({ context }) => {
            await bridge(context)
          },
        },
      },
    },
  }
}

describe('a joined write that throws poisons its transaction owner', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(schemaConfig(), { userId: 'u1' })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.truncate()
    afterTransaction.mockReset()
    bridge.mockReset()
  })

  const count = async (list: 'Bill' | 'Credit'): Promise<number> =>
    (await harness.context.sudo().db[list].all()).length

  test(
    'a caught validation failure rejects the owner with the child failure as cause',
    async () => {
      let child: unknown
      const run = harness.context.transaction(async (tx) => {
        await tx.db.Bill.create({ data: { name: 'a' } })
        try {
          await tx.sudo().db.Credit.create({ data: {} })
        } catch (err) {
          child = err
        }
      })

      const rejection = await run.catch((err: unknown) => err)
      expect(rejection).toBeInstanceOf(TransactionRolledBackError)
      expect(child).toBeInstanceOf(ValidationError)
      expect((rejection as TransactionRolledBackError).cause).toBe(child)
      expect(await count('Bill')).toBe(0)
      expect(await count('Credit')).toBe(0)
    },
    BOOT,
  )

  test(
    'a caught unique violation rejects instead of resolving a rolled-back transaction',
    async () => {
      await harness.context.sudo().db.Credit.create({ data: { code: 'dup' } })

      await expect(
        harness.context.transaction(async (tx) => {
          await tx.db.Bill.create({ data: { name: 'a' } })
          await tx
            .sudo()
            .db.Credit.create({ data: { code: 'dup' } })
            .catch(() => null)
        }),
      ).rejects.toBeInstanceOf(TransactionRolledBackError)

      expect(await count('Bill')).toBe(0)
    },
    BOOT,
  )

  test(
    'poison survives withSession and a nested transaction, landing on the outermost owner',
    async () => {
      await expect(
        harness.context.transaction(async (tx) => {
          await tx.db.Bill.create({ data: { name: 'a' } })
          await tx.transaction(async (inner) => {
            await inner
              .withSession({ userId: 'u2' })
              .db.Credit.create({ data: {} })
              .catch(() => null)
          })
        }),
      ).rejects.toBeInstanceOf(TransactionRolledBackError)

      expect(await count('Bill')).toBe(0)
    },
    BOOT,
  )

  test(
    'a caught failure from a hook-issued write poisons the outer owner',
    async () => {
      bridge.mockImplementation(async (context: { db: TestContext['context']['db'] }) => {
        await context.db.Credit.create({ data: {} }).catch(() => null)
      })

      await expect(
        harness.context.transaction(async (tx) => {
          await tx.db.Bill.create({ data: { name: 'a' } })
          await tx.db.Parent.create({ data: { name: 'p' } })
        }),
      ).rejects.toBeInstanceOf(TransactionRolledBackError)

      expect(await count('Bill')).toBe(0)
    },
    BOOT,
  )

  test(
    'a hook-issued failure caught inside a root write rolls that write back',
    async () => {
      bridge.mockImplementation(async (context: { db: TestContext['context']['db'] }) => {
        await context.db.Credit.create({ data: {} }).catch(() => null)
      })

      await expect(
        harness.context.db.Parent.create({ data: { name: 'p' } }),
      ).rejects.toBeInstanceOf(TransactionRolledBackError)
      expect(await harness.context.sudo().db.Parent.all()).toHaveLength(0)
    },
    BOOT,
  )

  test(
    'a statement on tx.unsafe that aborts the transaction rejects rather than committing',
    async () => {
      await expect(
        harness.context.transaction(async (tx) => {
          await tx.db.Bill.create({ data: { name: 'a' } })
          const failing = harness.client.raw.sql`SELECT 1 / 0`.affectedCount().build()
          await tx.unsafe.execute(failing).catch(() => null)
        }),
      ).rejects.toBeInstanceOf(TransactionRolledBackError)

      expect(await count('Bill')).toBe(0)
    },
    BOOT,
  )

  test(
    'an access-denied write returns null without poisoning the transaction',
    async () => {
      const denied = await harness.context.transaction(async (tx) => {
        await tx.db.Bill.create({ data: { name: 'a' } })
        return tx.db.Guarded.create({ data: { name: 'g' } })
      })

      expect(denied).toBeNull()
      expect(await count('Bill')).toBe(1)
    },
    BOOT,
  )

  test(
    'every afterTransaction in a poisoned owner reports rolled-back',
    async () => {
      await harness.context
        .transaction(async (tx) => {
          await tx.db.Bill.create({ data: { name: 'a' } })
          await tx
            .sudo()
            .db.Credit.create({ data: {} })
            .catch(() => null)
        })
        .catch(() => null)

      const statuses = afterTransaction.mock.calls.map((call) => call[0].status)
      expect(statuses).toEqual(['rolled-back', 'rolled-back'])
    },
    BOOT,
  )

  test(
    'a caught refusal raised before the write bracket opens poisons the owner',
    async () => {
      await expect(
        harness.context.transaction(async (tx) => {
          await tx.db.Bill.create({ data: { name: 'a' } })
          await tx.db.Bill.create({
            data: { name: 'b', credit: { create: { code: 'x' } } } as never,
          }).catch(() => null)
        }),
      ).rejects.toBeInstanceOf(TransactionRolledBackError)

      expect(await count('Bill')).toBe(0)
    },
    BOOT,
  )

  test(
    'a clean transaction still commits',
    async () => {
      await harness.context.transaction(async (tx) => {
        await tx.db.Bill.create({ data: { name: 'a' } })
      })
      expect(await count('Bill')).toBe(1)
    },
    BOOT,
  )
})

describe('a caught failing secured read poisons its transaction owner', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(schemaConfig(), { userId: 'u1' })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.truncate()
    bridge.mockReset()
  })

  const count = async (): Promise<number> => (await harness.context.sudo().db.Bill.all()).length

  test(
    'a caught malformed-id read rejects instead of resolving a rolled-back transaction',
    async () => {
      await expect(
        harness.context.transaction(async (tx) => {
          const created = await tx.db.Bill.create({ data: { name: 'kept' } })
          try {
            await tx.db.Bill.where({ id: { equals: 'not-a-uuid' } }).first()
          } catch {
            // treated as not found
          }
          return created
        }),
      ).rejects.toBeInstanceOf(TransactionRolledBackError)
      expect(await count()).toBe(0)
    },
    BOOT,
  )

  test(
    'a caught failing read in an afterOperation hook does not report a lost write as success',
    async () => {
      bridge.mockImplementation(async (context: { db: TestContext['context']['db'] }) => {
        await context.db.Credit.where({ id: { equals: 'not-a-uuid' } })
          .first()
          .catch(() => null)
      })

      const outcome = await harness.context
        .transaction(async (tx) => tx.db.Audited.create({ data: { name: 'p' } }))
        .catch((err: unknown) => err)
      expect(outcome).toBeInstanceOf(TransactionRolledBackError)
    },
    BOOT,
  )

  test(
    'a caught failing all() rejects instead of resolving a rolled-back transaction',
    async () => {
      await expect(
        harness.context.transaction(async (tx) => {
          await tx.db.Bill.create({ data: { name: 'kept' } })
          await tx.db.Bill.where({ id: { equals: 'not-a-uuid' } })
            .all()
            .catch(() => [])
        }),
      ).rejects.toBeInstanceOf(TransactionRolledBackError)
      expect(await count()).toBe(0)
    },
    BOOT,
  )
})
