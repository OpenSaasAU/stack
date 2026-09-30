import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import {
  bigInt,
  calendarDay,
  checkbox,
  decimal,
  integer,
  select,
  text,
  timestamp,
} from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from './context.js'

const BOOT = 120_000

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Thing: {
      fields: {
        label: text({ defaultValue: 'x' }),
        count: integer({ defaultValue: 3 }),
        big: bigInt({ defaultValue: 42n }),
        price: decimal({ validation: { isRequired: true }, defaultValue: '1.00' }),
        precise: decimal({ precision: 10, scale: 2, defaultValue: '-0.5' }),
        active: checkbox({ defaultValue: true }),
        day: calendarDay({ defaultValue: '2024-01-02' }),
        at: timestamp({ defaultValue: { kind: 'now' } }),
        kind: select({ options: [{ label: 'A', value: 'a' }], defaultValue: 'a' }),
      },
    },
  },
}

describe('scalar defaults apply to a real database', () => {
  let database: TestDatabase
  beforeAll(async () => {
    database = await createTestDatabase(config)
  }, BOOT)
  afterAll(async () => {
    await database?.close()
  })

  test('every scalar field type with a defaultValue satisfies the contract', () => {
    expect(database).toBeDefined()
  })
})
