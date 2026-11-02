import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { password, text } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'

const BOOT = 120_000

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Account: {
      fields: {
        name: text(),
        secret: password(),
      },
      access: { operation: { query: () => true, create: () => true } },
    },
  },
}

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase(config)
  const created = await database
    .context(null)
    .sudo()
    .db.Account.create({
      data: { name: 'a', secret: 'hunter2' },
    })
  if (!created) throw new Error('seed account')
}, BOOT)

afterAll(async () => {
  await database?.close()
})

describe('a password() column is outside the predicate, order and distinct vocabulary', () => {
  test(
    'where is refused as an unknown column is',
    async () => {
      const db = database.context(null).db
      const refused = await db.Account.where({ secret: { contains: '$' } })
        .all()
        .catch((error: unknown) => error)
      const unknown = await db.Account.where({ nope: { contains: '$' } } as never)
        .all()
        .catch((error: unknown) => error)
      expect(refused).toBeInstanceOf(Error)
      expect(String((refused as Error).message).replace('secret', 'X')).toBe(
        String((unknown as Error).message).replace('nope', 'X'),
      )
    },
    BOOT,
  )

  test(
    'orderBy and distinct are refused',
    async () => {
      const db = database.context(null).db
      await expect(db.Account.orderBy({ secret: 'asc' }).all()).rejects.toThrow()
      await expect(db.Account.distinct('secret').all()).rejects.toThrow()
    },
    BOOT,
  )

  test(
    'sudo does not lift the refusal',
    async () => {
      const db = database.context(null).sudo().db
      await expect(db.Account.where({ secret: { contains: '$' } }).all()).rejects.toThrow()
    },
    BOOT,
  )

  test(
    'an ordinary column still filters',
    async () => {
      const db = database.context(null).db
      expect(await db.Account.where({ name: { equals: 'a' } }).all()).toHaveLength(1)
    },
    BOOT,
  )
})
