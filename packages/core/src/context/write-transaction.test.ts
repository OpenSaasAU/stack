import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import type { AccessControlledDB, Session } from '../access/index.js'
import type { OpenSaasConfig } from '../config/types.js'
import { text } from '../fields/index.js'
import { createTestDatabase, ormClientFor, type TestDatabase } from '../testing/context.js'
import type { StackContext } from '../types/context.js'
import { getContext } from './index.js'
import { withOrigin } from '../origin.js'

/**
 * #1205 / ADR-0010: every write through `context.db` opens a transaction, so a
 * write that fails partway leaves nothing behind. #1152: the write path drives
 * the rc.8 collection itself, so these contexts sit directly on the harness's
 * client — the Prisma-7-shaped delegate that used to stand between them is
 * gone.
 *
 * The assertions read the tables through the driver — a row that survived a
 * rollback is the failure, whatever the engine returned.
 */

const BOOT = 120_000

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

function openConfig(): OpenSaasConfig {
  return {
    ...schemaConfig(),
    lists: {
      Job: { fields: { name: text() }, access: { operation: OPEN } },
      Audit: { fields: { note: text() }, access: { operation: OPEN } },
    },
  }
}

/**
 * A context over the harness's own client at a config of this test's choosing —
 * the same client `database.context()` uses, so the schema is the one that was
 * applied and only the hooks and access rules vary.
 */
function contextOver(
  database: TestDatabase,
  config: OpenSaasConfig,
  session: Session | null = null,
): StackContext<AccessControlledDB> {
  const orm = ormClientFor(database.data, database.client.orm)
  return getContext(config, orm, session, undefined, false, undefined, undefined, database.client)
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
      const created = await contextOver(database, openConfig()).db.Job.create({
        data: { name: 'ship' },
      })

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
    'a hook\u2019s own write through ormHandle rolls back with the write',
    async () => {
      const writeThroughHandle = async (
        context: { ormHandle: Record<string, unknown> },
        note: string,
      ): Promise<void> => {
        const collection = context.ormHandle.Audit
        if (typeof collection !== 'object' || collection === null) {
          throw new Error('the context carries no Audit collection')
        }
        const create = Reflect.get(collection, 'create')
        if (typeof create !== 'function') throw new Error('the collection has no create')
        await withOrigin('engine', () => create.call(collection, { note }))
      }

      const config = (thrower: boolean): OpenSaasConfig => ({
        ...schemaConfig(),
        lists: {
          Job: {
            fields: { name: text() },
            access: { operation: OPEN },
            hooks: {
              afterOperation: async ({ context }) => {
                await writeThroughHandle(context, 'job created')
                if (thrower) throw new Error('the hook rejected the write')
              },
            },
          },
          Audit: { fields: { note: text() }, access: { operation: OPEN } },
        },
      })

      await expect(
        contextOver(database, config(true)).db.Job.create({ data: { name: 'ship' } }),
      ).rejects.toThrow('the hook rejected the write')

      expect(await rows(database.url, 'Job')).toEqual([])
      expect(await rows(database.url, 'Audit')).toEqual([])

      // The control: the same hook without the throw leaves both rows, so the
      // assertion above is about the rollback and not about the write failing
      // to reach the database at all.
      await contextOver(database, config(false)).db.Job.create({ data: { name: 'ship' } })

      expect(await rows(database.url, 'Job')).toHaveLength(1)
      expect(await rows(database.url, 'Audit')).toHaveLength(1)
    },
    BOOT,
  )

  test(
    'a write inside context.transaction joins it rather than committing on its own',
    async () => {
      await expect(
        contextOver(database, openConfig()).transaction(async (tx) => {
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
      await contextOver(database, openConfig()).transaction(async (tx) => {
        await tx.db.Job.create({ data: { name: 'ship' } })
        await tx.db.Audit.create({ data: { note: 'job created' } })
      })

      expect(await rows(database.url, 'Job')).toHaveLength(1)
      expect(await rows(database.url, 'Audit')).toHaveLength(1)
    },
    BOOT,
  )
})
