import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import postgres from '@prisma/orm-postgres/runtime'
import type { OpenSaasConfig } from '../config/types.js'
import type { PrismaContract } from '../contract/prisma.js'
import { integer, text } from '../fields/index.js'
import { getContext } from '../context/index.js'
import { originTripwire } from '../origin.js'
import type { StackContext } from '../types/context.js'
import type { AccessControlledDB } from '../access/types.js'
import { createTestDatabase, ormClientFor, type TestDatabase } from '../testing/context.js'
import { ESCAPE_VARIABLE, readDatabaseEscape } from '../testing/escape.js'

/**
 * The #614 capacity gate: N concurrent racers against a capacity-N slot admit
 * exactly N.
 *
 * This is the guarantee ADR-0042 handed to the row lock when it deleted
 * `isolationLevel`, and ADR-0047 is the shape it takes now — every racer takes
 * the same lock on the contended parent row before counting its children, so
 * the count cannot go stale under a concurrent booking. #1154 deleted the
 * suite that protected it, because that suite drove an API that no longer
 * exists; this one restores the guarantee against a real database.
 *
 * It is escape-only. PGlite serialises every transaction, so the barrier below
 * — which does not release until every racer's transaction is open — would
 * never release there.
 *
 * The racers are genuinely concurrent, not sequential calls dressed up as
 * concurrency, and the barrier is what makes that a structural fact rather
 * than a hope: `arrive()` resolves only once all `RACERS` transactions have
 * reached it, so a run in which any two racers did not overlap does not pass
 * with the wrong answer — it hangs and fails on the timeout.
 *
 * The gate reads BOTH of its sides after the lock. The locked row carries its
 * columns as of before the lock — the terminal reads first and locks second,
 * and each statement takes its own snapshot — so a threshold taken off it can
 * be stale. The last test here holds the window open and proves the two values
 * differ.
 */

const BOOT = 120_000
const CAPACITY = 2
const RACERS = 5

const config: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    Slot: {
      fields: { name: text(), capacity: integer() },
      access: { operation: { query: () => true, create: () => true } },
    },
    // The booking's slot is a plain column rather than a relationship: the
    // gate is about the lock and the count, and a relation write is a
    // different spec's surface.
    Booking: {
      fields: { slotId: text(), holder: text() },
      access: { operation: { query: () => true, create: () => true } },
    },
  },
}

/** A latch that releases only once `count` callers are waiting on it. */
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

/** One racer's own client, pool and secured context — a connection of its own. */
interface Racer {
  readonly context: StackContext<AccessControlledDB>
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

const escape = readDatabaseEscape()

describe.skipIf(escape.kind !== 'postgres')(
  escape.kind === 'postgres'
    ? 'the #614 capacity gate under contention'
    : `the #614 capacity gate under contention [escape-only: ${ESCAPE_VARIABLE} names no Postgres]`,
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

    async function slot(): Promise<string> {
      const created = await database.context(null).db.Slot.create({
        data: { name: 'matinee', capacity: CAPACITY },
      })
      return String(created?.id)
    }

    async function booked(slotId: string): Promise<number> {
      const { taken } = await database
        .context(null)
        .db.Booking.where({ slotId: { equals: slotId } })
        .aggregate((aggregate) => ({ taken: aggregate.count() }))
      return taken
    }

    test(
      'five racers against a capacity-two slot admit exactly two',
      async () => {
        const slotId = await slot()
        const arrive = barrier(RACERS)

        const outcomes = await Promise.all(
          racers.map((each, index) =>
            each.context.transaction(async (tx) => {
              // Every racer's transaction is open before any of them locks, so
              // the contention below is real. If it were not, this never
              // releases.
              await arrive()

              // The lock comes BEFORE both sides of the gate. Every racer takes
              // the same token on the same parent row, so neither read can go
              // stale under a booking committed by a racer that got there
              // first.
              const held = await tx.db.Slot.where({ id: { equals: slotId } })
                .forUpdate()
                .first()
              if (held === null) return false

              // The threshold is re-read in its own statement after the lock,
              // for the reason the count is: `held`'s columns are the row as
              // of before the lock. The suite below proves the difference.
              const parent = await tx.db.Slot.where({ id: { equals: slotId } }).first()
              const { taken } = await tx.db.Booking.where({
                slotId: { equals: slotId },
              }).aggregate((aggregate) => ({ taken: aggregate.count() }))
              if (parent === null || taken >= Number(parent.capacity)) return false

              await tx.db.Booking.create({ data: { slotId, holder: `racer-${index}` } })
              return true
            }),
          ),
        )

        expect(outcomes.filter(Boolean)).toHaveLength(CAPACITY)
        expect(await booked(slotId)).toBe(CAPACITY)
      },
      BOOT,
    )

    test(
      'the same gate without the lock over-admits, which is what the lock is for',
      async () => {
        const slotId = await slot()
        // Placed AFTER the count rather than before it: every racer reads zero
        // before any of them inserts, which is the stale read the lock exists
        // to close.
        const arrive = barrier(RACERS)

        const outcomes = await Promise.all(
          racers.map((each, index) =>
            each.context.transaction(async (tx) => {
              const { taken } = await tx.db.Booking.where({
                slotId: { equals: slotId },
              }).aggregate((aggregate) => ({ taken: aggregate.count() }))
              await arrive()
              if (taken >= CAPACITY) return false
              await tx.db.Booking.create({ data: { slotId, holder: `racer-${index}` } })
              return true
            }),
          ),
        )

        expect(outcomes.filter(Boolean)).toHaveLength(RACERS)
        expect(await booked(slotId)).toBe(RACERS)
      },
      BOOT,
    )

    test(
      'the gate compares against the threshold read after the lock, not the one on the locked row',
      async () => {
        const slotId = await slot()

        // The window is opened deterministically rather than raced for: the
        // blocker holds the slot's row lock, so the gate's scoped read (which
        // nothing blocks) succeeds and its lock statement then waits. The
        // capacity change commits while it waits, so the two statements
        // straddle it — which is exactly the interval the locked row's own
        // columns predate.
        const blocker = new pg.Client({ connectionString: database.url })
        await blocker.connect()
        try {
          await blocker.query('begin')
          await blocker.query('select id from "Slot" where id = $1 for update', [slotId])

          const running = racers[0].context.transaction(
            async (tx): Promise<{ admitted: boolean; onLockedRow: number; afterLock: number }> => {
              const held = await tx.db.Slot.where({ id: { equals: slotId } })
                .forUpdate()
                .first()
              if (held === null) throw new Error('the slot was readable, so the lock has a gate')

              const parent = await tx.db.Slot.where({ id: { equals: slotId } }).first()
              if (parent === null) throw new Error('the lock is held, so the row cannot be gone')

              const { taken } = await tx.db.Booking.where({
                slotId: { equals: slotId },
              }).aggregate((aggregate) => ({ taken: aggregate.count() }))

              const onLockedRow = Number(held.capacity)
              const afterLock = Number(parent.capacity)
              if (taken >= afterLock) return { admitted: false, onLockedRow, afterLock }

              await tx.db.Booking.create({ data: { slotId, holder: 'late' } })
              return { admitted: true, onLockedRow, afterLock }
            },
          )
          await new Promise((resolve) => setTimeout(resolve, 750))

          await blocker.query('update "Slot" set capacity = 0 where id = $1', [slotId])
          await blocker.query('commit')

          const outcome = await running

          // The two values the gate could have compared against, and they
          // differ: the locked row still carries the capacity from before the
          // lock was granted, the database carries the committed one.
          expect(outcome.onLockedRow).toBe(CAPACITY)
          expect(outcome.afterLock).toBe(0)
          expect(outcome.admitted).toBe(false)
          expect(await booked(slotId)).toBe(0)
        } finally {
          await blocker.end()
        }
      },
      BOOT,
    )
  },
)
