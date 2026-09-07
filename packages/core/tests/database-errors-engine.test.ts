import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import pg from 'pg'
import { text } from '../src/fields/index.js'
import type { OpenSaasConfig } from '../src/config/types.js'
import { AfterTransactionError } from '../src/context/transaction-boundary.js'
import { DatabaseError, isUniqueConstraintViolation } from '../src/lib/database-errors.js'
import { createTestDatabase, type TestDatabase } from '../src/testing/context.js'

/**
 * ADR-0042 against a real PostgreSQL: what a caller catches from the secured
 * surface when the database refuses a write, and what it catches from the
 * Unsafe surface for the same refusal.
 */

const BOOT = 120_000

const afterTransaction = vi.fn()
const wrapperResolveInput = vi.fn(({ resolvedData }) => resolvedData)

const open = {
  operation: { query: () => true, create: () => true, update: () => true, delete: () => true },
}

class SlugTakenError extends Error {
  constructor(cause: unknown) {
    super('That slug belongs to another tenant', { cause })
    this.name = 'SlugTakenError'
  }
}

const testConfig: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Tenant: {
      fields: {
        slug: text({ isIndexed: 'unique' }),
        name: text(),
      },
      access: open,
    },
    Ledger: {
      fields: { entry: text({ isIndexed: 'unique' }) },
      access: open,
      hooks: { afterTransaction },
    },
    // Its one declared column is dropped from the database below, so every
    // read of it raises a driver error at the terminal — the only kind of
    // failure a read can produce on demand.
    Orphan: {
      fields: { gone: text() },
      access: open,
    },
    Wrapper: {
      fields: { label: text() },
      access: open,
      hooks: { resolveInput: wrapperResolveInput },
    },
  },
}

async function ddl(url: string, statement: string): Promise<void> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await client.query(statement)
  } finally {
    await client.end()
  }
}

/** The driver's own error shape, so a raw escape can be recognised without the ORM's class. */
function driverSqlState(error: unknown): string | undefined {
  if (!(error instanceof Error) || !('sqlState' in error)) return undefined
  const { sqlState } = error
  return typeof sqlState === 'string' ? sqlState : undefined
}

/** The error class a boundary hook was handed, named for a legible assertion. */
function errorName(value: unknown): string {
  return value instanceof Error ? value.name : String(value)
}

async function raised(work: Promise<unknown>): Promise<unknown> {
  return await work.then(
    () => undefined,
    (error: unknown) => error,
  )
}

describe('a database refusal through the secured surface', () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase(testConfig)

    // A unique index the generator never emitted, so the constraint map cannot
    // name it — the fall-through this suite pins.
    await ddl(
      database.url,
      'create unique index "tenant_name_handmade" on "public"."Tenant" ("name")',
    )

    // Re-declare the emitted unique on Ledger as deferred, so a duplicate is
    // refused at COMMIT rather than at the INSERT. PostgreSQL's ALTER
    // CONSTRAINT cannot change deferrability for a unique, so it is dropped
    // and re-added under the same name.
    await ddl(database.url, 'alter table "public"."Ledger" drop constraint "Ledger_entry_key"')
    await ddl(
      database.url,
      'alter table "public"."Ledger" add constraint "Ledger_entry_key" unique ("entry") ' +
        'deferrable initially deferred',
    )

    await ddl(database.url, 'alter table "public"."Orphan" drop column "gone"')
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(async () => {
    await database.truncate()
    afterTransaction.mockReset()
    wrapperResolveInput.mockReset()
    wrapperResolveInput.mockImplementation(({ resolvedData }) => resolvedData)
  })

  test(
    'a violation of a generated constraint carries per-field messages',
    async () => {
      const context = database.context()
      await context.db.Tenant.create({ data: { slug: 'acme', name: 'Acme' } })

      const error = await raised(
        context.db.Tenant.create({ data: { slug: 'acme', name: 'Acme Two' } }),
      )

      expect(isUniqueConstraintViolation(error)).toBe(true)
      if (!isUniqueConstraintViolation(error)) throw new Error('not a unique violation')
      expect(error.constraintName).toBe('Tenant_slug_key')
      expect(error.list).toBe('Tenant')
      expect(error.fields).toEqual(['slug'])
      expect(error.fieldErrors).toEqual({ slug: 'This slug is already in use' })
      expect(error.message).toBe('Slug must be unique. The value you entered is already in use.')
    },
    BOOT,
  )

  test(
    'a violation of a hand-made index carries the generic message and no fields',
    async () => {
      const context = database.context()
      await context.db.Tenant.create({ data: { slug: 'one', name: 'Shared' } })

      const error = await raised(
        context.db.Tenant.create({ data: { slug: 'two', name: 'Shared' } }),
      )

      expect(isUniqueConstraintViolation(error)).toBe(true)
      if (!isUniqueConstraintViolation(error)) throw new Error('not a unique violation')
      expect(error.constraintName).toBe('tenant_name_handmade')
      expect(error.fields).toEqual([])
      expect(error.fieldErrors).toEqual({})
      expect(error.message).toBe('A record with this value already exists')
    },
    BOOT,
  )

  test(
    'a refusal raised at COMMIT inside context.transaction arrives normalised',
    async () => {
      const context = database.context()
      const returnedFromTerminals: unknown[] = []

      const error = await raised(
        context.transaction(async (tx) => {
          returnedFromTerminals.push(await tx.db.Ledger.create({ data: { entry: 'once' } }))
          returnedFromTerminals.push(await tx.db.Ledger.create({ data: { entry: 'once' } }))
        }),
      )

      // Both terminals returned a row: the constraint is deferred, so nothing
      // failed until COMMIT — after every engine terminal had already settled.
      expect(returnedFromTerminals).toHaveLength(2)
      expect(returnedFromTerminals.every((row) => row !== null)).toBe(true)

      expect(isUniqueConstraintViolation(error)).toBe(true)
      if (!isUniqueConstraintViolation(error)) throw new Error('not a unique violation')
      expect(error.constraintName).toBe('Ledger_entry_key')
      expect(error.fields).toEqual(['entry'])
      expect(error.message).toBe('Entry must be unique. The value you entered is already in use.')

      expect(await context.db.Ledger.all()).toEqual([])
    },
    BOOT,
  )

  test(
    'the commit-time error keeps precedence over a throwing boundary hook',
    async () => {
      afterTransaction.mockImplementation(() => {
        throw new Error('compensator exploded')
      })
      const context = database.context()

      const error = await raised(
        context.transaction(async (tx) => {
          await tx.db.Ledger.create({ data: { entry: 'twice' } })
          await tx.db.Ledger.create({ data: { entry: 'twice' } })
        }),
      )

      expect(isUniqueConstraintViolation(error)).toBe(true)
      expect(error).not.toBeInstanceOf(AfterTransactionError)
      expect(afterTransaction).toHaveBeenCalled()
      expect(afterTransaction.mock.calls.every((call) => call[0].status === 'rolled-back')).toBe(
        true,
      )
      // The normalisation happens BEFORE the deferred-hook flush, so the
      // outcome a boundary hook is handed is the normalised error, not the
      // driver's own.
      expect([
        ...new Set(afterTransaction.mock.calls.map((call) => errorName(call[0].error))),
      ]).toEqual(['UniqueConstraintViolation'])
    },
    BOOT,
  )

  test(
    "an application's own error survives, rather than being replaced by the stack's",
    async () => {
      const context = database.context()
      await context.db.Tenant.create({ data: { slug: 'taken', name: 'First' } })

      wrapperResolveInput.mockImplementation(async ({ resolvedData, context: hookContext }) => {
        try {
          await hookContext.db.Tenant.create({ data: { slug: 'taken', name: 'Second' } })
        } catch (caught) {
          throw new SlugTakenError(caught)
        }
        return resolvedData
      })

      const error = await raised(context.db.Wrapper.create({ data: { label: 'anything' } }))

      expect(error).toBeInstanceOf(SlugTakenError)
      expect(isUniqueConstraintViolation(error)).toBe(false)
      if (!(error instanceof SlugTakenError)) throw new Error('the application error was replaced')
      expect(error.message).toBe('That slug belongs to another tenant')
      // The stack's error is still reachable, as the application put it.
      expect(isUniqueConstraintViolation(error.cause)).toBe(true)
    },
    BOOT,
  )

  test(
    'a read terminal owns its driver error too, and the Unsafe surface does not',
    async () => {
      const context = database.context()

      const secured = await raised(context.db.Orphan.all())
      expect(secured).toBeInstanceOf(DatabaseError)
      expect(driverSqlState(secured)).toBeUndefined()

      const bypass = await raised(context.unsafe.orm.public.Orphan.all().toArray())
      expect(bypass).not.toBeInstanceOf(DatabaseError)
      expect(driverSqlState(bypass)).toBe('42703')
    },
    BOOT,
  )

  test(
    'the same refusal through the Unsafe surface stays raw',
    async () => {
      const context = database.context()
      await context.db.Tenant.create({ data: { slug: 'unsafe', name: 'Raw' } })

      const collection = context.unsafe.orm.public.Tenant
      const error = await raised(collection.create({ slug: 'unsafe', name: 'Raw Two' }))

      expect(error).toBeInstanceOf(Error)
      expect(error).not.toBeInstanceOf(DatabaseError)
      expect(isUniqueConstraintViolation(error)).toBe(false)
      expect(driverSqlState(error)).toBe('23505')
    },
    BOOT,
  )
})
