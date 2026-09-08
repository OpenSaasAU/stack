import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AccessControlledDB, Session } from '../access/index.js'
import type {
  AfterTransactionHookArgs,
  BeforeTransactionHookArgs,
  Hooks,
  ListConfig,
  OpenSaasConfig,
  TypeInfo,
} from '../config/types.js'
import { text } from '../fields/index.js'
import { isSerializationFailure } from '../lib/database-errors.js'
import { createTestContext, ormClientFor, type TestContext } from '../testing/context.js'
import type { StackContext } from '../types/context.js'
import { getContext } from './index.js'
import { AfterTransactionError } from './transaction-boundary.js'

/**
 * Transaction-boundary hooks over a real database (ADR-0028, ADR-0057).
 *
 * The property is that `afterTransaction` reports the OUTERMOST transaction a
 * write took part in, not the return of the write itself. So every deferral
 * test asserts two things a fire-at-write-time implementation gets wrong: WHEN
 * the compensator ran relative to the callback, and WHAT status it was handed.
 */

const BOOT = 120_000

const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

function schemaConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      User: { fields: { name: text() }, access: { operation: OPEN } },
      Post: { fields: { title: text() }, access: { operation: OPEN } },
      Comment: { fields: { body: text() }, access: { operation: OPEN } },
      Audit: { fields: { note: text() }, access: { operation: OPEN } },
    },
  }
}

/** The schema config with hooks attached to the lists a test names. */
function withHooks(
  hooks: Partial<Record<'User' | 'Post' | 'Comment' | 'Audit', Hooks>>,
  fields?: Partial<Record<'User' | 'Post' | 'Comment' | 'Audit', ListConfig<TypeInfo>['fields']>>,
): OpenSaasConfig {
  const base = schemaConfig()
  const lists: OpenSaasConfig['lists'] = {}
  for (const [key, listConfig] of Object.entries(base.lists)) {
    const name = key as 'User' | 'Post' | 'Comment' | 'Audit'
    lists[key] = {
      ...listConfig,
      ...(fields?.[name] ? { fields: fields[name] } : {}),
      ...(hooks[name] ? { hooks: hooks[name] } : {}),
    }
  }
  return { ...base, lists }
}

/** The `name` a create carried, off whichever bracket half is reporting it. */
function written(args: BeforeTransactionHookArgs | AfterTransactionHookArgs): string {
  if (args.operation !== 'create') return 'not-a-create'
  return String(args.inputData.name)
}

describe('transaction-boundary hooks', () => {
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

  const rows = async (list: 'User' | 'Post' | 'Comment' | 'Audit'): Promise<unknown[]> =>
    harness.context.sudo().db[list].all()

  describe('a plain top-level write', () => {
    test(
      'commit: afterTransaction is handed committed and the persisted row',
      async () => {
        const after = vi.fn()
        const context = contextAt(withHooks({ User: { afterTransaction: after } }))

        await context.db.User.create({ data: { name: 'jane' } })

        expect(after).toHaveBeenCalledTimes(1)
        expect(after.mock.calls[0][0]).toMatchObject({ status: 'committed' })
        expect(after.mock.calls[0][0].item).toMatchObject({ name: 'jane' })
      },
      BOOT,
    )

    test(
      'a throwing afterOperation rolls the write back and reports it, with no item',
      async () => {
        const after = vi.fn()
        const context = contextAt(
          withHooks({
            User: {
              afterOperation: () => {
                throw new Error('after boom')
              },
              afterTransaction: after,
            },
          }),
        )

        await expect(context.db.User.create({ data: { name: 'jane' } })).rejects.toThrow(
          'after boom',
        )

        expect(after).toHaveBeenCalledTimes(1)
        expect(after.mock.calls[0][0]).toMatchObject({ status: 'rolled-back' })
        expect(after.mock.calls[0][0].item).toBeUndefined()
        expect((after.mock.calls[0][0].error as Error).message).toBe('after boom')
        expect(await rows('User')).toEqual([])
      },
      BOOT,
    )

    test(
      'a throwing beforeTransaction aborts the write and still fires its own compensator',
      async () => {
        const after = vi.fn()
        const context = contextAt(
          withHooks({
            User: {
              beforeTransaction: () => {
                throw new Error('before boom')
              },
              afterTransaction: after,
            },
          }),
        )

        await expect(context.db.User.create({ data: { name: 'jane' } })).rejects.toThrow(
          'before boom',
        )

        expect(after).toHaveBeenCalledTimes(1)
        expect(after.mock.calls[0][0]).toMatchObject({ status: 'rolled-back' })
        expect(await rows('User')).toEqual([])
      },
      BOOT,
    )

    test(
      'the field-level variants fire alongside the list-level ones',
      async () => {
        const fired: string[] = []
        const context = contextAt(
          withHooks(
            {
              User: {
                beforeTransaction: () => {
                  fired.push('list:before')
                },
                afterTransaction: () => {
                  fired.push('list:after')
                },
              },
            },
            {
              User: {
                name: text({
                  hooks: {
                    beforeTransaction: () => {
                      fired.push('field:before')
                    },
                    afterTransaction: () => {
                      fired.push('field:after')
                    },
                  },
                }),
              },
            },
          ),
        )

        await context.db.User.create({ data: { name: 'jane' } })

        expect(fired).toEqual(['list:before', 'field:before', 'list:after', 'field:after'])
      },
      BOOT,
    )

    test(
      'sudo still runs them, and an access-denied write runs neither',
      async () => {
        const after = vi.fn()
        const before = vi.fn()
        const closed = withHooks({
          User: { beforeTransaction: before, afterTransaction: after },
        })
        closed.lists.User.access = { operation: { ...OPEN, create: () => false } }
        const context = contextAt(closed)

        expect(await context.db.User.create({ data: { name: 'jane' } })).toBeNull()
        expect(before).not.toHaveBeenCalled()
        expect(after).not.toHaveBeenCalled()

        await context.sudo().db.User.create({ data: { name: 'jane' } })
        expect(before).toHaveBeenCalledTimes(1)
        expect(after).toHaveBeenCalledTimes(1)
        expect(after.mock.calls[0][0]).toMatchObject({ status: 'committed' })
      },
      BOOT,
    )
  })

  describe('a write that joined context.transaction', () => {
    test(
      'the compensator waits for the callback to return, and is handed committed',
      async () => {
        const events: string[] = []
        const after = vi.fn((_args: AfterTransactionHookArgs): void => {
          events.push('after')
        })
        const context = contextAt(withHooks({ User: { afterTransaction: after } }))

        const result = await context.transaction(async (tx) => {
          const user = await tx.db.User.create({ data: { name: 'jane' } })
          events.push('callback-write-done')
          expect(after).not.toHaveBeenCalled()
          return user
        })

        expect(events).toEqual(['callback-write-done', 'after'])
        expect(after.mock.calls[0][0]).toMatchObject({ status: 'committed' })
        expect(result).toMatchObject({ name: 'jane' })
      },
      BOOT,
    )

    test(
      'a callback that throws rolls everything back and reports its error once',
      async () => {
        const after = vi.fn()
        const context = contextAt(withHooks({ User: { afterTransaction: after } }))

        await expect(
          context.transaction(async (tx) => {
            await tx.db.User.create({ data: { name: 'jane' } })
            throw new Error('callback boom')
          }),
        ).rejects.toThrow('callback boom')

        expect(after).toHaveBeenCalledTimes(1)
        expect(after.mock.calls[0][0]).toMatchObject({ status: 'rolled-back' })
        expect((after.mock.calls[0][0].error as Error).message).toBe('callback boom')
        expect(after.mock.calls[0][0].item).toBeUndefined()
        expect(await rows('User')).toEqual([])
      },
      BOOT,
    )

    test(
      'beforeTransaction stays eager while afterTransaction defers',
      async () => {
        const order: string[] = []
        const context = contextAt(
          withHooks({
            User: {
              beforeTransaction: () => {
                order.push('before')
              },
              afterTransaction: () => {
                order.push('after')
              },
            },
          }),
        )

        await context.transaction(async (tx) => {
          order.push('callback-start')
          await tx.db.User.create({ data: { name: 'jane' } })
          order.push('callback-end')
        })

        expect(order).toEqual(['callback-start', 'before', 'callback-end', 'after'])
      },
      BOOT,
    )

    test(
      'a joined write whose beforeTransaction throws still defers its compensator to the owner',
      async () => {
        const order: string[] = []
        const context = contextAt(
          withHooks({
            User: {
              beforeTransaction: () => {
                order.push('before')
                throw new Error('before boom')
              },
              afterTransaction: ({ status }) => {
                order.push(`after:${status}`)
              },
            },
          }),
        )

        await context.transaction(async (tx) => {
          order.push('callback-start')
          await expect(tx.db.User.create({ data: { name: 'jane' } })).rejects.toThrow('before boom')
          order.push('callback-end')
        })

        expect(order).toEqual(['callback-start', 'before', 'callback-end', 'after:rolled-back'])
        expect(await rows('User')).toEqual([])
      },
      BOOT,
    )

    test(
      'three writes to one list flush in write order',
      async () => {
        const order: string[] = []
        const context = contextAt(
          withHooks({
            User: {
              beforeTransaction: (args: BeforeTransactionHookArgs) => {
                order.push(`before:${written(args)}`)
              },
              afterTransaction: (args: AfterTransactionHookArgs) => {
                order.push(`after:${written(args)}`)
              },
            },
          }),
        )

        await context.transaction(async (tx) => {
          await tx.db.User.create({ data: { name: 'a' } })
          await tx.db.User.create({ data: { name: 'b' } })
          await tx.db.User.create({ data: { name: 'c' } })
        })

        expect(order).toEqual(['before:a', 'before:b', 'before:c', 'after:a', 'after:b', 'after:c'])
      },
      BOOT,
    )

    test(
      'a nested context.transaction joins the outer owner rather than settling on its own',
      async () => {
        const order: string[] = []
        const context = contextAt(
          withHooks({
            User: {
              afterTransaction: () => {
                order.push('user-after')
              },
            },
            Post: {
              afterTransaction: () => {
                order.push('post-after')
              },
            },
          }),
        )

        await context.transaction(async (tx) => {
          await tx.db.User.create({ data: { name: 'jane' } })
          await tx.transaction(async (inner) => {
            await inner.db.Post.create({ data: { title: 'nested' } })
            order.push('inner-callback-done')
          })
          order.push('outer-callback-done')
        })

        expect(order).toEqual([
          'inner-callback-done',
          'outer-callback-done',
          'user-after',
          'post-after',
        ])
      },
      BOOT,
    )

    /**
     * A write's own failure is not the transaction's. `User.name` is required,
     * so the User write throws on its own while the enclosing transaction goes
     * on to commit the Post — and each compensator reports its own subject.
     */
    test(
      "a write's own error outranks the transaction's outcome, even on a commit",
      async () => {
        const userAfter = vi.fn()
        const postAfter = vi.fn()
        const config = withHooks(
          { User: { afterTransaction: userAfter }, Post: { afterTransaction: postAfter } },
          { User: { name: text({ validation: { isRequired: true } }) } },
        )
        const context = contextAt(config)

        const result = await context.transaction(async (tx) => {
          let userError: unknown
          try {
            await tx.db.User.create({ data: {} })
          } catch (error) {
            userError = error
          }
          await tx.db.Post.create({ data: { title: 'ok' } })
          return { failed: userError !== undefined }
        })

        expect(result.failed).toBe(true)
        expect(await rows('Post')).toHaveLength(1)
        expect(postAfter.mock.calls[0][0]).toMatchObject({ status: 'committed' })
        expect(userAfter).toHaveBeenCalledTimes(1)
        expect(userAfter.mock.calls[0][0]).toMatchObject({ status: 'rolled-back' })
      },
      BOOT,
    )

    test(
      'a throwing compensator rejects the transaction, and the others still ran',
      async () => {
        const fired: string[] = []
        const context = contextAt(
          withHooks({
            User: {
              afterTransaction: () => {
                fired.push('user')
                throw new Error('user compensator boom')
              },
            },
            Post: {
              afterTransaction: () => {
                fired.push('post')
              },
            },
          }),
        )

        await expect(
          context.transaction(async (tx) => {
            await tx.db.User.create({ data: { name: 'jane' } })
            await tx.db.Post.create({ data: { title: 'ok' } })
          }),
        ).rejects.toBeInstanceOf(AfterTransactionError)

        expect(fired.sort()).toEqual(['post', 'user'])
        expect(await rows('User')).toHaveLength(1)
        expect(await rows('Post')).toHaveLength(1)
      },
      BOOT,
    )

    /**
     * ADR-0028 decides that a boundary hook receives a context bound to the
     * BASE client, so a compensating write survives the rollback it is
     * compensating for. On a real database that is not what happens: the
     * deferred hook is handed the joined write's own transaction-bound
     * context, and by flush time that transaction is closed, so the write is
     * refused. The old suite could not see this — its double handed the same
     * ORM object in and out of the transaction, so a post-settle write worked.
     *
     * This pins the gap rather than the intent: a fix flips this assertion red,
     * which is the signal to restore the ADR's own wording here. Which way it
     * is resolved is open — issue #1348, and the amendment it is cited from at
     * the foot of ADR-0028.
     */
    test(
      'a deferred compensator still runs on rollback, but its own write is refused (ADR-0028 gap)',
      async () => {
        const outcomes: string[] = []
        const refusals: string[] = []
        const context = contextAt(
          withHooks({
            User: {
              afterTransaction: async ({ status, context: hookContext }) => {
                outcomes.push(status)
                if (status !== 'rolled-back') return
                try {
                  await hookContext.db.Comment.create({ data: { body: 'compensated' } })
                } catch (error) {
                  refusals.push(error instanceof Error ? error.message : String(error))
                }
              },
            },
          }),
        )

        await expect(
          context.transaction(async (tx) => {
            await tx.db.User.create({ data: { name: 'jane' } })
            throw new Error('boom')
          }),
        ).rejects.toThrow('boom')

        expect(outcomes).toEqual(['rolled-back'])
        expect(await rows('User')).toEqual([])
        expect(refusals).toHaveLength(1)
        expect(refusals[0]).toMatch(/after the transaction has ended/)
        expect(await rows('Comment')).toEqual([])
      },
      BOOT,
    )

    /**
     * The same hook on the top-level path, where the write's own context IS the
     * base one — the case ADR-0028 says the joined path should match.
     */
    test(
      'a top-level write’s compensator does write through the base client',
      async () => {
        const context = contextAt(
          withHooks({
            User: {
              afterOperation: () => {
                throw new Error('after boom')
              },
              afterTransaction: async ({ status, context: hookContext }) => {
                if (status !== 'rolled-back') return
                await hookContext.db.Comment.create({ data: { body: 'compensated' } })
              },
            },
          }),
        )

        await expect(context.db.User.create({ data: { name: 'jane' } })).rejects.toThrow(
          'after boom',
        )

        expect(await rows('User')).toEqual([])
        expect(await rows('Comment')).toMatchObject([{ body: 'compensated' }])
      },
      BOOT,
    )

    /**
     * ADR-0028's precedence rule over ADR-0042's normalisation: the
     * transaction's own failure reaches the caller ahead of any hook error,
     * and it arrives as the stack-owned type rather than the driver's.
     */
    test(
      'a serialization failure reaches the caller normalised, ahead of the compensators',
      async () => {
        const after = vi.fn()
        const context = contextAt(withHooks({ User: { afterTransaction: after } }))
        const driverError = Object.assign(new Error('could not serialize access'), {
          kind: 'sql_query',
          sqlState: '40001',
          constraint: undefined,
        })

        const raised = await context
          .transaction(async (tx) => {
            await tx.db.User.create({ data: { name: 'jane' } })
            throw driverError
          })
          .then(
            () => undefined,
            (error: unknown) => error,
          )

        expect(isSerializationFailure(raised)).toBe(true)
        expect(raised).not.toBeInstanceOf(AfterTransactionError)
        expect(after).toHaveBeenCalledTimes(1)
        expect(after.mock.calls[0][0]).toMatchObject({ status: 'rolled-back' })
        expect(await rows('User')).toEqual([])
      },
      BOOT,
    )
  })

  /**
   * The other way a write joins a transaction it did not open: a hook issuing
   * its own `context.db` write from inside an enclosing top-level write.
   */
  describe('a hook-issued write inside a plain top-level write', () => {
    function auditingConfig(options: {
      fieldThrows: boolean
      auditAfter: (args: unknown) => void
    }): OpenSaasConfig {
      return withHooks(
        {
          User: {
            afterOperation: async ({ operation, context: hookContext }) => {
              if (operation !== 'create') return
              await hookContext.db.Audit.create({ data: { note: 'audit' } })
            },
          },
          Audit: { afterTransaction: options.auditAfter },
        },
        {
          User: {
            name: text({
              hooks: options.fieldThrows
                ? {
                    afterOperation: () => {
                      throw new Error('name afterOperation boom')
                    },
                  }
                : undefined,
            }),
          },
        },
      )
    }

    test(
      'it reports rolled-back when the enclosing write later rolls back',
      async () => {
        const auditAfter = vi.fn()
        const context = contextAt(auditingConfig({ fieldThrows: true, auditAfter }))

        await expect(context.db.User.create({ data: { name: 'jane' } })).rejects.toThrow(
          'name afterOperation boom',
        )

        expect(await rows('User')).toEqual([])
        expect(await rows('Audit')).toEqual([])
        expect(auditAfter).toHaveBeenCalledTimes(1)
        expect(auditAfter.mock.calls[0][0]).toMatchObject({ status: 'rolled-back' })
        expect((auditAfter.mock.calls[0][0].error as Error).message).toBe(
          'name afterOperation boom',
        )
      },
      BOOT,
    )

    test(
      'it reports committed, with the persisted row, when the enclosing write commits',
      async () => {
        const auditAfter = vi.fn()
        const context = contextAt(auditingConfig({ fieldThrows: false, auditAfter }))

        await context.db.User.create({ data: { name: 'jane' } })

        expect(await rows('Audit')).toHaveLength(1)
        expect(auditAfter).toHaveBeenCalledTimes(1)
        expect(auditAfter.mock.calls[0][0]).toMatchObject({ status: 'committed' })
        expect(auditAfter.mock.calls[0][0].item).toMatchObject({ note: 'audit' })
      },
      BOOT,
    )
  })
})
