import { describe, it, expect } from 'vitest'
import {
  computeDefaultColumns,
  isDefaultColumnField,
  withStructuralTimestampDefaults,
  type DefaultColumnFieldLike,
} from '../../src/lib/defaultColumns.js'

/**
 * A bare `{ type: 'text' }` literal has no property in common with
 * `DefaultColumnFieldLike` (every one of its members is optional), which
 * TypeScript's weak-type check refuses outright. Adding a required `type`
 * gives every literal below a genuine overlapping property.
 */
type Field = DefaultColumnFieldLike & { type: string }

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
    const fields: Record<string, Field> = {
      title: { type: 'text' },
      secret: { type: 'password', ui: { listView: { defaultColumn: false } } },
      status: { type: 'select' },
    }

    expect(computeDefaultColumns(fields)).toEqual(['title', 'status'])
  })

  it('does not exclude a field merely named password or createdAt with no declaration', () => {
    const fields: Record<string, Field> = {
      password: { type: 'text' },
      createdAt: { type: 'text' },
    }

    expect(computeDefaultColumns(fields)).toEqual(['password', 'createdAt'])
  })
})

describe('withStructuralTimestampDefaults', () => {
  it('leaves fields untouched when timestamps are not enabled for the list', () => {
    const fields: Record<string, Field> = {
      createdAt: { type: 'timestamp' },
      title: { type: 'text' },
    }
    const result = withStructuralTimestampDefaults(
      fields,
      { db: undefined },
      { provider: 'postgresql' },
    )

    expect(result).toBe(fields)
    expect(computeDefaultColumns(result)).toEqual(['createdAt', 'title'])
  })

  it('excludes createdAt/updatedAt when the list resolves timestamps enabled', () => {
    const fields: Record<string, Field> = {
      createdAt: { type: 'timestamp' },
      updatedAt: { type: 'timestamp' },
      title: { type: 'text' },
    }
    const result = withStructuralTimestampDefaults(
      fields,
      { db: undefined },
      { provider: 'postgresql', timestamps: true },
    )

    expect(computeDefaultColumns(result)).toEqual(['title'])
    // Original map is not mutated.
    expect(fields.createdAt.ui).toBeUndefined()
  })

  it('honours a per-list db.timestamps override', () => {
    const fields: Record<string, Field> = {
      createdAt: { type: 'timestamp' },
      title: { type: 'text' },
    }
    const result = withStructuralTimestampDefaults(
      fields,
      { db: { timestamps: true } },
      { provider: 'postgresql' },
    )

    expect(computeDefaultColumns(result)).toEqual(['title'])
  })

  it("does not exclude a field literally named createdAt when the list's timestamps are off", () => {
    // An application field that just happens to be named createdAt/updatedAt,
    // unrelated to the list's own auto-timestamp column.
    const fields: Record<string, Field> = { createdAt: { type: 'text' }, title: { type: 'text' } }
    const result = withStructuralTimestampDefaults(fields, { db: undefined }, undefined)

    expect(computeDefaultColumns(result)).toEqual(['createdAt', 'title'])
  })

  it("respects the field's own explicit declaration over the structural default", () => {
    const fields: Record<string, Field> = {
      createdAt: { type: 'timestamp', ui: { listView: { defaultColumn: true } } },
      title: { type: 'text' },
    }
    const result = withStructuralTimestampDefaults(
      fields,
      { db: undefined },
      { provider: 'postgresql', timestamps: true },
    )

    expect(computeDefaultColumns(result)).toEqual(['createdAt', 'title'])
  })
})
