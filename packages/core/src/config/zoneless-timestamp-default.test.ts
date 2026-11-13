import { describe, expect, test } from 'vitest'
import { generateZodSchema } from '../validation/schema.js'
import { fieldToJsonSchema } from '../mcp/field-schema.js'
import { config, list } from './index.js'
import { isZonelessNativeType, timestamp } from '../fields/index.js'

const ZONELESS = '2024-06-10T02:30:00.123'

const accepts = (defaults: { timestampNativeType?: string }) =>
  generateZodSchema({ at: timestamp() }, 'update', defaults).safeParse({ at: ZONELESS }).success

const build = (nativeType: string) =>
  config({
    db: { provider: 'postgresql', defaults: { timestamp: { nativeType } } },
    lists: { Ev: list({ fields: { at: timestamp() } }) },
  }) as Awaited<ReturnType<typeof config>>

describe('zoneless timestamp default', () => {
  test('a Timestamp default lets the zoneless read value validate', () => {
    expect(accepts({ timestampNativeType: 'Timestamp(3)' })).toBe(true)
  })

  test('a Timestamptz default or none keeps the strict schema', () => {
    expect(accepts({ timestampNativeType: 'Timestamptz(3)' })).toBe(false)
    expect(accepts({})).toBe(false)
  })

  test('the field own native type outranks the default', () => {
    const schema = generateZodSchema(
      { at: timestamp({ db: { nativeType: 'Timestamptz' } }) },
      'update',
      { timestampNativeType: 'Timestamp' },
    )
    expect(schema.safeParse({ at: ZONELESS }).success).toBe(false)
  })

  test('config() leaves the field untouched, so rebuilding with another default is safe', () => {
    const resolved = build('Timestamp(3)')
    expect(resolved.lists.Ev.fields.at.db?.nativeType).toBeUndefined()
  })

  test('the MCP schema drops the date-time format for a zoneless column', () => {
    const zoneless = build('Timestamp(3)')
    const strict = build('Timestamptz(3)')
    expect(fieldToJsonSchema('at', zoneless.lists.Ev.fields.at, zoneless)).not.toHaveProperty(
      'format',
    )
    expect(fieldToJsonSchema('at', strict.lists.Ev.fields.at, strict)).toHaveProperty(
      'format',
      'date-time',
    )
  })

  test('isZonelessNativeType', () => {
    expect(isZonelessNativeType('Timestamp')).toBe(true)
    expect(isZonelessNativeType('timestamp(3)')).toBe(true)
    expect(isZonelessNativeType('Timestamptz')).toBe(false)
    expect(isZonelessNativeType(undefined)).toBe(false)
  })
})
