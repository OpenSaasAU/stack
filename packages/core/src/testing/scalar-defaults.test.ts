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
      access: { operation: { query: () => true, create: () => true } },
      fields: {
        label: text({ defaultValue: 'x' }),
        count: integer({ defaultValue: 3 }),
        big: bigInt({ defaultValue: 42n }),
        price: decimal({ validation: { isRequired: true }, defaultValue: '1.00' }),
        precise: decimal({ precision: 10, scale: 2, defaultValue: '-0.5' }),
        fraction: decimal({ precision: 10, scale: 2, defaultValue: '1.5' }),
        signed: decimal({ precision: 10, scale: 2, defaultValue: '+1.0' }),
        bare: decimal({ precision: 10, scale: 2, defaultValue: '.5' }),
        trailing: decimal({ precision: 10, scale: 2, defaultValue: '2.' }),
        padded: decimal({ precision: 10, scale: 2, defaultValue: '007' }),
        negWhole: decimal({ precision: 10, scale: 2, defaultValue: '-3' }),
        whole: decimal({ precision: 10, scale: 2, defaultValue: '1' }),
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

  test('every scalar field type with a defaultValue applies and defaults on insert', async () => {
    const created = await database.context().db.Thing.create({ data: {} })
    expect(created).toMatchObject({
      label: 'x',
      count: 3,
      active: true,
      kind: 'a',
    })
    expect(String(created?.price)).toBe('1.0000')
    expect(String(created?.precise)).toBe('-0.50')
    expect(String(created?.whole)).toBe('1.00')
    expect(String(created?.fraction)).toBe('1.50')
    expect(String(created?.signed)).toBe('1.00')
    expect(String(created?.bare)).toBe('0.50')
    expect(String(created?.trailing)).toBe('2.00')
    expect(String(created?.padded)).toBe('7.00')
    expect(String(created?.negWhole)).toBe('-3.00')
  })
})
