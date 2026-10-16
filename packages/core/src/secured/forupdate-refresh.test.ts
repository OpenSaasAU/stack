import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import postgres from '@prisma/orm-postgres/runtime'
import type { OpenSaasConfig } from '../config/types.js'
import type { PrismaContract } from '../contract/prisma.js'
import { integer, relationship, text } from '../fields/index.js'
import { getContext } from '../context/index.js'
import { originTripwire } from '../origin.js'
import type { StackContext } from '../types/context.js'
import type { AccessControlledDB } from '../access/types.js'
import { createTestDatabase, ormClientFor, type TestDatabase } from '../testing/context.js'
import { ESCAPE_VARIABLES, readDatabaseEscape } from '../testing/escape.js'

const BOOT = 120_000

const config: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    Folder: {
      fields: { name: text(), docs: relationship({ ref: 'Doc.folder', many: true }) },
      access: { operation: { query: () => true, create: () => true } },
    },
    Doc: {
      fields: {
        ownerId: text(),
        balance: integer(),
        note: text(),
        folder: relationship({ ref: 'Folder.docs' }),
      },
      access: {
        operation: {
          query: ({ session }) =>
            session === null ? false : { ownerId: { equals: String(session.userId) } },
          create: () => true,
        },
      },
    },
  },
}

const escape = readDatabaseEscape()

describe.skipIf(escape.kind !== 'postgres')(
  escape.kind === 'postgres'
    ? 'forUpdate re-reads the locked rows under the Access Filter'
    : `forUpdate re-reads the locked rows [escape-only: ${ESCAPE_VARIABLES.join('/')} names no Postgres]`,
  () => {
    let database: TestDatabase
    let pool: pg.Pool
    let alice: StackContext<AccessControlledDB>
    let closeClient: () => Promise<void>

    beforeAll(async () => {
      database = await createTestDatabase(config)
      pool = new pg.Pool({
        connectionString: database.url,
        max: 2,
        connectionTimeoutMillis: 20_000,
      })
      const client = postgres<PrismaContract>({
        contract: database.contract,
        pg: pool,
        verifyMarker: false,
        middleware: [originTripwire],
      })
      const orm = ormClientFor(database.data, client.orm)
      alice = getContext(
        config,
        orm,
        { userId: 'alice' },
        undefined,
        false,
        undefined,
        undefined,
        client,
      )
      closeClient = () => client.close()
    }, BOOT)

    afterAll(async () => {
      await closeClient?.()
      await database?.close()
    })

    beforeEach(async () => {
      await database.truncate()
    })

    async function seed(ownerId: string, balance: number, note = 'n'): Promise<string> {
      const row = await database.context(null).sudo().db.Doc.create({
        data: { ownerId, balance, note },
      })
      return String(row?.id)
    }

    async function whileLockWaits<T>(
      ids: string[],
      change: (blocker: pg.Client) => Promise<void>,
      run: (tx: StackContext<AccessControlledDB>) => Promise<T>,
    ): Promise<T> {
      const blocker = new pg.Client({ connectionString: database.url })
      await blocker.connect()
      try {
        await blocker.query('begin')
        await blocker.query('select id from "Doc" where id = any($1) for update', [ids])
        const running = alice.transaction(run)
        await new Promise((resolve) => setTimeout(resolve, 750))
        await change(blocker)
        await blocker.query('commit')
        return await running
      } finally {
        await blocker.end()
      }
    }

    test(
      'first() returns null once the row changed owner',
      async () => {
        const id = await seed('alice', 10)
        const result = await whileLockWaits(
          [id],
          async (b) => {
            await b.query(`update "Doc" set "ownerId" = 'bob', balance = 20 where id = $1`, [id])
          },
          (tx) =>
            tx.db.Doc.where({ id: { equals: id } })
              .forUpdate()
              .first(),
        )
        expect(result).toBeNull()
      },
      BOOT,
    )

    test(
      'first() returns the current values of a row still in scope',
      async () => {
        const id = await seed('alice', 10)
        const result = await whileLockWaits(
          [id],
          async (b) => {
            await b.query('update "Doc" set balance = 20 where id = $1', [id])
          },
          (tx) =>
            tx.db.Doc.where({ id: { equals: id } })
              .forUpdate()
              .first(),
        )
        expect(result?.balance).toBe(20)
      },
      BOOT,
    )

    test(
      'all() keeps the rows still in scope at their current values and drops the rest',
      async () => {
        const kept = await seed('alice', 1)
        const revoked = await seed('alice', 2)
        const gone = await seed('alice', 3)
        const result = await whileLockWaits(
          [kept, revoked, gone],
          async (b) => {
            await b.query('update "Doc" set balance = 100 where id = $1', [kept])
            await b.query(`update "Doc" set "ownerId" = 'bob' where id = $1`, [revoked])
            await b.query('delete from "Doc" where id = $1', [gone])
          },
          (tx) =>
            tx.db.Doc.where({ ownerId: { equals: 'alice' } })
              .forUpdate()
              .all(),
        )
        expect(result.map((row) => [row.id, row.balance])).toEqual([[kept, 100]])
      },
      BOOT,
    )

    test(
      'a row that entered scope while the lock waited is not returned',
      async () => {
        const mine = await seed('alice', 1)
        const bobs = await seed('bob', 2)
        const result = await whileLockWaits(
          [mine, bobs],
          async (b) => {
            await b.query(`update "Doc" set "ownerId" = 'alice' where id = $1`, [bobs])
          },
          (tx) => tx.db.Doc.forUpdate().all(),
        )
        expect(result.map((row) => row.id)).toEqual([mine])
      },
      BOOT,
    )

    test(
      'selection is exact after the refresh',
      async () => {
        const id = await seed('alice', 10, 'secret')
        const result = await whileLockWaits(
          [id],
          async (b) => {
            await b.query('update "Doc" set balance = 20 where id = $1', [id])
          },
          (tx) =>
            tx.db.Doc.where({ id: { equals: id } })
              .select('balance')
              .forUpdate()
              .first(),
        )
        expect(result).toEqual(expect.objectContaining({ balance: 20 }))
        expect(result).not.toHaveProperty('note')
        expect(result).not.toHaveProperty('ownerId')
      },
      BOOT,
    )

    test(
      'includes are read fresh after the lock',
      async () => {
        const folder = await database
          .context(null)
          .sudo()
          .db.Folder.create({ data: { name: 'before' } })
        const folderId = String(folder?.id)
        const id = await seed('alice', 10)
        await pool.query('update "Doc" set "folderId" = $2 where id = $1', [id, folderId])
        const result = await whileLockWaits(
          [id],
          async (b) => {
            await b.query(`update "Folder" set name = 'after' where id = $1`, [folderId])
          },
          (tx) =>
            tx.db.Doc.where({ id: { equals: id } })
              .include('folder')
              .forUpdate()
              .first(),
        )
        expect(result?.folder).toEqual(expect.objectContaining({ name: 'after' }))
      },
      BOOT,
    )
  },
)
