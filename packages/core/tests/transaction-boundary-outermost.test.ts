import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getContext } from '../src/context/index.js'
import { config, list } from '../src/config/index.js'
import { text, relationship } from '../src/fields/index.js'

/**
 * ADR-0028 / #899: a transaction-boundary hook reports the OUTERMOST
 * transaction a write participates in, not the return of its own write.
 *
 * A write that joins a transaction it did not open (a JOINED write — either
 * inside `context.transaction()`, or a hook's own `context.db` write inside a
 * plain top-level write) defers its `afterTransaction` bracket until the
 * transaction OWNER observes the real settle, instead of firing immediately.
 *
 * Per the ADR's verification note, these tests use a FAITHFUL transaction
 * mock — the `tx` client handed to `$transaction`'s callback omits
 * `$transaction` itself, mirroring real Prisma — because the bug is invisible
 * under a mock whose transaction client still exposes `$transaction` (a
 * nested write would open its own transaction rather than joining).
 */

function createFaithfulTxPrisma(extraTables: string[] = []) {
  const tables: Record<string, Map<string, Record<string, unknown>>> = {
    post: new Map(),
    user: new Map(),
    comment: new Map(),
  }
  for (const table of extraTables) tables[table] = new Map()
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
        if (nested.create || nested.update || nested.delete || nested.connect) {
          const relTable = key === 'author' ? 'user' : key === 'comments' ? 'comment' : key
          if (nested.create) {
            const created = doCreate(relTable, nested.create as Record<string, unknown>)
            result[key] = created
          }
          if (nested.update) {
            const upd = nested.update as { where: { id: string }; data: Record<string, unknown> }
            result[key] = doUpdate(relTable, upd.where, upd.data)
          }
          if (nested.delete) {
            doDelete(relTable, nested.delete as { id: string })
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
      findFirst: vi.fn(async ({ where }: { where?: { id?: string } } = {}) => {
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
  for (const table of extraTables) client[table] = makeModel(table)

  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    const snapshot: Record<string, Map<string, Record<string, unknown>>> = {}
    for (const [name, map] of Object.entries(tables)) {
      snapshot[name] = new Map(map)
    }
    // Faithful to real Prisma: the tx client has the model delegates but NOT
    // `$transaction` — this is how a nested write detects it must join rather
    // than open a second transaction.
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

const baseConfig = (hooks: {
  user?: Record<string, unknown>
  post?: Record<string, unknown>
  comment?: Record<string, unknown>
}) =>
  config({
    db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
    lists: {
      User: list({
        fields: { name: text() },
        access: { operation: { query: () => true, create: () => true, update: () => true } },
        hooks: hooks.user,
      }),
      Post: list({
        fields: { title: text(), author: relationship({ ref: 'User.posts' }) },
        access: { operation: { query: () => true, create: () => true, update: () => true } },
        hooks: hooks.post,
      }),
      Comment: list({
        fields: { body: text() },
        access: { operation: { query: () => true, create: () => true, update: () => true } },
        hooks: hooks.comment,
      }),
    },
  })

describe('ADR-0028 / #899: context.transaction() joined writes defer to the owner settle', () => {
  let mock: ReturnType<typeof createFaithfulTxPrisma>

  beforeEach(() => {
    mock = createFaithfulTxPrisma()
    vi.clearAllMocks()
  })

  it('commit: afterTransaction fires once, AFTER the callback returns, with status committed', async () => {
    const events: string[] = []
    const after = vi.fn(() => events.push('after'))

    const testConfig = await baseConfig({ user: { afterTransaction: after } })
    const context = getContext(testConfig, mock.client, { userId: '1' })

    const result = await context.transaction(async (tx) => {
      const user = await tx.db.user.create({ data: { name: 'jane' } })
      events.push('callback-write-done')
      // afterTransaction must NOT have fired yet — the outer transaction has
      // not settled while the callback is still running.
      expect(after).not.toHaveBeenCalled()
      return user
    })

    expect(events).toEqual(['callback-write-done', 'after'])
    expect(after).toHaveBeenCalledTimes(1)
    const arg = after.mock.calls[0][0]
    expect(arg.status).toBe('committed')
    expect(arg.item).toEqual(expect.objectContaining({ name: 'jane' }))
    expect(result).toEqual(expect.objectContaining({ name: 'jane' }))
  })

  it('rollback: afterTransaction fires exactly once with status rolled-back and the callback error', async () => {
    const after = vi.fn()
    const testConfig = await baseConfig({ user: { afterTransaction: after } })
    const context = getContext(testConfig, mock.client, { userId: '1' })

    await expect(
      context.transaction(async (tx) => {
        await tx.db.user.create({ data: { name: 'jane' } })
        throw new Error('callback boom')
      }),
    ).rejects.toThrow('callback boom')

    expect(after).toHaveBeenCalledTimes(1)
    const arg = after.mock.calls[0][0]
    expect(arg.status).toBe('rolled-back')
    expect(arg.error).toBeInstanceOf(Error)
    expect((arg.error as Error).message).toBe('callback boom')
    expect(arg.item).toBeUndefined()
    expect(mock.tables.user.size).toBe(0)
  })

  it('beforeTransaction stays eager: runs during the callback, before the write settles', async () => {
    const order: string[] = []
    const testConfig = await baseConfig({
      user: {
        beforeTransaction: () => order.push('before'),
        afterTransaction: () => order.push('after'),
      },
    })
    const context = getContext(testConfig, mock.client, { userId: '1' })

    await context.transaction(async (tx) => {
      order.push('callback-start')
      await tx.db.user.create({ data: { name: 'jane' } })
      order.push('callback-end')
    })

    expect(order).toEqual(['callback-start', 'before', 'callback-end', 'after'])
  })

  it('three writes to the same list in one transaction flush in write order', async () => {
    const order: string[] = []
    const testConfig = await baseConfig({
      user: {
        beforeTransaction: ({ inputData }) => order.push(`before:${inputData?.name}`),
        afterTransaction: ({ inputData }) => order.push(`after:${inputData?.name}`),
      },
    })
    const context = getContext(testConfig, mock.client, { userId: '1' })

    await context.transaction(async (tx) => {
      await tx.db.user.create({ data: { name: 'a' } })
      await tx.db.user.create({ data: { name: 'b' } })
      await tx.db.user.create({ data: { name: 'c' } })
    })

    expect(order).toEqual(['before:a', 'before:b', 'before:c', 'after:a', 'after:b', 'after:c'])
  })

  it("a write's own error takes precedence over the transaction's outcome even when the transaction commits", async () => {
    const userAfter = vi.fn()
    const postAfter = vi.fn()
    // A dedicated config: User.name is required, so a create with no `name`
    // throws ValidationError — the write's OWN failure — independent of
    // whatever the surrounding transaction ultimately does.
    const testConfig = await config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        User: list({
          fields: { name: text({ validation: { isRequired: true } }) },
          access: { operation: { query: () => true, create: () => true } },
          hooks: { afterTransaction: userAfter },
        }),
        Post: list({
          fields: { title: text() },
          access: { operation: { query: () => true, create: () => true } },
          hooks: { afterTransaction: postAfter },
        }),
      },
    })
    const context = getContext(testConfig, mock.client, { userId: '1' })

    const result = await context.transaction(async (tx) => {
      let userError: unknown
      try {
        // Missing the required `name` — throws ValidationError, the write's
        // OWN failure, independent of the enclosing transaction's fate.
        await tx.db.user.create({ data: {} })
      } catch (err) {
        userError = err
      }
      await tx.db.post.create({ data: { title: 'ok' } })
      return { userError: userError instanceof Error ? userError.message : undefined }
    })

    // The transaction committed overall (Post persisted)...
    expect(mock.tables.post.size).toBe(1)
    expect(postAfter).toHaveBeenCalledWith(expect.objectContaining({ status: 'committed' }))
    // ...but the User write's OWN failure is what its afterTransaction reports,
    // not the transaction's (otherwise committed) outcome.
    expect(userAfter).toHaveBeenCalledTimes(1)
    const userArg = userAfter.mock.calls[0][0]
    expect(userArg.status).toBe('rolled-back')
    expect(result.userError).toBeDefined()
  })

  it('a transaction that commits with a throwing deferred hook rejects with AfterTransactionError; other compensators still ran', async () => {
    const fired: string[] = []
    const testConfig = await baseConfig({
      user: {
        afterTransaction: () => {
          fired.push('user')
          throw new Error('user compensator boom')
        },
      },
      post: {
        afterTransaction: () => {
          fired.push('post')
        },
      },
    })
    const context = getContext(testConfig, mock.client, { userId: '1' })

    await expect(
      context.transaction(async (tx) => {
        await tx.db.user.create({ data: { name: 'jane' } })
        await tx.db.post.create({ data: { title: 'ok' } })
      }),
    ).rejects.toThrow(/afterTransaction hook\(s\) failed/)

    expect(fired).toEqual(expect.arrayContaining(['user', 'post']))
    // DB state is final — the underlying transaction already committed.
    expect(mock.tables.user.size).toBe(1)
    expect(mock.tables.post.size).toBe(1)
  })

  it('a nested context.transaction() joins the outer owner instead of creating a second registry', async () => {
    const order: string[] = []
    const testConfig = await baseConfig({
      user: { afterTransaction: () => order.push('user-after') },
      post: { afterTransaction: () => order.push('post-after') },
    })
    const context = getContext(testConfig, mock.client, { userId: '1' })

    await context.transaction(async (tx) => {
      await tx.db.user.create({ data: { name: 'jane' } })
      // Nested call: same underlying tx client (no $transaction), so it runs
      // directly — and per ADR-0028 must join the OUTER owner's queue.
      await tx.transaction(async (inner) => {
        await inner.db.post.create({ data: { title: 'nested' } })
        order.push('inner-callback-done')
      })
      order.push('outer-callback-done')
    })

    // Both brackets flush only once the OUTER transaction settles.
    expect(order).toEqual([
      'inner-callback-done',
      'outer-callback-done',
      'user-after',
      'post-after',
    ])
  })

  it('a deferred afterTransaction hook receives a base-client context — a compensator write survives the enclosing rollback', async () => {
    const testConfig = await baseConfig({
      user: {
        afterTransaction: async ({ status, context: hookContext }) => {
          if (status === 'rolled-back') {
            // Compensating write: NOT part of the (already rolled-back)
            // transaction — it must succeed and persist independently.
            await hookContext.db.comment.create({ data: { body: 'compensated' } })
          }
        },
      },
    })
    const context = getContext(testConfig, mock.client, { userId: '1' })

    await expect(
      context.transaction(async (tx) => {
        await tx.db.user.create({ data: { name: 'jane' } })
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    // The original transaction rolled back (no user persisted)...
    expect(mock.tables.user.size).toBe(0)
    // ...but the compensator's own write, issued from the deferred hook,
    // persisted — proving it ran against the base client, not the closed tx.
    expect(mock.tables.comment.size).toBe(1)
    expect(Array.from(mock.tables.comment.values())[0].body).toBe('compensated')
  })
})

describe('ADR-0028 / #899: a hook-issued context.db write inside a plain top-level write', () => {
  // A dedicated config per test in this block: Post's nested `author` (User)
  // is processed BEFORE its nested `comments` (Comment) — object-literal key
  // order — and each nested list's own `afterOperation` fires as a DEFERRED
  // "after task" once the top-level write's own before/after-hooks are done,
  // in that same order (see `runAfterTasks`). So User's afterOperation (which
  // issues the hook's own separate `context.db.audit.create()` write — the
  // JOINED write under test) always runs, and completes, BEFORE Comment's own
  // afterOperation gets a chance to fail the whole transaction — letting each
  // test control whether the ENCLOSING write settles by commit or rollback
  // strictly AFTER the joined Audit write already happened.
  function makeConfig(opts: { commentThrows: boolean; auditAfter: (arg: unknown) => void }) {
    return config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        User: list({
          fields: { name: text() },
          access: { operation: { query: () => true, create: () => true, update: () => true } },
          hooks: {
            afterOperation: async ({ operation, context: hookContext }) => {
              if (operation === 'create') {
                await hookContext.db.audit.create({ data: { note: 'audit' } })
              }
            },
          },
        }),
        Comment: list({
          fields: { body: text() },
          access: { operation: { query: () => true, create: () => true } },
          hooks: opts.commentThrows
            ? {
                afterOperation: () => {
                  throw new Error('comment afterOperation boom')
                },
              }
            : undefined,
        }),
        Audit: list({
          fields: { note: text() },
          access: { operation: { query: () => true, create: () => true } },
          hooks: { afterTransaction: opts.auditAfter },
        }),
        Post: list({
          fields: {
            title: text(),
            author: relationship({ ref: 'User.posts' }),
            comments: relationship({ ref: 'Comment', many: true }),
          },
          access: { operation: { query: () => true, create: () => true, update: () => true } },
        }),
      },
    })
  }

  let mock: ReturnType<typeof createFaithfulTxPrisma>

  beforeEach(() => {
    mock = createFaithfulTxPrisma(['audit'])
    vi.clearAllMocks()
  })

  it('defers and reports rolled-back when the enclosing (non-interactive) write later rolls back', async () => {
    const auditAfter = vi.fn()
    const testConfig = await makeConfig({ commentThrows: true, auditAfter })
    mock.tables.post.set('p1', { id: 'p1', title: 'P' })
    const context = getContext(testConfig, mock.client, { userId: '1' })

    await expect(
      context.db.post.update({
        where: { id: 'p1' },
        data: {
          title: 'x',
          author: { create: { name: 'jane' } },
          comments: { create: [{ body: 'trigger' }] },
        },
      }),
    ).rejects.toThrow('comment afterOperation boom')

    // Nothing persisted — the whole write, including the hook's own Audit
    // write, rolled back together (ADR-0010 atomicity).
    expect(mock.tables.user.size).toBe(0)
    expect(mock.tables.audit.size).toBe(0)

    // The Audit write itself succeeded (no error of its own) — its
    // afterTransaction must still report the OWNER's real (rolled-back)
    // outcome, not fire optimistically with 'committed' at write time.
    expect(auditAfter).toHaveBeenCalledTimes(1)
    const arg = auditAfter.mock.calls[0][0]
    expect(arg.status).toBe('rolled-back')
    expect(arg.error).toBeInstanceOf(Error)
    expect((arg.error as Error).message).toBe('comment afterOperation boom')
  })

  it('defers and reports committed with the persisted item when the enclosing write commits', async () => {
    const auditAfter = vi.fn()
    const testConfig = await makeConfig({ commentThrows: false, auditAfter })
    mock.tables.post.set('p1', { id: 'p1', title: 'P' })
    const context = getContext(testConfig, mock.client, { userId: '1' })

    await context.db.post.update({
      where: { id: 'p1' },
      data: {
        title: 'x',
        author: { create: { name: 'jane' } },
        comments: { create: [{ body: 'fine' }] },
      },
    })

    expect(mock.tables.audit.size).toBe(1)
    expect(auditAfter).toHaveBeenCalledTimes(1)
    const arg = auditAfter.mock.calls[0][0]
    expect(arg.status).toBe('committed')
    expect(arg.item).toEqual(expect.objectContaining({ note: 'audit' }))
  })
})

describe('ADR-0028 / #899: a serialization failure still propagates unwrapped, with compensators run', () => {
  it('P2034 rejects the caller unwrapped; the deferred afterTransaction still fired (rolled-back)', async () => {
    const mock = createFaithfulTxPrisma()
    const after = vi.fn()
    const testConfig = await baseConfig({ user: { afterTransaction: after } })
    const context = getContext(testConfig, mock.client, { userId: '1' })

    const serializationError = Object.assign(new Error('could not serialize access'), {
      code: 'P2034',
    })

    await expect(
      context.transaction(async (tx) => {
        await tx.db.user.create({ data: { name: 'jane' } })
        throw serializationError
      }),
    ).rejects.toMatchObject({ code: 'P2034' })

    // The error propagated UNWRAPPED (not an AfterTransactionError) — transaction
    // errors keep precedence over hook errors, so a P2034 retry loop still works.
    expect(after).toHaveBeenCalledTimes(1)
    expect(after.mock.calls[0][0].status).toBe('rolled-back')
    expect(mock.tables.user.size).toBe(0)
  })
})
