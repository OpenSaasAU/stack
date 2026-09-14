import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AccessControlledDB, Session } from '../access/index.js'
import type { OpenSaasConfig, ResolveInputHookArgs } from '../config/types.js'
import { text } from '../fields/index.js'
import { isSerializationFailure } from '../lib/database-errors.js'
import { createTestContext, ormClientFor, type TestContext } from '../testing/context.js'
import type { StackContext } from '../types/context.js'
import { getContext, OrmHandleUnresolvableError, TransactionUnavailableError } from './index.js'

/**
 * `context.transaction(fn)` over a real database (#614, ADR-0012, ADR-0042).
 *
 * The harness binds its client to a single-connection pool, so a callback whose
 * writes were not rebound onto the transaction would starve rather than pass —
 * the rebinding is proved by these tests running at all, not by counting
 * connections.
 */

const BOOT = 120_000

const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

function schemaConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      User: { fields: { name: text() }, access: { operation: OPEN } },
      Post: { fields: { title: text() }, access: { operation: OPEN } },
    },
  }
}

/** The shape a driver raises on a serialization conflict, before normalisation. */
function serializationError(): Error {
  return Object.assign(new Error('could not serialize access'), {
    kind: 'sql_query',
    sqlState: '40001',
    constraint: undefined,
  })
}

describe('context.transaction', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(schemaConfig(), { userId: 'u1' })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.truncate()
  })

  function contextAt(
    config: OpenSaasConfig,
    session: Session | null = { userId: 'u1' },
  ): StackContext<AccessControlledDB> {
    const orm = ormClientFor(harness.data, harness.client.orm)
    return getContext(config, orm, session, undefined, false, undefined, undefined, harness.client)
  }

  const rows = async (list: 'User' | 'Post'): Promise<unknown[]> =>
    harness.context.sudo().db[list].all()

  test(
    'the callback’s writes commit together, and its return value is the result',
    async () => {
      const result = await harness.context.transaction(async (tx) => {
        const user = await tx.db.User.create({ data: { name: 'jane' } })
        const post = await tx.db.Post.create({ data: { title: 'hello' } })
        return { user, post }
      })

      expect(result.user).toMatchObject({ name: 'jane' })
      expect(result.post).toMatchObject({ title: 'hello' })
      expect(await rows('User')).toHaveLength(1)
      expect(await rows('Post')).toHaveLength(1)
    },
    BOOT,
  )

  test(
    'a throw inside the callback rolls back every write',
    async () => {
      await expect(
        harness.context.transaction(async (tx) => {
          await tx.db.User.create({ data: { name: 'jane' } })
          await tx.db.Post.create({ data: { title: 'hello' } })
          throw new Error('boom')
        }),
      ).rejects.toThrow('boom')

      expect(await rows('User')).toEqual([])
      expect(await rows('Post')).toEqual([])
    },
    BOOT,
  )

  test(
    'access control still runs inside: a denied create is the same silent null',
    async () => {
      const denied = schemaConfig()
      denied.lists.User.access = { operation: { ...OPEN, create: () => false } }

      expect(
        await contextAt(denied).transaction((tx) => tx.db.User.create({ data: { name: 'jane' } })),
      ).toBeNull()
      expect(await rows('User')).toEqual([])
    },
    BOOT,
  )

  test(
    'list hooks fire inside, and their transform reaches the row',
    async () => {
      const resolveInput = vi.fn(({ resolvedData }) => ({
        ...resolvedData,
        name: 'transformed',
      }))
      const hooked = schemaConfig()
      hooked.lists.User.hooks = { resolveInput }

      const created = await contextAt(hooked).transaction((tx) =>
        tx.db.User.create({ data: { name: 'jane' } }),
      )

      expect(resolveInput).toHaveBeenCalledTimes(1)
      expect(created).toMatchObject({ name: 'transformed' })
      expect(await rows('User')).toMatchObject([{ name: 'transformed' }])
    },
    BOOT,
  )

  test(
    'a serialization failure raised at the settle arrives normalised, not swallowed to null',
    async () => {
      const raised = await harness.context
        .transaction(async () => {
          throw serializationError()
        })
        .then(
          () => undefined,
          (error: unknown) => error,
        )

      expect(isSerializationFailure(raised)).toBe(true)
      if (!isSerializationFailure(raised)) throw new Error('not normalised')
      expect(raised.message).toBe('This operation conflicted with another and was rolled back')
      expect(raised.cause).toBeInstanceOf(Error)
    },
    BOOT,
  )

  /**
   * The caller owns the retry loop (ADR-0042 leaves `retryOnSerializationFailure`
   * deferred), so what the stack owes is a context still usable after a
   * rejection and a second attempt that starts clean rather than replaying the
   * first attempt's deferred hooks.
   */
  test(
    'a caller-owned retry after a rejection runs a clean second attempt',
    async () => {
      const resolveInput = vi.fn(async (args: ResolveInputHookArgs) => args.resolvedData)
      const canCreate = vi.fn(() => true)
      const afterTransaction = vi.fn()
      const retryConfig = schemaConfig()
      retryConfig.lists.User.access = { operation: { ...OPEN, create: canCreate } }
      retryConfig.lists.User.hooks = { resolveInput, afterTransaction }
      const context = contextAt(retryConfig)

      let attempts = 0
      const attempt = () =>
        context.transaction(async (tx) => {
          attempts += 1
          const user = await tx.db.User.create({ data: { name: `attempt-${attempts}` } })
          if (attempts === 1) throw serializationError()
          return user
        })

      const rejection = await attempt().then(
        () => undefined,
        (error: unknown) => error,
      )

      expect(isSerializationFailure(rejection)).toBe(true)
      expect(await rows('User')).toEqual([])
      expect(afterTransaction.mock.calls.map((call) => call[0].status)).toEqual(['rolled-back'])

      expect(await attempt()).toMatchObject({ name: 'attempt-2' })
      expect(attempts).toBe(2)
      expect(await rows('User')).toHaveLength(1)
      expect(afterTransaction.mock.calls.map((call) => call[0].status)).toEqual([
        'rolled-back',
        'committed',
      ])
      expect(resolveInput).toHaveBeenCalledTimes(2)
      expect(canCreate).toHaveBeenCalledTimes(2)
    },
    BOOT,
  )

  test(
    'the transaction context carries the same session and a working sudo()',
    async () => {
      const closed = schemaConfig()
      closed.lists.User.access = { operation: { ...OPEN, create: () => false } }
      const context = contextAt(closed, { userId: '42' })

      const seen = await context.transaction(async (tx) => {
        expect(tx.session).toEqual({ userId: '42' })
        expect(await tx.db.User.create({ data: { name: 'denied' } })).toBeNull()
        expect(await tx.sudo().db.User.create({ data: { name: 'jane' } })).toMatchObject({
          name: 'jane',
        })
        return tx.session?.userId
      })

      expect(seen).toBe('42')
      expect(await rows('User')).toMatchObject([{ name: 'jane' }])
    },
    BOOT,
  )

  test(
    'a sudo write inside rolls back with the transaction like any other',
    async () => {
      await expect(
        harness.context.transaction(async (tx) => {
          await tx.sudo().db.User.create({ data: { name: 'rollback-me' } })
          throw new Error('boom')
        }),
      ).rejects.toThrow('boom')

      expect(await rows('User')).toEqual([])
    },
    BOOT,
  )

  describe('what it refuses rather than running unatomically', () => {
    test(
      'a context with no client refuses to open one',
      async () => {
        const orm = ormClientFor(harness.data, harness.client.orm)
        const clientless = getContext(schemaConfig(), orm, { userId: 'u1' })

        await expect(
          clientless.transaction((tx) => tx.db.User.create({ data: { name: 'jane' } })),
        ).rejects.toBeInstanceOf(TransactionUnavailableError)
        expect(await rows('User')).toEqual([])
      },
      BOOT,
    )

    test(
      'a client whose collections do not cover the config refuses at construction',
      async () => {
        const orm = ormClientFor(harness.data, harness.client.orm)
        const extra = schemaConfig()
        extra.lists.Absent = { fields: { name: text() }, access: { operation: OPEN } }

        expect(() =>
          getContext(extra, orm, null, undefined, false, undefined, undefined, harness.client),
        ).toThrow(OrmHandleUnresolvableError)
      },
      BOOT,
    )
  })

  describe('the list-to-namespace reconciliation runs once per context (#1266)', () => {
    test(
      'several writes on one context reuse the shape resolved at construction',
      async () => {
        // `listConfig.db` (the namespace/schema a list's collection is reconciled
        // against) is read at runtime ONLY by the shape derivation this test
        // targets — nothing else in the write path touches it — so counting
        // `get('db')` on each list config is a precise proxy for how many times
        // that derivation ran, without reaching into a private function.
        const base = schemaConfig()
        let dbAccesses = 0
        const lists: OpenSaasConfig['lists'] = {}
        for (const [listKey, listConfig] of Object.entries(base.lists)) {
          lists[listKey] = new Proxy(listConfig, {
            get(target, prop, receiver) {
              if (prop === 'db') dbAccesses++
              return Reflect.get(target, prop, receiver)
            },
          })
        }
        const config: OpenSaasConfig = { ...base, lists }

        const orm = ormClientFor(harness.data, harness.client.orm)
        const context = getContext(
          config,
          orm,
          { userId: 'u1' },
          undefined,
          false,
          undefined,
          undefined,
          harness.client,
        )

        // The opener's own up-front validation (`transactionOpenerFor`) derives
        // the shape once, at construction — one `db` read per declared list.
        const afterConstruction = dbAccesses
        expect(afterConstruction).toBe(Object.keys(base.lists).length)

        await context.db.User.create({ data: { name: 'a' } })
        await context.db.User.create({ data: { name: 'b' } })
        await context.db.Post.create({ data: { title: 'c' } })

        // Three writes opened three transactions, each resolving a fresh handle
        // against that transaction's own `orm` root — but against the shape
        // derived once above, not by re-walking `config.lists`.
        expect(dbAccesses).toBe(afterConstruction)
      },
      BOOT,
    )
  })

  describe('a plain context.db write with no client (#1273)', () => {
    test(
      'runs anyway, but warns once per list and operation instead of staying silent',
      async () => {
        const orm = ormClientFor(harness.data, harness.client.orm)
        const clientless = getContext(schemaConfig(), orm, { userId: 'u1' })
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        try {
          const created = await clientless.db.User.create({ data: { name: 'jane' } })
          expect(created?.name).toBe('jane')
          expect(warn).toHaveBeenCalledTimes(1)
          expect(warn.mock.calls[0]?.[0]).toContain('no transaction')

          await clientless.db.User.create({ data: { name: 'again' } })
          expect(warn).toHaveBeenCalledTimes(1)
        } finally {
          warn.mockRestore()
        }
      },
      BOOT,
    )
  })
})
