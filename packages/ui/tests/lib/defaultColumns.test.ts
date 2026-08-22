import { describe, it, expect } from 'vitest'
import {
  computeDefaultColumns,
  isDefaultColumnField,
  withStructuralTimestampDefaults,
} from '../../src/lib/defaultColumns.js'

describe('isDefaultColumnField', () => {
  it('is true for a field with no declaration', () => {
    expect(isDefaultColumnField({ type: 'text' } as never)).toBe(true)
    expect(isDefaultColumnField(undefined)).toBe(true)
  })

  it('is false only when explicitly declared false', () => {
    expect(isDefaultColumnField({ ui: { listView: { defaultColumn: false } } })).toBe(false)
    expect(isDefaultColumnField({ ui: { listView: { defaultColumn: true } } })).toBe(true)
    expect(isDefaultColumnField({ ui: {} })).toBe(true)
  })
})

describe('computeDefaultColumns', () => {
  it('includes every field whose declaration holds, in declaration order', () => {
    const fields = {
      title: { type: 'text' },
      secret: { type: 'password', ui: { listView: { defaultColumn: false } } },
      status: { type: 'select' },
    }

    expect(computeDefaultColumns(fields)).toEqual(['title', 'status'])
  })

  it('does not exclude a field merely named password or createdAt with no declaration', () => {
    const fields = {
      password: { type: 'text' },
      createdAt: { type: 'text' },
    }

    expect(computeDefaultColumns(fields)).toEqual(['password', 'createdAt'])
  })
})

describe('withStructuralTimestampDefaults', () => {
  it('leaves fields untouched when timestamps are not enabled for the list', () => {
    const fields = { createdAt: { type: 'timestamp' }, title: { type: 'text' } }
    const result = withStructuralTimestampDefaults(
      fields,
      { db: undefined },
      { provider: 'sqlite' },
    )

    expect(result).toBe(fields)
    expect(computeDefaultColumns(result)).toEqual(['createdAt', 'title'])
  })

  it('excludes createdAt/updatedAt when the list resolves timestamps enabled', () => {
    const fields = {
      createdAt: { type: 'timestamp' },
      updatedAt: { type: 'timestamp' },
      title: { type: 'text' },
    }
    const result = withStructuralTimestampDefaults(
      fields,
      { db: undefined },
      { provider: 'sqlite', timestamps: true },
    )

    expect(computeDefaultColumns(result)).toEqual(['title'])
    // Original map is not mutated.
    expect(fields.createdAt.ui).toBeUndefined()
  })

  it('honours a per-list db.timestamps override', () => {
    const fields = { createdAt: { type: 'timestamp' }, title: { type: 'text' } }
    const result = withStructuralTimestampDefaults(
      fields,
      { db: { timestamps: true } },
      { provider: 'sqlite' },
    )

    expect(computeDefaultColumns(result)).toEqual(['title'])
  })

  it("does not exclude a field literally named createdAt when the list's timestamps are off", () => {
    // An application field that just happens to be named createdAt/updatedAt,
    // unrelated to the list's own auto-timestamp column.
    const fields = { createdAt: { type: 'text' }, title: { type: 'text' } }
    const result = withStructuralTimestampDefaults(fields, { db: undefined }, undefined)

    expect(computeDefaultColumns(result)).toEqual(['createdAt', 'title'])
  })

  it("respects the field's own explicit declaration over the structural default", () => {
    const fields = {
      createdAt: { type: 'timestamp', ui: { listView: { defaultColumn: true } } },
      title: { type: 'text' },
    }
    const result = withStructuralTimestampDefaults(
      fields,
      { db: undefined },
      { provider: 'sqlite', timestamps: true },
    )

    expect(computeDefaultColumns(result)).toEqual(['createdAt', 'title'])
  })
})
