import { describe, expect, expectTypeOf, test } from 'vitest'
import * as z from 'zod'
import type { AccessControlledDB } from '../access/types.js'
import type { StackContext } from '../types/context.js'
import {
  createProcedureClient,
  type ProcedureClientResultOf,
  type ProcedureInputOf,
  type ProcedureTransportFailure,
} from './client.js'
import { createProcedureBuilder, type ProcedureRegistry } from './procedure.js'
import type { ReservedFailureCode } from './result.js'

type Ctx = StackContext<AccessControlledDB>

const procedure = createProcedureBuilder<Ctx>()

const book = procedure({
  description: 'Book a place',
  input: z.object({ slotId: z.string(), seats: z.number().default(1) }),
  output: z.object({ bookingId: z.string() }),
  failures: { SLOT_FULL: 'The slot is full', CLOSED: 'Bookings have closed' },
  access: ({ session }) => session !== null,
  expose: ['web'],
  run: ({ input }) => ({ bookingId: input.slotId }),
})

const ping = procedure({
  description: 'Answer anyone',
  input: z.object({}).optional(),
  output: z.object({ at: z.string() }),
  access: () => true,
  expose: ['web'],
  run: () => ({ at: 'now' }),
})

const registry = { book, ping } satisfies ProcedureRegistry<Ctx>

const unanswered = async (): Promise<Response> => {
  throw new TypeError('offline')
}

const call = createProcedureClient<typeof registry>({
  baseUrl: 'http://app.test/api/procedures',
  fetch: unanswered,
})

function outcome(result: ProcedureClientResultOf<typeof book>): string {
  if (result.success) return result.data.bookingId
  const { error } = result
  switch (error.code) {
    case 'SLOT_FULL':
    case 'CLOSED':
      return 'declared'
    case 'UNAUTHENTICATED':
    case 'DENIED':
    case 'INVALID_INPUT':
    case 'VALIDATION':
    case 'RETRY':
    case 'CONFLICT':
    case 'INTERNAL':
      return 'reserved'
    case 'transport':
      expectTypeOf(error).toEqualTypeOf<ProcedureTransportFailure>()
      return reasonOf(error)
    default: {
      const unreachable: never = error
      return unreachable
    }
  }
}

function reasonOf(error: ProcedureTransportFailure): string {
  switch (error.reason) {
    case 'network':
    case 'refused':
    case 'malformed':
    case 'unsent':
      return error.reason
    default: {
      const unreachable: never = error.reason
      return unreachable
    }
  }
}

function missesACode(result: ProcedureClientResultOf<typeof book>): string {
  if (result.success) return result.data.bookingId
  const { error } = result
  switch (error.code) {
    case 'SLOT_FULL':
    case 'UNAUTHENTICATED':
    case 'DENIED':
    case 'INVALID_INPUT':
    case 'VALIDATION':
    case 'RETRY':
    case 'CONFLICT':
    case 'INTERNAL':
    case 'transport':
      return 'handled'
    default: {
      // @ts-expect-error CLOSED is declared and not handled above
      const unreachable: never = error
      return String(unreachable)
    }
  }
}

describe('the procedure client types', () => {
  test('the input is what the input schema accepts', () => {
    expectTypeOf<ProcedureInputOf<typeof book>>().toEqualTypeOf<{
      slotId: string
      seats?: number | undefined
    }>()
    expectTypeOf(call<'book'>)
      .parameter(1)
      .toEqualTypeOf<{ slotId: string; seats?: number | undefined }>()
  })

  test('the data and the failure-code union are inferred per procedure', async () => {
    const booked = await call('book', { slotId: 'a' })
    if (booked.success) {
      expectTypeOf(booked.data).toEqualTypeOf<{ bookingId: string }>()
    } else {
      expectTypeOf(booked.error.code).toEqualTypeOf<
        ReservedFailureCode | 'SLOT_FULL' | 'CLOSED' | 'transport'
      >()
    }

    const pinged = await call('ping')
    if (pinged.success) {
      expectTypeOf(pinged.data).toEqualTypeOf<{ at: string }>()
    } else {
      expectTypeOf(pinged.error.code).toEqualTypeOf<ReservedFailureCode | 'transport'>()
    }
  })

  test('a switch on the code is exhaustive over declared, reserved and transport', async () => {
    expect(outcome(await call('book', { slotId: 'a' }))).toBe('network')
    expect(missesACode(await call('book', { slotId: 'a' }))).toBe('handled')
  })

  test('an unknown procedure, a renamed field and a missing input are compile errors', async () => {
    // @ts-expect-error the registry has no such procedure
    await call('cancel', {})
    // @ts-expect-error the input field is slotId
    await call('book', { slot: 'a' })
    // @ts-expect-error the input field is a string
    await call('book', { slotId: 7 })
    // @ts-expect-error book requires its input
    await call('book')
    // @ts-expect-error a session is not part of a call
    await call('book', { slotId: 'a' }, { userId: 'ada' })

    await call('ping')
    await call('ping', {})
    await call('ping', undefined)
  })

  test('a name typed as a union is not callable until it is narrowed', async () => {
    const either = (pick: boolean): 'book' | 'ping' => (pick ? 'book' : 'ping')
    const name = either(true)
    // @ts-expect-error a union of names is not callable
    await call(name)
    // @ts-expect-error a union of names is not callable
    await call(name, {})
    // @ts-expect-error a union of names is not callable
    await call(name, { slotId: 'a' })
    if (name === 'book') await call(name, { slotId: 'a' })
    else await call(name)
  })

  test('a registry type whose names are any string leaves no name callable', async () => {
    const untyped = createProcedureClient({ fetch: unanswered })
    // @ts-expect-error no type argument gives the client no names
    await untyped('book', { slotId: 'a' })

    const annotated: ProcedureRegistry<Ctx> = registry
    expectTypeOf(annotated).toEqualTypeOf<ProcedureRegistry<Ctx>>()
    const erased = createProcedureClient<typeof annotated>({ fetch: unanswered })
    // @ts-expect-error an annotated registry has lost its names
    await erased('book', { slotId: 'a' })
  })

  test('a value that is not a registry is refused', () => {
    expectTypeOf(registry).toExtend<ProcedureRegistry<Ctx>>()
    // @ts-expect-error a registry holds procedures
    createProcedureClient<{ book: string }>()
  })
})
