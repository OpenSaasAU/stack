import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { validateDefaultValues } from '../validation/default-value.js'
import { deriveContract } from '../contract/derive.js'
import { createTestContext, type TestContext } from '../testing/context.js'
import { bigInt, calendarDay, checkbox, decimal, integer, select } from './index.js'

function derive(field: OpenSaasConfig['lists'][string]['fields'][string]) {
  return deriveContract({
    db: { provider: 'postgresql' },
    lists: { Thing: { fields: { value: field }, access: { operation: { query: () => true } } } },
  })
}

describe('decimal precision and scale', () => {
  test.each([
    ['precision', { precision: '10' }],
    ['precision', { precision: 0 }],
    ['precision', { precision: 1001 }],
    ['precision', { precision: 1.5 }],
    ['scale', { scale: '2); DROP TABLE x; --', defaultValue: '1' }],
    ['scale', { scale: -1 }],
    ['scale', { precision: 5, scale: 6 }],
  ])('rejects an invalid %s naming list, field and option', (option, bad) => {
    expect(() => derive(decimal(bad as never))).toThrow(
      new RegExp(`"Thing\\.value" has an invalid ${option}`),
    )
  })

  test('a derived default expression holds only the checked integers', () => {
    const derived = derive(decimal({ precision: 10, scale: 2, defaultValue: '1.50' }))
    expect(JSON.stringify(derived)).toContain('::numeric(10,2)')
    expect(JSON.stringify(derived)).not.toMatch(/DROP|--|;/)
  })
})

describe('defaultValue is checked against the field type', () => {
  test.each([
    ['checkbox', () => checkbox({ defaultValue: 'true) pwn' as never })],
    ['integer', () => integer({ defaultValue: 1.5 })],
    ['bigInt', () => bigInt({ defaultValue: '1n; pwn' as never })],
    ['decimal', () => decimal({ defaultValue: 'abc' })],
    ['calendarDay', () => calendarDay({ defaultValue: '2025-13-01' })],
    ['calendarDay', () => calendarDay({ defaultValue: '2025-02-30' })],
  ])('%s rejects an invalid default with a named error', (_name, build) => {
    expect(() => derive(build())).toThrow(/"Thing\.value" has an invalid defaultValue/)
  })

  test.each([
    ['integer', () => integer({ defaultValue: 3_000_000_000 })],
    ['bigInt', () => bigInt({ defaultValue: 1e21 })],
    ['decimal', () => decimal({ precision: 5, scale: 2, defaultValue: '12345.678' })],
  ])('%s rejects an out-of-range default', (_name, build) => {
    expect(() => derive(build())).toThrow(/has an invalid defaultValue/)
  })

  test('null and year-0099 defaults are accepted', () => {
    expect(() => derive(integer({ defaultValue: null as never }))).not.toThrow()
    expect(() => derive(calendarDay({ defaultValue: '0099-12-31' }))).not.toThrow()
  })

  test('valid defaults still derive', () => {
    expect(() => derive(checkbox({ defaultValue: true }))).not.toThrow()
    expect(() => derive(integer({ defaultValue: 3 }))).not.toThrow()
    expect(() => derive(bigInt({ defaultValue: '12' }))).not.toThrow()
    expect(() => derive(bigInt({ defaultValue: 12n }))).not.toThrow()
    expect(() => derive(decimal({ defaultValue: '1.5' }))).not.toThrow()
    expect(() =>
      derive(select({ options: [{ label: 'A', value: 'a' }], defaultValue: 'a' })),
    ).not.toThrow()
    expect(() => derive(calendarDay({ defaultValue: '2024-02-29' }))).not.toThrow()
  })
})

describe('select defaults', () => {
  test('a default outside the options is refused by the default-value validator', () => {
    const refusals = validateDefaultValues({
      db: { provider: 'postgresql' },
      lists: {
        Thing: {
          fields: { value: select({ options: [{ label: 'A', value: 'a' }], defaultValue: 'b' }) },
          access: { operation: { query: () => true } },
        },
      },
    })
    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatchObject({ listKey: 'Thing', entry: 'fields.value' })
  })
})

describe('defaults apply in a real database', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(
      {
        db: { provider: 'postgresql' },
        lists: {
          Item: {
            fields: {
              day: calendarDay({ defaultValue: '2025-03-04' }),
              price: decimal({ precision: 10, scale: 2, defaultValue: '1.50' }),
            },
            access: { operation: { query: () => true, create: () => true } },
          },
        },
      },
      null,
    )
  }, 120_000)

  afterAll(async () => {
    await harness?.close()
  })

  test('calendarDay and decimal defaults apply', async () => {
    const created = await harness.context.db.Item.create({ data: {} })
    expect(created?.day).toBe('2025-03-04')
    expect(String(created?.price)).toBe('1.50')
  })
})
