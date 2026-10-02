import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import postgres from '@prisma/orm-postgres/runtime'
import type { OpenSaasConfig } from '../config/types.js'
import type { PrismaContract } from '../contract/prisma.js'
import { integer, text } from '../fields/index.js'
import { getContext } from '../context/index.js'
import { originTripwire } from '../origin.js'
import { createTestDatabase, ormClientFor, type TestDatabase } from '../testing/context.js'
import { ESCAPE_VARIABLES, readDatabaseEscape } from '../testing/escape.js'

const BOOT = 120_000
const observed: number[] = []

const config: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    Bill: {
      fields: { name: text(), total: integer() },
      access: { operation: { query: () => true, create: () => true } },
    },
    BillItem: {
      fields: { billId: text(), amount: integer() },
      access: { operation: { query: () => true, create: () => true } },
      hooks: {
        resolveInput: async ({ context, resolvedData }) => {
          await context.db.Bill.forUpdate().all()
          const { count } = await context.db.BillItem.aggregate((aggregate) => ({
            count: aggregate.count(),
          }))
          observed.push(count)
          await new Promise((resolve) => setTimeout(resolve, 300))
          return resolvedData
        },
      },
    },
  },
}

const escape = readDatabaseEscape()

describe.skipIf(escape.kind !== 'postgres')(
  escape.kind === 'postgres'
    ? 'root writes whose hooks lock the same row'
    : `root writes whose hooks lock the same row [escape-only: ${ESCAPE_VARIABLES.join('/')} names no Postgres]`,
  () => {
    let database: TestDatabase
    const closers: Array<() => Promise<void>> = []

    beforeAll(async () => {
      database = await createTestDatabase(config)
    }, BOOT)

    afterAll(async () => {
      await Promise.all(closers.map((close) => close()))
      await database?.close()
    })

    beforeEach(async () => {
      await database.truncate()
      observed.length = 0
      await database.context(null).db.Bill.create({ data: { name: 'b', total: 0 } })
    })

    function racer(): ReturnType<TestDatabase['context']> {
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

    test(
      'two concurrent root writes serialise, the second seeing the first’s commit',
      async () => {
        const first = racer()
        const second = racer()

        const results = await Promise.all([
          first.db.BillItem.create({ data: { billId: 'x', amount: 1 } }),
          second.db.BillItem.create({ data: { billId: 'x', amount: 2 } }),
        ])

        expect(results.every((row) => row !== null)).toBe(true)
        expect([...observed].sort()).toEqual([0, 1])
      },
      BOOT,
    )
  },
)
