import { describe, it, expect } from 'vitest'
import { applyCreateDefaults } from '../src/context/apply-defaults.js'
import { text, integer, checkbox, timestamp, virtual, relationship } from '../src/fields/index.js'
import type { FieldConfig } from '../src/config/types.js'

/**
 * Direct unit tests for `applyCreateDefaults` (#615). These exercise every guard
 * rail of the real helper — virtual / system / relationship skips, the
 * no-`defaultValue` skip, explicit-value and explicit-`null` preservation, the
 * timestamp `{ kind: 'now' }` sentinel skip, and concrete `Date` injection — so
 * the resolve-then-validate helper is fully covered without mocking its logic.
 */

function fields(config: Record<string, FieldConfig>): Record<string, FieldConfig> {
  return config
}

describe('applyCreateDefaults', () => {
  it('injects a declared defaultValue into an omitted field', () => {
    const resolved = applyCreateDefaults(
      {},
      fields({
        label: text({ defaultValue: 'PLACEHOLDER' }),
        count: integer({ defaultValue: 7 }),
        active: checkbox({ defaultValue: true }),
      }),
    )

    expect(resolved).toEqual({ label: 'PLACEHOLDER', count: 7, active: true })
  })

  it('leaves a field with NO defaultValue untouched (key stays absent)', () => {
    const resolved = applyCreateDefaults({}, fields({ label: text() }))

    expect('label' in resolved).toBe(false)
  })

  it('preserves an explicitly-provided value over the default', () => {
    const resolved = applyCreateDefaults(
      { count: 99 },
      fields({ count: integer({ defaultValue: 7 }) }),
    )

    expect(resolved.count).toBe(99)
  })

  it('preserves an explicit null and does not overwrite it with the default', () => {
    const resolved = applyCreateDefaults(
      { note: null },
      fields({ note: text({ defaultValue: 'DEFAULT_NOTE' }) }),
    )

    expect(resolved.note).toBeNull()
  })

  it('skips virtual fields (no scalar default to inject)', () => {
    const resolved = applyCreateDefaults(
      {},
      fields({
        // A virtual field cannot carry a stored default; it must be skipped.
        computed: virtual({
          type: 'string',
          hooks: { resolveOutput: () => 'x' },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
      }),
    )

    expect('computed' in resolved).toBe(false)
  })

  it('skips system fields (id/createdAt/updatedAt)', () => {
    const resolved = applyCreateDefaults(
      {},
      fields({
        id: text({ defaultValue: 'SHOULD_NOT_INJECT' }),
        createdAt: timestamp({ defaultValue: new Date('2020-01-01T00:00:00Z') }),
        updatedAt: timestamp({ defaultValue: new Date('2020-01-01T00:00:00Z') }),
      }),
    )

    expect(resolved).toEqual({})
  })

  it('skips relationship fields (they carry connect/create payloads, not literals)', () => {
    const resolved = applyCreateDefaults(
      {},
      fields({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        owner: relationship({ ref: 'User' }) as any,
      }),
    )

    expect('owner' in resolved).toBe(false)
  })

  it("does NOT inject the timestamp { kind: 'now' } sentinel (left for the DB @default(now()))", () => {
    const resolved = applyCreateDefaults(
      {},
      fields({ when: timestamp({ defaultValue: { kind: 'now' } }) }),
    )

    expect('when' in resolved).toBe(false)
  })

  it('DOES inject a concrete Date default (a real literal, unlike the now sentinel)', () => {
    const date = new Date('2021-06-15T12:00:00Z')
    const resolved = applyCreateDefaults({}, fields({ when: timestamp({ defaultValue: date }) }))

    expect(resolved.when).toBe(date)
  })

  it('returns the same resolvedData object it was given (mutation contract)', () => {
    const input: Record<string, unknown> = {}
    const result = applyCreateDefaults(input, fields({ label: text({ defaultValue: 'x' }) }))

    expect(result).toBe(input)
  })
})
