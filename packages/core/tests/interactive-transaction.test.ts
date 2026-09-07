import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getContext, TransactionUnavailableError } from '../src/context/index.js'
import { isSerializationFailure } from '../src/lib/database-errors.js'
import { config, list } from '../src/config/index.js'
import { text } from '../src/fields/index.js'

/**
 * #614: interactive, hook-firing transaction on the stack `Context`.
 *
 * `context.transaction(fn)` runs `fn` against a `txContext` whose `db.*`
 * operations are access-checked and hook-firing (identical to the normal
 * context) but persist against ONE underlying interactive transaction, so every
 * write in the callback is atomic. It takes no options and runs at the
 * connection's default isolation level (ADR-0042); a driver failure reaches the
 * caller as a stack-owned error rather than being swallowed, so a caller-owned
 * retry loop can react to it.
 *
 * These tests use an in-memory Prisma mock. The `tx` client handed to the
 * `$transaction` callback intentionally has NO `$transaction` of its own —
 * mirroring a real Prisma interactive-transaction client — so nested
 * `context.db` writes join the outer transaction instead of opening their own.
 */

/** A driver serialization failure, shaped the way Prisma 8's `SqlQueryError` is. */
function makeSerializationError(): Error {
  return Object.assign(new Error('could not serialize access due to concurrent update'), {
    kind: 'sql_query',
    sqlState: '40001',
    constraint: undefined,
  })
}

/**
 * Basic transaction-aware mock. Writes apply to shared `tables` immediately and
 * are rolled back by restoring a snapshot when the callback throws. The `tx`
 * handed to the callback exposes the model delegates but NOT `$transaction`.
 */
function createTxPrisma() {
  const tables: Record<string, Map<string, Record<string, unknown>>> = {
    User: new Map(),
    Post: new Map(),
  }
  let idCounter = 0
  const nextId = () => `id-${++idCounter}`

  function makeModel(table: string) {
    // One row per table in this suite, so the composed predicate's target is
    // the first row — which is what `first()` answers.
    const model = {
      where: vi.fn(() => model),
      first: vi.fn(async () => tables[table].values().next().value ?? null),
      aggregate: vi.fn(async () => ({ rows: tables[table].size })),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => tables[table].get(where.id) ?? null,
      ),
      findFirst: vi.fn(async () => tables[table].values().next().value ?? null),
      findMany: vi.fn(async () => Array.from(tables[table].values())),
      count: vi.fn(async () => tables[table].size),
      create: vi.fn(async (data: Record<string, unknown>) => {
        const id = (data.id as string) ?? nextId()
        const record = { ...data, id }
        tables[table].set(id, record)
        return record
      }),
      update: vi.fn(async (data: Record<string, unknown>) => {
        const target = tables[table].values().next().value
        const id = (target?.id as string) ?? nextId()
        const updated = { ...(target ?? { id }), ...data }
        tables[table].set(id, updated)
        return updated
      }),
      delete: vi.fn(async () => {
        const target = tables[table].values().next().value
        if (target === undefined) return null
        tables[table].delete(target.id as string)
        return target
      }),
    }
    return model
  }

  const client: Record<string, unknown> = {
    User: makeModel('User'),
    Post: makeModel('Post'),
  }

  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    const snapshot: Record<string, Map<string, Record<string, unknown>>> = {}
    for (const [name, map] of Object.entries(tables)) {
      snapshot[name] = new Map(map)
    }
    // The interactive-transaction client mirrors real Prisma: model delegates
    // are present but `$transaction` is NOT, so nested writes join this tx.
    const { $transaction: _omit, ...models } = client
    void _omit
    try {
      return await fn(models)
    } catch (err) {
      for (const [name, map] of Object.entries(snapshot)) {
        tables[name] = map
      }
      throw err
    }
  }

  return { client, tables }
}

const baseConfig = () =>
  config({
    db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
    lists: {
      User: list({
        fields: { name: text() },
        access: { operation: { query: () => true, create: () => true, update: () => true } },
      }),
      Post: list({
        fields: { title: text() },
        access: { operation: { query: () => true, create: () => true } },
      }),
    },
  })

describe('#614 context.transaction (interactive transaction)', () => {
  let mock: ReturnType<typeof createTxPrisma>

  beforeEach(() => {
    mock = createTxPrisma()
    vi.clearAllMocks()
  })

  it('exposes a transaction() method on the context', async () => {
    const context = getContext(await baseConfig(), mock.client, { userId: '1' })
    expect(typeof context.transaction).toBe('function')
  })

  it('runs db writes inside the callback and returns the callback result', async () => {
    const context = getContext(await baseConfig(), mock.client, { userId: '1' })

    const result = await context.transaction(async (tx) => {
      const user = await tx.db.User.create({ data: { name: 'jane' } })
      const post = await tx.db.Post.create({ data: { title: 'hello' } })
      return { user, post }
    })

    expect(result.user).toEqual(expect.objectContaining({ name: 'jane' }))
    expect(result.post).toEqual(expect.objectContaining({ title: 'hello' }))
    expect(mock.tables.User.size).toBe(1)
    expect(mock.tables.Post.size).toBe(1)
  })

  it('is atomic: a throw inside the callback rolls back every write', async () => {
    const context = getContext(await baseConfig(), mock.client, { userId: '1' })

    await expect(
      context.transaction(async (tx) => {
        await tx.db.User.create({ data: { name: 'jane' } })
        await tx.db.Post.create({ data: { title: 'hello' } })
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    expect(mock.tables.User.size).toBe(0)
    expect(mock.tables.Post.size).toBe(0)
  })

  it('enforces access control inside the transaction (denied create returns null)', async () => {
    const denyConfig = await config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        User: list({
          fields: { name: text() },
          access: { operation: { query: () => true, create: () => false } },
        }),
      },
    })
    const context = getContext(denyConfig, mock.client, { userId: '1' })

    const created = await context.transaction((tx) => tx.db.User.create({ data: { name: 'jane' } }))

    expect(created).toBeNull()
    expect(mock.tables.User.size).toBe(0)
  })

  it('fires list hooks inside the transaction', async () => {
    const resolveInput = vi.fn(({ resolvedData }) => ({ ...resolvedData, name: 'transformed' }))
    const hookConfig = await config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        User: list({
          fields: { name: text() },
          access: { operation: { query: () => true, create: () => true } },
          hooks: { resolveInput },
        }),
      },
    })
    const context = getContext(hookConfig, mock.client, { userId: '1' })

    const created = await context.transaction((tx) => tx.db.User.create({ data: { name: 'jane' } }))

    expect(resolveInput).toHaveBeenCalledTimes(1)
    expect(created).toEqual(expect.objectContaining({ name: 'transformed' }))
  })

  it('normalises a serialization failure raised at the settle, not swallowing it to null', async () => {
    const context = getContext(await baseConfig(), mock.client, { userId: '1' })

    const raised = await context
      .transaction(async () => {
        throw makeSerializationError()
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      )

    expect(isSerializationFailure(raised)).toBe(true)
    if (!isSerializationFailure(raised)) throw new Error('not normalised')
    expect(raised.message).toBe('could not serialize access due to concurrent update')
  })

  it('the tx context carries the same session and a working sudo()', async () => {
    const context = getContext(await baseConfig(), mock.client, { userId: '42' })

    const seen = await context.transaction(async (tx) => {
      expect(tx.session).toEqual({ userId: '42' })
      expect(typeof tx.sudo).toBe('function')
      expect(tx.sudo()._isSudo).toBe(true)
      return tx.session?.userId
    })

    expect(seen).toBe('42')
  })

  it('sudo() writes inside the transaction are atomic and roll back with it', async () => {
    const context = getContext(await baseConfig(), mock.client, { userId: '1' })

    // A sudo write persists when the transaction commits.
    const created = await context.transaction((tx) =>
      tx.sudo().db.User.create({ data: { name: 'jane' } }),
    )
    expect(created).toEqual(expect.objectContaining({ name: 'jane' }))
    expect(mock.tables.User.size).toBe(1)

    // A sudo write rolls back when the transaction throws (it is bound to `tx`,
    // not the original client).
    await expect(
      context.transaction(async (tx) => {
        await tx.sudo().db.User.create({ data: { name: 'rollback-me' } })
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(mock.tables.User.size).toBe(1)
  })

  it('refuses when nothing can open a transaction, rather than running the callback unatomically', async () => {
    const tables = new Map<string, Record<string, unknown>>()
    const plainClient: Record<string, unknown> = {
      User: {
        where: vi.fn(() => plainClient.User),
        first: vi.fn(async () => tables.values().next().value ?? null),
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) => tables.get(where.id) ?? null,
        ),
        findMany: vi.fn(async () => Array.from(tables.values())),
        count: vi.fn(async () => tables.size),
        create: vi.fn(async (data: Record<string, unknown>) => {
          const record = { ...data, id: 'u1' }
          tables.set('u1', record)
          return record
        }),
      },
    }
    const context = getContext(await baseConfig(), plainClient, { userId: '1' })

    await expect(
      context.transaction(async (tx) => tx.db.User.create({ data: { name: 'jane' } })),
    ).rejects.toBeInstanceOf(TransactionUnavailableError)

    expect(tables.size).toBe(0)
  })
})
