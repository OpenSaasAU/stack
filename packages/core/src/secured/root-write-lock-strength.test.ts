import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import postgres from '@prisma/orm-postgres/runtime'
import type { OpenSaasConfig } from '../config/types.js'
import type { PrismaContract } from '../contract/prisma.js'
import { integer, relationship, text } from '../fields/index.js'
import { getContext } from '../context/index.js'
import { originTripwire } from '../origin.js'
import { createTestDatabase, ormClientFor, type TestDatabase } from '../testing/context.js'
import { ESCAPE_VARIABLES, readDatabaseEscape } from '../testing/escape.js'

// Root writes take the lock ADR-0078 records: an update stays out of a child
// INSERT's way and every other pairing still excludes. Escape-only: PGlite
// serialises transactions, so neither the deadlock nor a lock wait can occur.

const BOOT = 120_000
const CONTENTION = 30_000
const RACERS = 4
const NO_KEY_LOCK = /LIMIT \$\d+ FOR NO KEY UPDATE$/
const FULL_LOCK = /LIMIT \$\d+ FOR UPDATE$/

const OPEN = {
  query: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
}

let afterChildInsert: () => Promise<void> = async () => {}

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Thread: {
      fields: {
        name: text(),
        replyCount: integer({ defaultValue: 0 }),
        updates: integer({ defaultValue: 0 }),
        replies: relationship({ ref: 'Reply.thread', many: true }),
      },
      access: { operation: OPEN },
      hooks: {
        resolveInput: async ({ operation, item, resolvedData }) =>
          operation === 'update'
            ? { ...resolvedData, updates: Number(item?.updates) + 1 }
            : resolvedData,
      },
    },
    Reply: {
      fields: { body: text(), thread: relationship({ ref: 'Thread.replies' }) },
      access: { operation: OPEN },
      hooks: {
        afterOperation: async (args) => {
          if (args.operation !== 'create') return
          await afterChildInsert()
          const id = String(args.item.threadId)
          const thread = await args.context.db.Thread.where({ id: { equals: id } }).first()
          await args.context.db.Thread.update({
            where: { id },
            data: { replyCount: Number(thread?.replyCount) + 1 },
          })
        },
      },
    },
    Note: {
      fields: { body: text(), thread: relationship({ ref: 'Thread' }) },
      access: { operation: OPEN },
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

function failures(settled: readonly PromiseSettledResult<unknown>[]): string[] {
  return settled.flatMap((result) => {
    if (result.status === 'fulfilled') return []
    const { reason } = result
    return [reason instanceof Error ? `${reason.message}: ${String(reason.cause)}` : String(reason)]
  })
}

const escape = readDatabaseEscape()

describe.skipIf(escape.kind !== 'postgres')(
  escape.kind === 'postgres'
    ? 'the lock strength of a root write'
    : `the lock strength of a root write [escape-only: ${ESCAPE_VARIABLES.join('/')} names no Postgres]`,
  () => {
    type Context = ReturnType<TestDatabase['context']>
    type Transaction = Parameters<Parameters<Context['transaction']>[0]>[0]

    let database: TestDatabase
    let monitor: pg.Pool
    let threadId: string
    let closers: Array<() => Promise<void>> = []

    function racer(): Context {
      const pool = new pg.Pool({ connectionString: database.url, max: 2 })
      const client = postgres<PrismaContract>({
        contract: database.contract,
        pg: pool,
        verifyMarker: false,
        middleware: [originTripwire],
      })
      closers.push(() => client.close())
      const orm = ormClientFor(database.data, client.orm)
      return getContext(config, orm, null, undefined, false, undefined, undefined, client)
    }

    async function thread(): Promise<{ updates: number; replies: number }> {
      const context = database.context(null)
      const row = await context.db.Thread.where({ id: { equals: threadId } }).first()
      const { replies } = await context.db.Reply.aggregate((aggregate) => ({
        replies: aggregate.count(),
      }))
      return { updates: Number(row?.updates), replies: Number(replies) }
    }

    async function waitingStatement(): Promise<string | undefined> {
      const { rows } = await monitor.query<{ query: string }>(
        `SELECT query FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      )
      return rows[0]?.query
    }

    /** The statement `pending` parks on, or `'finished'` if it never needs to. */
    async function outcome(pending: Promise<unknown>): Promise<string> {
      let finished = false
      const finish = (): void => {
        finished = true
      }
      pending.then(finish, finish)
      while (!finished) {
        const statement = await waitingStatement()
        if (statement !== undefined) return statement
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      return 'finished'
    }

    /** Open a transaction on its own connection and sit on what `take` locked. */
    async function hold(
      take: (tx: Transaction) => Promise<unknown>,
    ): Promise<{ release(): Promise<void> }> {
      let open = (): void => {}
      const released = new Promise<void>((resolve) => {
        open = resolve
      })
      let acquired = (): void => {}
      const taken = new Promise<void>((resolve) => {
        acquired = resolve
      })
      const done = racer().transaction(async (tx) => {
        await take(tx)
        acquired()
        await released
      })
      await Promise.race([taken, done])
      return {
        release: async () => {
          open()
          await done
        },
      }
    }

    const rootUpdate = (context: Context | Transaction): Promise<unknown> =>
      context.db.Thread.update({ where: { id: threadId }, data: { name: 'updated' } })
    const rootDelete = (context: Context | Transaction): Promise<unknown> =>
      context.db.Thread.delete({ where: { id: threadId } })
    const forUpdate = (tx: Transaction): Promise<unknown> =>
      tx.db.Thread.where({ id: { equals: threadId } })
        .forUpdate()
        .first()

    beforeAll(async () => {
      database = await createTestDatabase(config)
      monitor = new pg.Pool({ connectionString: database.url, max: 1 })
    }, BOOT)

    afterAll(async () => {
      await monitor?.end()
      await database?.close()
    })

    beforeEach(async () => {
      await database.truncate()
      afterChildInsert = async () => {}
      const row = await database.context(null).db.Thread.create({ data: { name: 't' } })
      threadId = String(row?.id)
    })

    afterEach(async () => {
      await Promise.all(closers.map((close) => close()))
      closers = []
    })

    test(
      'racers that each insert a child and then update the parent all succeed',
      async () => {
        afterChildInsert = barrier(RACERS)
        const racers = Array.from({ length: RACERS }, racer)

        const settled = await Promise.allSettled(
          racers.map((context, index) =>
            context.db.Reply.create({
              data: { body: `${index}`, thread: { connect: { id: threadId } } },
            }),
          ),
        )

        expect(failures(settled)).toEqual([])
        expect(await thread()).toEqual({ updates: RACERS, replies: RACERS })
      },
      CONTENTION,
    )

    test(
      'the same shape written by the caller inside context.transaction',
      async () => {
        const arrive = barrier(RACERS)
        const racers = Array.from({ length: RACERS }, racer)

        const settled = await Promise.allSettled(
          racers.map((context, index) =>
            context.transaction(async (tx) => {
              await tx.db.Note.create({
                data: { body: `${index}`, thread: { connect: { id: threadId } } },
              })
              await arrive()
              await rootUpdate(tx)
            }),
          ),
        )

        expect(failures(settled)).toEqual([])
        expect((await thread()).updates).toBe(RACERS)
      },
      CONTENTION,
    )

    test(
      'concurrent root updates serialise, each seeing the last one’s commit in `item`',
      async () => {
        const racers = Array.from({ length: RACERS }, racer)

        const settled = await Promise.allSettled(racers.map(rootUpdate))

        expect(failures(settled)).toEqual([])
        expect((await thread()).updates).toBe(RACERS)
      },
      CONTENTION,
    )

    test(
      'a child insert does not wait for a root update',
      async () => {
        const holder = await hold(rootUpdate)
        try {
          const insert = racer().db.Note.create({
            data: { body: 'n', thread: { connect: { id: threadId } } },
          })

          expect(await outcome(insert)).toBe('finished')
          expect(await insert).not.toBeNull()
        } finally {
          await holder.release()
        }
      },
      CONTENTION,
    )

    // A contender's own UPDATE or DELETE would wait on the holder too, so each
    // case pins the lock statement it parks on, not merely that it waits.
    test.each([
      {
        held: 'a root update',
        take: rootUpdate,
        contender: 'a root update',
        run: rootUpdate,
        parksOn: NO_KEY_LOCK,
      },
      {
        held: 'a root update',
        take: rootUpdate,
        contender: 'a root delete',
        run: rootDelete,
        parksOn: FULL_LOCK,
      },
      {
        held: 'a root delete',
        take: rootDelete,
        contender: 'a root update',
        run: rootUpdate,
        parksOn: NO_KEY_LOCK,
      },
      {
        held: 'forUpdate()',
        take: forUpdate,
        contender: 'a root update',
        run: rootUpdate,
        parksOn: NO_KEY_LOCK,
      },
      {
        held: 'forUpdate()',
        take: forUpdate,
        contender: 'a root delete',
        run: rootDelete,
        parksOn: FULL_LOCK,
      },
    ])(
      '$held excludes $contender',
      async ({ take, run, parksOn }) => {
        const holder = await hold(take)
        let contending: Promise<unknown> = Promise.resolve()
        try {
          contending = run(racer())

          expect(await outcome(contending)).toMatch(parksOn)
        } finally {
          await holder.release()
        }
        await contending
      },
      CONTENTION,
    )

    test(
      'a root update excludes forUpdate()',
      async () => {
        const holder = await hold(rootUpdate)
        let contending: Promise<unknown> = Promise.resolve()
        try {
          contending = racer().transaction(forUpdate)

          expect(await outcome(contending)).toMatch(FULL_LOCK)
        } finally {
          await holder.release()
        }
        await contending
      },
      CONTENTION,
    )

    test(
      'a root update that waited on a root delete finds no row',
      async () => {
        const holder = await hold(rootDelete)
        const contending = rootUpdate(racer())

        expect(await outcome(contending)).toMatch(NO_KEY_LOCK)
        await holder.release()
        expect(await contending).toBeNull()
      },
      CONTENTION,
    )
  },
)
