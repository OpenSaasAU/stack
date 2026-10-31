import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import postgres from '@prisma/orm-postgres/runtime'
import type { OpenSaasConfig } from '../config/types.js'
import type { PrismaContract } from '../contract/prisma.js'
import { text } from '../fields/index.js'
import { getContext } from '../context/index.js'
import { originTripwire } from '../origin.js'
import type { StackContext } from '../types/context.js'
import type { AccessControlledDB } from '../access/types.js'
import { createTestDatabase, ormClientFor, type TestDatabase } from '../testing/context.js'
import { ESCAPE_VARIABLES, readDatabaseEscape } from '../testing/escape.js'

const BOOT = 120_000

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Settings: {
      isSingleton: true,
      fields: { name: text() },
      access: { operation: { query: () => true, create: () => true } },
    },
  },
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
    ? 'concurrent first get() on an empty singleton'
    : `concurrent first get() on an empty singleton [escape-only: ${ESCAPE_VARIABLES.join('/')} names no Postgres]`,
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
      'both racers resolve to the same row',
      async () => {
        const [a, b] = await Promise.all(
          racers.map((each) => {
            const get = each.context.db.Settings?.get
            if (!get) throw new Error('Settings is not a singleton')
            return get()
          }),
        )
        expect(a).not.toBeNull()
        expect(b).not.toBeNull()
        expect(a?.id).toBe(b?.id)
      },
      BOOT,
    )
  },
)
