import { describe, test, expect } from 'vitest'
import {
  text,
  integer,
  bigInt,
  checkbox,
  timestamp,
  password,
  select,
  relationship,
  json,
} from './index.js'
import type { ContractColumnDescriptor, FieldConfig, OpenSaasConfig } from '../config/types.js'

const config: OpenSaasConfig = { db: { provider: 'postgresql' }, lists: {} }

/** The single column a stored scalar contributes to the contract. */
function columnOf(
  field: FieldConfig,
  fieldName: string,
  listKey = 'Post',
): ContractColumnDescriptor {
  const descriptor = field.getContractField?.(fieldName, listKey, config)
  if (descriptor?.kind !== 'column') {
    throw new Error(`the field "${fieldName}" did not describe a single column`)
  }
  const { kind: _kind, ...column } = descriptor
  return column
}

function schemaOf(field: FieldConfig, fieldName: string, operation: 'create' | 'update') {
  if (!field.getZodSchema) {
    throw new Error(`the field "${fieldName}" did not describe a Zod schema`)
  }
  return field.getZodSchema(fieldName, operation)
}

describe('Field Types', () => {
  describe('text field', () => {
    describe('getZodSchema', () => {
      test('returns optional string schema for non-required field', () => {
        const field = text()
        const schema = schemaOf(field, 'title', 'create')

        expect(schema.safeParse('test').success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(true)
        expect(schema.safeParse(123).success).toBe(false)
      })

      test('returns required string schema for required field in create mode', () => {
        const field = text({ validation: { isRequired: true } })
        const schema = schemaOf(field, 'title', 'create')

        expect(schema.safeParse('test').success).toBe(true)
        expect(schema.safeParse('').success).toBe(false)
        expect(schema.safeParse(undefined).success).toBe(false)
      })

      test('returns optional schema for required field in update mode', () => {
        const field = text({ validation: { isRequired: true } })
        const schema = schemaOf(field, 'title', 'update')

        expect(schema.safeParse('test').success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(true)
        expect(schema.safeParse('').success).toBe(false)
      })

      test('validates min length', () => {
        const field = text({ validation: { length: { min: 5 } } })
        const schema = schemaOf(field, 'title', 'create')

        expect(schema.safeParse('test').success).toBe(false)
        expect(schema.safeParse('testing').success).toBe(true)
      })

      test('validates max length', () => {
        const field = text({ validation: { length: { max: 10 } } })
        const schema = schemaOf(field, 'title', 'create')

        expect(schema.safeParse('short').success).toBe(true)
        expect(schema.safeParse('this is way too long').success).toBe(false)
      })

      test('validates min and max length together', () => {
        const field = text({ validation: { length: { min: 3, max: 10 } } })
        const schema = schemaOf(field, 'title', 'create')

        expect(schema.safeParse('ab').success).toBe(false)
        expect(schema.safeParse('abc').success).toBe(true)
        expect(schema.safeParse('abcdefghij').success).toBe(true)
        expect(schema.safeParse('abcdefghijk').success).toBe(false)
      })

      test('includes formatted field name in error messages', () => {
        const field = text({ validation: { isRequired: true } })
        const schema = schemaOf(field, 'firstName', 'create')
        const result = schema.safeParse('')

        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues[0].message).toContain('First Name')
        }
      })
    })

    describe('the contract column', () => {
      test('a plain text field is a nullable pg text column', () => {
        expect(columnOf(text(), 'title')).toEqual({
          name: 'title',
          type: { pack: 'pg', type: 'text' },
          nullable: true,
        })
      })

      test('validation.isRequired makes the column non-nullable', () => {
        expect(columnOf(text({ validation: { isRequired: true } }), 'title').nullable).toBe(false)
      })

      test("isIndexed: 'unique' marks the column unique, not indexed", () => {
        const column = columnOf(text({ isIndexed: 'unique' }), 'email')
        expect(column.unique).toBe(true)
        expect(column.index).toBeUndefined()
      })

      test('isIndexed: true asks for a non-unique index', () => {
        const column = columnOf(text({ isIndexed: true }), 'slug')
        expect(column.index).toBe(true)
        expect(column.unique).toBeUndefined()
      })

      test('db.isNullable: true makes an optional field explicitly nullable', () => {
        expect(columnOf(text({ db: { isNullable: true } }), 'description').nullable).toBe(true)
      })

      test('db.isNullable: false makes the column non-nullable regardless of validation', () => {
        expect(columnOf(text({ db: { isNullable: false } }), 'phoneNumber').nullable).toBe(false)
      })

      test('db.isNullable: false on a required field keeps it non-nullable', () => {
        const field = text({ validation: { isRequired: true }, db: { isNullable: false } })
        expect(columnOf(field, 'title').nullable).toBe(false)
      })

      test('db.isNullable: true on a required field overrides to nullable', () => {
        const field = text({ validation: { isRequired: true }, db: { isNullable: true } })
        expect(columnOf(field, 'title').nullable).toBe(true)
      })

      test('db.nativeType reaches the column', () => {
        expect(columnOf(text({ db: { nativeType: 'Text' } }), 'medical').nativeType).toBe('Text')
      })

      test('db.nativeType and nullability are independent', () => {
        expect(
          columnOf(text({ db: { isNullable: true, nativeType: 'Text' } }), 'bio'),
        ).toMatchObject({ nullable: true, nativeType: 'Text' })
        expect(
          columnOf(text({ db: { isNullable: false, nativeType: 'Text' } }), 'content'),
        ).toMatchObject({ nullable: false, nativeType: 'Text' })
      })
    })

    describe('the TypeScript face', () => {
      test('declares no override — the text codec types it', () => {
        expect(text().outputType).toBeUndefined()
        expect(text().inputType).toBeUndefined()
      })
    })
  })

  describe('integer field', () => {
    describe('getZodSchema', () => {
      test('returns optional number schema for non-required field', () => {
        const field = integer()
        const schema = schemaOf(field, 'age', 'create')

        expect(schema.safeParse(25).success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(true)
        expect(schema.safeParse('25').success).toBe(false)
      })

      test('returns required number schema for required field in create mode', () => {
        const field = integer({ validation: { isRequired: true } })
        const schema = schemaOf(field, 'age', 'create')

        expect(schema.safeParse(25).success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(false)
      })

      test('returns optional schema for required field in update mode', () => {
        const field = integer({ validation: { isRequired: true } })
        const schema = schemaOf(field, 'age', 'update')

        expect(schema.safeParse(25).success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(true)
      })

      test('validates min value', () => {
        const field = integer({ validation: { min: 0 } })
        const schema = schemaOf(field, 'age', 'create')

        expect(schema.safeParse(-1).success).toBe(false)
        expect(schema.safeParse(0).success).toBe(true)
        expect(schema.safeParse(1).success).toBe(true)
      })

      test('validates max value', () => {
        const field = integer({ validation: { max: 100 } })
        const schema = schemaOf(field, 'age', 'create')

        expect(schema.safeParse(99).success).toBe(true)
        expect(schema.safeParse(100).success).toBe(true)
        expect(schema.safeParse(101).success).toBe(false)
      })

      test('validates min and max together', () => {
        const field = integer({ validation: { min: 18, max: 65 } })
        const schema = schemaOf(field, 'age', 'create')

        expect(schema.safeParse(17).success).toBe(false)
        expect(schema.safeParse(18).success).toBe(true)
        expect(schema.safeParse(65).success).toBe(true)
        expect(schema.safeParse(66).success).toBe(false)
      })
    })

    describe('the contract column', () => {
      test('a plain integer field is a nullable pg int column', () => {
        expect(columnOf(integer(), 'age')).toEqual({
          name: 'age',
          type: { pack: 'pg', type: 'int' },
          nullable: true,
        })
      })

      test('validation.isRequired makes the column non-nullable', () => {
        expect(columnOf(integer({ validation: { isRequired: true } }), 'age').nullable).toBe(false)
      })

      test('db.isNullable: false makes the column non-nullable regardless of validation', () => {
        expect(columnOf(integer({ db: { isNullable: false } }), 'count').nullable).toBe(false)
      })

      test('db.isNullable: true on a required field overrides to nullable', () => {
        const field = integer({ validation: { isRequired: true }, db: { isNullable: true } })
        expect(columnOf(field, 'count').nullable).toBe(true)
      })

      test('db.nativeType reaches the column', () => {
        expect(columnOf(integer({ db: { nativeType: 'SmallInt' } }), 'score').nativeType).toBe(
          'SmallInt',
        )
      })

      test('isIndexed: true asks for a non-unique index', () => {
        expect(columnOf(integer({ isIndexed: true }), 'rank').index).toBe(true)
      })

      test("isIndexed: 'unique' marks the column unique, not indexed", () => {
        const column = columnOf(integer({ isIndexed: 'unique' }), 'rank')
        expect(column.unique).toBe(true)
        expect(column.index).toBeUndefined()
      })

      test('no isIndexed asks for neither', () => {
        const column = columnOf(integer(), 'rank')
        expect(column.unique).toBeUndefined()
        expect(column.index).toBeUndefined()
      })
    })

    describe('the TypeScript face', () => {
      test('declares no override — the int codec types it', () => {
        expect(integer().outputType).toBeUndefined()
        expect(integer().inputType).toBeUndefined()
      })
    })
  })

  describe('bigInt field', () => {
    describe('getZodSchema', () => {
      test('returns optional bigint schema for non-required field', () => {
        const field = bigInt()
        const schema = schemaOf(field, 'epoch', 'create')

        expect(schema.safeParse(25n).success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(true)
      })

      test('returns required schema for required field in create mode', () => {
        const field = bigInt({ validation: { isRequired: true } })
        const schema = schemaOf(field, 'epoch', 'create')

        expect(schema.safeParse(25n).success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(false)
      })

      test('returns optional schema for required field in update mode', () => {
        const field = bigInt({ validation: { isRequired: true } })
        const schema = schemaOf(field, 'epoch', 'update')

        expect(schema.safeParse(25n).success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(true)
      })

      test('coerces a bigint input to a bigint output unchanged', () => {
        const field = bigInt()
        const schema = schemaOf(field, 'epoch', 'create')

        const result = schema.safeParse(9007199254740993n)
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data).toBe(9007199254740993n)
          expect(typeof result.data).toBe('bigint')
        }
      })

      test('coerces a safe-integer number input to a bigint output', () => {
        const field = bigInt()
        const schema = schemaOf(field, 'epoch', 'create')

        const result = schema.safeParse(1700000000000)
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data).toBe(1700000000000n)
          expect(typeof result.data).toBe('bigint')
        }
      })

      test('coerces a numeric string input to a bigint output, round-tripping beyond Number.MAX_SAFE_INTEGER', () => {
        const field = bigInt()
        const schema = schemaOf(field, 'epoch', 'create')

        const result = schema.safeParse('9223372036854775807')
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data).toBe(9223372036854775807n)
        }
      })

      test('accepts a negative numeric string', () => {
        const field = bigInt()
        const schema = schemaOf(field, 'delta', 'create')

        const result = schema.safeParse('-42')
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data).toBe(-42n)
        }
      })

      test('rejects a non-integer number', () => {
        const field = bigInt()
        const schema = schemaOf(field, 'epoch', 'create')

        expect(schema.safeParse(1.5).success).toBe(false)
      })

      test('rejects a number above Number.MAX_SAFE_INTEGER instead of silently losing precision', () => {
        const field = bigInt()
        const schema = schemaOf(field, 'epoch', 'create')

        expect(schema.safeParse(Number.MAX_SAFE_INTEGER + 10).success).toBe(false)
      })

      test('rejects a non-numeric string', () => {
        const field = bigInt()
        const schema = schemaOf(field, 'epoch', 'create')

        expect(schema.safeParse('not-a-number').success).toBe(false)
      })

      test('rejects a decimal string', () => {
        const field = bigInt()
        const schema = schemaOf(field, 'epoch', 'create')

        expect(schema.safeParse('1.5').success).toBe(false)
      })

      test('validates min value', () => {
        const field = bigInt({ validation: { min: 0n } })
        const schema = schemaOf(field, 'epoch', 'create')

        expect(schema.safeParse(-1n).success).toBe(false)
        expect(schema.safeParse(0n).success).toBe(true)
        expect(schema.safeParse(1n).success).toBe(true)
      })

      test('validates max value', () => {
        const field = bigInt({ validation: { max: 100n } })
        const schema = schemaOf(field, 'epoch', 'create')

        expect(schema.safeParse(99n).success).toBe(true)
        expect(schema.safeParse(100n).success).toBe(true)
        expect(schema.safeParse(101n).success).toBe(false)
      })

      test('validates min and max together', () => {
        const field = bigInt({ validation: { min: 18n, max: 65n } })
        const schema = schemaOf(field, 'age', 'create')

        expect(schema.safeParse(17n).success).toBe(false)
        expect(schema.safeParse(18n).success).toBe(true)
        expect(schema.safeParse(65n).success).toBe(true)
        expect(schema.safeParse(66n).success).toBe(false)
      })
    })

    describe('the contract column', () => {
      test('a plain bigInt field is a nullable pg bigint column', () => {
        expect(columnOf(bigInt(), 'epoch')).toEqual({
          name: 'epoch',
          type: { pack: 'pg', type: 'bigint' },
          nullable: true,
        })
      })

      test('validation.isRequired makes the column non-nullable', () => {
        expect(columnOf(bigInt({ validation: { isRequired: true } }), 'epoch').nullable).toBe(false)
      })

      test('db.isNullable: false makes the column non-nullable regardless of validation', () => {
        expect(columnOf(bigInt({ db: { isNullable: false } }), 'epoch').nullable).toBe(false)
      })

      test('db.map reaches the column', () => {
        expect(columnOf(bigInt({ db: { map: 'occurred_at_ms' } }), 'epoch').map).toBe(
          'occurred_at_ms',
        )
      })

      test('a bigint default carries as its decimal string', () => {
        expect(columnOf(bigInt({ defaultValue: 0n }), 'epoch').default).toEqual({
          kind: 'literal',
          value: '0',
        })
      })

      test('isIndexed: true asks for a non-unique index', () => {
        expect(columnOf(bigInt({ isIndexed: true }), 'epoch').index).toBe(true)
      })

      test("isIndexed: 'unique' marks the column unique", () => {
        expect(columnOf(bigInt({ isIndexed: 'unique' }), 'epoch').unique).toBe(true)
      })
    })

    describe('the TypeScript face', () => {
      test('declares no override — the bigint codec types it', () => {
        expect(bigInt().outputType).toBeUndefined()
        expect(bigInt().inputType).toBeUndefined()
      })
    })

    describe('getFilterSpec', () => {
      test('parses a valid integer token into a BigInt condition', () => {
        const field = bigInt()
        const spec = field.getFilterSpec?.('epoch', 'Event', {} as never)

        expect(spec?.toCondition('eq', '9007199254740993')).toEqual({
          epoch: { equals: 9007199254740993n },
        })
        expect(spec?.toCondition('gt', '5')).toEqual({ epoch: { gt: 5n } })
      })

      test('degrades to free text (null) for a non-integer token', () => {
        const field = bigInt()
        const spec = field.getFilterSpec?.('epoch', 'Event', {} as never)

        expect(spec?.toCondition('eq', '1.5')).toBeNull()
        expect(spec?.toCondition('eq', 'not-a-number')).toBeNull()
      })
    })
  })

  describe('checkbox field', () => {
    describe('getZodSchema', () => {
      test('returns optional boolean schema', () => {
        const field = checkbox()
        const schema = schemaOf(field, 'isActive', 'create')

        expect(schema.safeParse(true).success).toBe(true)
        expect(schema.safeParse(false).success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(true)
        expect(schema.safeParse('true').success).toBe(false)
      })
    })

    describe('the contract column', () => {
      test('a plain checkbox is a non-nullable pg boolean column', () => {
        expect(columnOf(checkbox(), 'isActive')).toEqual({
          name: 'isActive',
          type: { pack: 'pg', type: 'boolean' },
          nullable: false,
        })
      })

      test('carries a true default', () => {
        expect(columnOf(checkbox({ defaultValue: true }), 'isActive').default).toEqual({
          kind: 'literal',
          value: true,
        })
      })

      test('carries a false default — not treated as absent', () => {
        expect(columnOf(checkbox({ defaultValue: false }), 'isActive').default).toEqual({
          kind: 'literal',
          value: false,
        })
      })

      test('db.isNullable: true makes the column nullable', () => {
        expect(columnOf(checkbox({ db: { isNullable: true } }), 'agreed').nullable).toBe(true)
      })

      test('db.isNullable: true keeps a default alongside it', () => {
        const field = checkbox({ defaultValue: false, db: { isNullable: true } })
        expect(columnOf(field, 'agreed')).toMatchObject({
          nullable: true,
          default: { kind: 'literal', value: false },
        })
      })
    })

    describe('the TypeScript face', () => {
      test('declares no override — the boolean codec types it', () => {
        expect(checkbox().outputType).toBeUndefined()
        expect(checkbox().inputType).toBeUndefined()
      })
    })
  })

  describe('timestamp field', () => {
    describe('getZodSchema', () => {
      test('accepts Date objects and ISO datetime strings', () => {
        const field = timestamp()
        const schema = schemaOf(field, 'createdAt', 'create')

        expect(schema.safeParse(new Date()).success).toBe(true)
        expect(schema.safeParse('2024-01-01T00:00:00Z').success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(true)
        expect(schema.safeParse('invalid').success).toBe(false)
      })
    })

    describe('the contract column', () => {
      test('a plain timestamp is a nullable pg dateTime column', () => {
        expect(columnOf(timestamp(), 'createdAt')).toEqual({
          name: 'createdAt',
          type: { pack: 'pg', type: 'dateTime' },
          nullable: true,
        })
      })

      test('defaultValue { kind: now } is a now default on a non-nullable column', () => {
        const column = columnOf(timestamp({ defaultValue: { kind: 'now' } }), 'createdAt')
        expect(column.default).toEqual({ kind: 'now' })
        expect(column.nullable).toBe(false)
      })

      test('db.isNullable: false makes the column non-nullable without a default', () => {
        const column = columnOf(timestamp({ db: { isNullable: false } }), 'publishedAt')
        expect(column.nullable).toBe(false)
        expect(column.default).toBeUndefined()
      })

      test('db.isNullable: true overrides a now default back to nullable', () => {
        const field = timestamp({ defaultValue: { kind: 'now' }, db: { isNullable: true } })
        expect(columnOf(field, 'createdAt')).toMatchObject({
          nullable: true,
          default: { kind: 'now' },
        })
      })

      test('db.nativeType reaches the column', () => {
        expect(
          columnOf(timestamp({ db: { nativeType: 'Timestamptz' } }), 'scheduledAt').nativeType,
        ).toBe('Timestamptz')
      })

      test('isIndexed: true asks for a non-unique index', () => {
        expect(columnOf(timestamp({ isIndexed: true }), 'publishedAt').index).toBe(true)
      })

      test("isIndexed: 'unique' marks the column unique, not indexed", () => {
        const column = columnOf(timestamp({ isIndexed: 'unique' }), 'publishedAt')
        expect(column.unique).toBe(true)
        expect(column.index).toBeUndefined()
      })

      test('no isIndexed asks for neither', () => {
        const column = columnOf(timestamp(), 'publishedAt')
        expect(column.unique).toBeUndefined()
        expect(column.index).toBeUndefined()
      })
    })

    describe('the TypeScript face', () => {
      test('declares no override — the dateTime codec types it', () => {
        expect(timestamp().outputType).toBeUndefined()
        expect(timestamp().inputType).toBeUndefined()
      })
    })
  })

  describe('password field', () => {
    describe('getZodSchema', () => {
      test('returns required string schema for required field in create mode', () => {
        const field = password({ validation: { isRequired: true } })
        const schema = schemaOf(field, 'password', 'create')

        expect(schema.safeParse('secret123').success).toBe(true)
        expect(schema.safeParse('').success).toBe(false)
        expect(schema.safeParse(undefined).success).toBe(false)
      })

      test('returns optional schema for required field in update mode', () => {
        const field = password({ validation: { isRequired: true } })
        const schema = schemaOf(field, 'password', 'update')

        expect(schema.safeParse('newpassword').success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(true)
        expect(schema.safeParse('').success).toBe(false)
      })

      test('returns optional string schema for non-required field', () => {
        const field = password()
        const schema = schemaOf(field, 'password', 'create')

        expect(schema.safeParse('secret123').success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(true)
      })
    })

    describe('the contract column', () => {
      test('a plain password is a nullable pg text column', () => {
        expect(columnOf(password(), 'password')).toEqual({
          name: 'password',
          type: { pack: 'pg', type: 'text' },
          nullable: true,
        })
      })

      test('validation.isRequired makes the column non-nullable', () => {
        expect(columnOf(password({ validation: { isRequired: true } }), 'password').nullable).toBe(
          false,
        )
      })

      test('db.isNullable: false makes the column non-nullable regardless of validation', () => {
        expect(columnOf(password({ db: { isNullable: false } }), 'password').nullable).toBe(false)
      })

      test('db.isNullable: true on a required password overrides to nullable', () => {
        const field = password({ validation: { isRequired: true }, db: { isNullable: true } })
        expect(columnOf(field, 'password').nullable).toBe(true)
      })

      test('db.nativeType reaches the column', () => {
        expect(columnOf(password({ db: { nativeType: 'Text' } }), 'password').nativeType).toBe(
          'Text',
        )
      })
    })

    describe('hooks', () => {
      test('has resolveInput hook defined', () => {
        const field = password()

        expect(field.hooks).toBeDefined()
        expect(field.hooks?.resolveInput).toBeDefined()
        expect(typeof field.hooks?.resolveInput).toBe('function')
      })

      test('has resolveOutput hook defined', () => {
        const field = password()

        expect(field.hooks).toBeDefined()
        expect(field.hooks?.resolveOutput).toBeDefined()
        expect(typeof field.hooks?.resolveOutput).toBe('function')
      })
    })

    describe('the TypeScript face', () => {
      test('reads as HashedPassword over its text column', () => {
        expect(password().outputType).toBe("import('@opensaas/stack-core/internal').HashedPassword")
      })
    })

    describe('ui.listView.defaultColumn (issue #1018)', () => {
      test('is excluded from default admin table columns by default', () => {
        const field = password()

        expect(field.ui?.listView?.defaultColumn).toBe(false)
      })

      test('can be opted back into default columns explicitly', () => {
        const field = password({ ui: { listView: { defaultColumn: true } } })

        expect(field.ui?.listView?.defaultColumn).toBe(true)
      })

      test('preserves other caller-supplied ui options', () => {
        const field = password({ ui: { description: 'Account password' } })

        expect(field.ui?.description).toBe('Account password')
        expect(field.ui?.listView?.defaultColumn).toBe(false)
      })
    })
  })

  describe('select field', () => {
    describe('constructor', () => {
      test('throws error when no options provided', () => {
        expect(() => {
          // @ts-expect-error - Testing invalid input
          select()
        }).toThrow('option')
      })

      test('throws error when empty options array provided', () => {
        expect(() => {
          select({ options: [] })
        }).toThrow('Select field must have at least one option')
      })

      test('accepts valid options', () => {
        const field = select({
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
        })

        expect(field.options).toHaveLength(2)
      })
    })

    describe('getZodSchema', () => {
      test('validates against enum values', () => {
        const field = select({
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
        })
        const schema = schemaOf(field, 'status', 'create')

        expect(schema.safeParse('draft').success).toBe(true)
        expect(schema.safeParse('published').success).toBe(true)
        expect(schema.safeParse('invalid').success).toBe(false)
        expect(schema.safeParse(undefined).success).toBe(true)
      })

      test('requires value when isRequired in create mode', () => {
        const field = select({
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
          validation: { isRequired: true },
        })
        const schema = schemaOf(field, 'status', 'create')

        expect(schema.safeParse('draft').success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(false)
      })

      test('allows undefined in update mode even when required', () => {
        const field = select({
          options: [{ label: 'Draft', value: 'draft' }],
          validation: { isRequired: true },
        })
        const schema = schemaOf(field, 'status', 'update')

        expect(schema.safeParse('draft').success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(true)
      })
    })

    describe('the contract column', () => {
      test('a plain select is a nullable pg text column', () => {
        const field = select({ options: [{ label: 'Option', value: 'option' }] })
        expect(columnOf(field, 'status')).toEqual({
          name: 'status',
          type: { pack: 'pg', type: 'text' },
          nullable: true,
        })
      })

      test('a defaultValue carries as a literal and makes the column non-nullable', () => {
        const field = select({
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
          defaultValue: 'draft',
        })
        expect(columnOf(field, 'status')).toMatchObject({
          nullable: false,
          default: { kind: 'literal', value: 'draft' },
        })
      })

      test('isIndexed: true asks for a non-unique index on the text column', () => {
        const field = select({ options: [{ label: 'Draft', value: 'draft' }], isIndexed: true })
        const column = columnOf(field, 'status')
        expect(column.type).toEqual({ pack: 'pg', type: 'text' })
        expect(column.index).toBe(true)
      })

      test("isIndexed: 'unique' marks the text column unique, not indexed", () => {
        const field = select({ options: [{ label: 'Draft', value: 'draft' }], isIndexed: 'unique' })
        const column = columnOf(field, 'status')
        expect(column.unique).toBe(true)
        expect(column.index).toBeUndefined()
      })

      test('isIndexed: true asks for a non-unique index on a native-enum column', () => {
        const field = select({
          options: [{ label: 'Draft', value: 'draft' }],
          db: { type: 'enum' },
          isIndexed: true,
        })
        const column = columnOf(field, 'status')
        expect(column.enum?.name).toBe('PostStatus')
        expect(column.index).toBe(true)
      })

      test("isIndexed: 'unique' marks a native-enum column unique, not indexed", () => {
        const field = select({
          options: [{ label: 'Draft', value: 'draft' }],
          db: { type: 'enum' },
          isIndexed: 'unique',
        })
        const column = columnOf(field, 'status')
        expect(column.unique).toBe(true)
        expect(column.index).toBeUndefined()
      })
    })

    describe('the TypeScript face', () => {
      test('is the union of the option values, on both sides', () => {
        const field = select({
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
        })
        expect(field.outputType).toBe("'draft' | 'published'")
        expect(field.inputType).toBe("'draft' | 'published'")
      })

      test('does not change with isRequired — nullability lives on the column', () => {
        const field = select({
          options: [{ label: 'Draft', value: 'draft' }],
          validation: { isRequired: true },
        })
        expect(field.outputType).toBe("'draft'")
        expect(columnOf(field, 'status').nullable).toBe(false)
      })

      test('does not change with a defaultValue', () => {
        const field = select({
          options: [{ label: 'Draft', value: 'draft' }],
          defaultValue: 'draft',
        })
        expect(field.outputType).toBe("'draft'")
      })
    })
  })

  describe('relationship field', () => {
    describe('constructor', () => {
      test('throws error when no ref provided', () => {
        expect(() => {
          // @ts-expect-error - Testing invalid input
          relationship()
        }).toThrow('ref')
      })

      test('throws error when ref format has too many parts', () => {
        expect(() => {
          relationship({ ref: 'Invalid.Format.TooManyParts' })
        }).toThrow('Invalid relationship ref format')
      })

      test('accepts valid bidirectional ref format (ListName.fieldName)', () => {
        const field = relationship({ ref: 'User.posts' })

        expect(field.ref).toBe('User.posts')
      })

      test('accepts valid list-only ref format (ListName)', () => {
        const field = relationship({ ref: 'Category' })

        expect(field.ref).toBe('Category')
      })

      test('accepts list-only ref with many option', () => {
        const field = relationship({ ref: 'Tag', many: true })

        expect(field.ref).toBe('Tag')
        expect(field.many).toBe(true)
      })

      test('accepts bidirectional ref with many option', () => {
        const field = relationship({ ref: 'Post.author', many: true })

        expect(field.ref).toBe('Post.author')
        expect(field.many).toBe(true)
      })

      test('accepts db.isNullable on a single relationship', () => {
        const field = relationship({ ref: 'User.posts', db: { isNullable: false } })

        expect(field.db?.isNullable).toBe(false)
      })

      test('throws error when db.isNullable is used with many: true', () => {
        expect(() => {
          relationship({ ref: 'Post.author', many: true, db: { isNullable: false } })
        }).toThrow('db.isNullable can only be used on single relationships')
      })
    })
  })

  describe('json field', () => {
    describe('getZodSchema', () => {
      test('accepts any value for non-required field', () => {
        const field = json()
        const schema = schemaOf(field, 'metadata', 'create')

        expect(schema.safeParse({ key: 'value' }).success).toBe(true)
        expect(schema.safeParse([1, 2, 3]).success).toBe(true)
        expect(schema.safeParse('string').success).toBe(true)
        expect(schema.safeParse(123).success).toBe(true)
        expect(schema.safeParse(null).success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(true)
      })

      test('accepts value for required field in create mode', () => {
        const field = json({ validation: { isRequired: true } })
        const schema = schemaOf(field, 'metadata', 'create')

        // Any present non-null JSON value is accepted, including falsy values
        expect(schema.safeParse({ key: 'value' }).success).toBe(true)
        expect(schema.safeParse([1, 2, 3]).success).toBe(true)
        expect(schema.safeParse(0).success).toBe(true)
        expect(schema.safeParse('').success).toBe(true)
        expect(schema.safeParse(false).success).toBe(true)
        // A required json field must reject undefined on create (issue #597)
        expect(schema.safeParse(undefined).success).toBe(false)
        // A required json field means non-null: reject a present null (issue #604)
        expect(schema.safeParse(null).success).toBe(false)
      })

      test('allows undefined but rejects null for required field in update mode', () => {
        const field = json({ validation: { isRequired: true } })
        const schema = schemaOf(field, 'metadata', 'update')

        expect(schema.safeParse({ key: 'value' }).success).toBe(true)
        // Omitted/undefined still passes on update (issue #570)
        expect(schema.safeParse(undefined).success).toBe(true)
        // Present non-null falsy values pass
        expect(schema.safeParse(0).success).toBe(true)
        expect(schema.safeParse('').success).toBe(true)
        expect(schema.safeParse(false).success).toBe(true)
        // A present null is rejected — required json means non-null (issue #604)
        expect(schema.safeParse(null).success).toBe(false)
      })
    })

    describe('the contract column', () => {
      test('a plain json field is a nullable pg jsonb column', () => {
        expect(columnOf(json(), 'metadata')).toEqual({
          name: 'metadata',
          type: { pack: 'pg', type: 'jsonb' },
          nullable: true,
        })
      })

      test('validation.isRequired makes the column non-nullable', () => {
        expect(columnOf(json({ validation: { isRequired: true } }), 'metadata').nullable).toBe(
          false,
        )
      })

      test('db.isNullable: false makes the column non-nullable regardless of validation', () => {
        expect(columnOf(json({ db: { isNullable: false } }), 'settings').nullable).toBe(false)
      })

      test('db.isNullable: true on a required field overrides to nullable', () => {
        const field = json({ validation: { isRequired: true }, db: { isNullable: true } })
        expect(columnOf(field, 'settings').nullable).toBe(true)
      })
    })

    describe('the TypeScript face', () => {
      test('declares no override — the jsonb codec types it', () => {
        expect(json().outputType).toBeUndefined()
        expect(json().inputType).toBeUndefined()
      })
    })
  })

  describe('field name formatting', () => {
    test('formats camelCase to human-readable', () => {
      const field = text({ validation: { isRequired: true } })
      const schema = schemaOf(field, 'firstName', 'create')
      const result = schema.safeParse('')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('First Name')
      }
    })

    test('formats single word field names', () => {
      const field = text({ validation: { isRequired: true } })
      const schema = schemaOf(field, 'email', 'create')
      const result = schema.safeParse('')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Email')
      }
    })
  })

  describe('edge cases', () => {
    test('text field with only min length set', () => {
      const field = text({ validation: { length: { min: 5 } } })
      const schema = schemaOf(field, 'field', 'create')

      expect(schema.safeParse('1234').success).toBe(false)
      expect(schema.safeParse('12345').success).toBe(true)
      expect(schema.safeParse('a'.repeat(1000)).success).toBe(true)
    })

    test('text field with only max length set', () => {
      const field = text({ validation: { length: { max: 10 } } })
      const schema = schemaOf(field, 'field', 'create')

      expect(schema.safeParse('').success).toBe(true)
      expect(schema.safeParse('short').success).toBe(true)
      expect(schema.safeParse('way too long text').success).toBe(false)
    })

    test('integer field with zero as min value', () => {
      const field = integer({ validation: { min: 0 } })
      const schema = schemaOf(field, 'count', 'create')

      expect(schema.safeParse(-1).success).toBe(false)
      expect(schema.safeParse(0).success).toBe(true)
    })

    test('integer field with negative min and max', () => {
      const field = integer({ validation: { min: -100, max: -10 } })
      const schema = schemaOf(field, 'temperature', 'create')

      expect(schema.safeParse(-101).success).toBe(false)
      expect(schema.safeParse(-50).success).toBe(true)
      expect(schema.safeParse(-9).success).toBe(false)
    })

    test('select field with single option', () => {
      const field = select({
        options: [{ label: 'Only Option', value: 'only' }],
      })
      const schema = schemaOf(field, 'choice', 'create')

      expect(schema.safeParse('only').success).toBe(true)
      expect(schema.safeParse('other').success).toBe(false)
    })

    test('relationship field with complex ref', () => {
      const field = relationship({ ref: 'BlogPost.author' })

      expect(field.ref).toBe('BlogPost.author')
      expect(field.type).toBe('relationship')
    })
  })
})
