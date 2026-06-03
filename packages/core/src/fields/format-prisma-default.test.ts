import { describe, it, expect } from 'vitest'
import { formatPrismaDefault, type PrismaDefaultFieldType } from './format-prisma-default.js'

describe('formatPrismaDefault', () => {
  describe('table-driven serialisation', () => {
    const cases: Array<{
      name: string
      value: unknown
      fieldType: PrismaDefaultFieldType
      expected: string | undefined
    }> = [
      // text
      {
        name: 'non-empty string',
        value: 'PLEASE_UPDATE',
        fieldType: 'text',
        expected: '"PLEASE_UPDATE"',
      },
      { name: 'empty string', value: '', fieldType: 'text', expected: '""' },
      {
        name: 'string with embedded quotes',
        value: 'say "hi"',
        fieldType: 'text',
        expected: '"say \\"hi\\""',
      },
      // integer
      { name: 'integer', value: 3550, fieldType: 'integer', expected: '3550' },
      { name: 'zero integer', value: 0, fieldType: 'integer', expected: '0' },
      { name: 'negative integer', value: -7, fieldType: 'integer', expected: '-7' },
      // json
      { name: 'JSON array', value: [1, 2, 3, 4, 5], fieldType: 'json', expected: '"[1,2,3,4,5]"' },
      {
        name: 'JSON object',
        value: { a: 1, b: 'two' },
        fieldType: 'json',
        expected: '"{\\"a\\":1,\\"b\\":\\"two\\"}"',
      },
      { name: 'empty array', value: [], fieldType: 'json', expected: '"[]"' },
      { name: 'empty object', value: {}, fieldType: 'json', expected: '"{}"' },
      // undefined → no default for every field type
      { name: 'undefined text', value: undefined, fieldType: 'text', expected: undefined },
      { name: 'undefined integer', value: undefined, fieldType: 'integer', expected: undefined },
      { name: 'undefined json', value: undefined, fieldType: 'json', expected: undefined },
    ]

    it.each(cases)('serialises $name → $expected', ({ value, fieldType, expected }) => {
      expect(formatPrismaDefault(value, fieldType)).toBe(expected)
    })
  })

  it('produces canonical space-free JSON (no extra whitespace)', () => {
    // Guards against pretty-printed JSON sneaking into the literal.
    expect(formatPrismaDefault([1, 2, 3], 'json')).toBe('"[1,2,3]"')
    expect(formatPrismaDefault({ nested: { x: [1] } }, 'json')).toBe(
      '"{\\"nested\\":{\\"x\\":[1]}}"',
    )
  })

  it('wraps a JSON string default in escaped quotes around the JSON text', () => {
    // A string value under the json field type is itself valid JSON; it gets
    // double-serialised: inner JSON.stringify("hi") = "\"hi\"", then wrapped.
    expect(formatPrismaDefault('hi', 'json')).toBe('"\\"hi\\""')
  })
})
