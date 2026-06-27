import { describe, it, expect, expectTypeOf } from 'vitest'
import { calendarDay } from './index.js'
import { generateZodSchema, validateWithZod } from '../validation/schema.js'
import type { FieldConfig } from '../config/types.js'

/**
 * calendarDay is a YYYY-MM-DD string end-to-end (Keystone's CalendarDay
 * scalar). Type, validation, and runtime read value must all agree on `string`.
 * See issue #571.
 */
describe('calendarDay field (YYYY-MM-DD string end-to-end)', () => {
  describe('getTypeScriptType', () => {
    it('returns string (not Date), driving the entity + input types', () => {
      const field = calendarDay()
      expect(field.getTypeScriptType?.()).toEqual({ type: 'string', optional: true })
    })

    it('is non-optional when required and not nullable', () => {
      const field = calendarDay({ validation: { isRequired: true } })
      expect(field.getTypeScriptType?.()).toEqual({ type: 'string', optional: false })
    })

    it('type-level: the declared type is the literal "string"', () => {
      const field = calendarDay()
      const tsType = field.getTypeScriptType?.()
      // The entity/read type and the standalone generated CreateInput/UpdateInput
      // types are emitted from this literal, so asserting it is exactly 'string'
      // pins those types to `string`. (At the context.db write path a Date is
      // rejected at runtime by validation, not at compile time — tracked in #599.)
      expectTypeOf(tsType).toEqualTypeOf<{ type: string; optional: boolean } | undefined>()
      if (tsType) {
        expectTypeOf(tsType.type).toEqualTypeOf<string>()
        expect(tsType.type).toBe('string')
        // @ts-expect-error - the runtime type is 'string', never 'Date'
        const _notDate: 'Date' = tsType.type
        void _notDate
      }
    })
  })

  describe('getPrismaType (unchanged — stays DateTime @db.Date)', () => {
    it('keeps DateTime storage with @db.Date on non-sqlite providers', () => {
      const field = calendarDay({ validation: { isRequired: true } })
      const prisma = field.getPrismaType?.('startsOn', 'postgresql')
      expect(prisma?.type).toBe('DateTime')
      expect(prisma?.modifiers).toContain('@db.Date')
    })

    it('omits @db.Date on sqlite (TEXT fallback)', () => {
      const field = calendarDay({ validation: { isRequired: true } })
      const prisma = field.getPrismaType?.('startsOn', 'sqlite')
      expect(prisma?.type).toBe('DateTime')
      expect(prisma?.modifiers ?? '').not.toContain('@db.Date')
    })
  })

  describe('write validation (string-only)', () => {
    const fields: Record<string, FieldConfig> = {
      startsOn: calendarDay({ validation: { isRequired: true } }),
    }

    it('accepts a valid YYYY-MM-DD string on create', () => {
      const result = validateWithZod({ startsOn: '2025-01-15' }, fields, 'create')
      expect(result.success).toBe(true)
    })

    it('rejects a malformed string with a clear message', () => {
      const result = validateWithZod({ startsOn: '15/01/2025' }, fields, 'create')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors).toHaveProperty('startsOn')
        expect(result.errors.startsOn).toMatch(/YYYY-MM-DD/)
      }
    })

    it('rejects a Date instance at runtime (not a string)', () => {
      // A typed caller cannot reach here (input type is `string`), but the
      // validator is string-only as a runtime backstop.
      const result = validateWithZod(
        { startsOn: new Date('2025-01-15') } as unknown as Record<string, unknown>,
        fields,
        'create',
      )
      expect(result.success).toBe(false)
    })

    it('zod schema for the field validates the YYYY-MM-DD shape', () => {
      const schema = generateZodSchema(fields, 'create')
      expect(schema.safeParse({ startsOn: '2025-12-31' }).success).toBe(true)
      expect(schema.safeParse({ startsOn: 'nope' }).success).toBe(false)
    })
  })

  describe('read transform (resolveOutput returns a YYYY-MM-DD string)', () => {
    // The read pipeline calls fieldConfig.hooks.resolveOutput({ value, ... }).
    // We exercise that hook directly with the value shapes Prisma can return.
    function readValue(value: unknown): unknown {
      const field = calendarDay()
      const hook = field.hooks?.resolveOutput
      if (!hook) throw new Error('calendarDay must define a resolveOutput hook')
      // Cast to the runtime call shape used by field-visibility.ts.
      return (hook as unknown as (args: { value: unknown }) => unknown)({ value })
    }

    it('formats a Date (Postgres/MySQL @db.Date) to YYYY-MM-DD', () => {
      expect(readValue(new Date('2025-01-15T00:00:00.000Z'))).toBe('2025-01-15')
    })

    it('is timezone-safe — a late-UTC Date does not drift a day', () => {
      // 23:59:59Z is the same UTC calendar day; UTC-based formatting keeps it.
      expect(readValue(new Date('2025-01-15T23:59:59.999Z'))).toBe('2025-01-15')
    })

    it('passes through an already-formatted string (SQLite TEXT)', () => {
      expect(readValue('2025-01-15')).toBe('2025-01-15')
    })

    it('takes the date-only prefix of a full ISO string (SQLite TEXT)', () => {
      expect(readValue('2025-01-15T00:00:00.000Z')).toBe('2025-01-15')
    })

    it('passes null/undefined through unchanged', () => {
      expect(readValue(null)).toBeNull()
      expect(readValue(undefined)).toBeUndefined()
    })
  })

  describe('user-provided hooks are preserved', () => {
    it('merges a user resolveOutput over the default (last wins)', () => {
      const field = calendarDay({
        hooks: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test hook
          resolveOutput: ({ value }: { value: any }) => `custom:${value}`,
        },
      })
      const hook = field.hooks?.resolveOutput as unknown as (args: { value: unknown }) => unknown
      expect(hook({ value: '2025-01-15' })).toBe('custom:2025-01-15')
    })
  })
})
