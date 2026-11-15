import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { text } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import { engineContextOf } from './engine-context.js'

const BOOT = 120_000

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Settings: {
      isSingleton: true,
      fields: { siteName: text() },
      access: { operation: { query: () => false, create: () => true, update: () => true } },
    },
  },
}

describe("a context's singleton row probe", () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase(config)
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  test('answers whether the row is stored, without creating it and whatever the session may read', async () => {
    const denied = engineContextOf(database.context(null))
    const stored = async () => await denied._singletonRowStored?.('Settings')
    const sudo = database.context(null).sudo()

    expect(await stored()).toBe(false)
    expect(await stored()).toBe(false)
    expect(await sudo.db.Settings.update({ where: { id: 1 }, data: { siteName: 'x' } })).toBeNull()

    expect(await sudo.db.Settings.get?.()).toBeTruthy()

    expect(await stored()).toBe(true)
    expect(await database.context(null).db.Settings.get?.()).toBeNull()
  })

  test('answers on a transaction context through its own client', async () => {
    const answer = await database
      .context(null)
      .sudo()
      .transaction(async (tx) => await engineContextOf(tx)._singletonRowStored?.('Settings'))

    expect(answer).toBe(true)
  })
})
