import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getContext } from '../src/context/index.js'
import type { Session } from '../src/access/types.js'
import type { OpenSaasConfig } from '../src/config/types.js'
import { config, list } from '../src/config/index.js'
import { text } from '../src/fields/index.js'
import { prisma8Double } from './prisma8-double.js'

/**
 * #590 / ADR-0010: transaction-boundary hooks (`beforeTransaction` /
 * `afterTransaction`) run OUTSIDE the write's transaction — `beforeTransaction`
 * before it opens, `afterTransaction` after it settles (always, with the
 * commit/rollback outcome). They form a per-list compensation bracket around the
 * atomic write.
 *
 * These tests run over a transaction-aware in-memory ORM double so they can
 * assert commit/rollback outcomes, the symmetric-bracket always-run rule,
 * compensation when an afterTransaction itself throws, field-level variants,
 * and that sudo does not affect these hooks.
 */

function createTxPrisma(extraTables: string[] = []) {
  const tables: Record<string, Map<string, Record<string, unknown>>> = {
    Post: new Map(),
    User: new Map(),
    Comment: new Map(),
  }
  for (const table of extraTables) tables[table] = new Map()
  let idCounter = 0
  const nextId = () => `id-${++idCounter}`

  function doCreate(table: string, data: Record<string, unknown>): Record<string, unknown> {
    const id = (data.id as string) ?? nextId()
    const record = { id, ...data }
    tables[table].set(id, record)
    return record
  }

  function doUpdate(
    table: string,
    id: string,
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    const updated = { ...(tables[table].get(id) ?? { id }), ...data }
    tables[table].set(id, updated)
    return updated
  }

  function makeModel(table: string) {
    // These suites hold at most one row per table, so the row the composed
    // predicate would match is the first — which is what `first()` answers.
    const target = () => tables[table].values().next().value
    const model = {
      where: vi.fn(() => model),
      first: vi.fn(async () => target() ?? null),
      aggregate: vi.fn(async () => ({ rows: tables[table].size })),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => tables[table].get(where.id) ?? null,
      ),
      findFirst: vi.fn(async ({ where }: { where?: { id?: string } } = {}) => {
        if (where?.id) return tables[table].get(where.id) ?? null
        return target() ?? null
      }),
      findMany: vi.fn(async () => Array.from(tables[table].values())),
      count: vi.fn(async () => tables[table].size),
      create: vi.fn(async (data: Record<string, unknown>) => doCreate(table, data)),
      update: vi.fn(async (data: Record<string, unknown>) =>
        doUpdate(table, (target()?.id as string) ?? nextId(), data),
      ),
      delete: vi.fn(async () => {
        const row = target()
        if (row === undefined) return null
        tables[table].delete(row.id as string)
        return row
      }),
    }
    return model
  }

  const client: Record<string, unknown> = {
    Post: makeModel('Post'),
    User: makeModel('User'),
    Comment: makeModel('Comment'),
  }
  for (const table of extraTables) client[table] = makeModel(table)

  const prisma8 = prisma8Double(client, tables)

  return {
    client,
    tables,
    context: (cfg: OpenSaasConfig, session: Session | null) =>
      getContext(cfg, client, session, undefined, false, undefined, undefined, prisma8),
  }
}

describe('#590 transaction-boundary hooks', () => {
  let mock: ReturnType<typeof createTxPrisma>

  beforeEach(() => {
    mock = createTxPrisma()
    vi.clearAllMocks()
  })

  it('commit path: afterTransaction fires with status committed + the persisted item', async () => {
    const before = vi.fn()
    const after = vi.fn()

    const testConfig = config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        User: list({
          fields: { name: text() },
          access: { operation: { query: () => true, create: () => true } },
          hooks: { beforeTransaction: before, afterTransaction: after },
        }),
      },
    })

    const context = mock.context(await testConfig, { userId: '1' })
    const created = await context.db.User.create({ data: { name: 'jane' } })

    expect(created).toBeTruthy()
    expect(before).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'create', listKey: 'User' }),
    )
    expect(after).toHaveBeenCalledTimes(1)
    const arg = after.mock.calls[0][0]
    expect(arg.status).toBe('committed')
    expect(arg.item).toEqual(expect.objectContaining({ name: 'jane' }))
    expect(arg.error).toBeUndefined()
  })

  it('beforeTransaction runs before the transaction opens (no writes yet)', async () => {
    const order: string[] = []
    const testConfig = config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        User: list({
          fields: { name: text() },
          access: { operation: { query: () => true, create: () => true } },
          hooks: {
            beforeTransaction: () => {
              // No rows persisted at this point.
              order.push(`before:size=${mock.tables.User.size}`)
            },
            afterTransaction: () => {
              order.push(`after:size=${mock.tables.User.size}`)
            },
          },
        }),
      },
    })

    const context = mock.context(await testConfig, { userId: '1' })
    await context.db.User.create({ data: { name: 'jane' } })

    expect(order).toEqual(['before:size=0', 'after:size=1'])
  })

  it('rollback path (thrown afterOperation): afterTransaction fires rolled-back + error + no item', async () => {
    const after = vi.fn()

    const testConfig = config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        User: list({
          fields: { name: text() },
          access: { operation: { query: () => true, create: () => true } },
          hooks: {
            // In-transaction afterOperation throws → the transaction rolls back.
            afterOperation: async () => {
              throw new Error('in-tx boom')
            },
            afterTransaction: after,
          },
        }),
      },
    })

    const context = mock.context(await testConfig, { userId: '1' })

    await expect(context.db.User.create({ data: { name: 'jane' } })).rejects.toThrow('in-tx boom')

    expect(after).toHaveBeenCalledTimes(1)
    const arg = after.mock.calls[0][0]
    expect(arg.status).toBe('rolled-back')
    expect(arg.error).toBeInstanceOf(Error)
    expect((arg.error as Error).message).toBe('in-tx boom')
    expect(arg.item).toBeUndefined()
    expect(arg.inputData).toEqual(expect.objectContaining({ name: 'jane' }))
    // Nothing persisted.
    expect(mock.tables.User.size).toBe(0)
  })

  it('a thrown beforeTransaction aborts the write and still fires its afterTransaction', async () => {
    const events: string[] = []

    const testConfig = config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        User: list({
          fields: { name: text() },
          access: { operation: { query: () => true, create: () => true } },
          hooks: {
            beforeTransaction: () => {
              events.push('user:before')
              throw new Error('user before boom')
            },
            afterTransaction: ({ status }) => {
              events.push(`user:after:${status}`)
            },
          },
        }),
        // A list that is NOT involved in the write — must get neither hook.
        Comment: list({
          fields: { body: text() },
          access: { operation: { query: () => true, create: () => true } },
          hooks: {
            beforeTransaction: () => events.push('comment:before'),
            afterTransaction: () => events.push('comment:after'),
          },
        }),
      },
    })

    const context = mock.context(await testConfig, { userId: '1' })

    await expect(context.db.User.create({ data: { name: 'x' } })).rejects.toThrow(
      'user before boom',
    )

    // The bracket is symmetric: a list whose beforeTransaction ran gets its
    // afterTransaction whatever happened. The uninvolved list gets neither, and
    // the transaction was never opened.
    expect(events).toEqual(['user:before', 'user:after:rolled-back'])
    expect(mock.tables.User.size).toBe(0)
  })

  it('a throwing afterTransaction does not prevent the other compensators running', async () => {
    const fired: string[] = []

    const testConfig = config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        Post: list({
          fields: {
            title: text({
              hooks: {
                afterTransaction: () => {
                  fired.push('field')
                },
              },
            }),
          },
          access: { operation: { query: () => true, update: () => true } },
          hooks: {
            afterTransaction: () => {
              fired.push('list')
              throw new Error('list after boom')
            },
          },
        }),
      },
    })

    mock.tables.Post.set('p1', { id: 'p1', title: 'Original' })

    const context = mock.context(await testConfig, { userId: '1' })

    // The write itself committed; the surfaced error is the compensator's.
    await expect(
      context.db.Post.update({ where: { id: 'p1' }, data: { title: 'Updated' } }),
    ).rejects.toThrow(/afterTransaction hook\(s\) failed/)

    // The field-level compensator still ran after the list-level one threw.
    expect(fired).toEqual(['list', 'field'])
    // DB state is final (the write committed).
    expect((mock.tables.Post.get('p1') as Record<string, unknown>).title).toBe('Updated')
  })

  it('field-level beforeTransaction / afterTransaction variants fire', async () => {
    const fieldBefore = vi.fn()
    const fieldAfter = vi.fn()

    const testConfig = config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        User: list({
          fields: {
            name: text({
              hooks: { beforeTransaction: fieldBefore, afterTransaction: fieldAfter },
            }),
          },
          access: { operation: { query: () => true, create: () => true } },
        }),
      },
    })

    const context = mock.context(await testConfig, { userId: '1' })
    await context.db.User.create({ data: { name: 'jane' } })

    expect(fieldBefore).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'create', fieldKey: 'name' }),
    )
    expect(fieldAfter).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'committed', operation: 'create', fieldKey: 'name' }),
    )
  })

  it('sudo path still runs transaction-boundary hooks', async () => {
    const before = vi.fn()
    const after = vi.fn()

    const testConfig = config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        User: list({
          fields: { name: text() },
          // create access denies normally; sudo bypasses access only.
          access: { operation: { query: () => true, create: () => false } },
          hooks: { beforeTransaction: before, afterTransaction: after },
        }),
      },
    })

    const context = mock.context(await testConfig, { userId: '1' }).sudo()
    const created = await context.db.User.create({ data: { name: 'sudo-made' } })

    expect(created).toBeTruthy()
    expect(before).toHaveBeenCalledTimes(1)
    expect(after).toHaveBeenCalledWith(expect.objectContaining({ status: 'committed' }))
  })

  it('access-denied (non-sudo) write fires NEITHER transaction-boundary hook', async () => {
    const before = vi.fn()
    const after = vi.fn()

    const testConfig = config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        User: list({
          fields: { name: text() },
          access: { operation: { query: () => true, create: () => false } },
          hooks: { beforeTransaction: before, afterTransaction: after },
        }),
      },
    })

    const context = mock.context(await testConfig, { userId: '1' })
    const created = await context.db.User.create({ data: { name: 'jane' } })

    // Silent failure: a denied create returns null and takes no external action.
    expect(created).toBeNull()
    expect(before).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
  })
})
