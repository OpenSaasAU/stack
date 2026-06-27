import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getContext } from '../src/context/index.js'
import { config, list } from '../src/config/index.js'
import { text, relationship } from '../src/fields/index.js'

/**
 * #569 / ADR-0010: nested create/update/delete must run the SAME full hook
 * pipeline (list + field `beforeOperation`/`afterOperation`) as the equivalent
 * top-level write, with the documented arguments, inside ONE transaction that
 * rolls back if any hook throws.
 *
 * These tests use a transaction-aware in-memory Prisma mock so they can assert:
 *   - nested before/afterOperation fire with correct args;
 *   - side effects are identical nested vs top-level;
 *   - a throwing nested afterOperation rolls back the parent write (atomicity);
 *   - sudo still bypasses access while running hooks.
 */

/**
 * A tiny in-memory Prisma mock supporting interactive transactions.
 *
 * `$transaction(fn)` snapshots every table, runs `fn` against a tx client whose
 * writes mutate the live tables, and on throw restores the snapshot (rollback).
 * Nested writes are supported for to-one/to-many `create`/`update`/`delete`.
 */
function createTxPrisma() {
  const tables: Record<string, Map<string, Record<string, unknown>>> = {
    post: new Map(),
    user: new Map(),
    comment: new Map(),
  }
  let idCounter = 0
  const nextId = () => `id-${++idCounter}`

  function applyNested(
    table: string,
    record: Record<string, unknown>,
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    const result = { ...record }
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = value as Record<string, unknown>
        // Heuristic: a relationship op object has create/update/delete keys.
        if (nested.create || nested.update || nested.delete || nested.connect) {
          const relTable = key === 'author' ? 'user' : key === 'comments' ? 'comment' : key
          const linkField = `${key}Link`
          if (nested.create) {
            const created = doCreate(relTable, nested.create as Record<string, unknown>)
            result[linkField] = created.id
            result[key] = created
          }
          if (nested.update) {
            const upd = nested.update as { where: { id: string }; data: Record<string, unknown> }
            const updated = doUpdate(relTable, upd.where, upd.data)
            result[key] = updated
          }
          if (nested.delete) {
            const del = nested.delete as { id: string }
            doDelete(relTable, del)
            result[key] = null
          }
          continue
        }
      }
      result[key] = value
    }
    return result
  }

  function doCreate(table: string, data: Record<string, unknown>): Record<string, unknown> {
    const id = (data.id as string) ?? nextId()
    let record: Record<string, unknown> = { id }
    record = applyNested(table, record, data)
    tables[table].set(id, record)
    return record
  }

  function doUpdate(
    table: string,
    where: { id: string },
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    const existing = tables[table].get(where.id) ?? { id: where.id }
    const updated = applyNested(table, existing, data)
    tables[table].set(where.id, updated)
    return updated
  }

  function doDelete(table: string, where: { id: string }): Record<string, unknown> {
    const existing = tables[table].get(where.id) ?? { id: where.id }
    tables[table].delete(where.id)
    return existing
  }

  function makeModel(table: string) {
    return {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => tables[table].get(where.id) ?? null,
      ),
      findFirst: vi.fn(async ({ where }: { where?: { id?: string } }) => {
        if (where?.id) return tables[table].get(where.id) ?? null
        return tables[table].values().next().value ?? null
      }),
      findMany: vi.fn(async () => Array.from(tables[table].values())),
      count: vi.fn(async () => tables[table].size),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => doCreate(table, data)),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
          doUpdate(table, where, data),
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => doDelete(table, where)),
    }
  }

  const client: Record<string, unknown> = {
    post: makeModel('post'),
    user: makeModel('user'),
    comment: makeModel('comment'),
  }

  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    const snapshot: Record<string, Map<string, Record<string, unknown>>> = {}
    for (const [name, map] of Object.entries(tables)) {
      snapshot[name] = new Map(map)
    }
    try {
      return await fn(client)
    } catch (err) {
      // Roll back: restore every table from the snapshot.
      for (const [name, map] of Object.entries(snapshot)) {
        tables[name] = map
      }
      throw err
    }
  }

  return { client, tables }
}

describe('#569 nested writes — full hook pipeline + transaction', () => {
  let mock: ReturnType<typeof createTxPrisma>

  beforeEach(() => {
    mock = createTxPrisma()
    vi.clearAllMocks()
  })

  it('nested create fires list + field before/afterOperation with correct args', async () => {
    const events: string[] = []
    const listBefore = vi.fn(({ operation }) => {
      events.push(`list:before:${operation}`)
    })
    const listAfter = vi.fn(({ operation, item }) => {
      events.push(`list:after:${operation}`)
      expect(item).toBeDefined()
      expect(item.id).toBeDefined()
    })
    const fieldBefore = vi.fn(({ operation }) => {
      events.push(`field:before:${operation}`)
    })
    const fieldAfter = vi.fn(({ operation, item }) => {
      events.push(`field:after:${operation}`)
      expect(item.id).toBeDefined()
    })

    const testConfig = config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        User: list({
          fields: {
            name: text({ hooks: { beforeOperation: fieldBefore, afterOperation: fieldAfter } }),
          },
          access: { operation: { query: () => true, create: () => true, update: () => true } },
          hooks: { beforeOperation: listBefore, afterOperation: listAfter },
        }),
        Post: list({
          fields: {
            title: text(),
            author: relationship({ ref: 'User.posts' }),
          },
          access: { operation: { query: () => true, update: () => true } },
        }),
      },
    })

    mock.tables.post.set('p1', { id: 'p1', title: 'Original' })

    const context = getContext(await testConfig, mock.client, { userId: '1' })

    await context.db.post.update({
      where: { id: 'p1' },
      data: {
        title: 'Updated',
        author: { create: { name: 'john' } },
      },
    })

    // All four hooks fired, create operation, before strictly precedes after.
    expect(listBefore).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'create', listKey: 'User' }),
    )
    expect(fieldBefore).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'create', fieldKey: 'name' }),
    )
    expect(listAfter).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'create', listKey: 'User' }),
    )
    expect(fieldAfter).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'create', fieldKey: 'name' }),
    )
    expect(events.indexOf('list:before:create')).toBeLessThan(events.indexOf('list:after:create'))
  })

  it('nested update fires afterOperation with originalItem + updated item', async () => {
    const listAfter = vi.fn()

    const testConfig = config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        User: list({
          fields: { name: text() },
          access: { operation: { query: () => true, update: () => true } },
          hooks: { afterOperation: listAfter },
        }),
        Post: list({
          fields: { title: text(), author: relationship({ ref: 'User.posts' }) },
          access: { operation: { query: () => true, update: () => true } },
        }),
      },
    })

    mock.tables.post.set('p1', { id: 'p1', title: 'P', authorLink: 'u1' })
    mock.tables.user.set('u1', { id: 'u1', name: 'old name' })

    const context = getContext(await testConfig, mock.client, { userId: '1' })

    await context.db.post.update({
      where: { id: 'p1' },
      data: {
        author: { update: { where: { id: 'u1' }, data: { name: 'new name' } } },
      },
    })

    expect(listAfter).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'update',
        originalItem: expect.objectContaining({ id: 'u1', name: 'old name' }),
        item: expect.objectContaining({ id: 'u1', name: 'new name' }),
      }),
    )
  })

  it('nested delete fires before/afterOperation with originalItem', async () => {
    const listBefore = vi.fn()
    const listAfter = vi.fn()

    const testConfig = config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        Comment: list({
          fields: { body: text() },
          access: {
            operation: { query: () => true, update: () => true, delete: () => true },
          },
          hooks: { beforeOperation: listBefore, afterOperation: listAfter },
        }),
        Post: list({
          fields: {
            title: text(),
            comments: relationship({ ref: 'Comment', many: true }),
          },
          access: { operation: { query: () => true, update: () => true } },
        }),
      },
    })

    mock.tables.post.set('p1', { id: 'p1', title: 'P' })
    mock.tables.comment.set('c1', { id: 'c1', body: 'doomed' })

    const context = getContext(await testConfig, mock.client, { userId: '1' })

    await context.db.post.update({
      where: { id: 'p1' },
      data: { comments: { delete: { id: 'c1' } } },
    })

    expect(listBefore).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'delete',
        item: expect.objectContaining({ id: 'c1', body: 'doomed' }),
      }),
    )
    expect(listAfter).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'delete',
        originalItem: expect.objectContaining({ id: 'c1', body: 'doomed' }),
      }),
    )
  })

  it('side effect fires identically for nested vs top-level create', async () => {
    const sideEffects: string[] = []
    const afterOp = vi.fn(({ operation, item }) => {
      if (operation === 'create') sideEffects.push(`created:${item.name}`)
    })

    const makeConfig = () =>
      config({
        db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
        lists: {
          User: list({
            fields: { name: text() },
            access: { operation: { query: () => true, create: () => true, update: () => true } },
            hooks: { afterOperation: afterOp },
          }),
          Post: list({
            fields: { title: text(), author: relationship({ ref: 'User.posts' }) },
            access: { operation: { query: () => true, create: () => true, update: () => true } },
          }),
        },
      })

    // Top-level create.
    const ctx1 = getContext(await makeConfig(), mock.client, { userId: '1' })
    await ctx1.db.user.create({ data: { name: 'top-level' } })

    // Nested create (same logical operation).
    mock.tables.post.set('p1', { id: 'p1', title: 'P' })
    const ctx2 = getContext(await makeConfig(), mock.client, { userId: '1' })
    await ctx2.db.post.update({
      where: { id: 'p1' },
      data: { author: { create: { name: 'nested' } } },
    })

    expect(sideEffects).toContain('created:top-level')
    expect(sideEffects).toContain('created:nested')
  })

  it('a throwing nested afterOperation rolls back the parent write (atomicity)', async () => {
    const testConfig = config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        User: list({
          fields: { name: text() },
          access: { operation: { query: () => true, create: () => true, update: () => true } },
          hooks: {
            afterOperation: ({ operation }) => {
              if (operation === 'create') {
                throw new Error('nested afterOperation boom')
              }
            },
          },
        }),
        Post: list({
          fields: { title: text(), author: relationship({ ref: 'User.posts' }) },
          access: { operation: { query: () => true, update: () => true } },
        }),
      },
    })

    mock.tables.post.set('p1', { id: 'p1', title: 'Original' })

    const context = getContext(await testConfig, mock.client, { userId: '1' })

    await expect(
      context.db.post.update({
        where: { id: 'p1' },
        data: {
          title: 'Should NOT persist',
          author: { create: { name: 'doomed' } },
        },
      }),
    ).rejects.toThrow('nested afterOperation boom')

    // Rollback: the parent title is unchanged and the nested user is gone.
    expect(mock.tables.post.get('p1')?.title).toBe('Original')
    expect(mock.tables.user.size).toBe(0)
  })

  it('a throwing nested beforeOperation rolls back and never persists', async () => {
    const testConfig = config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        User: list({
          fields: { name: text() },
          access: { operation: { query: () => true, create: () => true, update: () => true } },
          hooks: {
            beforeOperation: ({ operation }) => {
              if (operation === 'create') throw new Error('nested beforeOperation boom')
            },
          },
        }),
        Post: list({
          fields: { title: text(), author: relationship({ ref: 'User.posts' }) },
          access: { operation: { query: () => true, update: () => true } },
        }),
      },
    })

    mock.tables.post.set('p1', { id: 'p1', title: 'Original' })
    const context = getContext(await testConfig, mock.client, { userId: '1' })

    await expect(
      context.db.post.update({
        where: { id: 'p1' },
        data: { title: 'nope', author: { create: { name: 'doomed' } } },
      }),
    ).rejects.toThrow('nested beforeOperation boom')

    expect(mock.tables.post.get('p1')?.title).toBe('Original')
    expect(mock.tables.user.size).toBe(0)
  })

  it('sudo bypasses access on nested create but still runs hooks', async () => {
    const createAccess = vi.fn(() => false as const)
    const afterOp = vi.fn()

    const testConfig = config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        User: list({
          fields: { name: text() },
          access: { operation: { query: () => true, create: createAccess, update: () => true } },
          hooks: { afterOperation: afterOp },
        }),
        Post: list({
          fields: { title: text(), author: relationship({ ref: 'User.posts' }) },
          access: { operation: { query: () => true, update: () => true } },
        }),
      },
    })

    mock.tables.post.set('p1', { id: 'p1', title: 'P' })
    const context = getContext(await testConfig, mock.client, { userId: '1' }).sudo()

    await context.db.post.update({
      where: { id: 'p1' },
      data: { author: { create: { name: 'sudo-made' } } },
    })

    // Access denied normally; sudo bypasses the access fn, but hooks still run.
    expect(createAccess).not.toHaveBeenCalled()
    expect(afterOp).toHaveBeenCalledWith(expect.objectContaining({ operation: 'create' }))
    expect(mock.tables.user.size).toBe(1)
  })

  it('non-sudo nested create denied by access throws and rolls back', async () => {
    const testConfig = config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        User: list({
          fields: { name: text() },
          access: { operation: { query: () => true, create: () => false, update: () => true } },
        }),
        Post: list({
          fields: { title: text(), author: relationship({ ref: 'User.posts' }) },
          access: { operation: { query: () => true, update: () => true } },
        }),
      },
    })

    mock.tables.post.set('p1', { id: 'p1', title: 'Original' })
    const context = getContext(await testConfig, mock.client, { userId: '1' })

    await expect(
      context.db.post.update({
        where: { id: 'p1' },
        data: { title: 'nope', author: { create: { name: 'denied' } } },
      }),
    ).rejects.toThrow('Access denied: Cannot create related item')

    // The whole write rolled back — parent title unchanged.
    expect(mock.tables.post.get('p1')?.title).toBe('Original')
  })

  it('every write is transactional — top-level create uses $transaction', async () => {
    const txSpy = vi.spyOn(
      mock.client as { $transaction: unknown } & Record<string, unknown>,
      '$transaction',
    )

    const testConfig = config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        User: list({
          fields: { name: text() },
          access: { operation: { query: () => true, create: () => true } },
        }),
      },
    })

    const context = getContext(await testConfig, mock.client, { userId: '1' })
    await context.db.user.create({ data: { name: 'solo' } })

    expect(txSpy).toHaveBeenCalledTimes(1)
  })
})
