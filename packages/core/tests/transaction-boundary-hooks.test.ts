import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getContext } from '../src/context/index.js'
import { config, list } from '../src/config/index.js'
import { text, relationship } from '../src/fields/index.js'
import { enumerateInvolvedLists } from '../src/context/transaction-boundary.js'

/**
 * #590 / ADR-0010: transaction-boundary hooks (`beforeTransaction` /
 * `afterTransaction`) run OUTSIDE the write's transaction — `beforeTransaction`
 * before it opens, `afterTransaction` after it settles (always, with the
 * commit/rollback outcome). They form a per-list compensation bracket around the
 * atomic write.
 *
 * These tests reuse a transaction-aware in-memory Prisma mock (mirroring
 * nested-write-hooks.test.ts) so they can assert commit/rollback outcomes, the
 * symmetric-bracket always-run rule, per-list firing across nested writes,
 * compensation when an afterTransaction itself throws, field-level variants, and
 * that sudo does not affect these hooks.
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
          const relTable =
            key === 'author'
              ? 'User'
              : key === 'comments'
                ? 'Comment'
                : /^l\d+$/.test(key)
                  ? key.toUpperCase()
                  : key
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
  for (const table of extraTables) client[table] = makeModel(table)

  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    const snapshot: Record<string, Map<string, Record<string, unknown>>> = {}
    for (const [name, map] of Object.entries(tables)) {
      snapshot[name] = new Map(map)
    }
    try {
      return await fn(client)
    } catch (err) {
      for (const [name, map] of Object.entries(snapshot)) {
        tables[name] = map
      }
      throw err
    }
  }

  return { client, tables }
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

    const context = getContext(await testConfig, mock.client, { userId: '1' })
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

    const context = getContext(await testConfig, mock.client, { userId: '1' })
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

    const context = getContext(await testConfig, mock.client, { userId: '1' })

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

  it('a thrown beforeTransaction aborts the write and fires afterTransaction only for already-run lists', async () => {
    const events: string[] = []

    const testConfig = config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        User: list({
          fields: { name: text() },
          access: { operation: { query: () => true, create: () => true } },
          hooks: {
            // The nested User's beforeTransaction throws.
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
        Post: list({
          fields: {
            title: text(),
            author: relationship({ ref: 'User.posts' }),
          },
          access: { operation: { query: () => true, create: () => true } },
          hooks: {
            beforeTransaction: () => events.push('post:before'),
            afterTransaction: ({ status }) => events.push(`post:after:${status}`),
          },
        }),
      },
    })

    const context = getContext(await testConfig, mock.client, { userId: '1' })

    await expect(
      context.db.Post.create({ data: { title: 'T', author: { create: { name: 'x' } } } }),
    ).rejects.toThrow('user before boom')

    // Post (top-level) beforeTransaction ran, then User's threw. Both ran-lists
    // get a rolled-back afterTransaction; the unrelated Comment list gets nothing;
    // the transaction was never opened (no persistence).
    expect(events).toContain('post:before')
    expect(events).toContain('user:before')
    expect(events).toContain('post:after:rolled-back')
    expect(events).toContain('user:after:rolled-back')
    expect(events).not.toContain('comment:before')
    expect(events).not.toContain('comment:after')
    expect(mock.tables.Post.size).toBe(0)
    expect(mock.tables.User.size).toBe(0)
  })

  it('fires per list across a nested write (parent + nested list both bracketed)', async () => {
    const userAfter = vi.fn()
    const postAfter = vi.fn()

    const testConfig = config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        User: list({
          fields: { name: text() },
          access: { operation: { query: () => true, create: () => true, update: () => true } },
          hooks: { beforeTransaction: vi.fn(), afterTransaction: userAfter },
        }),
        Post: list({
          fields: { title: text(), author: relationship({ ref: 'User.posts' }) },
          access: { operation: { query: () => true, update: () => true } },
          hooks: { beforeTransaction: vi.fn(), afterTransaction: postAfter },
        }),
      },
    })

    mock.tables.Post.set('p1', { id: 'p1', title: 'Original' })

    const context = getContext(await testConfig, mock.client, { userId: '1' })
    await context.db.Post.update({
      where: { id: 'p1' },
      data: { title: 'Updated', author: { create: { name: 'john' } } },
    })

    expect(postAfter).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'committed', operation: 'update', listKey: 'Post' }),
    )
    expect(userAfter).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'committed', operation: 'create', listKey: 'User' }),
    )

    // The committed item/originalItem are surfaced ONLY for the top-level record.
    // The top-level Post (update) gets the persisted item + its originalItem; the
    // nested User (create) gets `item: undefined` — NOT the top-level Post row,
    // which would be the wrong record for the nested list's own item type.
    const postArg = postAfter.mock.calls[0][0]
    expect(postArg.item).toEqual(expect.objectContaining({ id: 'p1', title: 'Updated' }))
    expect(postArg.originalItem).toEqual(expect.objectContaining({ id: 'p1', title: 'Original' }))

    const userArg = userAfter.mock.calls[0][0]
    expect(userArg.item).toBeUndefined()
    // Nested compensation keys off inputData, not the (unavailable) persisted row.
    expect(userArg.inputData).toEqual(expect.objectContaining({ name: 'john' }))
  })

  it('a throwing afterTransaction does not prevent the other afterTransaction hooks running', async () => {
    const fired: string[] = []

    const testConfig = config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        User: list({
          fields: { name: text() },
          access: { operation: { query: () => true, create: () => true, update: () => true } },
          hooks: {
            afterTransaction: () => {
              fired.push('user')
              throw new Error('user after boom')
            },
          },
        }),
        Post: list({
          fields: { title: text(), author: relationship({ ref: 'User.posts' }) },
          access: { operation: { query: () => true, update: () => true } },
          hooks: {
            afterTransaction: () => {
              fired.push('post')
            },
          },
        }),
      },
    })

    mock.tables.Post.set('p1', { id: 'p1', title: 'Original' })

    const context = getContext(await testConfig, mock.client, { userId: '1' })

    // The write itself committed; surfaced error is the afterTransaction failure.
    await expect(
      context.db.Post.update({
        where: { id: 'p1' },
        data: { title: 'Updated', author: { create: { name: 'john' } } },
      }),
    ).rejects.toThrow(/afterTransaction hook\(s\) failed/)

    // Both compensators fired even though one threw.
    expect(fired).toEqual(expect.arrayContaining(['post', 'user']))
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

    const context = getContext(await testConfig, mock.client, { userId: '1' })
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

    const context = getContext(await testConfig, mock.client, { userId: '1' }).sudo()
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

    const context = getContext(await testConfig, mock.client, { userId: '1' })
    const created = await context.db.User.create({ data: { name: 'jane' } })

    // Silent failure: a denied create returns null and takes no external action.
    expect(created).toBeNull()
    expect(before).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
  })
})

/**
 * #835: `enumerateInvolvedLists`'s walk used to stop at a fixed depth cap
 * (`MAX_DEPTH = 5`), so lists reachable only past it never entered the
 * involved-list set and their transaction-boundary hooks silently never fired.
 * The fix replaces the depth cap with a saturation bound computed from the
 * CONFIG's relationship graph reachable from the top-level list: the walk
 * stops once every (list, operation) pair it could ever find has been
 * recorded, regardless of how deep the payload nests.
 */
describe('#835 enumerateInvolvedLists — saturation-bound enumeration walk', () => {
  function chainConfigLists(length: number) {
    const lists: Record<string, ReturnType<typeof list>> = {}
    for (let i = 1; i <= length; i++) {
      const name = `L${i}`
      const fields: Record<string, ReturnType<typeof text> | ReturnType<typeof relationship>> = {
        name: text(),
      }
      if (i < length) {
        fields[`l${i + 1}`] = relationship({ ref: `L${i + 1}` })
      }
      lists[name] = list({ fields })
    }
    return lists
  }

  function chainInputData(length: number): Record<string, unknown> {
    let payload: Record<string, unknown> = { name: `r${length}` }
    for (let i = length - 1; i >= 1; i--) {
      payload = { name: `r${i}`, [`l${i + 1}`]: { create: payload } }
    }
    return payload
  }

  it('enumerates every list in an 8-list chain, deeper than the old fixed depth cap of 5', async () => {
    const resolvedConfig = await config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: chainConfigLists(8),
    })

    const involved = enumerateInvolvedLists({
      listName: 'L1',
      listConfig: resolvedConfig.lists.L1,
      operation: 'create',
      inputData: chainInputData(8),
      topLevelOriginalItem: undefined,
      config: resolvedConfig,
    })

    expect(involved.map((i) => i.listKey)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8'])
    expect(involved.map((i) => i.operation)).toEqual(Array(8).fill('create'))
    // The top-level list is first and is the only one marked isTopLevel.
    expect(involved[0].isTopLevel).toBe(true)
    expect(involved.slice(1).every((i) => !i.isTopLevel)).toBe(true)
  })

  it('dedupes by (list, operation) when a list is nested many times in one payload', async () => {
    const resolvedConfig = await config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        Parent: list({
          fields: { name: text(), children: relationship({ ref: 'Child', many: true }) },
        }),
        Child: list({ fields: { name: text() } }),
      },
    })

    const involved = enumerateInvolvedLists({
      listName: 'Parent',
      listConfig: resolvedConfig.lists.Parent,
      operation: 'create',
      inputData: {
        name: 'p',
        children: { create: [{ name: 'c1' }, { name: 'c2' }, { name: 'c3' }] },
      },
      topLevelOriginalItem: undefined,
      config: resolvedConfig,
    })

    // Three nested Child creates collapse into a single involvement — the
    // hooks are a per-LIST compensation bracket, not per-record.
    expect(involved.map((i) => `${i.listKey}:${i.operation}`)).toEqual([
      'Parent:create',
      'Child:create',
    ])
  })

  it('stops descending once every reachable (list, operation) pair is recorded, without inspecting payload past that point', async () => {
    // Node self-references, so the reachable closure from Node is just
    // {Node} — the saturation bound is 1 list * 3 operations = 3 pairs.
    // Extra1/Extra2 are unrelated lists in the same config: if the bound were
    // ever computed from the WHOLE config instead of the graph reachable
    // from the write's own top-level list, the bound would be inflated to 9
    // and this test's trap (below) would fire.
    const resolvedConfig = await config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        Node: list({
          fields: {
            name: text(),
            childrenA: relationship({ ref: 'Node', many: true }),
            childrenB: relationship({ ref: 'Node', many: true }),
          },
        }),
        Extra1: list({ fields: { name: text() } }),
        Extra2: list({ fields: { name: text() } }),
      },
    })

    // A payload entry that must NEVER be walked once the walk has saturated —
    // reading its `childrenA` property throws, so any attempt to descend
    // into it fails the test with a thrown error instead of relying on timing.
    const trap: Record<string, unknown> = { name: 'trap' }
    Object.defineProperty(trap, 'childrenA', {
      enumerable: true,
      get(): never {
        throw new Error('walkNested must not descend past the saturation bound')
      },
    })

    const involved = enumerateInvolvedLists({
      listName: 'Node',
      listConfig: resolvedConfig.lists.Node,
      operation: 'create',
      inputData: {
        name: 'root',
        // Completes the saturation bound: seed (Node:create) + Node:update +
        // Node:delete = 3 pairs = the full reachable closure for Node.
        childrenA: {
          update: [{ where: { id: 'u1' }, data: { name: 'updated' } }],
          delete: [{ id: 'd1' }],
        },
        // Processed after childrenA (insertion order) — by the time the walk
        // reaches it, the bound is already saturated, so `trap` must never
        // be descended into.
        childrenB: { create: [trap] },
      },
      topLevelOriginalItem: undefined,
      config: resolvedConfig,
    })

    expect(involved.map((i) => `${i.listKey}:${i.operation}`)).toEqual([
      'Node:create',
      'Node:update',
      'Node:delete',
    ])
  })
})

/**
 * #835 integration: the enumeration fix must not change the (separately
 * verified, and unrelated) fact that nested writes stay access-checked at
 * every depth — `processNestedOperations`'s own depth guard was already dead
 * code before this fix (neither recursive call site nor the Write Pipeline
 * ever passed a depth), so nested access control was never gated by depth and
 * remains that way.
 */
describe('#835 deep nested writes remain access-checked at every depth', () => {
  function chainLists(length: number, denyCreateAt?: number) {
    const lists: Record<string, ReturnType<typeof list>> = {}
    for (let i = 1; i <= length; i++) {
      const name = `L${i}`
      const fields: Record<string, ReturnType<typeof text> | ReturnType<typeof relationship>> = {
        name: text(),
      }
      if (i < length) {
        fields[`l${i + 1}`] = relationship({ ref: `L${i + 1}` })
      }
      lists[name] = list({
        fields,
        access: {
          operation: {
            query: () => true,
            create: () => denyCreateAt !== i,
            update: () => true,
          },
        },
      })
    }
    return lists
  }

  function chainInputData(length: number): Record<string, unknown> {
    let payload: Record<string, unknown> = { name: `r${length}` }
    for (let i = length - 1; i >= 1; i--) {
      payload = { name: `r${i}`, [`l${i + 1}`]: { create: payload } }
    }
    return payload
  }

  it('throws when a nested create 6 levels deep is denied, even though 6 is past the old enumeration depth cap', async () => {
    const tables = Array.from({ length: 8 }, (_, i) => `L${i + 1}`)
    const mock = createTxPrisma(tables)

    const testConfig = config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: chainLists(8, 6),
    })

    const context = getContext(await testConfig, mock.client, { userId: '1' })

    await expect(context.db.L1.create({ data: chainInputData(8) })).rejects.toThrow(
      /access denied/i,
    )

    // Nothing was persisted — the whole write was aborted by the denial.
    for (const table of tables) {
      expect(mock.tables[table].size).toBe(0)
    }
  })

  it('fires beforeTransaction/afterTransaction for every list in an 8-list chain, including the deepest', async () => {
    const tables = Array.from({ length: 8 }, (_, i) => `L${i + 1}`)
    const mock = createTxPrisma(tables)

    const fired: string[] = []
    const lists = chainLists(8)
    for (const [name, listConfig] of Object.entries(lists)) {
      listConfig.hooks = {
        beforeTransaction: () => {
          fired.push(`before:${name}`)
        },
        afterTransaction: () => {
          fired.push(`after:${name}`)
        },
      }
    }

    const testConfig = config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists,
    })

    const context = getContext(await testConfig, mock.client, { userId: '1' })
    await context.db.L1.create({ data: chainInputData(8) })

    for (let i = 1; i <= 8; i++) {
      expect(fired).toContain(`before:L${i}`)
      expect(fired).toContain(`after:L${i}`)
    }
  })
})
