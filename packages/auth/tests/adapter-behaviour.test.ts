// What the Auth adapter promises beyond better-auth's own conformance suites:
// the at-most-one `consumeOne`, the two lanes agreeing on how a column is
// addressed, and the value handling at each edge (ADR-0060).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { config as defineConfig } from '@opensaas/stack-core'
import { bigInt } from '@opensaas/stack-core/fields'
import { createTestDatabase } from '@opensaas/stack-core/testing'
import type { TestDatabase } from '@opensaas/stack-core/testing'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import type { UnsafeSurface } from '@opensaas/stack-core/unsafe'
import type { DBAdapter } from 'better-auth/adapters'
import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth'
import { authPlugin } from '../src/config/plugin.js'
import { getAuthListRegistry } from '../src/lists/index.js'
import { opensaasAuthAdapter } from '../src/adapter/index.js'
import type { AuthConfig, NormalizedAuthConfig } from '../src/config/types.js'

const BOOT = 120_000

/**
 * An application's own `int8` column on the user table, declared to
 * better-auth as an ordinary number so its writes carry it, and to the stack
 * as the `bigint` it is.
 */
const legacyIdPlugin: BetterAuthPlugin = {
  id: 'adapter-behaviour-legacy-id',
  schema: { user: { fields: { legacyId: { type: 'number', required: false } } } },
}

/** The `Collection` members the adapter reaches for, as a double answers them. */
interface CollectionDouble {
  where(): CollectionDouble
  select(): CollectionDouble
  orderBy(): CollectionDouble
  limit(): CollectionDouble
  offset(): CollectionDouble
  all(): Promise<Record<string, unknown>[]>
  first(): Promise<Record<string, unknown>>
  aggregate(): Promise<{ n: number }>
  create(): Promise<Record<string, unknown>>
  update(): Promise<Record<string, unknown>>
  updateAndCount(): Promise<number>
  delete(): Promise<Record<string, unknown>>
  deleteAndCount(): Promise<number>
}

/**
 * An Unsafe surface whose `Verification` collection resolves `row` and then
 * deletes nothing — the state a consumer that lost the race observes between
 * its own two statements.
 */
function lostRaceSurface(row: Record<string, unknown>): UnsafeSurface {
  const collection: CollectionDouble = {
    where: () => collection,
    select: () => collection,
    orderBy: () => collection,
    limit: () => collection,
    offset: () => collection,
    all: async () => [row],
    first: async () => row,
    aggregate: async () => ({ n: 1 }),
    create: async () => row,
    update: async () => row,
    updateAndCount: async () => 1,
    delete: async () => row,
    deleteAndCount: async () => 0,
  }
  return {
    sql: {},
    raw: {},
    orm: { public: { Verification: collection } },
    query: () => {
      throw new Error('the double runs no plans')
    },
    execute: () => {
      throw new Error('the double runs no plans')
    },
  }
}

interface Harness {
  database: TestDatabase
  adapter: DBAdapter<BetterAuthOptions>
  config: OpenSaasConfig
  registry: Record<string, string>
  betterAuthOptions: BetterAuthOptions
}

async function standUp(
  authConfig: AuthConfig,
  betterAuthOptions: BetterAuthOptions,
): Promise<Harness> {
  const opensaasConfig: OpenSaasConfig = await defineConfig({
    plugins: [authPlugin(authConfig)],
    db: { provider: 'postgresql' },
    lists: {},
  })
  const database = await createTestDatabase(opensaasConfig)
  const normalized = opensaasConfig._pluginData?.auth as NormalizedAuthConfig
  const context = database.context()
  const registry = getAuthListRegistry(normalized.models, normalized.betterAuthPlugins)
  const adapter = opensaasAuthAdapter({
    config: opensaasConfig,
    unsafe: context.unsafe,
    registry,
    transaction: (body) => context.transaction((tx) => body(tx.unsafe)),
  })(betterAuthOptions)
  return { database, adapter, config: opensaasConfig, registry, betterAuthOptions }
}

let plain: Harness
let mapped: Harness

beforeAll(async () => {
  plain = await standUp(
    {
      emailAndPassword: { enabled: true },
      betterAuthPlugins: [legacyIdPlugin],
      extendUserList: { fields: { legacyId: bigInt() } },
      rateLimit: { enabled: true, storage: 'database' },
    },
    { rateLimit: { storage: 'database' }, plugins: [legacyIdPlugin] },
  )

  mapped = await standUp(
    {
      emailAndPassword: { enabled: true },
      user: { fields: { name: 'full_name' } },
      verification: { fields: { identifier: 'ident' } },
      rateLimit: { enabled: true, storage: 'database', fields: { key: 'rate_key' } },
    },
    {
      user: { fields: { name: 'full_name' } },
      verification: { fields: { identifier: 'ident' } },
      rateLimit: { storage: 'database', fields: { key: 'rate_key' } },
    },
  )
}, BOOT)

afterAll(async () => {
  await plain?.database.close()
  await mapped?.database.close()
})

beforeEach(async () => {
  await plain.database.truncate()
  await mapped.database.truncate()
})

async function seedToken(harness: Harness, identifier: string): Promise<void> {
  await harness.adapter.create({
    model: 'verification',
    data: { identifier, value: 'token', expiresAt: new Date(Date.now() + 60_000) },
  })
}

describe('consumeOne is atomic', () => {
  test('two racing consumers: exactly one gets the row', async () => {
    await seedToken(plain, 'once')

    const consume = (): Promise<{ identifier: string } | null> =>
      plain.adapter.consumeOne<{ identifier: string }>({
        model: 'verification',
        where: [{ field: 'identifier', value: 'once' }],
      })

    const [first, second] = await Promise.all([consume(), consume()])

    const winners = [first, second].filter((row) => row !== null && row !== undefined)
    expect(winners).toHaveLength(1)
    expect(winners[0]?.identifier).toBe('once')
    expect(await plain.adapter.count({ model: 'verification' })).toBe(0)
  })

  test('five racing consumers: exactly one gets the row', async () => {
    await seedToken(plain, 'onlyonce')

    const consumed = await Promise.all(
      Array.from({ length: 5 }, () =>
        plain.adapter.consumeOne({
          model: 'verification',
          where: [{ field: 'identifier', value: 'onlyonce' }],
        }),
      ),
    )

    expect(consumed.filter((row) => row !== null && row !== undefined)).toHaveLength(1)
    expect(await plain.adapter.count({ model: 'verification' })).toBe(0)
  })

  // The in-process database holds one connection, so the two transactions
  // above run one after the other and the loser's own SELECT finds nothing.
  // That is the outcome, not the mechanism: this drives the lane through a
  // double whose SELECT resolves a row and whose DELETE claims none — the
  // interleaving two overlapping transactions produce on a real pool.
  test('a resolve that wins and a delete that claims nothing answers null', async () => {
    const row = { id: randomUUID(), identifier: 'raced', value: 'token' }
    const surface = lostRaceSurface(row)
    const adapter = opensaasAuthAdapter({
      config: plain.config,
      unsafe: surface,
      registry: plain.registry,
      transaction: (body) => body(surface),
    })(plain.betterAuthOptions)

    expect(
      await adapter.consumeOne({
        model: 'verification',
        where: [{ field: 'identifier', value: 'raced' }],
      }),
    ).toBeNull()
  })

  test('answers null when nothing matches', async () => {
    expect(
      await plain.adapter.consumeOne({
        model: 'verification',
        where: [{ field: 'identifier', value: 'never-issued' }],
      }),
    ).toBeNull()
  })
})

describe('the shipped id configuration', () => {
  // The normal suite's own "not found" probes are disabled in
  // `adapter-conformance.test.ts`: upstream hardcodes the id `"100000"` unless
  // the options say `generateId: 'uuid'`, which is the key production refuses.
  // These are those probes, with the well-formed id a uuid column takes.
  test('findOne answers null for an id no row carries', async () => {
    expect(
      await plain.adapter.findOne({
        model: 'user',
        where: [{ field: 'id', value: randomUUID() }],
      }),
    ).toBeNull()
  })

  test('findMany answers an empty array for an id no row carries', async () => {
    expect(
      await plain.adapter.findMany({
        model: 'user',
        where: [{ field: 'id', value: randomUUID() }],
        limit: 10,
      }),
    ).toEqual([])
  })

  test('delete does not throw for an id no row carries', async () => {
    await expect(
      plain.adapter.delete({ model: 'user', where: [{ field: 'id', value: randomUUID() }] }),
    ).resolves.toBeUndefined()
  })

  // Under `generateId: 'uuid'` — the configuration the harness used to run —
  // better-auth drops a caller-supplied id even here, because `useUUIDs` plus
  // `supportsUUIDs` answers `undefined` from the id transform. The shipped
  // configuration writes it, so a plugin or `databaseHooks` create carrying
  // its own id lands in the uuid column rather than being silently replaced.
  test('a caller-supplied id is written when the caller forces it', async () => {
    const id = randomUUID()
    const created = await plain.adapter.create<
      { id: string; email: string; name: string },
      { id: string }
    >({
      model: 'user',
      data: { id, email: `${id}@example.com`, name: 'Ada' },
      forceAllowId: true,
    })
    expect(created.id).toBe(id)
  })
})

describe('both lanes address a mapped column the same way', () => {
  test('the ORM lane resolves a mapped field', async () => {
    const email = `${randomUUID()}@example.com`
    await mapped.adapter.create({ model: 'user', data: { email, name: 'Ada' } })

    const found = await mapped.adapter.findOne<{ name: string }>({
      model: 'user',
      where: [{ field: 'name', value: 'Ada' }],
    })
    expect(found?.name).toBe('Ada')
  })

  test('the typed-SQL lane resolves a mapped field', async () => {
    await mapped.adapter.create({
      model: 'rateLimit',
      data: { key: 'ip:9', count: 1, lastRequest: 10 },
    })

    const bumped = await mapped.adapter.incrementOne<{ count: number }>({
      model: 'rateLimit',
      where: [{ field: 'key', value: 'ip:9' }],
      increment: { count: 2 },
      set: { lastRequest: 20 },
    })
    expect(bumped?.count).toBe(3)
  })

  test('consumeOne resolves a mapped field', async () => {
    await mapped.adapter.create({
      model: 'verification',
      data: {
        identifier: 'mapped-once',
        value: 'token',
        expiresAt: new Date(Date.now() + 60_000),
      },
    })

    const consumed = await mapped.adapter.consumeOne<{ identifier: string }>({
      model: 'verification',
      where: [{ field: 'identifier', value: 'mapped-once' }],
    })
    expect(consumed?.identifier).toBe('mapped-once')
    expect(await mapped.adapter.count({ model: 'verification' })).toBe(0)
  })
})

describe('values crossing the adapter', () => {
  test('an undeclared int8 column keeps its precision', async () => {
    const beyondSafe = 9007199254740993n
    const email = `${randomUUID()}@example.com`
    const created = await plain.adapter.create<
      { email: string; name: string; legacyId: bigint },
      { id: string; legacyId: unknown }
    >({ model: 'user', data: { email, name: 'Ada', legacyId: beyondSafe } })

    expect(created.legacyId).toBe(beyondSafe)

    const found = await plain.adapter.findOne<{ legacyId: unknown }>({
      model: 'user',
      where: [{ field: 'id', value: created.id }],
    })
    expect(found?.legacyId).toBe(beyondSafe)
  })

  test('a declared bigint column still answers a number', async () => {
    await plain.adapter.create({
      model: 'rateLimit',
      data: { key: 'ip:big', count: 1, lastRequest: 1234 },
    })

    const found = await plain.adapter.findOne<{ lastRequest: number }>({
      model: 'rateLimit',
      where: [{ field: 'key', value: 'ip:big' }],
    })
    expect(found?.lastRequest).toBe(1234)
  })
})

describe('where lowering', () => {
  test('an insensitive pattern matches SQL metacharacters literally', async () => {
    const literal = `100% ' OR 1=1 -- _x\\y`
    await plain.adapter.create({
      model: 'user',
      data: { email: 'meta@example.com', name: literal },
    })
    await plain.adapter.create({
      model: 'user',
      data: { email: 'other@example.com', name: '100 OR 1=1 abc' },
    })

    const matched = await plain.adapter.findMany<{ name: string }>({
      model: 'user',
      where: [{ field: 'name', value: literal, operator: 'contains' }],
      limit: 10,
    })
    expect(matched.map((row) => row.name)).toEqual([literal])
  })

  test('a case-sensitive pattern on the typed-SQL lane binds its metacharacters', async () => {
    await plain.adapter.create({
      model: 'rateLimit',
      data: { key: `ip:100% ' OR 1=1 --`, count: 1, lastRequest: 10 },
    })
    await plain.adapter.create({
      model: 'rateLimit',
      data: { key: 'ip:1000', count: 1, lastRequest: 10 },
    })

    const bumped = await plain.adapter.incrementOne<{ key: string; count: number }>({
      model: 'rateLimit',
      where: [{ field: 'key', value: `100% ' OR 1=1 --`, operator: 'contains' }],
      increment: { count: 1 },
    })
    expect(bumped?.key).toBe(`ip:100% ' OR 1=1 --`)
    expect(bumped?.count).toBe(2)
  })

  test('an empty insensitive `in` matches nothing rather than throwing', async () => {
    await plain.adapter.create({ model: 'user', data: { email: 'in@example.com', name: 'Ada' } })

    expect(
      await plain.adapter.findMany({
        model: 'user',
        where: [{ field: 'name', value: [], operator: 'in', mode: 'insensitive' }],
        limit: 10,
      }),
    ).toEqual([])
  })

  test('an empty insensitive `not_in` matches everything rather than throwing', async () => {
    await plain.adapter.create({ model: 'user', data: { email: 'notin@example.com', name: 'Ada' } })

    const rows = await plain.adapter.findMany({
      model: 'user',
      where: [{ field: 'name', value: [], operator: 'not_in', mode: 'insensitive' }],
      limit: 10,
    })
    expect(rows).toHaveLength(1)
  })

  test('a null guard on the typed-SQL lane compares with IS NULL', async () => {
    await plain.adapter.create({
      model: 'verification',
      data: { identifier: 'guarded', value: 'token', expiresAt: new Date(Date.now() + 60_000) },
    })
    await plain.adapter.create({
      model: 'rateLimit',
      data: { key: 'ip:null-guard', count: 1, lastRequest: 10 },
    })

    const guarded = await plain.adapter.incrementOne<{ count: number }>({
      model: 'rateLimit',
      where: [
        { field: 'key', value: 'ip:null-guard' },
        { field: 'count', operator: 'ne', value: null },
      ],
      increment: { count: 1 },
    })
    expect(guarded?.count).toBe(2)

    const blocked = await plain.adapter.incrementOne({
      model: 'rateLimit',
      where: [
        { field: 'key', value: 'ip:null-guard' },
        { field: 'count', operator: 'eq', value: null },
      ],
      increment: { count: 1 },
    })
    expect(blocked).toBeNull()
  })
})
