import { describe, it, expect } from 'vitest'
import { text, integer } from './index.js'
import type { ContractColumnDescriptor, FieldConfig, OpenSaasConfig } from '../config/types.js'

/**
 * Unit coverage for Keystone-compat mode on text() (issue #475).
 *
 * Keystone 6 gives every non-null text column an implicit empty-string default.
 * `db.keystoneCompat` mirrors that: a non-null `text()` column with no explicit
 * `defaultValue` carries `''` on its contract column, so a migrating project
 * reaches schema parity without hand-setting it on dozens of columns.
 *
 * A column default also drops the column from the required half of the
 * generated create input, so the compat default is carried only where this
 * field's own create validator accepts the omission it fills.
 * `types-keystone-compat.test.ts` in `@opensaas/stack-cli` pins that input
 * face against a real emitted contract; these tests pin the column, plus the
 * on/off/explicit-default/nullable/non-text matrix from the issue's
 * acceptance criteria.
 */
const ON: OpenSaasConfig = { db: { provider: 'postgresql', keystoneCompat: true }, lists: {} }
const OFF: OpenSaasConfig = { db: { provider: 'postgresql' }, lists: {} }
const EXPLICIT_OFF: OpenSaasConfig = {
  db: { provider: 'postgresql', keystoneCompat: false },
  lists: {},
}

function columnOf(
  field: FieldConfig,
  fieldName: string,
  config: OpenSaasConfig,
): ContractColumnDescriptor {
  const descriptor = field.getContractField?.(fieldName, 'User', config)
  if (descriptor?.kind !== 'column') {
    throw new Error(`the field "${fieldName}" did not describe a single column`)
  }
  const { kind: _kind, ...column } = descriptor
  return column
}

describe('text() Keystone-compat empty-string default', () => {
  describe('with keystoneCompat ON', () => {
    it('gives a validation.isRequired text field no default, which its own validator rejects', () => {
      const column = columnOf(text({ validation: { isRequired: true } }), 'name', ON)

      expect(column.type).toEqual({ pack: 'pg', type: 'text' })
      expect(column.nullable).toBe(false)
      expect(column.default).toBeUndefined()
    })

    /**
     * `length.min` constrains a value that is supplied; it says nothing about
     * an omission, which is the only thing a column default fills.
     */
    it('defaults a non-null text field with a minimum length, which its validator lets be omitted', () => {
      const field = text({ db: { isNullable: false }, validation: { length: { min: 2 } } })
      const column = columnOf(field, 'code', ON)

      expect(column.nullable).toBe(false)
      expect(column.default).toEqual({ kind: 'literal', value: '' })
    })

    /**
     * `text()` turns `length.min: 0` into `min(1)`, so asking the schema about
     * `''` would drop this column's default over a quirk of the builder rather
     * than anything the runtime does.
     */
    it('defaults a non-null text field declaring a zero minimum length', () => {
      const field = text({ db: { isNullable: false }, validation: { length: { min: 0 } } })

      expect(columnOf(field, 'slug', ON).default).toEqual({ kind: 'literal', value: '' })
    })

    it('defaults a text field made non-null via db.isNullable: false to ""', () => {
      // Non-null at the DB level even though validation does not mark it required.
      const column = columnOf(text({ db: { isNullable: false } }), 'phone', ON)

      expect(column.nullable).toBe(false)
      expect(column.default).toEqual({ kind: 'literal', value: '' })
    })

    it('gives a nullable text field no default', () => {
      // Optional → nullable; Keystone-compat must leave it alone.
      const column = columnOf(text(), 'bio', ON)

      expect(column.nullable).toBe(true)
      expect(column.default).toBeUndefined()
    })

    it('gives a text field made nullable via db.isNullable: true no default', () => {
      // Required validation, but explicitly nullable at the DB level.
      const field = text({ validation: { isRequired: true }, db: { isNullable: true } })
      const column = columnOf(field, 'note', ON)

      expect(column.nullable).toBe(true)
      expect(column.default).toBeUndefined()
    })

    it('lets an explicit defaultValue win over the compat empty-string default', () => {
      const field = text({ validation: { isRequired: true }, defaultValue: 'PLEASE_UPDATE' })

      expect(columnOf(field, 'status', ON).default).toEqual({
        kind: 'literal',
        value: 'PLEASE_UPDATE',
      })
    })

    it('honours an explicit empty-string defaultValue', () => {
      const field = text({ validation: { isRequired: true }, defaultValue: '' })

      expect(columnOf(field, 'label', ON).default).toEqual({ kind: 'literal', value: '' })
    })

    it('carries the default alongside the field’s other column facts', () => {
      const field = text({
        isIndexed: 'unique',
        db: { isNullable: false, nativeType: 'Text', map: 'full_name' },
      })

      expect(columnOf(field, 'fullName', ON)).toEqual({
        name: 'fullName',
        type: { pack: 'pg', type: 'text' },
        nullable: false,
        nativeType: 'Text',
        map: 'full_name',
        unique: true,
        default: { kind: 'literal', value: '' },
      })
    })
  })

  describe('with keystoneCompat OFF (default)', () => {
    it('gives a required text field no default when the flag is omitted', () => {
      const column = columnOf(text({ validation: { isRequired: true } }), 'name', OFF)

      expect(column.default).toBeUndefined()
    })

    it('gives a required text field no default when the flag is explicitly false', () => {
      const column = columnOf(text({ validation: { isRequired: true } }), 'name', EXPLICIT_OFF)

      expect(column.default).toBeUndefined()
    })

    it('still honours an explicit defaultValue when the flag is off', () => {
      const field = text({ validation: { isRequired: true }, defaultValue: 'PLEASE_UPDATE' })

      expect(columnOf(field, 'status', EXPLICIT_OFF).default).toEqual({
        kind: 'literal',
        value: 'PLEASE_UPDATE',
      })
    })
  })

  describe('the compat default and the create validator agree', () => {
    /**
     * Both columns are computed by hand: `acceptsOmission` is what this
     * field's own create schema does with an absent value — the only case a
     * column default is reached for — and `hasDefault` is whether the compat
     * branch may carry one. They must never disagree: a default under a
     * validator that refuses the omission is exactly the create-input/runtime
     * split this narrowing closes.
     */
    const shapes: {
      name: string
      field: FieldConfig
      acceptsOmission: boolean
      hasDefault: boolean
    }[] = [
      {
        name: 'name',
        field: text({ validation: { isRequired: true } }),
        acceptsOmission: false,
        hasDefault: false,
      },
      {
        name: 'phone',
        field: text({ db: { isNullable: false } }),
        acceptsOmission: true,
        hasDefault: true,
      },
      {
        name: 'code',
        field: text({ db: { isNullable: false }, validation: { length: { min: 2 } } }),
        acceptsOmission: true,
        hasDefault: true,
      },
      {
        name: 'title',
        field: text({ db: { isNullable: false }, validation: { length: { max: 10 } } }),
        acceptsOmission: true,
        hasDefault: true,
      },
      { name: 'bio', field: text(), acceptsOmission: true, hasDefault: false },
    ]

    it.each(shapes)('$name', ({ name, field, acceptsOmission, hasDefault }) => {
      expect(field.getZodSchema?.(name, 'create').safeParse(undefined).success).toBe(
        acceptsOmission,
      )
      expect(columnOf(field, name, ON).default !== undefined).toBe(hasDefault)
    })
  })

  describe('non-text fields are unaffected by the flag', () => {
    it('does not give a required integer field an empty-string default under keystoneCompat', () => {
      const column = columnOf(integer({ validation: { isRequired: true } }), 'count', ON)

      expect(column.type).toEqual({ pack: 'pg', type: 'int' })
      expect(column.default).toBeUndefined()
    })
  })
})
