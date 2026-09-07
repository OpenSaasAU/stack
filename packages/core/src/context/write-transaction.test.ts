import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import type { AccessControlledDB, Session } from '../access/index.js'
import type { OpenSaasConfig } from '../config/types.js'
import { text } from '../fields/index.js'
import { withOrigin } from '../origin.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import type { StackContext } from '../types/context.js'
import type { UnsafeCapableClient, UnsafeTransactionScope } from '../unsafe.js'
import { getContext, requireOrmHandle } from './index.js'

/**
 * #1205 / ADR-0010: every write through `context.db` opens a transaction, so a
 * write that fails partway leaves nothing behind. The assertions here read the
 * tables through the driver — a row that survived a rollback is the failure,
 * whatever the engine returned.
 */

const BOOT = 120_000

const LISTS = ['Job', 'Audit'] as const

function schemaConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      Job: { fields: { name: text({ validation: { isRequired: true } }) } },
      Audit: { fields: { note: text({ validation: { isRequired: true } }) } },
    },
  }
}

const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function collectionOf(orm: unknown, model: string): Record<string, unknown> {
  const namespace: unknown = isRecord(orm) ? Reflect.get(orm, 'public') : undefined
  const found: unknown = isRecord(namespace) ? Reflect.get(namespace, model) : undefined
  if (!isRecord(found)) throw new Error(`the client exposes no collection "${model}"`)
  return found
}

/**
 * The Prisma 7 delegate shape the Write Pipeline still calls, over an rc.8
 * collection: `create({ data })` onto `create(row)`, under the origin the
 * write terminals do not yet enter. #1152 moves the pipeline itself onto the
 * rc.8 names and this goes away with it; until then it is the only way to run
 * a secured write against a real database.
 */
function delegateFor(collection: Record<string, unknown>): Record<string, unknown> {
  const create: unknown = collection.create
  if (typeof create !== 'function') throw new Error('the collection has no create')
  return {
    create: ({ data }: { data: Record<string, unknown> }) =>
      withOrigin('engine', () => Promise.resolve(create.call(collection, data))),
  }
}

function shapedOrm(orm: unknown): object {
  const models: Record<string, unknown> = {}
  for (const model of LISTS) models[model] = delegateFor(collectionOf(orm, model))
  return { public: models }
}

/**
 * The real Prisma 8 client with {@link delegateFor} in front of each
 * collection — its own `transaction`, so the transaction the engine opens is
 * the database's.
 */
function shapedClient(client: TestDatabase['client']): UnsafeCapableClient {
  const unreachable = (): never => {
    throw new Error('this test runs no plans through the Unsafe surface')
  }
  return {
    sql: client.sql,
    raw: client.raw,
    orm: shapedOrm(client.orm),
    runtime: () => ({ query: unreachable, execute: unreachable }),
    transaction: <R>(fn: (tx: UnsafeTransactionScope) => PromiseLike<R>): Promise<R> =>
      client.transaction((tx) =>
        fn({ sql: tx.sql, orm: shapedOrm(tx.orm), query: unreachable, execute: unreachable }),
      ),
  }
}

function contextOver(
  database: TestDatabase,
  config: OpenSaasConfig,
  session: Session | null = null,
): StackContext<AccessControlledDB> {
  const client = shapedClient(database.client)
  return getContext(
    config,
    requireOrmHandle(config, client.orm),
    session,
    undefined,
    false,
    undefined,
    undefined,
    client,
  )
}

async function rows(url: string, table: string): Promise<Record<string, unknown>[]> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    return (await client.query(`select * from "public"."${table}" order by "id"`)).rows
  } finally {
    await client.end()
  }
}

describe('every write through context.db opens a transaction', () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase(schemaConfig())
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(async () => {
    await database.truncate()
  })

  test(
    'a write nothing rejects commits its row',
    async () => {
      const config: OpenSaasConfig = {
        ...schemaConfig(),
        lists: {
          Job: { fields: { name: text() }, access: { operation: OPEN } },
          Audit: { fields: { note: text() }, access: { operation: OPEN } },
        },
      }

      const created = await contextOver(database, config).db.Job.create({ data: { name: 'ship' } })

      expect(created).toMatchObject({ name: 'ship' })
      expect(await rows(database.url, 'Job')).toHaveLength(1)
    },
    BOOT,
  )

  test(
    'a hook that throws after the database call leaves no committed row',
    async () => {
      const config: OpenSaasConfig = {
        ...schemaConfig(),
        lists: {
          Job: {
            fields: { name: text() },
            access: { operation: OPEN },
            hooks: {
              afterOperation: () => {
                throw new Error('the hook rejected the write')
              },
            },
          },
          Audit: { fields: { note: text() }, access: { operation: OPEN } },
        },
      }

      await expect(
        contextOver(database, config).db.Job.create({ data: { name: 'ship' } }),
      ).rejects.toThrow('the hook rejected the write')

      expect(await rows(database.url, 'Job')).toEqual([])
    },
    BOOT,
  )

  test(
    'a multi-statement write that fails partway rolls both statements back',
    async () => {
      const config: OpenSaasConfig = {
        ...schemaConfig(),
        lists: {
          Job: {
            fields: {
              name: text({
                hooks: {
                  afterOperation: () => {
                    throw new Error('the second statement is already in')
                  },
                },
              }),
            },
            access: { operation: OPEN },
            hooks: {
              // Runs before the field hook below, so both rows are in the
              // database by the time the write fails.
              afterOperation: async ({ context }) => {
                await context.db.Audit.create({ data: { note: 'job created' } })
              },
            },
          },
          Audit: { fields: { note: text() }, access: { operation: OPEN } },
        },
      }

      await expect(
        contextOver(database, config).db.Job.create({ data: { name: 'ship' } }),
      ).rejects.toThrow('the second statement is already in')

      expect(await rows(database.url, 'Job')).toEqual([])
      expect(await rows(database.url, 'Audit')).toEqual([])
    },
    BOOT,
  )

  test(
    'a write inside context.transaction joins it rather than committing on its own',
    async () => {
      const config: OpenSaasConfig = {
        ...schemaConfig(),
        lists: {
          Job: { fields: { name: text() }, access: { operation: OPEN } },
          Audit: { fields: { note: text() }, access: { operation: OPEN } },
        },
      }

      await expect(
        contextOver(database, config).transaction(async (tx) => {
          await tx.db.Job.create({ data: { name: 'ship' } })
          await tx.db.Audit.create({ data: { note: 'job created' } })
          throw new Error('the caller rejected the transaction')
        }),
      ).rejects.toThrow('the caller rejected the transaction')

      expect(await rows(database.url, 'Job')).toEqual([])
      expect(await rows(database.url, 'Audit')).toEqual([])
    },
    BOOT,
  )

  test(
    'a write inside context.transaction commits with it',
    async () => {
      const config: OpenSaasConfig = {
        ...schemaConfig(),
        lists: {
          Job: { fields: { name: text() }, access: { operation: OPEN } },
          Audit: { fields: { note: text() }, access: { operation: OPEN } },
        },
      }

      await contextOver(database, config).transaction(async (tx) => {
        await tx.db.Job.create({ data: { name: 'ship' } })
        await tx.db.Audit.create({ data: { note: 'job created' } })
      })

      expect(await rows(database.url, 'Job')).toHaveLength(1)
      expect(await rows(database.url, 'Audit')).toHaveLength(1)
    },
    BOOT,
  )
})
