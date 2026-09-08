import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { AccessControlledDB, Session } from '../access/index.js'
import type { OpenSaasConfig } from '../config/types.js'
import { text } from '../fields/index.js'
import { createTestContext, ormClientFor, type TestContext } from '../testing/context.js'
import type { StackContext } from '../types/context.js'
import { getContext } from './index.js'

/**
 * `withSession(session)` — a context derived at another identity, over a real
 * database (ADR-0057).
 *
 * The property under test is that a derived context can do neither more nor
 * less than one built at that session directly, so every assertion compares
 * the two rather than asserting the derived one alone.
 */

const BOOT = 120_000

function schemaConfig(): OpenSaasConfig {
  const mine = ({ session }: { session: Session | null }) => ({
    owner: { equals: String(session?.userId ?? '') },
  })
  return {
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      Post: {
        fields: { title: text({ validation: { isRequired: true } }), owner: text() },
        access: {
          operation: { query: mine, create: () => true, update: mine, delete: mine },
        },
      },
    },
  }
}

describe('withSession', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(schemaConfig(), { userId: 'ada' })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.truncate()
    await harness.context.sudo().db.Post.create({ data: { title: 'ada-1', owner: 'ada' } })
    await harness.context.sudo().db.Post.create({ data: { title: 'bob-1', owner: 'bob' } })
  })

  function contextAt(
    config: OpenSaasConfig,
    session: Session | null,
  ): StackContext<AccessControlledDB> {
    const orm = ormClientFor(harness.data, harness.client.orm)
    return getContext(config, orm, session, undefined, false, undefined, undefined, harness.client)
  }

  const titles = (rows: readonly { title?: unknown }[]): string[] =>
    rows.map((row) => String(row.title)).sort()

  test(
    'the derived context carries the substituted session and leaves the receiver alone',
    async () => {
      const original = contextAt(schemaConfig(), { userId: 'ada' })
      const derived = original.withSession({ userId: 'bob' })

      expect(derived.session).toEqual({ userId: 'bob' })
      expect(original.session).toEqual({ userId: 'ada' })
    },
    BOOT,
  )

  test(
    'access rules evaluate against the substituted session, and it can do exactly what a direct context can',
    async () => {
      const derived = contextAt(schemaConfig(), { userId: 'ada' }).withSession({ userId: 'bob' })
      const direct = contextAt(schemaConfig(), { userId: 'bob' })

      expect(titles(await derived.db.Post.all())).toEqual(['bob-1'])
      expect(titles(await derived.db.Post.all())).toEqual(titles(await direct.db.Post.all()))
    },
    BOOT,
  )

  test(
    'withSession(null) is an anonymous context, and the rules treat it as one',
    async () => {
      const anonymous = contextAt(schemaConfig(), { userId: 'ada' }).withSession(null)

      expect(anonymous.session).toBeNull()
      expect(await anonymous.db.Post.all()).toEqual([])
    },
    BOOT,
  )

  test(
    'a hook sees the substituted session',
    async () => {
      const seen: Array<Session | null> = []
      const withHook: OpenSaasConfig = {
        ...schemaConfig(),
        lists: {
          Post: {
            ...schemaConfig().lists.Post,
            hooks: {
              validate: async ({ context }) => {
                seen.push(context.session)
              },
            },
          },
        },
      }

      await contextAt(withHook, { userId: 'ada' })
        .withSession({ userId: 'bob' })
        .db.Post.create({ data: { title: 'x', owner: 'bob' } })

      expect(seen).toEqual([{ userId: 'bob' }])
    },
    BOOT,
  )

  test(
    'sudo and withSession commute, and sudo state survives the substitution',
    async () => {
      const context = contextAt(schemaConfig(), { userId: 'ada' })
      const substituted = context.withSession({ userId: 'bob' }).sudo()
      const sudoedFirst = context.sudo().withSession({ userId: 'bob' })

      expect(titles(await substituted.db.Post.all())).toEqual(['ada-1', 'bob-1'])
      expect(titles(await sudoedFirst.db.Post.all())).toEqual(
        titles(await substituted.db.Post.all()),
      )
      expect(titles(await context.withSession({ userId: 'bob' }).db.Post.all())).toEqual(['bob-1'])
    },
    BOOT,
  )

  /**
   * The harness binds its client to a single-connection pool, so a derived
   * context that opened its own would starve rather than answer — reading a
   * row the receiver wrote is what proves the connection is shared.
   */
  test(
    'the derived context reuses the receiver’s storage and its connection',
    async () => {
      const context = contextAt(schemaConfig(), { userId: 'ada' })
      const derived = context.withSession({ userId: 'bob' })

      expect(derived.storage).toBe(context.storage)

      await context.db.Post.create({ data: { title: 'bob-2', owner: 'bob' } })
      expect(titles(await derived.db.Post.all())).toEqual(['bob-1', 'bob-2'])
    },
    BOOT,
  )

  describe('inside context.transaction', () => {
    test(
      'a substituted write joins the transaction and rolls back with it',
      async () => {
        const context = contextAt(schemaConfig(), { userId: 'ada' })

        await expect(
          context.transaction(async (tx) => {
            expect(tx.withSession({ userId: 'bob' }).session).toEqual({ userId: 'bob' })
            await tx
              .withSession({ userId: 'bob' })
              .db.Post.create({ data: { title: 'doomed', owner: 'bob' } })
            throw new Error('rollback')
          }),
        ).rejects.toThrow('rollback')

        expect(titles(await context.sudo().db.Post.all())).toEqual(['ada-1', 'bob-1'])
      },
      BOOT,
    )

    test(
      'a substituted write that commits is there afterwards',
      async () => {
        const context = contextAt(schemaConfig(), { userId: 'ada' })

        await context.transaction(async (tx) => {
          await tx
            .withSession({ userId: 'bob' })
            .db.Post.create({ data: { title: 'kept', owner: 'bob' } })
        })

        expect(titles(await context.sudo().db.Post.all())).toEqual(['ada-1', 'bob-1', 'kept'])
      },
      BOOT,
    )
  })
})
