import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getContext } from '../src/context/index.js'
import { config, list } from '../src/config/index.js'
import { text } from '../src/fields/index.js'
import type { PrismaClientLike } from '../src/access/types.js'

/**
 * #980: `context.withSession(session)` — the sibling to `sudo()` on the
 * other axis. It substitutes the session a derived context carries while
 * reusing the receiver's already-resolved config and client (including a
 * transaction client) and running access control/hooks exactly as normal.
 */

describe('withSession', () => {
  const mockPrisma = {
    post: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
  } as PrismaClientLike

  const seenSessions: (Record<string, unknown> | null | undefined)[] = []

  const testConfig = config({
    db: { provider: 'sqlite' },
    lists: {
      Post: list({
        fields: {
          title: text({ validation: { isRequired: true } }),
        },
        access: {
          operation: {
            query: async () => true,
            create: async ({ session }) => session?.role === 'admin',
            update: async ({ session }) => session?.role === 'admin',
          },
        },
        hooks: {
          validate: async ({ context }) => {
            seenSessions.push(context.session as Record<string, unknown> | null | undefined)
          },
        },
      }),
    },
  })

  beforeEach(() => {
    vi.clearAllMocks()
    seenSessions.length = 0
  })

  it('returns a context whose session is the substituted one, leaving the original unmutated', () => {
    const original = getContext(testConfig, mockPrisma, { userId: '1', role: 'user' })
    const derived = original.withSession({ userId: '2', role: 'admin' })

    expect(derived.session).toEqual({ userId: '2', role: 'admin' })
    expect(original.session).toEqual({ userId: '1', role: 'user' })
  })

  it('a list validate hook sees the substituted session, not the original', async () => {
    const original = getContext(testConfig, mockPrisma, { userId: '1', role: 'user' })
    const derived = original.withSession({ userId: '2', role: 'admin' })

    mockPrisma.post.create.mockResolvedValue({ id: '1', title: 'Hi' })

    await derived.db.post.create({ data: { title: 'Hi' } })

    expect(seenSessions).toEqual([{ userId: '2', role: 'admin' }])
  })

  it('access rules evaluate against the substituted session — a derived context can do neither more nor less than one built directly with it', async () => {
    const adminSession = { userId: '2', role: 'admin' }
    const derived = getContext(testConfig, mockPrisma, { userId: '1', role: 'user' }).withSession(
      adminSession,
    )
    const direct = getContext(testConfig, mockPrisma, adminSession)

    mockPrisma.post.create.mockResolvedValue({ id: '1', title: 'Hi' })

    const derivedResult = await derived.db.post.create({ data: { title: 'Hi' } })
    const directResult = await direct.db.post.create({ data: { title: 'Hi' } })

    expect(derivedResult).toMatchObject({ title: 'Hi' })
    expect(directResult).toMatchObject({ title: 'Hi' })

    // Neither more: a non-admin substituted session is denied exactly like a
    // context built with that session directly.
    const userSession = { userId: '3', role: 'user' }
    const derivedDenied = getContext(testConfig, mockPrisma, adminSession).withSession(userSession)
    const directDenied = getContext(testConfig, mockPrisma, userSession)

    expect(await derivedDenied.db.post.create({ data: { title: 'Nope' } })).toBeNull()
    expect(await directDenied.db.post.create({ data: { title: 'Nope' } })).toBeNull()
  })

  it('withSession(null) yields an anonymous context and access rules treat it as such', async () => {
    const derived = getContext(testConfig, mockPrisma, { userId: '1', role: 'admin' }).withSession(
      null,
    )

    expect(derived.session).toBeNull()

    const result = await derived.db.post.create({ data: { title: 'Nope' } })
    expect(result).toBeNull()
  })

  it('context.withSession(s).sudo() and context.sudo().withSession(s) are equivalent', () => {
    const base = getContext(testConfig, mockPrisma, { userId: '1', role: 'user' })
    const admin = { userId: '2', role: 'admin' }

    const a = base.withSession(admin).sudo()
    const b = base.sudo().withSession(admin)

    expect(a._isSudo).toBe(true)
    expect(b._isSudo).toBe(true)
    expect(a.session).toEqual(admin)
    expect(b.session).toEqual(admin)
  })

  it('preserves sudo state: withSession on a sudo context stays sudo, on a non-sudo context stays non-sudo', () => {
    const base = getContext(testConfig, mockPrisma, { userId: '1', role: 'user' })
    const admin = { userId: '2', role: 'admin' }

    expect(base.sudo().withSession(admin)._isSudo).toBe(true)
    expect(base.withSession(admin)._isSudo).toBe(false)
  })

  it('reuses the receiver client — no second connection is opened', () => {
    const original = getContext(testConfig, mockPrisma, { userId: '1', role: 'user' })
    const derived = original.withSession({ userId: '2', role: 'admin' })

    expect(derived.prisma).toBe(original.prisma)
  })

  it('reuses the receiver storage', () => {
    const original = getContext(testConfig, mockPrisma, { userId: '1', role: 'user' })
    const derived = original.withSession({ userId: '2', role: 'admin' })

    expect(derived.storage).toBe(original.storage)
  })

  it('hooks fire on the derived context exactly as on any other', async () => {
    const original = getContext(testConfig, mockPrisma, { userId: '1', role: 'admin' })
    const derived = original.withSession({ userId: '2', role: 'admin' })

    mockPrisma.post.create.mockResolvedValue({ id: '1', title: 'Hi' })

    await derived.db.post.create({ data: { title: 'Hi' } })

    expect(seenSessions).toHaveLength(1)
  })
})

describe('withSession inside context.transaction (#614/#980)', () => {
  function createTxPrisma() {
    const tables: Record<string, Map<string, Record<string, unknown>>> = { post: new Map() }
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
      }
    }

    const client: Record<string, unknown> = { post: makeModel('post') }

    client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot: Record<string, Map<string, Record<string, unknown>>> = {}
      for (const [name, map] of Object.entries(tables)) snapshot[name] = new Map(map)
      const { $transaction: _omit, ...models } = client
      void _omit
      try {
        return await fn(models)
      } catch (err) {
        for (const [name, map] of Object.entries(snapshot)) tables[name] = map
        throw err
      }
    }

    return { client, tables }
  }

  const txConfig = config({
    db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
    lists: {
      Post: list({
        fields: { title: text() },
        access: { operation: { query: () => true, create: () => true } },
      }),
    },
  })

  it('tx.withSession(s) writes participate in the same transaction and roll back with it', async () => {
    const mock = createTxPrisma()
    const context = getContext(txConfig, mock.client, { userId: '1' })

    // Commits: the substituted-session write is inside the callback's transaction.
    const created = await context.transaction((tx) =>
      tx.withSession({ userId: '2' }).db.post.create({ data: { title: 'committed' } }),
    )
    expect(created).toMatchObject({ title: 'committed' })
    expect(mock.tables.post.size).toBe(1)

    // Rolls back: a throw after the substituted-session write undoes it too,
    // proving the write joined the same transaction rather than a separate one.
    await expect(
      context.transaction(async (tx) => {
        await tx.withSession({ userId: '3' }).db.post.create({ data: { title: 'rollback-me' } })
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(mock.tables.post.size).toBe(1)
  })

  it('tx.withSession(s) carries the substituted session', async () => {
    const mock = createTxPrisma()
    const context = getContext(txConfig, mock.client, { userId: '1' })

    const seen = await context.transaction(async (tx) => {
      const withOther = tx.withSession({ userId: 'other' })
      return withOther.session
    })

    expect(seen).toEqual({ userId: 'other' })
  })
})
