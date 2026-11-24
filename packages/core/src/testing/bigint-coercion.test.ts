import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { bigInt } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from './context.js'

const BOOT = 120_000

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Big: {
      access: { operation: { query: () => true, create: () => true, update: () => true } },
      fields: { b: bigInt() },
    },
  },
}

describe('bigInt writes coerce number and numeric string input', () => {
  let database: TestDatabase
  beforeAll(async () => {
    database = await createTestDatabase(config)
  }, BOOT)
  afterAll(async () => {
    await database?.close()
  })

  test('create accepts a number and a numeric string', async () => {
    const db = database.context().db
    expect((await db.Big.create({ data: { b: 5 } }))?.b).toBe(5n)
    expect((await db.Big.create({ data: { b: '6' } }))?.b).toBe(6n)
  })

  test('update accepts a number and keeps a large string exact', async () => {
    const db = database.context().db
    const row = await db.Big.create({ data: { b: 1n } })
    if (row === null) throw new Error('create denied')
    expect((await db.Big.update({ where: { id: row.id }, data: { b: 42 } }))?.b).toBe(42n)
    const big = await db.Big.update({ where: { id: row.id }, data: { b: '9007199254740993' } })
    expect(big?.b).toBe(9007199254740993n)
  })
})
