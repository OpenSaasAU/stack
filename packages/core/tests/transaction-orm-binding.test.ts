import { describe, expect, test } from 'vitest'
import {
  getContext,
  OrmHandleUnresolvableError,
  TransactionUnavailableError,
} from '../src/context/index.js'
import { config, list } from '../src/config/index.js'
import { text } from '../src/fields/index.js'
import type { OrmClient } from '../src/access/types.js'
import type { UnsafeCapableClient, UnsafeTransactionScope } from '../src/unsafe.js'

/**
 * #1144: `context.transaction` over a Prisma 8 client opens a real interactive
 * transaction, which checks a connection out of the pool for the whole
 * callback. The engine's ORM handle therefore has to be rebound to the
 * transaction's own collections — a `db` left on the outer handle either
 * commits outside the open transaction or waits for a connection that will not
 * come.
 *
 * The doubles below model the two shapes that failure takes. Neither fakes the
 * secured surface: the real engine runs over them, and what they stand in for
 * is the ORM's own collections and its transaction's staging.
 */

const testConfig = config({
  db: { provider: 'postgresql' },
  lists: {
    Post: list({
      fields: { title: text() },
      access: { operation: { query: () => true, create: () => true } },
    }),
  },
})

/** Raised by the outer collection when the pool has no second connection. */
class PoolExhausted extends Error {
  constructor() {
    super('the pool has one connection and the transaction is holding it')
    this.name = 'PoolExhausted'
  }
}

type Row = Record<string, unknown>

interface Double {
  readonly client: UnsafeCapableClient
  /** The handle the engine is given outside any transaction. */
  readonly handle: OrmClient
  /** Rows the database would hold if every open transaction ended now. */
  committed(): Row[]
}

/**
 * A Prisma-8-shaped client whose transaction stages writes and discards them
 * on a throw.
 *
 * `pool` is what the outer collection does while a transaction is open:
 * `'starved'` refuses (one connection, held), `'spare'` writes straight
 * through (a larger pool, so the write auto-commits outside the transaction).
 */
function createDouble(pool: 'starved' | 'spare'): Double {
  const store: Row[] = []
  const staged: Row[] = []
  let open = false
  let id = 0

  const collection = (sink: Row[], outer: boolean): Row => {
    const self: Row = {
      where: () => self,
      first: async (): Promise<Row | null> => [...store, ...sink][0] ?? null,
      aggregate: async (): Promise<Row> => ({ rows: [...store, ...sink].length }),
      create: async (data: Row): Promise<Row> => {
        if (outer && open && pool === 'starved') throw new PoolExhausted()
        const row = { id: `id-${++id}`, ...data }
        sink.push(row)
        return row
      },
      findUnique: async ({ where }: { where: Row }): Promise<Row | null> =>
        [...store, ...sink].find((row) => row.id === where.id) ?? null,
      findFirst: async (): Promise<Row | null> => [...store, ...sink][0] ?? null,
      findMany: async (): Promise<Row[]> => [...store, ...sink],
      count: async (): Promise<number> => [...store, ...sink].length,
    }
    return self
  }

  const outerCollection = collection(store, true)
  const txCollection = collection(staged, false)

  const unreachable = (): never => {
    throw new Error('the double runs no plans')
  }

  return {
    handle: { Post: outerCollection },
    committed: () => [...store],
    client: {
      sql: {},
      raw: {},
      orm: { public: { Post: outerCollection } },
      runtime: () => ({ query: unreachable, execute: unreachable }),
      transaction: async <R>(fn: (tx: UnsafeTransactionScope) => PromiseLike<R>): Promise<R> => {
        open = true
        staged.length = 0
        try {
          const result = await fn({
            sql: {},
            orm: { public: { Post: txCollection } },
            query: unreachable,
            execute: unreachable,
          })
          store.push(...staged)
          return result
        } finally {
          staged.length = 0
          open = false
        }
      },
    },
  }
}

function contextOver(double: Double) {
  return getContext(
    testConfig,
    double.handle,
    null,
    undefined,
    false,
    undefined,
    undefined,
    double.client,
  )
}

describe('the transaction context is bound to the transaction', () => {
  test('a write in the callback lands inside the transaction and commits with it', async () => {
    const double = createDouble('spare')

    await contextOver(double).transaction(async (tx) => {
      await tx.db.Post.create({ data: { title: 'inside' } })
    })

    expect(double.committed().map((row) => row.title)).toEqual(['inside'])
  })

  test('a write in a callback that then throws leaves no committed row', async () => {
    const double = createDouble('spare')

    await expect(
      contextOver(double).transaction(async (tx) => {
        await tx.db.Post.create({ data: { title: 'rolled back' } })
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    expect(double.committed()).toEqual([])
  })

  test('the callback never asks the pool for a second connection', async () => {
    const double = createDouble('starved')

    await contextOver(double).transaction(async (tx) => {
      await tx.db.Post.create({ data: { title: 'one connection' } })
    })

    expect(double.committed().map((row) => row.title)).toEqual(['one connection'])
  })

  test('a context with no Prisma 8 client refuses rather than running unatomically', async () => {
    const double = createDouble('starved')
    const context = getContext(testConfig, double.handle, null)

    await expect(
      context.transaction(async (tx) => {
        await tx.db.Post.create({ data: { title: 'no client' } })
      }),
    ).rejects.toBeInstanceOf(TransactionUnavailableError)

    expect(double.committed()).toEqual([])
  })

  test('a client whose collections do not cover the config refuses at construction', async () => {
    const double = createDouble('spare')
    const client: UnsafeCapableClient = { ...double.client, orm: { public: {} } }

    expect(() =>
      getContext(testConfig, double.handle, null, undefined, false, undefined, undefined, client),
    ).toThrow(OrmHandleUnresolvableError)

    try {
      getContext(testConfig, double.handle, null, undefined, false, undefined, undefined, client)
    } catch (error) {
      expect(error).toMatchObject({ list: 'Post', namespace: 'public' })
    }
  })
})
