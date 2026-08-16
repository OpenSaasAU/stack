import { describe, it, expect } from 'vitest'
import { jsonSafeClone } from '../../src/lib/jsonSafeClone.js'

describe('jsonSafeClone', () => {
  it('round-trips a bigint back to a bigint instead of throwing', () => {
    const cloned = jsonSafeClone({ id: '1', epoch: 9007199254740993n })

    expect(cloned).toEqual({ id: '1', epoch: 9007199254740993n })
    expect(typeof cloned.epoch).toBe('bigint')
  })

  it('round-trips a bigint nested inside an array of rows', () => {
    const cloned = jsonSafeClone([{ epoch: 1n }, { epoch: -9223372036854775808n }])

    expect(cloned).toEqual([{ epoch: 1n }, { epoch: -9223372036854775808n }])
  })

  it('behaves like a plain JSON round-trip for ordinary values', () => {
    const input = { title: 'Post', createdAt: new Date('2026-01-01'), count: 3, tags: ['a', 'b'] }

    expect(jsonSafeClone(input)).toEqual(
      JSON.parse(JSON.stringify(input)) as Record<string, unknown>,
    )
  })

  it('does not misinterpret an ordinary object shaped like the internal bigint tag', () => {
    // A field legitimately named `$bigint` with a non-string value must not
    // be revived — only the exact shape this function itself produces should be.
    const cloned = jsonSafeClone({ $bigint: 42 })

    expect(cloned).toEqual({ $bigint: 42 })
  })
})
