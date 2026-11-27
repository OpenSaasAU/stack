import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import postgres from '@prisma/orm-postgres/runtime'
import * as z from 'zod'
import type { AccessControlledDB } from '../access/types.js'
import type { OpenSaasConfig } from '../config/types.js'
import { getContext } from '../context/index.js'
import type { PrismaContract } from '../contract/prisma.js'
import { integer, text } from '../fields/index.js'
import { originTripwire } from '../origin.js'
import { createTestDatabase, ormClientFor, type TestDatabase } from '../testing/context.js'
import { ESCAPE_VARIABLES, readDatabaseEscape } from '../testing/escape.js'
import type { StackContext } from '../types/context.js'
import { createProcedureHandler } from './http.js'
import { createProcedureBuilder } from './procedure.js'

/**
 * Escape-only: PGlite serialises every transaction, so the barrier below,
 * which releases only once every racer's transaction is open, would never
 * release there. See `../secured/capacity-gate.test.ts`.
 */

const BOOT = 120_000
const ORIGIN = 'http://app.test'
const CAPACITY = 2
const RACERS = 5

type Ctx = StackContext<AccessControlledDB>

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Slot: {
      fields: { name: text(), capacity: integer() },
      access: { operation: { query: () => true, create: () => true } },
    },
    Booking: {
      fields: { slotId: text(), holder: text() },
      access: { operation: { query: () => true, create: () => true } },
    },
  },
}

function barrier(count: number): () => Promise<void> {
  let arrived = 0
  let release = (): void => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return async () => {
    arrived += 1
    if (arrived >= count) release()
    await gate
  }
}

let arrive: () => Promise<void> = async () => {}

const procedure = createProcedureBuilder<Ctx>()

const book = procedure({
  description: 'Book a place in a slot behind a lock',
  input: z.object({
    slotId: z.string(),
    holder: z.string(),
    gate: z.enum(['row', 'advisory', 'none']),
  }),
  output: z.object({ booked: z.literal(true) }),
  failures: { SLOT_FULL: 'The slot has no places left', NO_SLOT: 'No such slot' },
  access: () => true,
  expose: ['web'],
  run: async ({ input, context, fail }) => {
    await context.transaction(async (tx) => {
      if (input.gate === 'none') {
        const { taken } = await tx.db.Booking.where({
          slotId: { equals: input.slotId },
        }).aggregate((aggregate) => ({ taken: aggregate.count() }))
        await arrive()
        if (taken >= CAPACITY) throw fail('SLOT_FULL')
        await tx.db.Booking.create({ data: { slotId: input.slotId, holder: input.holder } })
        return
      }

      await arrive()
      if (input.gate === 'row') {
        const held = await tx.db.Slot.where({ id: { equals: input.slotId } })
          .forUpdate()
          .first()
        if (held === null) throw fail('NO_SLOT')
      } else {
        await tx.advisoryLock(`slot:${input.slotId}`)
      }

      const slot = await tx.db.Slot.where({ id: { equals: input.slotId } }).first()
      if (slot === null) throw fail('NO_SLOT')
      const { taken } = await tx.db.Booking.where({
        slotId: { equals: input.slotId },
      }).aggregate((aggregate) => ({ taken: aggregate.count() }))
      if (taken >= Number(slot.capacity)) throw fail('SLOT_FULL')
      await tx.db.Booking.create({ data: { slotId: input.slotId, holder: input.holder } })
    })
    return { booked: true as const }
  },
})

interface Racer {
  readonly context: Ctx
  close(): Promise<void>
}

function racer(database: TestDatabase): Racer {
  const pool = new pg.Pool({
    connectionString: database.url,
    max: 1,
    connectionTimeoutMillis: 20_000,
  })
  const client = postgres<PrismaContract>({
    contract: database.contract,
    pg: pool,
    verifyMarker: false,
    middleware: [originTripwire],
  })
  const orm = ormClientFor(database.data, client.orm)
  return {
    context: getContext(config, orm, null, undefined, false, undefined, undefined, client),
    close: () => client.close(),
  }
}

const result = z.object({
  success: z.boolean(),
  error: z.object({ code: z.string() }).optional(),
})

const escape = readDatabaseEscape()

describe.skipIf(escape.kind !== 'postgres')(
  escape.kind === 'postgres'
    ? 'a procedure capacity gate under contention'
    : `a procedure capacity gate under contention [escape-only: ${ESCAPE_VARIABLES.join('/')} names no Postgres]`,
  () => {
    let database: TestDatabase
    let racers: Racer[]

    beforeAll(async () => {
      database = await createTestDatabase(config)
      racers = Array.from({ length: RACERS }, () => racer(database))
    }, BOOT)

    afterAll(async () => {
      await Promise.all((racers ?? []).map((each) => each.close()))
      await database?.close()
    })

    beforeEach(async () => {
      await database.truncate()
    })

    async function race(gate: 'row' | 'advisory' | 'none') {
      const created = await database
        .context(null)
        .db.Slot.create({ data: { name: 'matinee', capacity: CAPACITY } })
      const slotId = String(created?.id)
      arrive = barrier(RACERS)

      let next = 0
      const handler = createProcedureHandler<Ctx>({
        procedures: { book },
        getContext: async () => {
          const each = racers[next % RACERS]
          next += 1
          if (each === undefined) throw new Error('no racer')
          return each.context
        },
        getSession: async () => null,
        allowedOrigins: [ORIGIN],
      })

      const outcomes = await Promise.all(
        racers.map(async (_, index) => {
          const response = await handler(
            new Request(`${ORIGIN}/api/procedures/book`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ slotId, holder: `racer-${index}`, gate }),
            }),
          )
          return { status: response.status, body: result.parse(await response.json()) }
        }),
      )

      const { taken } = await database
        .context(null)
        .db.Booking.where({ slotId: { equals: slotId } })
        .aggregate((aggregate) => ({ taken: aggregate.count() }))
      return { outcomes, taken }
    }

    test.each(['row', 'advisory'] as const)(
      'five racers behind the %s lock admit exactly two, and the rest get SLOT_FULL with 200',
      async (gate) => {
        const { outcomes, taken } = await race(gate)

        expect(outcomes.every((outcome) => outcome.status === 200)).toBe(true)
        expect(outcomes.filter((outcome) => outcome.body.success)).toHaveLength(CAPACITY)
        expect(outcomes.filter((outcome) => outcome.body.error?.code === 'SLOT_FULL')).toHaveLength(
          RACERS - CAPACITY,
        )
        expect(taken).toBe(CAPACITY)
      },
      BOOT,
    )

    test(
      'the same gate without a lock over-admits, which is what the lock is for',
      async () => {
        const { outcomes, taken } = await race('none')

        expect(outcomes.filter((outcome) => outcome.body.success)).toHaveLength(RACERS)
        expect(taken).toBe(RACERS)
      },
      BOOT,
    )
  },
)
