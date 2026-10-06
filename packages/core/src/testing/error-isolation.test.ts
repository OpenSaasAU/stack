import { describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { text } from '../fields/index.js'
import { createTestContext } from './context.js'

const BOOT = 120_000
const ITERATIONS = 25

const open = {
  operation: { query: () => true, create: () => true, update: () => true, delete: () => true },
}

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    User: { fields: { name: text() }, access: open },
    IntItem: { fields: { name: text() }, access: open, db: { idField: 'int autoincrement' } },
    Note: { fields: { name: text() }, access: open, db: { idField: 'int autoincrement' } },
  },
}

const BAD_ID = 'not-a-uuid'

describe('a failed statement on the in-process database', () => {
  test(
    'rejects with its own error and leaves the next statements their own results',
    async () => {
      const harness = await createTestContext(config, { userId: 'user-1' })
      try {
        const { db } = harness.context
        for (let i = 0; i < ITERATIONS; i++) {
          await expect(
            db.User.update({ where: { id: BAD_ID }, data: { name: 'x' } }),
          ).rejects.toThrow()

          const created = await db.IntItem.create({ data: { name: `i${i}` } })
          expect(created).toMatchObject({ name: `i${i}` })

          const notes = await db.Note.all()
          expect(notes).toEqual([])
        }
        expect(await db.IntItem.all()).toHaveLength(ITERATIONS)
      } finally {
        await harness.close()
      }
    },
    BOOT,
  )

  test(
    'rejects a failing transaction and the next statement sees its own result',
    async () => {
      const harness = await createTestContext(config, { userId: 'user-1' })
      try {
        const { context } = harness
        for (let i = 0; i < ITERATIONS; i++) {
          await expect(
            context.transaction(async (tx) => {
              await tx.db.User.update({ where: { id: BAD_ID }, data: { name: 'x' } })
            }),
          ).rejects.toThrow()

          const created = await context.db.IntItem.create({ data: { name: `t${i}` } })
          expect(created).toMatchObject({ name: `t${i}` })
          expect(await context.db.Note.all()).toEqual([])
        }
      } finally {
        await harness.close()
      }
    },
    BOOT,
  )
})
