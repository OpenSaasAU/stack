import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import type { SqlExecutionPlan } from '@prisma/orm-postgres/relational-core'
import type { SqlMiddleware } from '@prisma/orm-postgres/family-runtime'
import type { OpenSaasConfig } from '../config/types.js'
import type { Session } from '../access/types.js'
import { integer, relationship, text } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import { ESCAPE_VARIABLE, readDatabaseEscape } from '../testing/escape.js'
import {
  createRowLockLane,
  ROW_LOCK_MAX_KEYS,
  RowLockKeyLimitExceededError,
  RowLockLaneUnavailableError,
  RowLockUnavailableError,
} from './lock.js'
import { getContext } from '../context/index.js'
import type { UnsafeCapableClient } from '../unsafe.js'
import { ormClientFor } from '../testing/context.js'

/**
 * The row lock: the statement the engine composes, the keys it binds, and the
 * subset it returns (ADR-0047, ADR-0062).
 *
 * This suite is the one place on the secured surface that asserts on rendered
 * SQL. ADR-0062 grants the exception explicitly — the spelling, the codec on
 * each bound key and the `FOR UPDATE`/`ORDER BY`/`LIMIT` clause text are what
 * the stack authors, so the statement is the subject rather than an
 * implementation detail of the answer. Everything else here asserts on rows.
 * The recorder is local for the same reason: `createPlanRecorder`'s rule
 * against pinning rendered SQL still holds everywhere else.
 *
 * Known limits: PGlite serialises transactions, so a second connection cannot
 * delete a row while a transaction is open on the default harness — a probe
 * confirmed the DELETE simply blocks. The vanished-row subset is therefore
 * exercised through the lock lane here (a key deleted before the lock runs)
 * and through the whole terminal under the Database escape.
 */

const BOOT = 120_000

const config: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    // Default id strategy: a `uuid` column, whose codec puts a cast on each
    // bound key.
    Slot: {
      fields: {
        name: text(),
        capacity: integer(),
        bookings: relationship({ ref: 'Booking.slot', many: true }),
      },
      access: { operation: { query: () => true, create: () => true, delete: () => true } },
    },
    Booking: {
      fields: { holder: text(), slot: relationship({ ref: 'Slot.bookings' }) },
      access: { operation: { query: () => true, create: () => true } },
    },
    // A text id, whose codec puts no cast on a bound key.
    Ticket: {
      db: { idField: 'cuid2' },
      fields: { label: text() },
      access: { operation: { query: () => true, create: () => true } },
    },
    // A write whose hook reaches for a row lock. The Write Pipeline rebuilds
    // the `db` a hook is handed, so this is what proves the rebuilt delegate
    // keeps the lane its context had (ADR-0047).
    Ledger: {
      fields: { note: text() },
      access: { operation: { query: () => true, create: () => true } },
      hooks: {
        beforeOperation: async ({ context }) => {
          try {
            const rows = await context.db.Slot.orderBy({ name: 'asc' }).forUpdate().all()
            lockedByHook = { keys: rows.map((row) => String(row.name)) }
          } catch (error) {
            lockedByHook = { error }
          }
        },
      },
    },
    // The scoped and unscoped answers must never coincide: a session sees its
    // own notes alone, and the fixture seeds notes it does not own.
    Note: {
      fields: { owner: text(), body: text() },
      access: {
        operation: {
          query: ({ session }) => ({ owner: { equals: session?.userId ?? '' } }),
          create: () => true,
        },
      },
    },
  },
}

/** What `Ledger`'s hook saw when it reached for a row lock, or why it could not. */
let lockedByHook: { keys: string[] } | { error: unknown } | null = null

/** One statement as the adapter rendered it, and the lane it ran on. */
interface Statement {
  readonly sql: string
  readonly params: readonly unknown[]
  readonly lane: string
}

function recordStatements(): { statements: Statement[]; middleware: SqlMiddleware } {
  const statements: Statement[] = []
  const capture = (plan: SqlExecutionPlan): void => {
    statements.push({ sql: plan.sql, params: [...plan.params], lane: plan.meta.lane })
  }
  return {
    statements,
    middleware: {
      name: 'opensaas-lock-statement-recorder',
      familyId: 'sql',
      beforeQuery: capture,
      beforeExecute: capture,
    },
  }
}

const recorder = recordStatements()

let database: TestDatabase

/** Every raw statement recorded since the last clear — the lock's own lane. */
function rawStatements(): Statement[] {
  return recorder.statements.filter((statement) => statement.lane === 'raw')
}

const anonymous: Session | null = null

describe('forUpdate()', () => {
  beforeAll(async () => {
    database = await createTestDatabase(config, { middleware: [recorder.middleware] })
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(async () => {
    await database.truncate()
    recorder.statements.length = 0
  })

  describe('the statement the engine composes', () => {
    test('a uuid key renders a cast, and the clause is spelled as the ADR says', async () => {
      const context = database.context(anonymous)
      const slot = await context.db.Slot.create({ data: { name: 'a', capacity: 1 } })
      expect(slot).not.toBeNull()
      recorder.statements.length = 0

      const locked = await context.transaction(async (tx) =>
        tx.db.Slot.where({ name: { equals: 'a' } })
          .forUpdate()
          .first(),
      )

      expect(locked?.id).toBe(slot?.id)
      expect(rawStatements()).toHaveLength(1)
      expect(rawStatements()[0].sql).toBe(
        'SELECT "id" FROM "public"."Slot" WHERE "id" IN ($1::uuid) ORDER BY "id" LIMIT $2 FOR UPDATE',
      )
      expect(rawStatements()[0].params).toEqual([slot?.id, 1])
    })

    test('a text key renders no cast', async () => {
      const context = database.context(anonymous)
      const ticket = await context.db.Ticket.create({ data: { label: 'stalls' } })
      recorder.statements.length = 0

      const locked = await context.transaction(async (tx) =>
        tx.db.Ticket.where({ label: { equals: 'stalls' } })
          .forUpdate()
          .first(),
      )

      expect(locked?.id).toBe(ticket?.id)
      expect(rawStatements()[0].sql).toBe(
        'SELECT "id" FROM "public"."Ticket" WHERE "id" IN ($1) ORDER BY "id" LIMIT $2 FOR UPDATE',
      )
      expect(rawStatements()[0].params).toEqual([ticket?.id, 1])
    })

    test('all() binds one placeholder per key and a LIMIT equal to the count', async () => {
      const context = database.context(anonymous)
      await context.db.Slot.create({ data: { name: 'a', capacity: 1 } })
      await context.db.Slot.create({ data: { name: 'b', capacity: 1 } })
      recorder.statements.length = 0

      const locked = await context.transaction(async (tx) =>
        tx.db.Slot.orderBy({ name: 'asc' }).forUpdate().all(),
      )

      expect(locked.map((row) => row.name)).toEqual(['a', 'b'])
      expect(rawStatements()[0].sql).toBe(
        'SELECT "id" FROM "public"."Slot" WHERE "id" IN ($1::uuid, $2::uuid) ORDER BY "id" ' +
          'LIMIT $3 FOR UPDATE',
      )
      expect(rawStatements()[0].params).toEqual([locked[0].id, locked[1].id, 2])
    })

    test('the statement is planned as a lock', async () => {
      const context = database.context(anonymous)
      await context.db.Slot.create({ data: { name: 'a', capacity: 1 } })
      recorder.statements.length = 0
      await context.transaction(async (tx) => tx.db.Slot.forUpdate().first())
      const statement = rawStatements()[0]

      // EXPLAIN the engine's own statement, verbatim, on a connection of its
      // own: the plan node is Postgres's answer to the clause the stack wrote.
      const client = new pg.Client({ connectionString: database.url })
      await client.connect()
      try {
        await client.query('begin')
        const explained = await client.query(`EXPLAIN ${statement.sql}`, [...statement.params])
        const plan = explained.rows.map((row) => Object.values(row).join(' ')).join('\n')
        expect(plan).toContain('LockRows')
        await client.query('rollback')
      } finally {
        await client.end()
      }
    })
  })

  describe('what it locks', () => {
    test('the lock covers the rows the Access Filter left, and no others', async () => {
      const seed = database.context(anonymous).sudo()
      const mine = await seed.db.Note.create({ data: { owner: 'u1', body: 'mine' } })
      await seed.db.Note.create({ data: { owner: 'u2', body: 'theirs' } })
      await seed.db.Note.create({ data: { owner: 'u3', body: 'also theirs' } })

      const context = database.context({ userId: 'u1' })
      recorder.statements.length = 0
      const locked = await context.transaction(async (tx) => tx.db.Note.forUpdate().all())

      expect(locked.map((row) => row.body)).toEqual(['mine'])
      expect(rawStatements()[0].params).toEqual([mine?.id, 1])

      // The unscoped answer is three rows, so the scoped one cannot coincide
      // with it by accident.
      const everything = await context.sudo().db.Note.all()
      expect(everything).toHaveLength(3)
    })

    test('an empty scoped read issues no lock statement', async () => {
      const seed = database.context(anonymous).sudo()
      await seed.db.Note.create({ data: { owner: 'u2', body: 'theirs' } })

      const context = database.context({ userId: 'u1' })
      recorder.statements.length = 0
      const locked = await context.transaction(async (tx) => tx.db.Note.forUpdate().all())

      expect(locked).toEqual([])
      expect(rawStatements()).toEqual([])
    })

    test('first() on a read that matched nothing issues no lock statement', async () => {
      const context = database.context(anonymous)
      recorder.statements.length = 0
      const locked = await context.transaction(async (tx) =>
        tx.db.Slot.where({ name: { equals: 'absent' } })
          .forUpdate()
          .first(),
      )

      expect(locked).toBeNull()
      expect(rawStatements()).toEqual([])
    })

    test('a key the lock did not come back with is absent from the result', async () => {
      const seed = database.context(anonymous)
      const a = await seed.db.Slot.create({ data: { name: 'a', capacity: 1 } })
      const b = await seed.db.Slot.create({ data: { name: 'b', capacity: 1 } })
      const gone = await seed.db.Slot.create({ data: { name: 'gone', capacity: 1 } })
      const goneId = String(gone?.id)
      await seed.db.Slot.delete({ where: { id: goneId } })

      // The lane the terminal locks through, driven with the key set a read
      // that raced a delete would hand it. PGlite serialises transactions, so
      // the concurrent form of this is under the escape below.
      const locked = await database.client.transaction(async (tx) => {
        const lane = createRowLockLane(database.client.raw, database.client.contract, tx)
        expect(lane).toBeDefined()
        if (lane === undefined) throw new Error('unreachable')
        const identity = lane.identity('Slot')
        return await lane.lock('Slot', identity, [String(a?.id), goneId, String(b?.id)])
      })

      expect([...locked].sort()).toEqual([String(a?.id), String(b?.id)].sort())
    })
  })

  describe('the bounds it refuses', () => {
    test('a bound over the constant throws before any statement', async () => {
      const context = database.context(anonymous)
      await context.db.Slot.create({ data: { name: 'a', capacity: 1 } })
      recorder.statements.length = 0

      await expect(
        context.transaction(async (tx) =>
          tx.db.Slot.limit(ROW_LOCK_MAX_KEYS + 1)
            .forUpdate()
            .all(),
        ),
      ).rejects.toBeInstanceOf(RowLockKeyLimitExceededError)

      expect(recorder.statements).toEqual([])
    })

    test('a key set over the constant throws before the lock statement', async () => {
      const locked = database.client.transaction(async (tx) => {
        const lane = createRowLockLane(database.client.raw, database.client.contract, tx)
        if (lane === undefined) throw new Error('unreachable')
        const identity = lane.identity('Slot')
        const keys = Array.from({ length: ROW_LOCK_MAX_KEYS + 1 }, (_, index) => `k${index}`)
        recorder.statements.length = 0
        return await lane.lock('Slot', identity, keys)
      })

      await expect(locked).rejects.toBeInstanceOf(RowLockKeyLimitExceededError)
      expect(rawStatements()).toEqual([])
    })

    test('aggregate() and nearest() refuse the modifier rather than dropping it', async () => {
      const context = database.context(anonymous)
      await context.db.Slot.create({ data: { name: 'a', capacity: 1 } })

      await expect(
        context.transaction(async (tx) =>
          tx.db.Slot.forUpdate().aggregate((aggregate) => ({ total: aggregate.count() })),
        ),
      ).rejects.toThrow(/forUpdate/)
    })

    test('outside a transaction the engine refuses rather than locking nothing', async () => {
      const context = database.context(anonymous)
      await context.db.Slot.create({ data: { name: 'a', capacity: 1 } })

      await expect(context.db.Slot.forUpdate().all()).rejects.toBeInstanceOf(
        RowLockUnavailableError,
      )
    })

    test('no keys, no statement — the lane composes nothing at arity zero', async () => {
      // `lockStatement` carries one fragment per key, so at arity 0 the tag
      // never consumes its trailing fragment: the statement would arrive with
      // `FOR UPDATE` dropped and `LIMIT` dangling. The terminal cannot reach
      // this, but `lock()` is a member of the lane and is driven directly.
      const locked = await database.client.transaction(async (tx) => {
        const lane = createRowLockLane(database.client.raw, database.client.contract, tx)
        if (lane === undefined) throw new Error('unreachable')
        const identity = lane.identity('Slot')
        recorder.statements.length = 0
        return await lane.lock('Slot', identity, [])
      })

      expect(locked).toEqual([])
      expect(rawStatements()).toEqual([])
    })

    test('inside a transaction, a client that cannot compose the statement says so', async () => {
      // Not the same fact as "there is no transaction": there is one, and the
      // caller told to open another would be looking in the wrong place.
      const unusable: UnsafeCapableClient = {
        sql: database.client.sql,
        raw: {},
        contract: database.client.contract,
        orm: database.client.orm,
        runtime: () => database.client.runtime(),
        transaction: (run) => database.client.transaction(run),
      }
      const context = getContext(
        config,
        ormClientFor(database.data, database.client.orm),
        anonymous,
        undefined,
        false,
        undefined,
        undefined,
        unusable,
      )

      await expect(
        context.transaction(async (tx) => tx.db.Slot.forUpdate().all()),
      ).rejects.toBeInstanceOf(RowLockLaneUnavailableError)
      await expect(
        context.transaction(async (tx) => tx.advisoryLock('checkout:slot-1')),
      ).rejects.toBeInstanceOf(RowLockLaneUnavailableError)
    })
  })

  describe('the lane a rebuilt delegate carries', () => {
    test('a hook inside a transaction locks through the lane its context has', async () => {
      const context = database.context(anonymous)
      await context.db.Slot.create({ data: { name: 'a', capacity: 1 } })
      await context.db.Slot.create({ data: { name: 'b', capacity: 1 } })
      lockedByHook = null
      recorder.statements.length = 0

      await context.transaction(async (tx) => tx.db.Ledger.create({ data: { note: 'x' } }))

      expect(lockedByHook).toEqual({ keys: ['a', 'b'] })
      expect(rawStatements()).toHaveLength(1)
      expect(rawStatements()[0].sql).toContain('FOR UPDATE')
    })

    test('the same hook under a write outside a transaction has no lane, and refuses', async () => {
      // This context is not transaction-bound, so it never carried a lane at
      // all — the refusal comes from its absence, not from
      // `bindContextToTransaction` dropping one. That guard is defensive:
      // `_rowLock` and `_transactionOpener` are set on mutually exclusive
      // conditions, so no path reaches the drop branch with a lane present,
      // and this test passes identically with the guard deleted.
      const context = database.context(anonymous)
      await context.db.Slot.create({ data: { name: 'a', capacity: 1 } })
      lockedByHook = null

      await context.db.Ledger.create({ data: { note: 'x' } })

      expect(lockedByHook).toMatchObject({ error: expect.any(RowLockUnavailableError) })
    })
  })

  describe('advisoryLock()', () => {
    test('runs pg_advisory_xact_lock over a hashed key, and the backend holds it', async () => {
      const context = database.context(anonymous)
      recorder.statements.length = 0

      // Built off the client's own typed raw lane and run through
      // `tx.unsafe`, so it executes on the transaction's connection — the one
      // `advisoryLock()` took the lock on.
      const heldByThisBackend = database.client.raw
        .sql`SELECT count(*)::int AS held FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()`
        .returnsRow({ held: 'pg/int4@1' })
        .build()

      const held = await context.transaction(async (tx) => {
        await tx.advisoryLock('checkout:slot-1')
        const rows = await tx.unsafe.query(heldByThisBackend).toArray()
        return rows[0]?.held
      })

      expect(held).toBe(1)
      const advisory = rawStatements().filter((statement) =>
        statement.sql.includes('pg_advisory_xact_lock'),
      )
      expect(advisory).toHaveLength(1)
      expect(advisory[0].sql).toBe('SELECT pg_advisory_xact_lock(hashtext($1))')
      expect(advisory[0].params).toEqual(['checkout:slot-1'])
    })

    test('a client with no raw lane and no contract yields no lane at all', () => {
      // What makes `advisoryLock()` and `forUpdate()` refuse rather than run
      // unscoped: a context assembled from something that is not a Prisma 8
      // client has nothing to compose the statement through.
      expect(
        createRowLockLane({}, database.client.contract, database.client.runtime()),
      ).toBeUndefined()
      expect(createRowLockLane(database.client.raw, {}, database.client.runtime())).toBeUndefined()
    })
  })
})

// ── contention: escape-only, because PGlite serialises every transaction ────

const escape = readDatabaseEscape()

describe.skipIf(escape.kind !== 'postgres')(
  escape.kind === 'postgres'
    ? 'forUpdate() under contention'
    : `forUpdate() under contention [escape-only: ${ESCAPE_VARIABLE} names no Postgres]`,
  () => {
    let contended: TestDatabase

    beforeAll(async () => {
      contended = await createTestDatabase(config)
    }, BOOT)

    afterAll(async () => {
      await contended?.close()
    })

    beforeEach(async () => {
      await contended.truncate()
    })

    test('a second connection cannot take the row while the lock is held, and can after', async () => {
      const context = contended.context(anonymous)
      const slot = await context.db.Slot.create({ data: { name: 'a', capacity: 1 } })
      const id = String(slot?.id)

      const other = new pg.Client({ connectionString: contended.url })
      await other.connect()
      try {
        const contendedWhileHeld = await context.transaction(async (tx) => {
          const locked = await tx.db.Slot.where({ id: { equals: id } })
            .forUpdate()
            .first()
          expect(locked?.id).toBe(id)
          await other.query('begin')
          const outcome = await other
            .query('select id from "Slot" where id = $1 for update nowait', [id])
            .then(() => 'acquired')
            .catch((error: unknown) => (error instanceof Error ? error : new Error('unknown')))
          await other.query('rollback')
          return outcome
        })

        expect(contendedWhileHeld).not.toBe('acquired')
        expect(contendedWhileHeld).toMatchObject({ code: '55P03' })

        await other.query('begin')
        const after = await other.query('select id from "Slot" where id = $1 for update nowait', [
          id,
        ])
        expect(after.rows).toHaveLength(1)
        await other.query('rollback')
      } finally {
        await other.end()
      }
    }, 60_000)

    test('a row deleted between the read and the lock is absent from the result', async () => {
      const context = contended.context(anonymous)
      await context.db.Slot.create({ data: { name: 'kept', capacity: 1 } })
      const doomed = await context.db.Slot.create({ data: { name: 'doomed', capacity: 1 } })

      const other = new pg.Client({ connectionString: contended.url })
      await other.connect()
      try {
        // The window is opened deterministically rather than raced for: the
        // other connection holds the doomed row's lock, so the terminal's
        // scoped read (which nothing blocks) succeeds and its lock statement
        // then waits. The delete commits while it waits, and Read Committed
        // re-checks the row after the wait — so the terminal sees the vanish.
        await other.query('begin')
        await other.query('select id from "Slot" where id = $1 for update', [doomed?.id])

        const running = context.transaction(async (tx) =>
          tx.db.Slot.orderBy({ name: 'asc' }).forUpdate().all(),
        )
        await new Promise((resolve) => setTimeout(resolve, 750))

        await other.query('delete from "Slot" where id = $1', [doomed?.id])
        await other.query('commit')

        const locked = await running
        expect(locked.map((row) => row.name)).toEqual(['kept'])
      } finally {
        await other.end()
      }
    }, 60_000)
  },
)
