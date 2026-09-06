import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getContext } from '../src/context/index.js'
import { config, list } from '../src/config/index.js'
import { text } from '../src/fields/index.js'

/**
 * #614: interactive, hook-firing transaction on the stack `Context`.
 *
 * `context.transaction(fn, options)` runs `fn` against a `txContext` whose
 * `db.*` operations are access-checked and hook-firing (identical to the normal
 * context) but persist against ONE underlying interactive transaction, so every
 * write in the callback is atomic. The transaction `options` (notably
 * `isolationLevel`) are passed through to the underlying Prisma transaction, and
 * serialization failures propagate to the caller (rather than being swallowed)
 * so a caller-owned retry loop can react to them.
 *
 * These tests use an in-memory Prisma mock. The `tx` client handed to the
 * `$transaction` callback intentionally has NO `$transaction` of its own —
 * mirroring a real Prisma interactive-transaction client — so nested
 * `context.db` writes join the outer transaction instead of opening their own.
 */

/** A Prisma-style serialization failure (write conflict / deadlock). */
function makeSerializationError(): Error & { code: string } {
  const err = new Error('could not serialize access due to concurrent update') as Error & {
    code: string
  }
  err.code = 'P2034'
  return err
}

function isSerializationError(err: unknown): boolean {
  return !!err && typeof err === 'object' && 'code' in err && err.code === 'P2034'
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
    return {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => tables[table].get(where.id) ?? null,
      ),
      findFirst: vi.fn(async () => tables[table].values().next().value ?? null),
      findMany: vi.fn(async () => Array.from(tables[table].values())),
      count: vi.fn(async () => tables[table].size),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = (data.id as string) ?? nextId()
        const record = { ...data, id }
        tables[table].set(id, record)
        return record
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const existing = tables[table].get(where.id) ?? { id: where.id }
          const updated = { ...existing, ...data }
          tables[table].set(where.id, updated)
          return updated
        },
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const existing = tables[table].get(where.id) ?? { id: where.id }
        tables[table].delete(where.id)
        return existing
      }),
    }
  }

  const client: Record<string, unknown> = {
    User: makeModel('User'),
    Post: makeModel('Post'),
  }

  const capturedOptions: unknown[] = []

  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>, options?: unknown) => {
    capturedOptions.push(options)
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

  return { client, tables, capturedOptions }
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

  it('passes transaction options (isolationLevel) through to the underlying client', async () => {
    const context = getContext(await baseConfig(), mock.client, { userId: '1' })

    await context.transaction(
      async (tx) => {
        await tx.db.User.create({ data: { name: 'jane' } })
      },
      { isolationLevel: 'Serializable' },
    )

    expect(mock.capturedOptions).toContainEqual(
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    )
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

  it('propagates serialization failures to the caller (not swallowed to null)', async () => {
    const context = getContext(await baseConfig(), mock.client, { userId: '1' })

    await expect(
      context.transaction(async () => {
        throw makeSerializationError()
      }),
    ).rejects.toMatchObject({ code: 'P2034' })
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

  it('falls back to running directly when the client has no $transaction', async () => {
    // A client without `$transaction` (e.g. a plain mock or an already-open tx).
    const tables = new Map<string, Record<string, unknown>>()
    const plainClient: Record<string, unknown> = {
      User: {
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) => tables.get(where.id) ?? null,
        ),
        findMany: vi.fn(async () => Array.from(tables.values())),
        count: vi.fn(async () => tables.size),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const record = { ...data, id: 'u1' }
          tables.set('u1', record)
          return record
        }),
      },
    }
    const context = getContext(await baseConfig(), plainClient, { userId: '1' })

    const created = await context.transaction(async (tx) => {
      expect(tx.db).toBeDefined()
      return tx.db.User.create({ data: { name: 'jane' } })
    })

    expect(created).toEqual(expect.objectContaining({ name: 'jane' }))
    expect(tables.size).toBe(1)
  })
})

/**
 * Serializable-isolation emulation for the capacity-gate use case.
 *
 * Each transaction reads a snapshot taken at begin and buffers its writes. At
 * commit, if a transaction that committed during this tx's lifetime wrote to a
 * table this tx READ (a predicate/phantom conflict) or WROTE, this tx fails with
 * a P2034 serialization error — exactly the conflict a `Serializable` capacity
 * gate must surface. With a caller-owned retry loop this yields exactly-N.
 */
function createSerializablePrisma() {
  const committed: Record<string, Map<string, Record<string, unknown>>> = { booking: new Map() }
  let version = 0
  let idCounter = 0
  const log: { writeTables: Set<string>; version: number }[] = []

  function snapshotTables() {
    const snap: Record<string, Map<string, Record<string, unknown>>> = {}
    for (const [name, map] of Object.entries(committed)) snap[name] = new Map(map)
    return snap
  }

  const client: Record<string, unknown> = {
    // Direct (non-tx) access is not used by these tests, but keep a booking model
    // so getContext can build a delegate.
    Booking: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => Array.from(committed.booking.values())),
      count: vi.fn(async () => committed.booking.size),
      create: vi.fn(),
    },
  }

  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>, _options?: unknown) => {
    const beganAt = version
    const view = snapshotTables()
    const buffer = new Map<string, Record<string, unknown>>()
    const readTables = new Set<string>()
    const writeTables = new Set<string>()

    const tx: Record<string, unknown> = {
      Booking: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          readTables.add('booking')
          return buffer.get(where.id) ?? view.booking.get(where.id) ?? null
        }),
        findMany: vi.fn(async () => {
          readTables.add('booking')
          return [...view.booking.values(), ...buffer.values()]
        }),
        count: vi.fn(async ({ where }: { where?: { slotId?: string } } = {}) => {
          readTables.add('booking')
          const all = [...view.booking.values(), ...buffer.values()]
          if (where?.slotId) return all.filter((r) => r.slotId === where.slotId).length
          return all.length
        }),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          writeTables.add('booking')
          const id = `b-${++idCounter}`
          const record = { ...data, id }
          buffer.set(id, record)
          return record
        }),
      },
    }

    const result = await fn(tx)

    // Commit: detect serialization conflicts against tx that committed after we began.
    for (const entry of log) {
      if (entry.version <= beganAt) continue
      const conflictsRead = [...entry.writeTables].some((t) => readTables.has(t))
      const conflictsWrite = [...entry.writeTables].some((t) => writeTables.has(t))
      if (conflictsRead || conflictsWrite) {
        const err = new Error('serialization failure') as Error & { code: string }
        err.code = 'P2034'
        throw err
      }
    }

    // No conflict: apply buffered writes and advance the version.
    for (const [id, record] of buffer) committed.booking.set(id, record)
    version += 1
    log.push({ writeTables, version })
    return result
  }

  return { client, committed }
}

function makeBarrier(n: number) {
  let count = 0
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return async () => {
    count += 1
    if (count >= n) release()
    await gate
  }
}

describe('#614 capacity gate under Serializable contention', () => {
  it('N concurrent transactions against a capacity-N slot commit exactly N', async () => {
    const capacity = 2
    const racers = 4
    const slotId = 'slot-1'

    const mock = createSerializablePrisma()
    const cfg = await config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        Booking: list({
          fields: { slotId: text() },
          access: { operation: { query: () => true, create: () => true } },
        }),
      },
    })
    const context = getContext(cfg, mock.client, { userId: '1' })

    // All racers must READ the count before any of them COMMITS, to create the
    // contention. Only the first attempt waits at the barrier; retries proceed.
    const barrier = makeBarrier(racers)

    async function book(): Promise<boolean> {
      for (let attempt = 0; attempt < 50; attempt++) {
        try {
          return await context.transaction(
            async (tx) => {
              const count = await tx.db.Booking.count({ where: { slotId } })
              if (attempt === 0) await barrier()
              if (count >= capacity) return false
              await tx.db.Booking.create({ data: { slotId } })
              return true
            },
            { isolationLevel: 'Serializable' },
          )
        } catch (err) {
          if (isSerializationError(err)) continue
          throw err
        }
      }
      throw new Error('exceeded retry budget')
    }

    const results = await Promise.all(Array.from({ length: racers }, () => book()))

    const booked = results.filter(Boolean).length
    expect(booked).toBe(capacity)
    expect(mock.committed.booking.size).toBe(capacity)
  })
})
