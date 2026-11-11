import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import postgres from '@prisma/orm-postgres/runtime'
import type { AccessControlledDB } from '../access/types.js'
import type { OpenSaasConfig } from '../config/types.js'
import type { PrismaContract } from '../contract/prisma.js'
import { text } from '../fields/index.js'
import { originTripwire } from '../origin.js'
import { createTestDatabase, ormClientFor, type TestDatabase } from '../testing/context.js'
import { ESCAPE_VARIABLES, readDatabaseEscape } from '../testing/escape.js'
import type { StackContext } from '../types/context.js'
import { getContext } from './index.js'

/**
 * Two concurrent dispatches of a one-shot Row action run its handler once.
 *
 * Escape-only for the reason `secured/capacity-gate.test.ts` gives: PGlite
 * serialises every transaction, so the barrier would never release there. The
 * barrier sits in the list's `query` rule, which the lock's own scoped read
 * evaluates, so both dispatches have read the row before either takes the lock.
 */

const BOOT = 120_000
const RACERS = 2

let arrive: (() => Promise<void>) | null = null
let handlerRuns = 0

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Invoice: {
      fields: { number: text(), sentAt: text() },
      access: {
        operation: {
          query: async () => {
            if (arrive) await arrive()
            return true
          },
          create: () => true,
          update: () => true,
          delete: () => true,
        },
      },
      ui: {
        listView: {
          rowActions: [
            {
              key: 'send',
              label: 'Send invoice',
              isAvailable: ({ item }) => item.sentAt === null,
              handler: async ({ id, context }) => {
                handlerRuns += 1
                await context.db.Invoice.update({
                  where: { id },
                  data: { sentAt: new Date().toISOString() },
                })
                await new Promise((resolve) => setTimeout(resolve, 200))
                return { message: 'Sent' }
              },
            },
          ],
        },
      },
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
    ? 'a one-shot Row action under concurrent dispatch'
    : `a one-shot Row action under concurrent dispatch [escape-only: ${ESCAPE_VARIABLES.join('/')} names no Postgres]`,
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
      arrive = null
      handlerRuns = 0
      await database.truncate()
    })

    test(
      'exactly one handler runs and the other dispatch is not run',
      async () => {
        const invoice = await database
          .context(null)
          .db.Invoice.create({ data: { number: 'INV-1', sentAt: null } })
        if (invoice === null) throw new Error('invoice not created')
        const id = String(invoice.id)

        arrive = barrier(RACERS)
        const outcomes = await Promise.all(
          racers.map((each) =>
            each.context.serverAction({ listKey: 'Invoice', action: 'rowAction', key: 'send', id }),
          ),
        )
        arrive = null

        expect(handlerRuns).toBe(1)
        expect(outcomes).toEqual(
          expect.arrayContaining([
            { rowAction: true, message: 'Sent' },
            { rowAction: false, error: 'This action was not run' },
          ]),
        )
      },
      BOOT,
    )
  },
)
