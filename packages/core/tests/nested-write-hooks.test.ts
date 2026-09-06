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
    Post: new Map(),
    User: new Map(),
    Comment: new Map(),
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
          const relTable = key === 'author' ? 'User' : key === 'comments' ? 'Comment' : key
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
    Post: makeModel('Post'),
    User: makeModel('User'),
    Comment: makeModel('Comment'),
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

    mock.tables.Post.set('p1', { id: 'p1', title: 'Original' })

    const context = getContext(await testConfig, mock.client, { userId: '1' })

    await context.db.Post.update({
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

    mock.tables.Post.set('p1', { id: 'p1', title: 'P', authorLink: 'u1' })
    mock.tables.User.set('u1', { id: 'u1', name: 'old name' })

    const context = getContext(await testConfig, mock.client, { userId: '1' })

    await context.db.Post.update({
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

    mock.tables.Post.set('p1', { id: 'p1', title: 'P' })
    mock.tables.Comment.set('c1', { id: 'c1', body: 'doomed' })

    const context = getContext(await testConfig, mock.client, { userId: '1' })

    await context.db.Post.update({
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
    await ctx1.db.User.create({ data: { name: 'top-level' } })

    // Nested create (same logical operation).
    mock.tables.Post.set('p1', { id: 'p1', title: 'P' })
    const ctx2 = getContext(await makeConfig(), mock.client, { userId: '1' })
    await ctx2.db.Post.update({
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

    mock.tables.Post.set('p1', { id: 'p1', title: 'Original' })

    const context = getContext(await testConfig, mock.client, { userId: '1' })

    await expect(
      context.db.Post.update({
        where: { id: 'p1' },
        data: {
          title: 'Should NOT persist',
          author: { create: { name: 'doomed' } },
        },
      }),
    ).rejects.toThrow('nested afterOperation boom')

    // Rollback: the parent title is unchanged and the nested user is gone.
    expect(mock.tables.Post.get('p1')?.title).toBe('Original')
    expect(mock.tables.User.size).toBe(0)
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

    mock.tables.Post.set('p1', { id: 'p1', title: 'Original' })
    const context = getContext(await testConfig, mock.client, { userId: '1' })

    await expect(
      context.db.Post.update({
        where: { id: 'p1' },
        data: { title: 'nope', author: { create: { name: 'doomed' } } },
      }),
    ).rejects.toThrow('nested beforeOperation boom')

    expect(mock.tables.Post.get('p1')?.title).toBe('Original')
    expect(mock.tables.User.size).toBe(0)
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

    mock.tables.Post.set('p1', { id: 'p1', title: 'P' })
    const context = getContext(await testConfig, mock.client, { userId: '1' }).sudo()

    await context.db.Post.update({
      where: { id: 'p1' },
      data: { author: { create: { name: 'sudo-made' } } },
    })

    // Access denied normally; sudo bypasses the access fn, but hooks still run.
    expect(createAccess).not.toHaveBeenCalled()
    expect(afterOp).toHaveBeenCalledWith(expect.objectContaining({ operation: 'create' }))
    expect(mock.tables.User.size).toBe(1)
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

    mock.tables.Post.set('p1', { id: 'p1', title: 'Original' })
    const context = getContext(await testConfig, mock.client, { userId: '1' })

    await expect(
      context.db.Post.update({
        where: { id: 'p1' },
        data: { title: 'nope', author: { create: { name: 'denied' } } },
      }),
    ).rejects.toThrow('Access denied: Cannot create related item')

    // The whole write rolled back — parent title unchanged.
    expect(mock.tables.Post.get('p1')?.title).toBe('Original')
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
    await context.db.User.create({ data: { name: 'solo' } })

    expect(txSpy).toHaveBeenCalledTimes(1)
  })
})

/**
 * A richer transaction-aware mock that models a to-many relation
 * (`Post.comments`) with real link tracking and `include`-echoing, so the
 * created-row recovery (#569 finding 1+2) can be exercised against the actual
 * id-diff: each created comment gets a fresh id, the parent `update`/`create`
 * result echoes `include: { comments: true }` with the linked rows, and
 * pre-existing comments are preserved.
 */
function createToManyPrisma() {
  const tables: Record<string, Map<string, Record<string, unknown>>> = {
    Post: new Map(),
    Comment: new Map(),
  }
  // commentId -> postId link.
  const commentToPost = new Map<string, string>()
  let idCounter = 0
  const nextId = () => `c-${++idCounter}`

  function linkedComments(postId: string): Array<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = []
    for (const [commentId, owner] of commentToPost.entries()) {
      if (owner === postId) {
        const row = tables.Comment.get(commentId)
        if (row) rows.push(row)
      }
    }
    return rows
  }

  function applyCommentOps(postId: string, ops: Record<string, unknown>) {
    if (ops.create) {
      const creates = Array.isArray(ops.create) ? ops.create : [ops.create]
      for (const data of creates as Array<Record<string, unknown>>) {
        const id = (data.id as string) ?? nextId()
        const row: Record<string, unknown> = { id, ...data }
        tables.Comment.set(id, row)
        commentToPost.set(id, postId)
      }
    }
    if (ops.update) {
      const updates = Array.isArray(ops.update) ? ops.update : [ops.update]
      for (const u of updates as Array<{ where: { id: string }; data: Record<string, unknown> }>) {
        const existing = tables.Comment.get(u.where.id) ?? { id: u.where.id }
        tables.Comment.set(u.where.id, { ...existing, ...u.data })
      }
    }
    if (ops.delete) {
      const deletes = Array.isArray(ops.delete) ? ops.delete : [ops.delete]
      for (const d of deletes as Array<{ id: string }>) {
        tables.Comment.delete(d.id)
        commentToPost.delete(d.id)
      }
    }
  }

  function buildPostResult(
    postId: string,
    include: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    const base = tables.Post.get(postId) ?? { id: postId }
    if (include?.comments) {
      return { ...base, comments: linkedComments(postId) }
    }
    return { ...base }
  }

  const postModel = {
    findUnique: vi.fn(
      async ({ where, include }: { where: { id: string }; include?: Record<string, unknown> }) => {
        if (!tables.Post.has(where.id)) return null
        return buildPostResult(where.id, include)
      },
    ),
    findFirst: vi.fn(async ({ where }: { where?: { id?: string } }) => {
      if (where?.id) return tables.Post.get(where.id) ?? null
      return tables.Post.values().next().value ?? null
    }),
    findMany: vi.fn(async () => Array.from(tables.Post.values())),
    count: vi.fn(async () => tables.Post.size),
    create: vi.fn(
      async ({
        data,
        include,
      }: {
        data: Record<string, unknown>
        include?: Record<string, unknown>
      }) => {
        const id = (data.id as string) ?? `p-${++idCounter}`
        const { comments, ...scalars } = data
        tables.Post.set(id, { id, ...scalars })
        if (comments) applyCommentOps(id, comments as Record<string, unknown>)
        return buildPostResult(id, include)
      },
    ),
    update: vi.fn(
      async ({
        where,
        data,
        include,
      }: {
        where: { id: string }
        data: Record<string, unknown>
        include?: Record<string, unknown>
      }) => {
        const existing = tables.Post.get(where.id) ?? { id: where.id }
        const { comments, ...scalars } = data
        tables.Post.set(where.id, { ...existing, ...scalars })
        if (comments) applyCommentOps(where.id, comments as Record<string, unknown>)
        return buildPostResult(where.id, include)
      },
    ),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      const existing = tables.Post.get(where.id) ?? { id: where.id }
      tables.Post.delete(where.id)
      return existing
    }),
  }

  function makeCommentModel() {
    return {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => tables.Comment.get(where.id) ?? null,
      ),
      findFirst: vi.fn(async () => tables.Comment.values().next().value ?? null),
      findMany: vi.fn(async () => Array.from(tables.Comment.values())),
      count: vi.fn(async () => tables.Comment.size),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = (data.id as string) ?? nextId()
        const row = { id, ...data }
        tables.Comment.set(id, row)
        return row
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const existing = tables.Comment.get(where.id) ?? { id: where.id }
          const updated = { ...existing, ...data }
          tables.Comment.set(where.id, updated)
          return updated
        },
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const existing = tables.Comment.get(where.id) ?? { id: where.id }
        tables.Comment.delete(where.id)
        commentToPost.delete(where.id)
        return existing
      }),
    }
  }

  const client: Record<string, unknown> = {
    Post: postModel,
    Comment: makeCommentModel(),
  }

  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    const snapshot = {
      post: new Map(tables.Post),
      comment: new Map(tables.Comment),
      links: new Map(commentToPost),
    }
    try {
      return await fn(client)
    } catch (err) {
      tables.Post = snapshot.post
      tables.Comment = snapshot.comment
      commentToPost.clear()
      for (const [k, v] of snapshot.links) commentToPost.set(k, v)
      throw err
    }
  }

  /** Link a pre-existing comment to a post (test setup helper). */
  function seedComment(postId: string, comment: Record<string, unknown>) {
    tables.Comment.set(comment.id as string, comment)
    commentToPost.set(comment.id as string, postId)
  }

  return { client, tables, seedComment, linkedComments }
}

describe('#569 nested writes — created-row recovery by id-diff (findings 1 + 2)', () => {
  function makeConfig(afterOp: ReturnType<typeof vi.fn>) {
    return config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        Comment: list({
          fields: { body: text() },
          access: { operation: { query: () => true, create: () => true, update: () => true } },
          hooks: { afterOperation: afterOp },
        }),
        Post: list({
          fields: {
            title: text(),
            comments: relationship({ ref: 'Comment', many: true }),
          },
          access: { operation: { query: () => true, create: () => true, update: () => true } },
        }),
      },
    })
  }

  it('multiple nested creates on a to-many relation each fire afterOperation once with their OWN distinct row', async () => {
    const mock = createToManyPrisma()
    const created: Array<{ id: unknown; body: unknown }> = []
    const afterOp = vi.fn(({ operation, item }) => {
      if (operation === 'create') created.push({ id: item.id, body: item.body })
    })

    mock.tables.Post.set('p1', { id: 'p1', title: 'P' })
    const context = getContext(await makeConfig(afterOp), mock.client, { userId: '1' })

    await context.db.Post.update({
      where: { id: 'p1' },
      data: {
        comments: { create: [{ body: 'A' }, { body: 'B' }] },
      },
    })

    // afterOperation fired exactly once per created comment.
    const createEvents = afterOp.mock.calls.filter((c) => c[0].operation === 'create')
    expect(createEvents).toHaveLength(2)

    // Each fired against its OWN distinct, persisted row — distinct ids, the two
    // bodies, never the same row twice (the original bug recovered fresh[last]
    // for every create).
    expect(created).toHaveLength(2)
    const ids = created.map((c) => c.id)
    expect(new Set(ids).size).toBe(2)
    for (const id of ids) expect(typeof id).toBe('string')
    expect(created.map((c) => c.body).sort()).toEqual(['A', 'B'])
  })

  it('nested create on a to-many relation with pre-existing rows fires afterOperation ONLY for the newly-created row', async () => {
    const mock = createToManyPrisma()
    const createdItems: Array<Record<string, unknown>> = []
    const afterOp = vi.fn(({ operation, item }) => {
      if (operation === 'create') createdItems.push(item)
    })

    // A post that already has a pre-existing comment.
    mock.tables.Post.set('p1', { id: 'p1', title: 'P' })
    mock.seedComment('p1', { id: 'pre-1', body: 'pre-existing' })

    const context = getContext(await makeConfig(afterOp), mock.client, { userId: '1' })

    await context.db.Post.update({
      where: { id: 'p1' },
      data: { comments: { create: { body: 'brand-new' } } },
    })

    // Exactly one create afterOperation — for the new row, NOT the pre-existing one.
    const createEvents = afterOp.mock.calls.filter((c) => c[0].operation === 'create')
    expect(createEvents).toHaveLength(1)
    expect(createdItems).toHaveLength(1)
    expect(createdItems[0].id).not.toBe('pre-1')
    expect(createdItems[0].body).toBe('brand-new')

    // Both comments now exist in the DB (pre-existing preserved).
    expect(
      mock
        .linkedComments('p1')
        .map((c) => c.body)
        .sort(),
    ).toEqual(['brand-new', 'pre-existing'])
  })
})

describe('#569 nested writes — context.db inside hooks is transactional (finding 3)', () => {
  it('a hook writing via context.db rolls back when the transaction later throws', async () => {
    const mock = createToManyPrisma()

    // The Comment afterOperation writes a SECOND comment via context.db, then a
    // later (post) afterOperation throws — the whole transaction must roll back,
    // including the context.db write, leaving NO comments persisted.
    const testConfig = config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        Comment: list({
          fields: { body: text() },
          access: { operation: { query: () => true, create: () => true, update: () => true } },
          hooks: {
            afterOperation: async ({ operation, item, context }) => {
              // Only the originally-created comment triggers the side-write, and
              // guard against recursion (the side-write is body 'audit').
              if (operation === 'create' && item.body === 'main') {
                await context.db.Comment.create({ data: { body: 'audit' } })
              }
            },
          },
        }),
        Post: list({
          fields: {
            title: text(),
            comments: relationship({ ref: 'Comment', many: true }),
          },
          access: { operation: { query: () => true, create: () => true, update: () => true } },
          hooks: {
            afterOperation: ({ operation }) => {
              if (operation === 'update') throw new Error('post afterOperation boom')
            },
          },
        }),
      },
    })

    mock.tables.Post.set('p1', { id: 'p1', title: 'P' })
    const context = getContext(await testConfig, mock.client, { userId: '1' })

    await expect(
      context.db.Post.update({
        where: { id: 'p1' },
        data: { comments: { create: { body: 'main' } } },
      }),
    ).rejects.toThrow('post afterOperation boom')

    // Rollback: neither the nested 'main' comment nor the hook's 'audit'
    // context.db write survived — proving the hook's context.db participated in
    // the same transaction.
    expect(mock.tables.Comment.size).toBe(0)
  })

  it('a hook writing via context.db persists when the transaction commits', async () => {
    const mock = createToManyPrisma()

    const testConfig = config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        Comment: list({
          fields: { body: text() },
          access: { operation: { query: () => true, create: () => true, update: () => true } },
          hooks: {
            afterOperation: async ({ operation, item, context }) => {
              if (operation === 'create' && item.body === 'main') {
                await context.db.Comment.create({ data: { body: 'audit' } })
              }
            },
          },
        }),
        Post: list({
          fields: {
            title: text(),
            comments: relationship({ ref: 'Comment', many: true }),
          },
          access: { operation: { query: () => true, create: () => true, update: () => true } },
        }),
      },
    })

    mock.tables.Post.set('p1', { id: 'p1', title: 'P' })
    const context = getContext(await testConfig, mock.client, { userId: '1' })

    await context.db.Post.update({
      where: { id: 'p1' },
      data: { comments: { create: { body: 'main' } } },
    })

    // Commit: both the nested 'main' comment and the hook's 'audit' write
    // persisted.
    expect(
      Array.from(mock.tables.Comment.values())
        .map((c) => c.body)
        .sort(),
    ).toEqual(['audit', 'main'])
  })
})
