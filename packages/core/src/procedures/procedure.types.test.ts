import { describe, expectTypeOf, test } from 'vitest'
import * as z from 'zod'
import type { AccessControlledDB } from '../access/types.js'
import type { StackContext, StackTransactionContext } from '../types/context.js'
import type { ProcedureFailureError } from './failures.js'
import {
  createProcedureBuilder,
  type ProcedureRegistry,
  type ProcedureResultOf,
  type TransactionContextOf,
} from './procedure.js'
import type { ProcedureResult, ReservedFailureCode } from './result.js'

type Ctx = StackContext<AccessControlledDB>

const procedure = createProcedureBuilder<Ctx>()

const book = procedure({
  description: 'Book a place',
  input: z.object({ slotId: z.string() }),
  output: z.object({ bookingId: z.string() }),
  failures: { SLOT_FULL: 'The slot is full', CLOSED: 'Bookings have closed' },
  access: ({ session }) => session !== null,
  expose: ['web'],
  run: async ({ input, context, fail }) => {
    expectTypeOf(input).toEqualTypeOf<{ slotId: string }>()
    expectTypeOf(fail).parameter(0).toEqualTypeOf<'SLOT_FULL' | 'CLOSED'>()
    expectTypeOf(fail('CLOSED')).toEqualTypeOf<ProcedureFailureError<'SLOT_FULL' | 'CLOSED'>>()

    // @ts-expect-error a code the procedure does not declare
    fail('SOLD_OUT')
    // @ts-expect-error a reserved code is not a declared one
    fail('INTERNAL')

    // @ts-expect-error sudo is not on a procedure's context
    void context.sudo
    // @ts-expect-error the Unsafe surface is not on a procedure's context
    void context.unsafe
    // @ts-expect-error the session cannot be switched
    void context.withSession
    // @ts-expect-error the admin's action is not on a procedure's context
    void context.serverAction
    // @ts-expect-error the advisory lock needs a transaction
    void context.advisoryLock

    return context.transaction(async (tx) => {
      expectTypeOf(tx.advisoryLock).toEqualTypeOf<(key: string) => Promise<void>>()
      expectTypeOf(tx.session).toEqualTypeOf<Ctx['session']>()
      expectTypeOf(tx.db).toEqualTypeOf<StackTransactionContext<AccessControlledDB>['db']>()

      // @ts-expect-error sudo is not on a transaction's context
      void tx.sudo
      // @ts-expect-error the Unsafe surface is not on a transaction's context
      void tx.unsafe
      // @ts-expect-error the session cannot be switched inside a transaction
      void tx.withSession
      // @ts-expect-error the admin's action is not on a transaction's context
      void tx.serverAction

      await tx.transaction(async (inner) => {
        expectTypeOf(inner).toEqualTypeOf(tx)
      })
      return { bookingId: input.slotId }
    })
  },
})

const ping = procedure({
  description: 'Declare no failures',
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  access: () => true,
  expose: ['web', 'mcp'],
  run: ({ fail }) => {
    expectTypeOf(fail).parameter(0).toBeNever()
    // @ts-expect-error a procedure that declares no failures has none to construct
    fail('ANYTHING')
    return { ok: true }
  },
})

procedure({
  description: 'Declare a reserved code',
  input: z.object({}),
  output: z.object({}),
  // @ts-expect-error a reserved code cannot be declared
  failures: { RETRY: 'Mine now' },
  access: () => true,
  expose: ['web'],
  run: () => ({}),
})

describe('procedure types', () => {
  test('the transaction context is read from the application context', () => {
    expectTypeOf<TransactionContextOf<Ctx>>().toEqualTypeOf<
      StackTransactionContext<AccessControlledDB>
    >()
  })

  test("a result's failure code is a reserved code or one the procedure declares", () => {
    expectTypeOf<ProcedureResultOf<typeof book>>().toEqualTypeOf<
      ProcedureResult<{ bookingId: string }, 'SLOT_FULL' | 'CLOSED'>
    >()
    type BookFailure = Extract<ProcedureResultOf<typeof book>, { success: false }>
    expectTypeOf<BookFailure['error']['code']>().toEqualTypeOf<
      ReservedFailureCode | 'SLOT_FULL' | 'CLOSED'
    >()

    type PingFailure = Extract<ProcedureResultOf<typeof ping>, { success: false }>
    expectTypeOf<PingFailure['error']['code']>().toEqualTypeOf<ReservedFailureCode>()
  })

  test('a registry holds procedures whatever they declare, and keeps each one typed', () => {
    const registry = { book, ping } satisfies ProcedureRegistry<Ctx>
    expectTypeOf(registry.book).toEqualTypeOf(book)
    expectTypeOf<ProcedureResultOf<(typeof registry)['ping']>>().toEqualTypeOf<
      ProcedureResult<{ ok: boolean }>
    >()
  })
})
