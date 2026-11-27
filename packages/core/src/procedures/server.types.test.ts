import { describe, expectTypeOf, test } from 'vitest'
import * as z from 'zod'
import type { AccessControlledDB, Session } from '../access/types.js'
import type { StackContext } from '../types/context.js'
import {
  createProcedureBuilder,
  type ProcedureRegistry,
  type ProcedureResultOf,
} from './procedure.js'
import type { ProcedureResult } from './result.js'
import { createServerCaller, type ServerCaller } from './server.js'

type Ctx = StackContext<AccessControlledDB>

const procedure = createProcedureBuilder<Ctx>()

const book = procedure({
  description: 'Book a place',
  input: z.object({ slotId: z.string() }),
  output: z.object({ bookingId: z.string() }),
  failures: { SLOT_FULL: 'The slot is full' },
  access: ({ session }) => session !== null,
  expose: ['web'],
  run: () => ({ bookingId: 'b1' }),
})

const ping = procedure({
  description: 'Answer anyone',
  input: z.object({}).optional(),
  output: z.object({ ok: z.boolean() }),
  access: () => true,
  expose: ['web'],
  run: () => ({ ok: true }),
})

const procedures = { book, ping } satisfies ProcedureRegistry<Ctx>

async function getContext<TSession extends Session = Session>(session?: TSession): Promise<Ctx> {
  throw new Error(`Not called at runtime: ${String(session)}`)
}

async function getSession(): Promise<Session | null> {
  return null
}

function typeOnly(check: () => unknown): void {
  expectTypeOf(check).toBeFunction()
}

const server = createServerCaller({ procedures, getContext, getSession })

describe('the in-process caller types', () => {
  test('infers the registry and the context from the generated getContext', () => {
    expectTypeOf(server).toEqualTypeOf<ServerCaller<typeof procedures>>()
    expectTypeOf(server.context).toEqualTypeOf<() => Promise<Ctx>>()
  })

  test('the result is the procedure result, with its declared codes and no transport failure', () => {
    expectTypeOf(server.call('book', { slotId: 's1' })).resolves.toEqualTypeOf<
      ProcedureResult<{ bookingId: string }, 'SLOT_FULL'>
    >()
    expectTypeOf(server.call('book', { slotId: 's1' })).resolves.toEqualTypeOf<
      ProcedureResultOf<typeof book>
    >()
  })

  test('the input may be left out only when the schema accepts undefined', () => {
    typeOnly(() => {
      void server.call('ping')
      // @ts-expect-error book requires its input
      void server.call('book')
    })
  })

  test('an unknown name or a renamed input field is a compile error', () => {
    typeOnly(() => {
      // @ts-expect-error an unknown name
      void server.call('cancel', {})
      // @ts-expect-error a renamed input field
      void server.call('book', { slot: 's1' })
    })
  })

  test('no signature accepts a session or an actor', () => {
    typeOnly(() => {
      // @ts-expect-error call takes the name and the input only
      void server.call('book', { slotId: 's1' }, { userId: 'ada' })
      // @ts-expect-error context takes no argument
      void server.context({ userId: 'ada' })
      expectTypeOf(getSession).parameters.toEqualTypeOf<[]>()
      createServerCaller({
        procedures,
        getContext,
        // @ts-expect-error the session resolver takes no argument a caller could fill
        getSession: async (session: Session) => session,
      })
    })
  })

  test('a registry annotated with ProcedureRegistry leaves no name callable', () => {
    typeOnly(() => {
      const annotated: ProcedureRegistry<Ctx> = procedures
      const loose = createServerCaller({ procedures: annotated, getContext, getSession })
      // @ts-expect-error the names of an annotated registry are not known
      void loose.call('book', { slotId: 's1' })
    })
  })
})
