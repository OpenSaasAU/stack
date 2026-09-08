import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { AccessControlledDB, Session } from '../access/index.js'
import { config, list } from '../config/index.js'
import type { OpenSaasConfig, Plugin } from '../config/types.js'
import { text } from '../fields/index.js'
import { createTestContext, ormClientFor, type TestContext } from '../testing/context.js'
import type { StackContext } from '../types/context.js'
import { getContext } from './index.js'

/**
 * `sudo()` — the one trusted bypass — over a real database (ADR-0057).
 *
 * Each bypass is asserted as a pair: the same call on the same rows through a
 * context that is denied, and through its `sudo()`. A test that only asserted
 * the sudo half would pass against a context that never denied anything.
 */

const BOOT = 120_000

function schemaConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      Post: {
        fields: { title: text({ validation: { isRequired: true } }), secret: text() },
        access: { operation: { query: () => true, create: () => true } },
      },
    },
  }
}

/** The same schema, with every rule closed and `secret` unreadable. */
function closedConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      Post: {
        fields: {
          title: text({ validation: { isRequired: true } }),
          secret: text({ access: { read: () => false } }),
        },
        access: {
          operation: {
            query: () => false,
            create: () => false,
            update: () => false,
            delete: () => false,
          },
        },
      },
    },
  }
}

describe('Sudo context', () => {
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
    session: Session | null,
  ): StackContext<AccessControlledDB> {
    const orm = ormClientFor(harness.data, harness.client.orm)
    return getContext(config, orm, session, undefined, false, undefined, undefined, harness.client)
  }

  async function seed(): Promise<void> {
    await harness.context.db.Post.create({ data: { title: 'one', secret: 's1' } })
    await harness.context.db.Post.create({ data: { title: 'two', secret: 's2' } })
  }

  test(
    'a denied query returns rows under sudo and nothing without it',
    async () => {
      await seed()
      const closed = contextAt(closedConfig(), { userId: 'u1' })

      expect(await closed.db.Post.all()).toEqual([])
      expect((await closed.sudo().db.Post.all()).map((row) => row.title).sort()).toEqual([
        'one',
        'two',
      ])
    },
    BOOT,
  )

  test(
    'a read-denied field is present under sudo and absent without it',
    async () => {
      await seed()
      const closed = contextAt(closedConfig(), { userId: 'u1' })

      const [visible] = await closed
        .sudo()
        .db.Post.where({ title: { equals: 'one' } })
        .all()
      expect(visible).toMatchObject({ title: 'one', secret: 's1' })

      const open = contextAt(
        {
          ...schemaConfig(),
          lists: {
            Post: {
              fields: {
                title: text({ validation: { isRequired: true } }),
                secret: text({ access: { read: () => false } }),
              },
              access: { operation: { query: () => true } },
            },
          },
        },
        { userId: 'u1' },
      )
      const [withheld] = await open.db.Post.where({ title: { equals: 'one' } }).all()
      expect(withheld).toMatchObject({ title: 'one' })
      expect('secret' in withheld).toBe(false)
    },
    BOOT,
  )

  test(
    'a denied count answers under sudo and answers zero without it',
    async () => {
      await seed()
      const closed = contextAt(closedConfig(), { userId: 'u1' })

      expect(await closed.db.Post.aggregate((a) => ({ total: a.count() }))).toEqual({ total: 0 })
      expect(await closed.sudo().db.Post.aggregate((a) => ({ total: a.count() }))).toEqual({
        total: 2,
      })
    },
    BOOT,
  )

  test(
    'the hooks still run, and a required field is still required',
    async () => {
      const ran: string[] = []
      const withHooks: OpenSaasConfig = {
        ...closedConfig(),
        lists: {
          Post: {
            ...closedConfig().lists.Post,
            hooks: {
              resolveInput: ({ resolvedData }) => {
                ran.push('resolveInput')
                return resolvedData
              },
              validate: async () => {
                ran.push('validate')
              },
              beforeOperation: async () => {
                ran.push('beforeOperation')
              },
              afterOperation: async () => {
                ran.push('afterOperation')
              },
            },
          },
        },
      }
      const sudone = contextAt(withHooks, { userId: 'u1' }).sudo()

      expect(await sudone.db.Post.create({ data: { title: 'hooked' } })).toMatchObject({
        title: 'hooked',
      })
      expect(ran).toEqual(['resolveInput', 'validate', 'beforeOperation', 'afterOperation'])

      await expect(sudone.db.Post.create({ data: { secret: 's' } })).rejects.toThrow(
        /Validation failed/,
      )
    },
    BOOT,
  )

  describe('what a sudo context carries', () => {
    test(
      'the same session, storage and Unsafe surface shape as the context it came from',
      async () => {
        const session = { userId: 'u1', role: 'admin' }
        const context = contextAt(schemaConfig(), session)
        const sudone = context.sudo()

        expect(sudone.session).toBe(context.session)
        expect(sudone.storage).toBe(context.storage)
        expect(Object.keys(sudone.unsafe).sort()).toEqual(Object.keys(context.unsafe).sort())
      },
      BOOT,
    )

    test(
      'sudo() chains, and the context it came from is left denied',
      async () => {
        await seed()
        const closed = contextAt(closedConfig(), { userId: 'u1' })

        expect(await closed.sudo().sudo().db.Post.all()).toHaveLength(2)
        expect(await closed.db.Post.all()).toEqual([])
      },
      BOOT,
    )
  })

  /**
   * A plugin's `runtime(context, sudo)` factory receives `sudo` as a plain
   * second argument rather than a method on `AccessContext`. A self-referential
   * `sudo(): AccessContext` member on that widely instantiated interface broke
   * TypeScript's structural checking of unrelated generated types in a
   * downstream app; the separate argument avoids the recursion while still
   * giving a plugin the identity-lookup path ADR-0013 needs.
   */
  test(
    'a plugin runtime is handed a working sudo()',
    async () => {
      await seed()
      let captured: (() => StackContext) | undefined

      const plugin: Plugin = {
        name: 'test-plugin',
        init: async () => {},
        runtime: (_context, sudo) => {
          captured = sudo
          return {}
        },
      }

      const pluginConfig = await config({
        db: { provider: 'postgresql', timestamps: true },
        plugins: [plugin],
        lists: {
          Post: list({
            fields: { title: text({ validation: { isRequired: true } }), secret: text() },
            access: { operation: { query: () => false } },
          }),
        },
      })

      contextAt(pluginConfig, null)

      expect(captured).toBeTypeOf('function')
      expect(await captured!().db.Post.all()).toHaveLength(2)
    },
    BOOT,
  )
})
