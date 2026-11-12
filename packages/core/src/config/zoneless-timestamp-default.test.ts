import { describe, expect, test } from 'vitest'
import { config, list } from './index.js'
import { isZonelessNativeType, timestamp } from '../fields/index.js'

const build = (nativeType: string) =>
  config({
    db: { provider: 'postgresql', defaults: { timestamp: { nativeType } } },
    lists: { Ev: list({ fields: { at: timestamp() } }) },
  }) as Awaited<ReturnType<typeof config>>

describe('zoneless timestamp default', () => {
  test('a Timestamp default lets the zoneless read value validate', () => {
    const field = build('Timestamp(3)').lists.Ev.fields.at
    expect(field.getZodSchema?.('at', 'update').safeParse('2024-06-10T02:30:00.123').success).toBe(
      true,
    )
  })

  test('a Timestamptz default keeps the strict schema', () => {
    const field = build('Timestamptz(3)').lists.Ev.fields.at
    expect(field.getZodSchema?.('at', 'update').safeParse('2024-06-10T02:30:00.123').success).toBe(
      false,
    )
  })

  test('isZonelessNativeType', () => {
    expect(isZonelessNativeType('Timestamp')).toBe(true)
    expect(isZonelessNativeType('timestamp(3)')).toBe(true)
    expect(isZonelessNativeType('Timestamptz')).toBe(false)
    expect(isZonelessNativeType(undefined)).toBe(false)
  })
})
