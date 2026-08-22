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
} from '../src/fields/index.js'

describe('Field Types', () => {
  describe('text field', () => {
    describe('getZodSchema', () => {
      test('returns optional string schema for non-required field', () => {
        const field = text()
        const schema = field.getZodSchema('title', 'create')

        expect(schema.safeParse('test').success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(true)
        expect(schema.safeParse(123).success).toBe(false)
      })

      test('returns required string schema for required field in create mode', () => {
        const field = text({ validation: { isRequired: true } })
        const schema = field.getZodSchema('title', 'create')

        expect(schema.safeParse('test').success).toBe(true)
        expect(schema.safeParse('').success).toBe(false)
        expect(schema.safeParse(undefined).success).toBe(false)
      })

      test('returns optional schema for required field in update mode', () => {
        const field = text({ validation: { isRequired: true } })
        const schema = field.getZodSchema('title', 'update')

        expect(schema.safeParse('test').success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(true)
        expect(schema.safeParse('').success).toBe(false)
      })

      test('validates min length', () => {
        const field = text({ validation: { length: { min: 5 } } })
        const schema = field.getZodSchema('title', 'create')

        expect(schema.safeParse('test').success).toBe(false)
        expect(schema.safeParse('testing').success).toBe(true)
      })

      test('validates max length', () => {
        const field = text({ validation: { length: { max: 10 } } })
        const schema = field.getZodSchema('title', 'create')

        expect(schema.safeParse('short').success).toBe(true)
        expect(schema.safeParse('this is way too long').success).toBe(false)
      })

      test('validates min and max length together', () => {
        const field = text({ validation: { length: { min: 3, max: 10 } } })
        const schema = field.getZodSchema('title', 'create')

        expect(schema.safeParse('ab').success).toBe(false)
        expect(schema.safeParse('abc').success).toBe(true)
        expect(schema.safeParse('abcdefghij').success).toBe(true)
        expect(schema.safeParse('abcdefghijk').success).toBe(false)
      })

      test('includes formatted field name in error messages', () => {
        const field = text({ validation: { isRequired: true } })
        const schema = field.getZodSchema('firstName', 'create')
        const result = schema.safeParse('')

        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues[0].message).toContain('First Name')
        }
      })
    })

    describe('getPrismaType', () => {
      test('returns String type for basic text field', () => {
        const field = text()
        const prismaType = field.getPrismaType('title')

        expect(prismaType.type).toBe('String')
        expect(prismaType.modifiers).toBe('?')
      })

      test('returns required String for required field', () => {
        const field = text({ validation: { isRequired: true } })
        const prismaType = field.getPrismaType('title')

        expect(prismaType.type).toBe('String')
        expect(prismaType.modifiers).toBeUndefined()
      })

      test('includes @unique modifier', () => {
        const field = text({ isIndexed: 'unique' })
        const prismaType = field.getPrismaType('email')

        expect(prismaType.type).toBe('String')
        expect(prismaType.modifiers).toContain('@unique')
      })

      test('requests a block-level index rather than an inline modifier', () => {
        const field = text({ isIndexed: true })
        const prismaType = field.getPrismaType('slug')

        expect(prismaType.type).toBe('String')
        // Prisma has no field-level `@index` attribute — emitting one produces a
        // schema Prisma refuses to parse. A non-unique index is requested
        // out-of-line and lands as `@@index([slug])` on the model.
        expect(prismaType.index).toBe(true)
        expect(prismaType.modifiers ?? '').not.toContain('@index')
      })

      test('db.isNullable: true makes optional field explicitly nullable', () => {
        const field = text({ db: { isNullable: true } })
        const prismaType = field.getPrismaType('description')

        expect(prismaType.type).toBe('String')
        expect(prismaType.modifiers).toContain('?')
      })

      test('db.isNullable: false makes field non-nullable regardless of validation', () => {
        const field = text({ db: { isNullable: false } })
        const prismaType = field.getPrismaType('phoneNumber')

        expect(prismaType.type).toBe('String')
        // Non-nullable with no other modifiers → modifiers is undefined
        expect(prismaType.modifiers).toBeUndefined()
      })

      test('db.isNullable: false on required field keeps it non-nullable', () => {
        const field = text({ validation: { isRequired: true }, db: { isNullable: false } })
        const prismaType = field.getPrismaType('title')

        expect(prismaType.type).toBe('String')
        // Non-nullable with no other modifiers → modifiers is undefined
        expect(prismaType.modifiers).toBeUndefined()
      })

      test('db.isNullable: true on required field overrides to nullable', () => {
        const field = text({ validation: { isRequired: true }, db: { isNullable: true } })
        const prismaType = field.getPrismaType('title')

        expect(prismaType.type).toBe('String')
        expect(prismaType.modifiers).toContain('?')
      })

      test('db.nativeType generates @db. attribute', () => {
        const field = text({ db: { nativeType: 'Text' } })
        const prismaType = field.getPrismaType('medical')

        expect(prismaType.type).toBe('String')
        expect(prismaType.modifiers).toContain('@db.Text')
      })

      test('db.nativeType with nullable field includes both ? and @db. attribute', () => {
        const field = text({ db: { isNullable: true, nativeType: 'Text' } })
        const prismaType = field.getPrismaType('bio')

        expect(prismaType.type).toBe('String')
        expect(prismaType.modifiers).toBe('? @db.Text')
      })

      test('db.nativeType with non-nullable field excludes ? but includes @db. attribute', () => {
        const field = text({ db: { isNullable: false, nativeType: 'Text' } })
        const prismaType = field.getPrismaType('content')

        expect(prismaType.type).toBe('String')
        expect(prismaType.modifiers).toBe('@db.Text')
      })

      test('db.nativeType with required field generates non-nullable with @db. attribute', () => {
        const field = text({ validation: { isRequired: true }, db: { nativeType: 'Text' } })
        const prismaType = field.getPrismaType('content')

        expect(prismaType.type).toBe('String')
        expect(prismaType.modifiers).toBe('@db.Text')
      })
    })

    describe('getTypeScriptType', () => {
      test('returns optional string type for non-required field', () => {
        const field = text()
        const tsType = field.getTypeScriptType()

        expect(tsType.type).toBe('string')
        expect(tsType.optional).toBe(true)
      })

      test('returns required string type for required field', () => {
        const field = text({ validation: { isRequired: true } })
        const tsType = field.getTypeScriptType()

        expect(tsType.type).toBe('string')
        expect(tsType.optional).toBe(false)
      })
    })
  })

  describe('integer field', () => {
    describe('getZodSchema', () => {
      test('returns optional number schema for non-required field', () => {
        const field = integer()
        const schema = field.getZodSchema('age', 'create')

        expect(schema.safeParse(25).success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(true)
        expect(schema.safeParse('25').success).toBe(false)
      })

      test('returns required number schema for required field in create mode', () => {
        const field = integer({ validation: { isRequired: true } })
        const schema = field.getZodSchema('age', 'create')

        expect(schema.safeParse(25).success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(false)
      })

      test('returns optional schema for required field in update mode', () => {
        const field = integer({ validation: { isRequired: true } })
        const schema = field.getZodSchema('age', 'update')

        expect(schema.safeParse(25).success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(true)
      })

      test('validates min value', () => {
        const field = integer({ validation: { min: 0 } })
        const schema = field.getZodSchema('age', 'create')

        expect(schema.safeParse(-1).success).toBe(false)
        expect(schema.safeParse(0).success).toBe(true)
        expect(schema.safeParse(1).success).toBe(true)
      })

      test('validates max value', () => {
        const field = integer({ validation: { max: 100 } })
        const schema = field.getZodSchema('age', 'create')

        expect(schema.safeParse(99).success).toBe(true)
        expect(schema.safeParse(100).success).toBe(true)
        expect(schema.safeParse(101).success).toBe(false)
      })

      test('validates min and max together', () => {
        const field = integer({ validation: { min: 18, max: 65 } })
        const schema = field.getZodSchema('age', 'create')

        expect(schema.safeParse(17).success).toBe(false)
        expect(schema.safeParse(18).success).toBe(true)
        expect(schema.safeParse(65).success).toBe(true)
        expect(schema.safeParse(66).success).toBe(false)
      })
    })

    describe('getPrismaType', () => {
      test('returns Int type for basic integer field', () => {
        const field = integer()
        const prismaType = field.getPrismaType('age')

        expect(prismaType.type).toBe('Int')
        expect(prismaType.modifiers).toBe('?')
      })

      test('returns required Int for required field', () => {
        const field = integer({ validation: { isRequired: true } })
        const prismaType = field.getPrismaType('age')

        expect(prismaType.type).toBe('Int')
        expect(prismaType.modifiers).toBeUndefined()
      })

      test('db.isNullable: false makes field non-nullable regardless of validation', () => {
        const field = integer({ db: { isNullable: false } })
        const prismaType = field.getPrismaType('count')

        expect(prismaType.type).toBe('Int')
        // Non-nullable with no other modifiers → modifiers is undefined
        expect(prismaType.modifiers).toBeUndefined()
      })

      test('db.isNullable: true on required field overrides to nullable', () => {
        const field = integer({ validation: { isRequired: true }, db: { isNullable: true } })
        const prismaType = field.getPrismaType('count')

        expect(prismaType.type).toBe('Int')
        expect(prismaType.modifiers).toContain('?')
      })

      test('db.nativeType generates @db. attribute', () => {
        const field = integer({ db: { nativeType: 'SmallInt' } })
        const prismaType = field.getPrismaType('score')

        expect(prismaType.type).toBe('Int')
        expect(prismaType.modifiers).toContain('@db.SmallInt')
      })

      test('db.nativeType with non-nullable field excludes ? but includes @db. attribute', () => {
        const field = integer({ db: { isNullable: false, nativeType: 'BigInt' } })
        const prismaType = field.getPrismaType('largeId')

        expect(prismaType.type).toBe('Int')
        expect(prismaType.modifiers).toBe('@db.BigInt')
      })

      test('isIndexed: true requests a block-level index', () => {
        const field = integer({ isIndexed: true })
        const prismaType = field.getPrismaType('rank')

        expect(prismaType.index).toBe(true)
      })

      test("isIndexed: 'unique' generates @unique modifier", () => {
        const field = integer({ isIndexed: 'unique' })
        const prismaType = field.getPrismaType('rank')

        expect(prismaType.modifiers).toContain('@unique')
        expect(prismaType.index).toBeUndefined()
      })

      test('no isIndexed generates neither modifier nor index', () => {
        const field = integer()
        const prismaType = field.getPrismaType('rank')

        expect(prismaType.modifiers).not.toContain('@unique')
        expect(prismaType.index).toBeUndefined()
      })
    })

    describe('getTypeScriptType', () => {
      test('returns optional number type for non-required field', () => {
        const field = integer()
        const tsType = field.getTypeScriptType()

        expect(tsType.type).toBe('number')
        expect(tsType.optional).toBe(true)
      })

      test('returns required number type for required field', () => {
        const field = integer({ validation: { isRequired: true } })
        const tsType = field.getTypeScriptType()

        expect(tsType.type).toBe('number')
        expect(tsType.optional).toBe(false)
      })
    })
  })

  describe('bigInt field', () => {
    describe('getZodSchema', () => {
      test('returns optional bigint schema for non-required field', () => {
        const field = bigInt()
        const schema = field.getZodSchema('epoch', 'create')

        expect(schema.safeParse(25n).success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(true)
      })

      test('returns required schema for required field in create mode', () => {
        const field = bigInt({ validation: { isRequired: true } })
        const schema = field.getZodSchema('epoch', 'create')

        expect(schema.safeParse(25n).success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(false)
      })

      test('returns optional schema for required field in update mode', () => {
        const field = bigInt({ validation: { isRequired: true } })
        const schema = field.getZodSchema('epoch', 'update')

        expect(schema.safeParse(25n).success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(true)
      })

      test('coerces a bigint input to a bigint output unchanged', () => {
        const field = bigInt()
        const schema = field.getZodSchema('epoch', 'create')

        const result = schema.safeParse(9007199254740993n)
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data).toBe(9007199254740993n)
          expect(typeof result.data).toBe('bigint')
        }
      })

      test('coerces a safe-integer number input to a bigint output', () => {
        const field = bigInt()
        const schema = field.getZodSchema('epoch', 'create')

        const result = schema.safeParse(1700000000000)
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data).toBe(1700000000000n)
          expect(typeof result.data).toBe('bigint')
        }
      })

      test('coerces a numeric string input to a bigint output, round-tripping beyond Number.MAX_SAFE_INTEGER', () => {
        const field = bigInt()
        const schema = field.getZodSchema('epoch', 'create')

        const result = schema.safeParse('9223372036854775807')
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data).toBe(9223372036854775807n)
        }
      })

      test('accepts a negative numeric string', () => {
        const field = bigInt()
        const schema = field.getZodSchema('delta', 'create')

        const result = schema.safeParse('-42')
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data).toBe(-42n)
        }
      })

      test('rejects a non-integer number', () => {
        const field = bigInt()
        const schema = field.getZodSchema('epoch', 'create')

        expect(schema.safeParse(1.5).success).toBe(false)
      })

      test('rejects a number above Number.MAX_SAFE_INTEGER instead of silently losing precision', () => {
        const field = bigInt()
        const schema = field.getZodSchema('epoch', 'create')

        expect(schema.safeParse(Number.MAX_SAFE_INTEGER + 10).success).toBe(false)
      })

      test('rejects a non-numeric string', () => {
        const field = bigInt()
        const schema = field.getZodSchema('epoch', 'create')

        expect(schema.safeParse('not-a-number').success).toBe(false)
      })

      test('rejects a decimal string', () => {
        const field = bigInt()
        const schema = field.getZodSchema('epoch', 'create')

        expect(schema.safeParse('1.5').success).toBe(false)
      })

      test('validates min value', () => {
        const field = bigInt({ validation: { min: 0n } })
        const schema = field.getZodSchema('epoch', 'create')

        expect(schema.safeParse(-1n).success).toBe(false)
        expect(schema.safeParse(0n).success).toBe(true)
        expect(schema.safeParse(1n).success).toBe(true)
      })

      test('validates max value', () => {
        const field = bigInt({ validation: { max: 100n } })
        const schema = field.getZodSchema('epoch', 'create')

        expect(schema.safeParse(99n).success).toBe(true)
        expect(schema.safeParse(100n).success).toBe(true)
        expect(schema.safeParse(101n).success).toBe(false)
      })

      test('validates min and max together', () => {
        const field = bigInt({ validation: { min: 18n, max: 65n } })
        const schema = field.getZodSchema('age', 'create')

        expect(schema.safeParse(17n).success).toBe(false)
        expect(schema.safeParse(18n).success).toBe(true)
        expect(schema.safeParse(65n).success).toBe(true)
        expect(schema.safeParse(66n).success).toBe(false)
      })
    })

    describe('getPrismaType', () => {
      test('returns BigInt type for basic field', () => {
        const field = bigInt()
        const prismaType = field.getPrismaType('epoch')

        expect(prismaType.type).toBe('BigInt')
        expect(prismaType.modifiers).toBe('?')
      })

      test('returns required BigInt for required field', () => {
        const field = bigInt({ validation: { isRequired: true } })
        const prismaType = field.getPrismaType('epoch')

        expect(prismaType.type).toBe('BigInt')
        expect(prismaType.modifiers).toBeUndefined()
      })

      test('db.isNullable: false makes field non-nullable regardless of validation', () => {
        const field = bigInt({ db: { isNullable: false } })
        const prismaType = field.getPrismaType('epoch')

        expect(prismaType.modifiers).toBeUndefined()
      })

      test('db.map generates @map attribute', () => {
        const field = bigInt({ db: { map: 'occurred_at_ms' } })
        const prismaType = field.getPrismaType('epoch')

        expect(prismaType.modifiers).toContain('@map("occurred_at_ms")')
      })

      test('defaultValue generates a bare @default literal', () => {
        const field = bigInt({ defaultValue: 0n })
        const prismaType = field.getPrismaType('epoch')

        expect(prismaType.modifiers).toContain('@default(0)')
      })

      test('isIndexed: true requests a block-level index', () => {
        const field = bigInt({ isIndexed: true })
        const prismaType = field.getPrismaType('epoch')

        expect(prismaType.index).toBe(true)
      })

      test("isIndexed: 'unique' generates @unique modifier", () => {
        const field = bigInt({ isIndexed: 'unique' })
        const prismaType = field.getPrismaType('epoch')

        expect(prismaType.modifiers).toContain('@unique')
      })
    })

    describe('getTypeScriptType', () => {
      test('returns optional bigint type for non-required field', () => {
        const field = bigInt()
        const tsType = field.getTypeScriptType()

        expect(tsType.type).toBe('bigint')
        expect(tsType.optional).toBe(true)
      })

      test('returns required bigint type for required field', () => {
        const field = bigInt({ validation: { isRequired: true } })
        const tsType = field.getTypeScriptType()

        expect(tsType.type).toBe('bigint')
        expect(tsType.optional).toBe(false)
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
        const schema = field.getZodSchema('isActive', 'create')

        expect(schema.safeParse(true).success).toBe(true)
        expect(schema.safeParse(false).success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(true)
        expect(schema.safeParse('true').success).toBe(false)
      })
    })

    describe('getPrismaType', () => {
      test('returns Boolean type without default', () => {
        const field = checkbox()
        const prismaType = field.getPrismaType('isActive')

        expect(prismaType.type).toBe('Boolean')
        expect(prismaType.modifiers).toBeUndefined()
      })

      test('returns Boolean type with default true', () => {
        const field = checkbox({ defaultValue: true })
        const prismaType = field.getPrismaType('isActive')

        expect(prismaType.type).toBe('Boolean')
        expect(prismaType.modifiers).toBe('@default(true)')
      })

      test('returns Boolean type with default false', () => {
        const field = checkbox({ defaultValue: false })
        const prismaType = field.getPrismaType('isActive')

        expect(prismaType.type).toBe('Boolean')
        expect(prismaType.modifiers).toBe('@default(false)')
      })

      test('db.isNullable: true makes Boolean field nullable', () => {
        const field = checkbox({ db: { isNullable: true } })
        const prismaType = field.getPrismaType('agreed')

        expect(prismaType.type).toBe('Boolean')
        expect(prismaType.modifiers).toContain('?')
      })

      test('db.isNullable: true with default value makes nullable Boolean with default', () => {
        const field = checkbox({ defaultValue: false, db: { isNullable: true } })
        const prismaType = field.getPrismaType('agreed')

        expect(prismaType.type).toBe('Boolean')
        expect(prismaType.modifiers).toContain('?')
        expect(prismaType.modifiers).toContain('@default(false)')
      })
    })

    describe('getTypeScriptType', () => {
      test('returns optional boolean type without default', () => {
        const field = checkbox()
        const tsType = field.getTypeScriptType()

        expect(tsType.type).toBe('boolean')
        expect(tsType.optional).toBe(true)
      })

      test('returns required boolean type with default', () => {
        const field = checkbox({ defaultValue: false })
        const tsType = field.getTypeScriptType()

        expect(tsType.type).toBe('boolean')
        expect(tsType.optional).toBe(false)
      })
    })
  })

  describe('timestamp field', () => {
    describe('getZodSchema', () => {
      test('accepts Date objects and ISO datetime strings', () => {
        const field = timestamp()
        const schema = field.getZodSchema('createdAt', 'create')

        expect(schema.safeParse(new Date()).success).toBe(true)
        expect(schema.safeParse('2024-01-01T00:00:00Z').success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(true)
        expect(schema.safeParse('invalid').success).toBe(false)
      })
    })

    describe('getPrismaType', () => {
      test('returns optional DateTime type', () => {
        const field = timestamp()
        const prismaType = field.getPrismaType('createdAt')

        expect(prismaType.type).toBe('DateTime')
        expect(prismaType.modifiers).toBe('?')
      })

      test('returns DateTime type with @default(now())', () => {
        const field = timestamp({ defaultValue: { kind: 'now' } })
        const prismaType = field.getPrismaType('createdAt')

        expect(prismaType.type).toBe('DateTime')
        expect(prismaType.modifiers).toBe('@default(now())')
      })

      test('db.isNullable: false makes timestamp non-nullable without default', () => {
        const field = timestamp({ db: { isNullable: false } })
        const prismaType = field.getPrismaType('publishedAt')

        expect(prismaType.type).toBe('DateTime')
        // Non-nullable with no other modifiers → modifiers is undefined
        expect(prismaType.modifiers).toBeUndefined()
      })

      test('db.isNullable: true on timestamp with @default(now()) overrides to nullable', () => {
        const field = timestamp({ defaultValue: { kind: 'now' }, db: { isNullable: true } })
        const prismaType = field.getPrismaType('createdAt')

        expect(prismaType.type).toBe('DateTime')
        expect(prismaType.modifiers).toContain('?')
        expect(prismaType.modifiers).toContain('@default(now())')
      })

      test('db.nativeType generates @db. attribute', () => {
        const field = timestamp({ db: { nativeType: 'Timestamptz' } })
        const prismaType = field.getPrismaType('scheduledAt')

        expect(prismaType.type).toBe('DateTime')
        expect(prismaType.modifiers).toContain('@db.Timestamptz')
      })

      test('isIndexed: true requests a block-level index', () => {
        const field = timestamp({ isIndexed: true })
        const prismaType = field.getPrismaType('publishedAt')

        expect(prismaType.index).toBe(true)
      })

      test("isIndexed: 'unique' generates @unique modifier", () => {
        const field = timestamp({ isIndexed: 'unique' })
        const prismaType = field.getPrismaType('publishedAt')

        expect(prismaType.modifiers).toContain('@unique')
        expect(prismaType.index).toBeUndefined()
      })

      test('no isIndexed generates neither modifier nor index', () => {
        const field = timestamp()
        const prismaType = field.getPrismaType('publishedAt')

        expect(prismaType.modifiers).not.toContain('@unique')
        expect(prismaType.index).toBeUndefined()
      })
    })

    describe('getTypeScriptType', () => {
      test('returns optional Date type without default', () => {
        const field = timestamp()
        const tsType = field.getTypeScriptType()

        expect(tsType.type).toBe('Date')
        expect(tsType.optional).toBe(true)
      })

      test('returns required Date type with default now', () => {
        const field = timestamp({ defaultValue: { kind: 'now' } })
        const tsType = field.getTypeScriptType()

        expect(tsType.type).toBe('Date')
        expect(tsType.optional).toBe(false)
      })
    })
  })

  describe('password field', () => {
    describe('getZodSchema', () => {
      test('returns required string schema for required field in create mode', () => {
        const field = password({ validation: { isRequired: true } })
        const schema = field.getZodSchema('password', 'create')

        expect(schema.safeParse('secret123').success).toBe(true)
        expect(schema.safeParse('').success).toBe(false)
        expect(schema.safeParse(undefined).success).toBe(false)
      })

      test('returns optional schema for required field in update mode', () => {
        const field = password({ validation: { isRequired: true } })
        const schema = field.getZodSchema('password', 'update')

        expect(schema.safeParse('newpassword').success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(true)
        expect(schema.safeParse('').success).toBe(false)
      })

      test('returns optional string schema for non-required field', () => {
        const field = password()
        const schema = field.getZodSchema('password', 'create')

        expect(schema.safeParse('secret123').success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(true)
      })
    })

    describe('getPrismaType', () => {
      test('returns String type for password field', () => {
        const field = password()
        const prismaType = field.getPrismaType('password')

        expect(prismaType.type).toBe('String')
        expect(prismaType.modifiers).toBe('?')
      })

      test('returns required String for required password', () => {
        const field = password({ validation: { isRequired: true } })
        const prismaType = field.getPrismaType('password')

        expect(prismaType.type).toBe('String')
        expect(prismaType.modifiers).toBeUndefined()
      })

      test('db.isNullable: false makes password non-nullable regardless of validation', () => {
        const field = password({ db: { isNullable: false } })
        const prismaType = field.getPrismaType('password')

        expect(prismaType.type).toBe('String')
        // Non-nullable with no other modifiers → modifiers is undefined
        expect(prismaType.modifiers).toBeUndefined()
      })

      test('db.isNullable: true on required password overrides to nullable', () => {
        const field = password({ validation: { isRequired: true }, db: { isNullable: true } })
        const prismaType = field.getPrismaType('password')

        expect(prismaType.type).toBe('String')
        expect(prismaType.modifiers).toContain('?')
      })

      test('db.nativeType generates @db. attribute', () => {
        const field = password({ db: { nativeType: 'Text' } })
        const prismaType = field.getPrismaType('password')

        expect(prismaType.type).toBe('String')
        expect(prismaType.modifiers).toContain('@db.Text')
      })
    })

    describe('getTypeScriptType', () => {
      test('returns optional string type', () => {
        const field = password()
        const tsType = field.getTypeScriptType()

        expect(tsType.type).toBe('string')
        expect(tsType.optional).toBe(true)
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

    describe('resultExtension', () => {
      test('has result extension configured', () => {
        const field = password()

        expect(field.resultExtension).toBeDefined()
        expect(field.resultExtension?.outputType).toBe(
          "import('@opensaas/stack-core/internal').HashedPassword",
        )
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
        const schema = field.getZodSchema('status', 'create')

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
        const schema = field.getZodSchema('status', 'create')

        expect(schema.safeParse('draft').success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(false)
      })

      test('allows undefined in update mode even when required', () => {
        const field = select({
          options: [{ label: 'Draft', value: 'draft' }],
          validation: { isRequired: true },
        })
        const schema = field.getZodSchema('status', 'update')

        expect(schema.safeParse('draft').success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(true)
      })
    })

    describe('getPrismaType', () => {
      test('returns String type with optional modifier', () => {
        const field = select({
          options: [{ label: 'Option', value: 'option' }],
        })
        const prismaType = field.getPrismaType('status')

        expect(prismaType.type).toBe('String')
        expect(prismaType.modifiers).toBe('?')
      })

      test('includes @default modifier when defaultValue provided', () => {
        const field = select({
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
          defaultValue: 'draft',
        })
        const prismaType = field.getPrismaType('status')

        expect(prismaType.type).toBe('String')
        expect(prismaType.modifiers).toBe(' @default("draft")')
      })

      test('isIndexed: true requests a block-level index on the default string column', () => {
        const field = select({
          options: [{ label: 'Draft', value: 'draft' }],
          isIndexed: true,
        })
        const prismaType = field.getPrismaType('status')

        expect(prismaType.type).toBe('String')
        expect(prismaType.index).toBe(true)
      })

      test("isIndexed: 'unique' generates @unique on the default string column", () => {
        const field = select({
          options: [{ label: 'Draft', value: 'draft' }],
          isIndexed: 'unique',
        })
        const prismaType = field.getPrismaType('status')

        expect(prismaType.modifiers).toContain('@unique')
        expect(prismaType.index).toBeUndefined()
      })

      test('isIndexed: true requests a block-level index on a native-enum column', () => {
        const field = select({
          options: [{ label: 'Draft', value: 'draft' }],
          db: { type: 'enum' },
          isIndexed: true,
        })
        const prismaType = field.getPrismaType('status', undefined, 'Post')

        expect(prismaType.type).toBe('PostStatus')
        expect(prismaType.index).toBe(true)
      })

      test("isIndexed: 'unique' generates @unique on a native-enum column", () => {
        const field = select({
          options: [{ label: 'Draft', value: 'draft' }],
          db: { type: 'enum' },
          isIndexed: 'unique',
        })
        const prismaType = field.getPrismaType('status', undefined, 'Post')

        expect(prismaType.modifiers).toContain('@unique')
        expect(prismaType.index).toBeUndefined()
      })
    })

    describe('getTypeScriptType', () => {
      test('returns union type from options', () => {
        const field = select({
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
        })
        const tsType = field.getTypeScriptType()

        expect(tsType.type).toBe("'draft' | 'published'")
        expect(tsType.optional).toBe(true)
      })

      test('returns required type when isRequired', () => {
        const field = select({
          options: [{ label: 'Draft', value: 'draft' }],
          validation: { isRequired: true },
        })
        const tsType = field.getTypeScriptType()

        expect(tsType.optional).toBe(false)
      })

      test('returns optional type when has defaultValue', () => {
        const field = select({
          options: [{ label: 'Draft', value: 'draft' }],
          defaultValue: 'draft',
        })
        const tsType = field.getTypeScriptType()

        expect(tsType.optional).toBe(true)
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
        const schema = field.getZodSchema('metadata', 'create')

        expect(schema.safeParse({ key: 'value' }).success).toBe(true)
        expect(schema.safeParse([1, 2, 3]).success).toBe(true)
        expect(schema.safeParse('string').success).toBe(true)
        expect(schema.safeParse(123).success).toBe(true)
        expect(schema.safeParse(null).success).toBe(true)
        expect(schema.safeParse(undefined).success).toBe(true)
      })

      test('accepts value for required field in create mode', () => {
        const field = json({ validation: { isRequired: true } })
        const schema = field.getZodSchema('metadata', 'create')

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
        const schema = field.getZodSchema('metadata', 'update')

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

    describe('getPrismaType', () => {
      test('returns Json type with optional modifier', () => {
        const field = json()
        const prismaType = field.getPrismaType('metadata')

        expect(prismaType.type).toBe('Json')
        expect(prismaType.modifiers).toBe('?')
      })

      test('returns required Json type for required field', () => {
        const field = json({ validation: { isRequired: true } })
        const prismaType = field.getPrismaType('metadata')

        expect(prismaType.type).toBe('Json')
        expect(prismaType.modifiers).toBeUndefined()
      })

      test('db.isNullable: false makes Json field non-nullable regardless of validation', () => {
        const field = json({ db: { isNullable: false } })
        const prismaType = field.getPrismaType('settings')

        expect(prismaType.type).toBe('Json')
        // Non-nullable with no other modifiers → modifiers is undefined
        expect(prismaType.modifiers).toBeUndefined()
      })

      test('db.isNullable: true on required field overrides to nullable', () => {
        const field = json({ validation: { isRequired: true }, db: { isNullable: true } })
        const prismaType = field.getPrismaType('settings')

        expect(prismaType.type).toBe('Json')
        expect(prismaType.modifiers).toContain('?')
      })
    })

    describe('getTypeScriptType', () => {
      test('returns optional unknown type', () => {
        const field = json()
        const tsType = field.getTypeScriptType()

        expect(tsType.type).toBe('unknown')
        expect(tsType.optional).toBe(true)
      })

      test('returns required unknown type for required field', () => {
        const field = json({ validation: { isRequired: true } })
        const tsType = field.getTypeScriptType()

        expect(tsType.type).toBe('unknown')
        expect(tsType.optional).toBe(false)
      })
    })
  })

  describe('field name formatting', () => {
    test('formats camelCase to human-readable', () => {
      const field = text({ validation: { isRequired: true } })
      const schema = field.getZodSchema('firstName', 'create')
      const result = schema.safeParse('')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('First Name')
      }
    })

    test('formats single word field names', () => {
      const field = text({ validation: { isRequired: true } })
      const schema = field.getZodSchema('email', 'create')
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
      const schema = field.getZodSchema('field', 'create')

      expect(schema.safeParse('1234').success).toBe(false)
      expect(schema.safeParse('12345').success).toBe(true)
      expect(schema.safeParse('a'.repeat(1000)).success).toBe(true)
    })

    test('text field with only max length set', () => {
      const field = text({ validation: { length: { max: 10 } } })
      const schema = field.getZodSchema('field', 'create')

      expect(schema.safeParse('').success).toBe(true)
      expect(schema.safeParse('short').success).toBe(true)
      expect(schema.safeParse('way too long text').success).toBe(false)
    })

    test('integer field with zero as min value', () => {
      const field = integer({ validation: { min: 0 } })
      const schema = field.getZodSchema('count', 'create')

      expect(schema.safeParse(-1).success).toBe(false)
      expect(schema.safeParse(0).success).toBe(true)
    })

    test('integer field with negative min and max', () => {
      const field = integer({ validation: { min: -100, max: -10 } })
      const schema = field.getZodSchema('temperature', 'create')

      expect(schema.safeParse(-101).success).toBe(false)
      expect(schema.safeParse(-50).success).toBe(true)
      expect(schema.safeParse(-9).success).toBe(false)
    })

    test('select field with single option', () => {
      const field = select({
        options: [{ label: 'Only Option', value: 'only' }],
      })
      const schema = field.getZodSchema('choice', 'create')

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
