import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import * as z from 'zod'
import type { AccessControlledDB, Session } from '../access/types.js'
import type { OpenSaasConfig } from '../config/types.js'
import { EngineContextUnavailableError, engineContextOf } from '../context/engine-context.js'
import { integer, text } from '../fields/index.js'
import { ValidationError } from '../hooks/index.js'
import { classifyDriverError } from '../lib/database-errors.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import type { StackContext } from '../types/context.js'
import type { ProcedureFail } from './failures.js'
import { createProcedureHandler, ProcedureHostError } from './http.js'
import {
  createProcedureBuilder,
  ProcedureDefinitionError,
  type ProcedureContext,
  type ProcedureRegistry,
  type ProcedureTransactionContext,
  type TransactionContextOf,
} from './procedure.js'

const BOOT = 120_000
const ORIGIN = 'http://app.test'

type Ctx = StackContext<AccessControlledDB>

const open = { query: () => true, create: () => true, update: () => true, delete: () => true }

const owned = ({ session }: { session: Session | null }) =>
  session === null ? false : { holder: { equals: String(session.userId) } }

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Slot: {
      fields: { name: text(), capacity: integer() },
      access: { operation: open },
    },
    Booking: {
      fields: {
        slotId: text(),
        holder: text(),
        reference: text({ isIndexed: 'unique' }),
        note: text(),
      },
      access: { operation: { query: () => true, create: () => true, update: owned } },
      hooks: {
        validate: async (args) => {
          if (args.operation !== 'delete' && args.resolvedData.note === 'spam') {
            args.addValidationError('Note cannot be spam')
          }
        },
      },
    },
  },
}

const procedure = createProcedureBuilder<Ctx>()

const bookingInput = z.object({ slotId: z.string(), holder: z.string() })
const booked = z.object({ booked: z.literal(true) })

const book = procedure({
  description: 'Book a place in a slot, refusing once it is full',
  input: bookingInput,
  output: booked,
  failures: { SLOT_FULL: 'The slot has no places left', NO_SLOT: 'No such slot' },
  access: () => true,
  expose: ['web'],
  run: async ({ input, context, fail }) => {
    await context.transaction(async (tx) => {
      const held = await tx.db.Slot.where({ id: { equals: input.slotId } })
        .forUpdate()
        .first()
      if (held === null) throw fail('NO_SLOT')
      await tx.db.Booking.create({ data: { slotId: input.slotId, holder: input.holder } })
      const slot = await tx.db.Slot.where({ id: { equals: input.slotId } }).first()
      const { taken } = await tx.db.Booking.where({
        slotId: { equals: input.slotId },
      }).aggregate((aggregate) => ({ taken: aggregate.count() }))
      if (slot === null || taken > Number(slot.capacity)) {
        throw fail('SLOT_FULL', `No places left for ${input.holder}`)
      }
    })
    return { booked: true as const }
  },
})

const writeThenFail = procedure({
  description: 'Write outside any transaction, then fail',
  input: bookingInput,
  output: booked,
  failures: { TOO_LATE: 'Bookings have closed' },
  access: () => true,
  expose: ['web'],
  run: async ({ input, context, fail }) => {
    await context.db.Booking.create({ data: input })
    throw fail('TOO_LATE')
  },
})

const commitThenMisreport = procedure({
  description: 'Commit a booking, then return output its schema rejects',
  input: bookingInput,
  output: z.object({ count: z.number() }),
  access: () => true,
  expose: ['web'],
  run: async ({ input, context }) => {
    await context.transaction(async (tx) => {
      await tx.db.Booking.create({ data: input })
    })
    return { count: Number.NaN }
  },
})

const validateAfterWrite = procedure({
  description: 'Write in a transaction, then make a write the list refuses',
  input: bookingInput,
  output: booked,
  access: () => true,
  expose: ['web'],
  run: async ({ input, context }) => {
    await context.transaction(async (tx) => {
      await tx.db.Booking.create({ data: input })
      await tx.db.Booking.create({ data: { ...input, note: 'spam' } })
    })
    return { booked: true as const }
  },
})

const throwValidationAfterWrite = procedure({
  description: 'Write in a transaction, then throw a validation error',
  input: bookingInput,
  output: booked,
  access: () => true,
  expose: ['web'],
  run: async ({ input, context }) => {
    await context.transaction(async (tx) => {
      await tx.db.Booking.create({ data: input })
      throw new ValidationError(['Holder is banned'], { holder: 'Holder is banned' })
    })
    return { booked: true as const }
  },
})

const collideAfterWrite = procedure({
  description: 'Write two bookings under one reference in a transaction',
  input: bookingInput,
  output: booked,
  access: () => true,
  expose: ['web'],
  run: async ({ input, context }) => {
    await context.transaction(async (tx) => {
      await tx.db.Booking.create({ data: { ...input, reference: 'R1' } })
      await tx.db.Booking.create({ data: { ...input, reference: 'R1' } })
    })
    return { booked: true as const }
  },
})

let raceRuns = 0

const loseRaceAfterWrite = procedure({
  description: 'Write in a transaction, then lose a race the database rolled back',
  input: bookingInput,
  output: booked,
  access: () => true,
  expose: ['web'],
  run: async ({ input, context }) => {
    raceRuns += 1
    await context.transaction(async (tx) => {
      await tx.db.Booking.create({ data: input })
      const driverError = Object.assign(new Error('could not serialize access'), {
        kind: 'sql_query',
        sqlState: '40001',
      })
      throw classifyDriverError(driverError) ?? driverError
    })
    return { booked: true as const }
  },
})

const nestedThenFail = procedure({
  description: 'Write in a nested transaction, then fail in the outer one',
  input: bookingInput,
  output: booked,
  failures: { CHANGED_MIND: 'The booking was withdrawn' },
  access: () => true,
  expose: ['web'],
  run: async ({ input, context, fail }) => {
    await context.transaction(async (tx) => {
      await tx.transaction(async (inner) => {
        await inner.db.Booking.create({ data: input })
      })
      throw fail('CHANGED_MIND')
    })
    return { booked: true as const }
  },
})

let lentFail: ProcedureFail<'LENDER_ONLY'> | undefined

const lender = procedure({
  description: 'Declare a failure and throw it',
  input: z.object({}),
  output: z.object({}),
  failures: { LENDER_ONLY: 'Only the lender declares this' },
  access: () => true,
  expose: ['web'],
  run: ({ fail }) => {
    lentFail = fail
    throw fail('LENDER_ONLY')
  },
})

const borrower = procedure({
  description: 'Throw a failure another procedure declared',
  input: z.object({}),
  output: z.object({}),
  access: () => true,
  expose: ['web'],
  run: () => {
    if (lentFail === undefined) return {}
    throw lentFail('LENDER_ONLY')
  },
})

const undeclaredAtRuntime = procedure({
  description: 'Ask the helper for a code that was never declared',
  input: z.object({}),
  output: z.object({}),
  failures: { DECLARED: 'A declared failure' },
  access: () => true,
  expose: ['web'],
  run: ({ fail }) => {
    throw Reflect.apply(fail, undefined, ['SECRET_DETAIL'])
  },
})

interface Seen {
  outer: ProcedureContext<Ctx>
  transaction: ProcedureTransactionContext<TransactionContextOf<Ctx>>
  nested: ProcedureTransactionContext<TransactionContextOf<Ctx>>
}

let seen: Seen | undefined

const inspect = procedure({
  description: 'Open a transaction, take an advisory lock and report who is asking',
  input: z.object({}),
  output: z.object({ userId: z.string(), sameSession: z.boolean() }),
  access: ({ session }) => session !== null,
  expose: ['web'],
  run: async ({ context }) => {
    return context.transaction(async (tx) => {
      await tx.advisoryLock('inspect')
      const nested = await tx.transaction(async (inner) => inner)
      seen = { outer: context, transaction: tx, nested }
      return {
        userId: tx.session === null ? '' : String(tx.session.userId),
        sameSession: tx.session === context.session,
      }
    })
  },
})

const takeOver = procedure({
  description: 'Rename the holder of a booking inside a transaction',
  input: z.object({ id: z.string() }),
  output: z.object({ changed: z.boolean() }),
  access: ({ session }) => session !== null,
  expose: ['web'],
  run: async ({ input, context }) => {
    const row = await context.transaction((tx) =>
      tx.db.Booking.update({ where: { id: input.id }, data: { note: 'taken over' } }),
    )
    return { changed: row !== null }
  },
})

const registry: ProcedureRegistry<Ctx> = {
  book,
  writeThenFail,
  commitThenMisreport,
  validateAfterWrite,
  throwValidationAfterWrite,
  collideAfterWrite,
  loseRaceAfterWrite,
  nestedThenFail,
  lender,
  borrower,
  undeclaredAtRuntime,
  inspect,
  takeOver,
}

const envelope = z.object({
  success: z.boolean(),
  data: z.record(z.string(), z.unknown()).optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      fieldErrors: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
})

describe('procedure transactions and declared failures', () => {
  let database: TestDatabase
  const onUnexpectedError = vi.fn()

  function handler(procedures: ProcedureRegistry<Ctx> = registry) {
    return createProcedureHandler<Ctx>({
      procedures,
      getContext: async (session) => database.context(session),
      getSession: async (request) => {
        const match = /session=([a-z]+)/.exec(request.headers.get('cookie') ?? '')
        return match === null ? null : { userId: match[1] }
      },
      allowedOrigins: [ORIGIN],
      onUnexpectedError,
    })
  }

  async function call(name: string, body: unknown, cookie?: string) {
    const headers: Record<string, string> = { 'content-type': 'application/json', origin: ORIGIN }
    if (cookie !== undefined) headers.cookie = cookie
    const response = await handler()(
      new Request(`${ORIGIN}/api/procedures/${name}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
    )
    return { status: response.status, body: envelope.parse(await response.json()) }
  }

  async function holders(): Promise<string[]> {
    const rows = await database.context().sudo().db.Booking.all()
    return rows.map((row) => String(row.holder)).sort()
  }

  async function slot(capacity: number): Promise<string> {
    const created = await database.context().db.Slot.create({ data: { name: 'matinee', capacity } })
    return String(created?.id)
  }

  beforeAll(async () => {
    database = await createTestDatabase(config)
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(async () => {
    await database.truncate()
    onUnexpectedError.mockClear()
    seen = undefined
    raceRuns = 0
  })

  test('a declared failure thrown after a write in a transaction leaves no row and answers 200', async () => {
    const slotId = await slot(1)

    const first = await call('book', { slotId, holder: 'ada' })
    expect(first).toEqual({ status: 200, body: { success: true, data: { booked: true } } })

    const second = await call('book', { slotId, holder: 'bob' })
    expect(second).toEqual({
      status: 200,
      body: { success: false, error: { code: 'SLOT_FULL', message: 'No places left for bob' } },
    })
    expect(await holders()).toEqual(['ada'])
    expect(onUnexpectedError).not.toHaveBeenCalled()
  })

  test('a declared failure carries its declared message unless the throw replaces it', async () => {
    const response = await call('book', { slotId: crypto.randomUUID(), holder: 'ada' })
    expect(response).toEqual({
      status: 200,
      body: { success: false, error: { code: 'NO_SLOT', message: 'No such slot' } },
    })
  })

  test('run opens no transaction of its own: a write before a failure outside a transaction stays', async () => {
    const response = await call('writeThenFail', { slotId: 's', holder: 'ada' })
    expect(response.status).toBe(200)
    expect(response.body.error).toEqual({ code: 'TOO_LATE', message: 'Bookings have closed' })
    expect(await holders()).toEqual(['ada'])
  })

  test('a write joined through a nested transaction rolls back with the outer one', async () => {
    const response = await call('nestedThenFail', { slotId: 's', holder: 'ada' })
    expect(response.status).toBe(200)
    expect(response.body.error?.code).toBe('CHANGED_MIND')
    expect(await holders()).toEqual([])
  })

  test('output failing its schema is INTERNAL and does not undo the committed transaction', async () => {
    const response = await call('commitThenMisreport', { slotId: 's', holder: 'ada' })
    expect(response.status).toBe(500)
    expect(response.body.error).toEqual({ code: 'INTERNAL', message: 'Internal error' })
    expect(await holders()).toEqual(['ada'])
    expect(onUnexpectedError.mock.calls[0]?.[1]).toBe('commitThenMisreport')
  })

  test('a validation failure in a transaction is VALIDATION 400 with field errors and leaves no row', async () => {
    const hook = await call('validateAfterWrite', { slotId: 's', holder: 'ada' })
    expect(hook.status).toBe(400)
    expect(hook.body.error?.code).toBe('VALIDATION')
    expect(hook.body.error?.message).toContain('Note cannot be spam')

    const thrown = await call('throwValidationAfterWrite', { slotId: 's', holder: 'ada' })
    expect(thrown.status).toBe(400)
    expect(thrown.body.error).toEqual({
      code: 'VALIDATION',
      message: expect.stringContaining('Holder is banned'),
      fieldErrors: { holder: 'Holder is banned' },
    })
    expect(await holders()).toEqual([])
  })

  test('a database error in a transaction is CONFLICT 409 and leaves no row', async () => {
    const response = await call('collideAfterWrite', { slotId: 's', holder: 'ada' })
    expect(response.status).toBe(409)
    expect(response.body.error?.code).toBe('CONFLICT')
    expect(Object.keys(response.body.error?.fieldErrors ?? {})).toEqual(['reference'])
    expect(await holders()).toEqual([])
  })

  test('a serialization failure is RETRY 409, leaves no row and is not retried by the host', async () => {
    const response = await call('loseRaceAfterWrite', { slotId: 's', holder: 'ada' })
    expect(response.status).toBe(409)
    expect(response.body.error?.code).toBe('RETRY')
    expect(raceRuns).toBe(1)
    expect(await holders()).toEqual([])
    expect(onUnexpectedError).not.toHaveBeenCalled()
  })

  test('a failure another procedure declared is INTERNAL, redacted and reported', async () => {
    const lent = await call('lender', {})
    expect(lent.body.error?.code).toBe('LENDER_ONLY')

    const borrowed = await call('borrower', {})
    expect(borrowed.status).toBe(500)
    expect(borrowed.body.error).toEqual({ code: 'INTERNAL', message: 'Internal error' })
    expect(onUnexpectedError.mock.calls[0]?.[1]).toBe('borrower')
  })

  test('a code the procedure never declared cannot be constructed at runtime', async () => {
    const response = await call('undeclaredAtRuntime', {})
    expect(response.status).toBe(500)
    expect(JSON.stringify(response.body)).not.toContain('SECRET_DETAIL')
    expect(onUnexpectedError.mock.calls[0]?.[1]).toBe('undeclaredAtRuntime')
  })

  test('privileged members are absent at runtime inside a transaction, and the session is unchanged', async () => {
    const response = await call('inspect', {}, 'session=ada')
    expect(response.body).toEqual({ success: true, data: { userId: 'ada', sameSession: true } })

    expect(seen).toBeDefined()
    if (seen === undefined) return
    expect(seen.nested).toBe(seen.transaction)
    for (const context of [seen.transaction, seen.nested]) {
      expect(Object.keys(context).sort()).toEqual([
        'advisoryLock',
        'db',
        'plugins',
        'session',
        'storage',
        'transaction',
      ])
      for (const member of ['sudo', 'unsafe', 'withSession', 'serverAction', '_isSudo']) {
        expect(member in context).toBe(false)
        expect(Reflect.get(context, member)).toBeUndefined()
      }
      expect(Object.getOwnPropertySymbols(context)).toEqual([])
      expect(() => Reflect.apply(engineContextOf, undefined, [context])).toThrow(
        EngineContextUnavailableError,
      )
      expect(Object.isFrozen(context)).toBe(true)
    }
  })

  test('list access still denies a row inside a transaction', async () => {
    const created = await database
      .context()
      .db.Booking.create({ data: { slotId: 's', holder: 'ada', note: 'mine' } })

    const denied = await call('takeOver', { id: String(created?.id) }, 'session=bob')
    expect(denied.body).toEqual({ success: true, data: { changed: false } })

    const allowed = await call('takeOver', { id: String(created?.id) }, 'session=ada')
    expect(allowed.body).toEqual({ success: true, data: { changed: true } })
  })

  test('a procedure declaring a reserved code is refused when the host is created', () => {
    const reserved = procedure({
      description: 'Declare a code the stack owns',
      input: z.object({}),
      output: z.object({}),
      // @ts-expect-error a reserved code cannot be declared
      failures: { INTERNAL: 'Mine now' },
      access: () => true,
      expose: ['web'],
      run: () => ({}),
    })
    expect(() => handler({ reserved })).toThrow(ProcedureHostError)
    expect(() => handler({ reserved })).toThrow(/"reserved".*"INTERNAL".*reserved/)
  })

  test('malformed failure declarations are refused when the procedure is defined', () => {
    const define = (failures: unknown) =>
      Reflect.apply(procedure, undefined, [
        {
          description: 'Declare failures badly',
          input: z.object({}),
          output: z.object({}),
          failures,
          access: () => true,
          expose: ['web'],
          run: () => ({}),
        },
      ])
    expect(() => define({ 'slot-full': 'Lower case' })).toThrow(ProcedureDefinitionError)
    expect(() => define({ internal: 'Looks reserved' })).toThrow(ProcedureDefinitionError)
    expect(() => define({ SLOT_FULL: '' })).toThrow(ProcedureDefinitionError)
    expect(() => define(['SLOT_FULL'])).toThrow(ProcedureDefinitionError)
    expect(() => define({ SLOT_FULL: 'The slot is full' })).not.toThrow()
  })
})
