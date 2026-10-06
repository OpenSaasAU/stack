import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { text } from '../fields/index.js'
import { createTestContext, type TestContext } from './context.js'

const BOOT = 120_000
const ITERATIONS = 25
const BAD_ID = 'not-a-uuid'

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

async function causeOf(attempt: Promise<unknown>): Promise<string> {
  try {
    await attempt
  } catch (error) {
    return error instanceof Error && error.cause instanceof Error ? error.cause.message : ''
  }
  return ''
}

describe('a failed statement on the in-process database', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(config, { userId: 'user-1' })
    await harness.context.db.Note.create({ data: { name: 'seed' } })
  }, BOOT)

  afterAll(async () => {
    await harness.close()
  })

  test('rejects with its own error and leaves the next statements their own results', async () => {
    const { db } = harness.context
    for (let i = 0; i < ITERATIONS; i++) {
      const cause = await causeOf(db.User.update({ where: { id: BAD_ID }, data: { name: 'x' } }))
      expect(cause).toMatch(/invalid input syntax for type uuid/)

      const created = await db.IntItem.create({ data: { name: `i${i}` } })
      expect(created).toMatchObject({ name: `i${i}` })

      const notes = await db.Note.all()
      expect(notes).toHaveLength(1)
      expect(notes[0]).toMatchObject({ name: 'seed' })
    }
  })

  test('rejects a failing transaction and the next statement sees its own result', async () => {
    const { context } = harness
    for (let i = 0; i < ITERATIONS; i++) {
      const cause = await causeOf(
        context.transaction(async (tx) => {
          await tx.db.User.update({ where: { id: BAD_ID }, data: { name: 'x' } })
        }),
      )
      expect(cause).toMatch(/invalid input syntax for type uuid/)

      const created = await context.db.IntItem.create({ data: { name: `t${i}` } })
      expect(created).toMatchObject({ name: `t${i}` })

      const notes = await context.db.Note.all()
      expect(notes).toHaveLength(1)
      expect(notes[0]).toMatchObject({ name: 'seed' })
    }
  })
})
