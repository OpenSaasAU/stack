import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { text } from '../fields/index.js'
import { ValidationError } from '../hooks/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'

const BOOT = 120_000

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Doc: {
      fields: { title: text() },
      access: {
        operation: { query: () => true, create: () => true, update: () => true },
      },
    },
    Broken: {
      fields: { title: text() },
      access: {
        operation: { query: () => true, create: () => true, update: () => true },
      },
      hooks: {
        resolveInput: async () => undefined,
      },
    },
  },
}

describe('write input shape', () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase(config)
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(async () => {
    await database.truncate()
  })

  test.each([
    ['missing', undefined],
    ['null', null],
    ['an array', []],
  ])('create with data %s throws ValidationError and writes nothing', async (_, data) => {
    const db = database.context(null).sudo().db
    await expect(db.Doc.create({ data })).rejects.toBeInstanceOf(ValidationError)
    expect(await db.Doc.all()).toHaveLength(0)
  })

  test('a resolveInput returning undefined throws ValidationError and writes nothing', async () => {
    const db = database.context(null).sudo().db
    await expect(db.Broken.create({ data: { title: 'a' } })).rejects.toBeInstanceOf(ValidationError)
    expect(await db.Broken.all()).toHaveLength(0)
  })
})
