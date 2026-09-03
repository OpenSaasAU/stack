import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getContext } from '../src/context/index.js'
import { config, list } from '../src/config/index.js'
import { text } from '../src/fields/index.js'
import { ResolveOutputCycleError } from '../src/access/index.js'
import type { Plugin } from '../src/config/types.js'
import type { StackContext } from '../src/context/index.js'

/**
 * #1176: a list/field `resolveInput`/`validate`/`beforeOperation`/
 * `afterOperation` hook now receives the FULL secured {@link StackContext} —
 * `sudo()`, `withSession()`, `transaction()`, `serverAction` — bound to the
 * write's OWN transaction client, instead of the bare `AccessContext` object
 * literal `bindContextToTransaction` used to hand-assemble. See ADR-0012's
 * amendment and `packages/core/CLAUDE.md`.
 *
 * `beforeTransaction`/`afterTransaction` are OUT of scope (ADR-0028): they
 * keep a base-client `AccessContext`, unchanged by this issue.
 */

/**
 * A transaction-aware mock whose `$transaction` hands the callback a `tx`
 * object that is NOT `client` itself (mirroring real Prisma, and required to
 * prove a hook's context is bound to the TRANSACTION client, not the base
 * one) and — faithfully — has no `$transaction` of its own, so a nested
 * `context.transaction()`/`context.db` write can only join, never nest.
 */
function createTxPrisma(tableNames: string[]) {
  const tables: Record<string, Map<string, Record<string, unknown>>> = {}
  for (const name of tableNames) tables[name] = new Map()
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

  const client: Record<string, unknown> = {}
  for (const name of tableNames) client[name] = makeModel(name)

  const transactionSpy = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const snapshot: Record<string, Map<string, Record<string, unknown>>> = {}
    for (const [name, map] of Object.entries(tables)) snapshot[name] = new Map(map)
    // Faithful to real Prisma: the tx client has the model delegates but NOT
    // `$transaction` — a nested write detects this and joins rather than
    // opening a second transaction. Spreading into a NEW object also makes
    // `tx !== client`, which the "bound to tx, not the base client" tests key on.
    const { $transaction: _omit, ...models } = client
    void _omit
    try {
      return await fn(models)
    } catch (err) {
      for (const [name, map] of Object.entries(snapshot)) tables[name] = map
      throw err
    }
  })
  client.$transaction = transactionSpy

  return { client, tables, transactionSpy }
}

describe('#1176 hook context is a full secured StackContext bound to the transaction', () => {
  let mock: ReturnType<typeof createTxPrisma>

  beforeEach(() => {
    mock = createTxPrisma(['user'])
    vi.clearAllMocks()
  })

  it('resolveInput/validate/beforeOperation/afterOperation (list AND field) all receive sudo/withSession/transaction/serverAction, bound to `tx`', async () => {
    const captured: StackContext[] = []

    const testConfig = await config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        User: list({
          fields: {
            name: text({
              hooks: {
                resolveInput: async ({ context, resolvedData, fieldKey }) => {
                  captured.push(context)
                  return resolvedData[fieldKey]
                },
                validate: async ({ context }) => {
                  captured.push(context)
                },
                beforeOperation: async ({ context }) => {
                  captured.push(context)
                },
                afterOperation: async ({ context }) => {
                  captured.push(context)
                },
              },
            }),
          },
          access: { operation: { query: () => true, create: () => true } },
          hooks: {
            resolveInput: async ({ context, resolvedData }) => {
              captured.push(context)
              return resolvedData
            },
            validate: async ({ context }) => {
              captured.push(context)
            },
            beforeOperation: async ({ context }) => {
              captured.push(context)
            },
            afterOperation: async ({ context }) => {
              captured.push(context)
            },
          },
        }),
      },
    })

    const context = getContext(testConfig, mock.client, { userId: '1' })
    await context.db.user.create({ data: { name: 'jane' } })

    // list resolveInput/validate/beforeOperation/afterOperation + the same 4
    // at field level = 8 hook invocations, one create.
    expect(captured).toHaveLength(8)

    for (const hookContext of captured) {
      expect(typeof hookContext.sudo).toBe('function')
      expect(typeof hookContext.withSession).toBe('function')
      expect(typeof hookContext.transaction).toBe('function')
      expect(typeof hookContext.serverAction).toBe('function')
      // Bound to the transaction client, never the base one.
      expect(hookContext.prisma).not.toBe(mock.client)
      expect(hookContext.sudo().prisma).toBe(hookContext.prisma)
    }
  })

  it('a context.sudo()/.withSession() write from beforeOperation succeeds against an access-denied-for-the-session list, and rolls back with the outer write', async () => {
    async function run(shouldThrow: boolean) {
      const denyMock = createTxPrisma(['user', 'draft'])
      const testConfig = await config({
        db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
        lists: {
          User: list({
            fields: { name: text() },
            access: { operation: { query: () => true, create: () => true } },
            hooks: {
              beforeOperation: async ({ context, operation }) => {
                if (operation !== 'create') return
                // Denied for this session under normal access — only sudo can write it.
                await context.sudo().db.draft.create({ data: { note: 'draft' } })
                if (shouldThrow) {
                  throw new Error('boom')
                }
              },
            },
          }),
          Draft: list({
            fields: { note: text() },
            access: { operation: { query: () => true, create: () => false } },
          }),
        },
      })
      const context = getContext(testConfig, denyMock.client, { userId: '1' })

      if (shouldThrow) {
        await expect(context.db.user.create({ data: { name: 'jane' } })).rejects.toThrow('boom')
      } else {
        await context.db.user.create({ data: { name: 'jane' } })
      }
      return denyMock
    }

    const committed = await run(false)
    expect(committed.tables.draft.size).toBe(1)

    const rolledBack = await run(true)
    expect(rolledBack.tables.draft.size).toBe(0)
  })

  it('context.withSession() from a hook stays bound to `tx` and preserves the receiver sudo state; sudo()/withSession() compose in either order', async () => {
    const seen: { withSessionPrisma?: unknown; ownPrisma?: unknown; combos?: boolean[] } = {}

    const testConfig = await config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        User: list({
          fields: { name: text() },
          access: { operation: { query: () => true, create: () => true } },
          hooks: {
            beforeOperation: async ({ context }) => {
              seen.ownPrisma = context.prisma
              seen.withSessionPrisma = context.withSession({ userId: '2' }).prisma
              seen.combos = [
                context.sudo().withSession({ userId: '2' })._isSudo,
                context.withSession({ userId: '2' }).sudo()._isSudo,
                context.withSession({ userId: '2' })._isSudo, // non-sudo receiver stays non-sudo
              ]
            },
          },
        }),
      },
    })

    const context = getContext(testConfig, mock.client, { userId: '1' })
    await context.db.user.create({ data: { name: 'jane' } })

    expect(seen.withSessionPrisma).toBe(seen.ownPrisma)
    expect(seen.combos).toEqual([true, true, false])
  })

  it('context.transaction() called from a hook JOINS the write transaction rather than opening a nested one', async () => {
    const joinMock = createTxPrisma(['user', 'note'])
    const testConfig = await config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        User: list({
          fields: { name: text() },
          access: { operation: { query: () => true, create: () => true } },
          hooks: {
            beforeOperation: async ({ context }) => {
              await context.transaction(async (tx2) => {
                await tx2.db.note.create({ data: { name: 'joined' } })
              })
            },
          },
        }),
        Note: list({
          fields: { name: text() },
          access: { operation: { query: () => true, create: () => true } },
        }),
      },
    })

    const context = getContext(testConfig, joinMock.client, { userId: '1' })
    await context.db.user.create({ data: { name: 'jane' } })

    // Exactly the one outer transaction — the hook's `context.transaction()`
    // joined it instead of calling `$transaction` again.
    expect(joinMock.transactionSpy).toHaveBeenCalledTimes(1)
    expect(joinMock.tables.user.size).toBe(1)
    expect(joinMock.tables.note.size).toBe(1)
  })

  it('a write issued through a hook context.sudo() defers afterTransaction to the outer settle and reports the outer outcome', async () => {
    async function run(commentThrows: boolean) {
      const m = createTxPrisma(['user', 'comment', 'audit'])
      const auditAfter = vi.fn()
      const testConfig = await config({
        db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
        lists: {
          User: list({
            fields: { name: text() },
            access: { operation: { query: () => true, create: () => true } },
            hooks: {
              afterOperation: async ({ context, operation }) => {
                if (operation === 'create') {
                  await context.sudo().db.audit.create({ data: { note: 'audit' } })
                }
              },
            },
          }),
          Comment: list({
            fields: { body: text() },
            access: { operation: { query: () => true, create: () => true } },
            hooks: commentThrows
              ? {
                  afterOperation: () => {
                    throw new Error('comment boom')
                  },
                }
              : undefined,
          }),
          // Denied for the session — only reachable via sudo, proving the
          // deferred afterTransaction reports the join even for a sudo write.
          Audit: list({
            fields: { note: text() },
            access: { operation: { query: () => true, create: () => false } },
            hooks: { afterTransaction: auditAfter },
          }),
        },
      })
      const context = getContext(testConfig, m.client, { userId: '1' })

      if (commentThrows) {
        await expect(
          context.transaction(async (tx) => {
            await tx.db.user.create({ data: { name: 'jane' } })
            await tx.db.comment.create({ data: { body: 'trigger' } })
          }),
        ).rejects.toThrow('comment boom')
      } else {
        await context.transaction(async (tx) => {
          await tx.db.user.create({ data: { name: 'jane' } })
        })
      }

      return { m, auditAfter }
    }

    const committed = await run(false)
    expect(committed.m.tables.audit.size).toBe(1)
    expect(committed.auditAfter).toHaveBeenCalledTimes(1)
    expect(committed.auditAfter.mock.calls[0][0].status).toBe('committed')

    const rolledBack = await run(true)
    expect(rolledBack.m.tables.audit.size).toBe(0)
    expect(rolledBack.auditAfter).toHaveBeenCalledTimes(1)
    expect(rolledBack.auditAfter.mock.calls[0][0].status).toBe('rolled-back')
  })

  it('plugin runtime() is invoked exactly once per request, even across a hook-firing write with a nested context.db write', async () => {
    const runtimeSpy = vi.fn(() => ({}))
    const testPlugin: Plugin = {
      name: 'test-plugin',
      init: () => {},
      runtime: runtimeSpy,
    }

    const nestedMock = createTxPrisma(['user', 'audit'])
    const testConfig = await config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      plugins: [testPlugin],
      lists: {
        User: list({
          fields: { name: text() },
          access: { operation: { query: () => true, create: () => true } },
          hooks: {
            afterOperation: async ({ context, operation }) => {
              if (operation === 'create') {
                await context.db.audit.create({ data: { note: 'audit' } })
              }
            },
          },
        }),
        Audit: list({
          fields: { note: text() },
          access: { operation: { query: () => true, create: () => true } },
        }),
      },
    })

    const context = getContext(testConfig, nestedMock.client, { userId: '1' })
    await context.db.user.create({ data: { name: 'jane' } })

    expect(runtimeSpy).toHaveBeenCalledTimes(1)
    expect(nestedMock.tables.audit.size).toBe(1)
  })

  it("a write issued from inside a resolveOutput hook carries that hook's resolve chain into the write's own Field Visibility pass (ADR-0023)", async () => {
    // Ping.label's resolveOutput creates a Pong row, whose own Field
    // Visibility pass (Phase 11 of THAT write) computes Pong.label — which
    // creates a Ping row, whose Field Visibility pass computes Ping.label
    // again. If (and only if) the write's hook context carries the resolve
    // chain forward, that third hop re-enters `Ping.label`, already on the
    // chain, and the cycle guard throws instead of recursing forever.
    const { virtual } = await import('../src/fields/index.js')

    const cycleMock = createTxPrisma(['ping', 'pong'])
    const testConfig = await config({
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        Ping: list({
          fields: {
            name: text(),
            label: virtual({
              type: 'string',
              hooks: {
                resolveOutput: async ({ context }) => {
                  await context.db.pong.create({ data: { name: 'q' } })
                  return 'ping'
                },
              },
            }),
          },
          access: { operation: { query: () => true, create: () => true } },
        }),
        Pong: list({
          fields: {
            name: text(),
            label: virtual({
              type: 'string',
              hooks: {
                resolveOutput: async ({ context }) => {
                  await context.db.ping.create({ data: { name: 'p' } })
                  return 'pong'
                },
              },
            }),
          },
          access: { operation: { query: () => true, create: () => true } },
        }),
      },
    })

    const context = getContext(testConfig, cycleMock.client, { userId: '1' })

    await expect(context.db.ping.create({ data: { name: 'p0' } })).rejects.toThrow(
      ResolveOutputCycleError,
    )
  })
})
