import { describe, it, expect, expectTypeOf, vi } from 'vitest'
import { calendarDay } from './index.js'
import { generateZodSchema, validateWithZod } from '../validation/schema.js'
import { getContext } from '../context/index.js'
import type { FieldConfig, TypeDescriptor } from '../config/types.js'
import type { OpenSaasConfig } from '../config/types.js'

/**
 * calendarDay is a YYYY-MM-DD string end-to-end (Keystone's CalendarDay
 * scalar). Type, validation, and runtime read value must all agree on `string`.
 * See issue #571.
 */
describe('calendarDay field (YYYY-MM-DD string end-to-end)', () => {
  describe('the TypeScript face', () => {
    it('reads and writes as string (not Date), driving the row and input types', () => {
      const field = calendarDay()
      expect(field.outputType).toBe('string')
      expect(field.inputType).toBe('string')
    })

    it('declares the same face when required', () => {
      const field = calendarDay({ validation: { isRequired: true } })
      expect(field.outputType).toBe('string')
      expect(field.inputType).toBe('string')
    })

    it('type-level: the declared face is a plain type string, never a Date', () => {
      const field = calendarDay()
      // The remainder's `output`/`input` entries are rendered from these, so
      // pinning them to 'string' pins the emitted row and input types. (At the
      // context.db write path a Date is rejected at runtime by validation, not
      // at compile time — tracked in #599.)
      expectTypeOf(field.outputType).toEqualTypeOf<TypeDescriptor | undefined>()
      expect(field.outputType).toBe('string')
      // @ts-expect-error - the declared face is 'string', never 'Date'
      const _notDate: 'Date' = field.outputType
      void _notDate
    })
  })

  describe('the stored column (a date column under a string face)', () => {
    const config: OpenSaasConfig = { db: { provider: 'postgresql' }, lists: {} }

    it('stores a dateTime column with a native date type', () => {
      const field = calendarDay({ validation: { isRequired: true } })
      expect(field.getContractField?.('startsOn', 'Event', config)).toEqual({
        kind: 'column',
        name: 'startsOn',
        type: { pack: 'pg', type: 'dateTime' },
        nativeType: 'date',
        nullable: false,
      })
    })

    it('is nullable when not required', () => {
      const field = calendarDay()
      expect(field.getContractField?.('startsOn', 'Event', config)).toMatchObject({
        nullable: true,
      })
    })
  })

  describe('filter condition (compares on the string, not a Date, #1437)', () => {
    const config: OpenSaasConfig = { db: { provider: 'postgresql' }, lists: {} }

    it('produces a string comparison value', () => {
      const field = calendarDay()
      const condition = field
        .getFilterSpec?.('startsOn', 'Event', config)
        ?.toCondition('eq', '2025-01-15')
      expect(condition).toEqual({ startsOn: { equals: '2025-01-15' } })
    })

    it('degrades to free text on a malformed value', () => {
      const field = calendarDay()
      expect(
        field.getFilterSpec?.('startsOn', 'Event', config)?.toCondition('eq', 'not-a-date'),
      ).toBeNull()
    })

    it('degrades to free text on an out-of-range month the regex alone cannot catch', () => {
      const field = calendarDay()
      expect(
        field.getFilterSpec?.('startsOn', 'Event', config)?.toCondition('eq', '2025-13-01'),
      ).toBeNull()
    })
  })

  describe('write validation (YYYY-MM-DD string only)', () => {
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

    it('rejects a Date instance — the column takes the string as-is, never a Date (#1437)', () => {
      const result = validateWithZod(
        { startsOn: new Date('2025-01-15T00:00:00.000Z') } as unknown as Record<string, unknown>,
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

  describe('no write transform — the string reaches the column as-is (#1437)', () => {
    it('declares no resolveInput hook', () => {
      const field = calendarDay()
      expect(field.hooks?.resolveInput).toBeUndefined()
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

  describe('end-to-end via context.db.*.create/update (mocked ORM, #1437)', () => {
    // The column's codec is a string pass-through (see the real-database test
    // in calendar-day-column.test.ts). Assert the value forwarded to the ORM
    // is the same YYYY-MM-DD string the caller passed in, not a Date.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock Prisma client
    let mockPrisma: any

    function buildConfig(): OpenSaasConfig {
      const event: Record<string, unknown> = {
        where: vi.fn(() => event),
        first: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      }
      mockPrisma = { Event: event }
      return {
        db: { provider: 'postgresql' },
        lists: {
          Event: {
            fields: {
              startsOn: calendarDay({ validation: { isRequired: true } }),
            },
            access: {
              operation: {
                query: () => true,
                create: () => true,
                update: () => true,
                delete: () => true,
              },
            },
          },
        },
      }
    }

    it('create: a YYYY-MM-DD string reaches Prisma unchanged, not a Date', async () => {
      const config = buildConfig()
      mockPrisma.Event.create.mockResolvedValue({ id: '1', startsOn: '2025-01-15' })
      const context = await getContext(config, mockPrisma, null)

      await context.db.Event.create({ data: { startsOn: '2025-01-15' } })

      expect(mockPrisma.Event.create).toHaveBeenCalledTimes(1)
      const written = mockPrisma.Event.create.mock.calls[0][0]
      expect(written.startsOn).toBe('2025-01-15')
    })

    it('update: a YYYY-MM-DD string reaches Prisma unchanged, not a Date', async () => {
      const config = buildConfig()
      const existing = { id: '1', startsOn: '2025-01-15' }
      mockPrisma.Event.first.mockResolvedValue(existing)
      mockPrisma.Event.update.mockResolvedValue({ ...existing, startsOn: '2025-02-20' })
      const context = await getContext(config, mockPrisma, null)

      await context.db.Event.update({ where: { id: '1' }, data: { startsOn: '2025-02-20' } })

      expect(mockPrisma.Event.update).toHaveBeenCalledTimes(1)
      const written = mockPrisma.Event.update.mock.calls[0][0]
      expect(written.startsOn).toBe('2025-02-20')
    })

    it('the read result is still normalised back to a YYYY-MM-DD string', async () => {
      const config = buildConfig()
      mockPrisma.Event.create.mockResolvedValue({
        id: '1',
        startsOn: new Date('2025-01-15T00:00:00.000Z'),
      })
      const context = await getContext(config, mockPrisma, null)

      const result = await context.db.Event.create({ data: { startsOn: '2025-01-15' } })

      expect(result?.startsOn).toBe('2025-01-15')
    })
  })
})
