import type { FieldConfig } from '../config/types.js'
import { describe, expect, test } from 'vitest'
import { bigInt, calendarDay, checkbox, decimal, integer, json, select, text } from './index.js'

const accepts = (field: Pick<FieldConfig, 'getZodSchema'>, value: unknown): boolean =>
  field.getZodSchema?.('f', 'create').safeParse(value).success === true

describe('values a column cannot hold are refused by validation', () => {
  test.each([2147483648, 1.5, -2147483649, NaN])('integer refuses %s', (v) => {
    expect(accepts(integer(), v)).toBe(false)
  })
  test('integer accepts the 32-bit bounds', () => {
    expect(accepts(integer(), 2147483647)).toBe(true)
    expect(accepts(integer(), -2147483648)).toBe(true)
  })

  test.each(['12345.67', '9999.995', 'abc', '', 'Infinity', 'NaN', NaN, Infinity])(
    'decimal(6,2) refuses %s',
    (v) => {
      expect(accepts(decimal({ precision: 6, scale: 2 }), v)).toBe(false)
    },
  )
  test.each(['9999.99', '0', '-1234.5', 12.5])('decimal(6,2) accepts %s', (v) => {
    expect(accepts(decimal({ precision: 6, scale: 2 }), v)).toBe(true)
  })

  test('bigInt refuses 2^63 and accepts 2^63-1', () => {
    expect(accepts(bigInt(), 2n ** 63n)).toBe(false)
    expect(accepts(bigInt(), 2n ** 63n - 1n)).toBe(true)
  })

  test.each(['2024-02-30', '2024-13-01'])('calendarDay refuses %s', (v) => {
    expect(accepts(calendarDay(), v)).toBe(false)
  })
  test('calendarDay accepts a leap day', () => {
    expect(accepts(calendarDay(), '2024-02-29')).toBe(true)
  })

  test('text and json refuse NUL bytes', () => {
    expect(accepts(text(), 'a\u0000b')).toBe(false)
    expect(accepts(json(), { nul: 'a\u0000b' })).toBe(false)
    expect(accepts(json(), ['a\u0000b'])).toBe(false)
    expect(accepts(json(), { ok: 'ab' })).toBe(true)
  })

  test('null is refused where the column is NOT NULL', () => {
    expect(accepts(checkbox(), null)).toBe(false)
    expect(accepts(checkbox({ db: { isNullable: true } }), null)).toBe(true)
    expect(accepts(text({ db: { isNullable: false } }), null)).toBe(false)
    expect(accepts(text(), null)).toBe(true)
    const withDefault = select({
      options: [{ label: 'A', value: 'a' }],
      defaultValue: 'a',
    })
    expect(accepts(withDefault, null)).toBe(false)
  })
})
