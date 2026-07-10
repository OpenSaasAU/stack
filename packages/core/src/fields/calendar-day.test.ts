import { describe, it, expect, expectTypeOf, vi } from 'vitest'
import { calendarDay } from './index.js'
import { generateZodSchema, validateWithZod } from '../validation/schema.js'
import { getContext } from '../context/index.js'
import type { FieldConfig } from '../config/types.js'
import type { OpenSaasConfig } from '../config/types.js'

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

  describe('write validation (YYYY-MM-DD string, or a Date post-resolveInput)', () => {
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

    it('accepts a Date instance (the shape resolveInput produces from a valid string)', () => {
      // The write pipeline runs field `resolveInput` BEFORE this schema, and
      // calendarDay's resolveInput turns a valid YYYY-MM-DD string into a UTC
      // Date (see #621) so Prisma's `@db.Date` write validator accepts it. So
      // by the time this schema runs, a successful write reaches it as a
      // Date, not the original string — the schema must accept both shapes.
      const result = validateWithZod(
        { startsOn: new Date('2025-01-15T00:00:00.000Z') } as unknown as Record<string, unknown>,
        fields,
        'create',
      )
      expect(result.success).toBe(true)
    })

    it('zod schema for the field validates the YYYY-MM-DD shape', () => {
      const schema = generateZodSchema(fields, 'create')
      expect(schema.safeParse({ startsOn: '2025-12-31' }).success).toBe(true)
      expect(schema.safeParse({ startsOn: 'nope' }).success).toBe(false)
    })
  })

  describe('write transform (resolveInput coerces YYYY-MM-DD string to a UTC Date, #621)', () => {
    // The write pipeline calls fieldConfig.hooks.resolveInput({ resolvedData,
    // fieldKey, ... }) BEFORE zod validation runs. We exercise that hook
    // directly with the value shapes a caller (or an upstream list-level
    // resolveInput) can produce.
    function writeValue(value: unknown): unknown {
      const field = calendarDay()
      const hook = field.hooks?.resolveInput
      if (!hook) throw new Error('calendarDay must define a resolveInput hook')
      return (
        hook as unknown as (args: {
          resolvedData: Record<string, unknown>
          fieldKey: string
        }) => unknown
      )({ resolvedData: { startsOn: value }, fieldKey: 'startsOn' })
    }

    it('converts a YYYY-MM-DD string to a UTC-midnight Date', () => {
      const result = writeValue('2025-01-15') as Date
      expect(result).toBeInstanceOf(Date)
      expect(result.toISOString()).toBe('2025-01-15T00:00:00.000Z')
    })

    it('passes an already-Date value through unchanged', () => {
      const date = new Date('2025-06-01T00:00:00.000Z')
      expect(writeValue(date)).toBe(date)
    })

    it('passes null/undefined through unchanged (so isRequired can still reject a missing value)', () => {
      expect(writeValue(null)).toBeNull()
      expect(writeValue(undefined)).toBeUndefined()
    })

    it('leaves a malformed string untouched so zod still rejects it with a clear message', () => {
      expect(writeValue('15/01/2025')).toBe('15/01/2025')
    })

    it('reads resolvedData[fieldKey], not inputData — survives a list-level resolveInput default', () => {
      // A list-level resolveInput can inject a default for an omitted key
      // into resolvedData before field resolveInput runs. Reading
      // resolvedData (not the original inputData) here means that injected
      // default is what gets coerced, instead of being read as `undefined`
      // and overwriting the injected default with null.
      const field = calendarDay()
      const hook = field.hooks?.resolveInput as unknown as (args: {
        resolvedData: Record<string, unknown>
        fieldKey: string
      }) => unknown
      const result = hook({
        resolvedData: { startsOn: '2025-03-20' }, // injected by a list-level hook
        fieldKey: 'startsOn',
      }) as Date
      expect(result.toISOString()).toBe('2025-03-20T00:00:00.000Z')
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

  describe('end-to-end via context.db.*.create/update (#621 repro)', () => {
    // Prisma 7's client validator rejects a bare YYYY-MM-DD string for a
    // `@db.Date` column. Assert the value actually forwarded to the Prisma
    // client is a Date, not the string the caller passed in.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock Prisma client
    let mockPrisma: any

    function buildConfig(): OpenSaasConfig {
      mockPrisma = {
        event: {
          findFirst: vi.fn(),
          findUnique: vi.fn(),
          findMany: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
          count: vi.fn(),
        },
      }
      return {
        db: {
          provider: 'postgresql',
          prismaClientConstructor: (PrismaClient) => new PrismaClient(),
        },
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

    it('create: a YYYY-MM-DD string reaches Prisma as a UTC-midnight Date', async () => {
      const config = buildConfig()
      mockPrisma.event.create.mockResolvedValue({
        id: '1',
        startsOn: new Date('2025-01-15T00:00:00.000Z'),
      })
      const context = await getContext(config, mockPrisma, null)

      await context.db.event.create({ data: { startsOn: '2025-01-15' } })

      expect(mockPrisma.event.create).toHaveBeenCalledTimes(1)
      const callArgs = mockPrisma.event.create.mock.calls[0][0]
      expect(callArgs.data.startsOn).toBeInstanceOf(Date)
      expect((callArgs.data.startsOn as Date).toISOString()).toBe('2025-01-15T00:00:00.000Z')
    })

    it('update: a YYYY-MM-DD string reaches Prisma as a UTC-midnight Date', async () => {
      const config = buildConfig()
      const existing = { id: '1', startsOn: new Date('2025-01-15T00:00:00.000Z') }
      mockPrisma.event.findUnique.mockResolvedValue(existing)
      mockPrisma.event.update.mockResolvedValue({
        ...existing,
        startsOn: new Date('2025-02-20T00:00:00.000Z'),
      })
      const context = await getContext(config, mockPrisma, null)

      await context.db.event.update({ where: { id: '1' }, data: { startsOn: '2025-02-20' } })

      expect(mockPrisma.event.update).toHaveBeenCalledTimes(1)
      const callArgs = mockPrisma.event.update.mock.calls[0][0]
      expect(callArgs.data.startsOn).toBeInstanceOf(Date)
      expect((callArgs.data.startsOn as Date).toISOString()).toBe('2025-02-20T00:00:00.000Z')
    })

    it('the read result is still normalised back to a YYYY-MM-DD string', async () => {
      const config = buildConfig()
      mockPrisma.event.create.mockResolvedValue({
        id: '1',
        startsOn: new Date('2025-01-15T00:00:00.000Z'),
      })
      const context = await getContext(config, mockPrisma, null)

      const result = await context.db.event.create({ data: { startsOn: '2025-01-15' } })

      expect(result?.startsOn).toBe('2025-01-15')
    })
  })
})
