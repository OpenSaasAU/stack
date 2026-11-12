import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import postgres from '@prisma/orm-postgres/runtime'
import type { OpenSaasConfig } from '../config/types.js'
import type { PrismaContract } from '../contract/prisma.js'
import { text } from '../fields/index.js'
import { getContext } from '../context/index.js'
import { originTripwire } from '../origin.js'
import { isSerializationFailure } from '../lib/database-errors.js'
import type { StackContext } from '../types/context.js'
import type { AccessControlledDB } from '../access/types.js'
import { createTestDatabase, ormClientFor, type TestDatabase } from '../testing/context.js'
import { ESCAPE_VARIABLES, readDatabaseEscape } from '../testing/escape.js'

const BOOT = 120_000

const config: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    Row: {
      fields: { name: text() },
      access: { operation: { query: () => true, create: () => true, update: () => true } },
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
    ? 'a deadlock victim is a SerializationFailure'
    : `a deadlock victim is a SerializationFailure [escape-only: ${ESCAPE_VARIABLES.join('/')} names no Postgres]`,
  () => {
    let database: TestDatabase
    let racers: Racer[]

    beforeAll(async () => {
      database = await createTestDatabase(config)
      racers = [racer(database), racer(database)]
    }, BOOT)

    afterAll(async () => {
      await Promise.all((racers ?? []).map((each) => each.close()))
      await database?.close()
    })

    beforeEach(async () => {
      await database.truncate()
    })

    test(
      'the loser satisfies isSerializationFailure and a retry loop completes both',
      async () => {
        const a = await database.context(null).db.Row.create({ data: { name: 'a' } })
        const b = await database.context(null).db.Row.create({ data: { name: 'b' } })
        const aId = String(a?.id)
        const bId = String(b?.id)
        const [first, second] = racers
        if (first === undefined || second === undefined) throw new Error('racers not built')

        let contended = true
        const attempts: unknown[] = []
        const arrive = barrier(2)

        const run = async (
          who: Racer,
          body: (tx: StackContext<AccessControlledDB>) => Promise<unknown>,
        ): Promise<void> => {
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              await who.context.transaction(async (tx) => {
                await body(tx)
              })
              return
            } catch (error) {
              attempts.push(error)
              if (!isSerializationFailure(error)) throw error
            }
          }
          throw new Error('retries exhausted')
        }

        const sync = async (): Promise<void> => {
          if (contended) await arrive()
        }

        await Promise.all([
          run(first, async (tx) => {
            await tx.db.Row.where({ id: { equals: aId } })
              .forUpdate()
              .first()
            await sync()
            await tx.db.Row.update({ where: { id: bId }, data: { name: 'b1' } })
          }),
          run(second, async (tx) => {
            await tx.db.Row.update({ where: { id: bId }, data: { name: 'b2' } })
            await sync()
            await tx.db.Row.where({ id: { equals: aId } })
              .forUpdate()
              .first()
          }),
        ])
        contended = false

        expect(attempts.length).toBeGreaterThanOrEqual(1)
        expect(attempts.every(isSerializationFailure)).toBe(true)
      },
      BOOT,
    )
  },
)
