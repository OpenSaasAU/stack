import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AccessControlledDB, Session } from '../access/index.js'
import type { BulkAction, OpenSaasConfig, RowAction, RowActionContext } from '../config/types.js'
import { relationship, text } from '../fields/index.js'
import { createTestContext, ormClientFor, type TestContext } from '../testing/context.js'
import type { StackContext } from '../types/context.js'
import { ValidationError } from '../hooks/index.js'
import { getContext } from './index.js'

/**
 * `context.serverAction` — the admin UI's one write entry point — over a real
 * database (#736, #758, #761).
 *
 * The recurring property is error hygiene: whatever fails inside, the client
 * gets a stack-authored message and the operator gets the real one in the log.
 */

const BOOT = 120_000

const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

function schemaConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      User: {
        fields: {
          name: text(),
          email: text(),
          apiToken: text({ ui: { valueForClientSerialization: () => null } }),
          posts: relationship({ ref: 'Post.author', many: true }),
        },
        access: { operation: OPEN },
      },
      Post: {
        fields: {
          title: text(),
          status: text(),
          author: relationship({ ref: 'User.posts' }),
        },
        access: { operation: OPEN },
      },
      Ticket: {
        fields: { status: text() },
        access: { operation: OPEN },
        db: { idField: 'int autoincrement' },
      },
    },
  }
}

/** The schema config carrying one bulk action, with the parts a test varies. */
function withBulkAction(overrides?: Partial<BulkAction>): OpenSaasConfig {
  const base = schemaConfig()
  base.lists.Post.ui = {
    listView: {
      bulkActions: [
        {
          key: 'publish',
          label: 'Publish',
          handler: async ({ ids, context }) => {
            let published = 0
            for (const id of ids) {
              const updated = await context.db.Post.update({
                where: { id },
                data: { status: 'published' },
              })
              if (updated) published += 1
            }
            return { message: `Published ${published} of ${ids.length}` }
          },
          ...overrides,
        },
      ],
    },
  }
  return base
}

/** The schema config carrying one Row action, with the parts a test varies. */
function withRowAction(overrides?: Partial<RowAction>): OpenSaasConfig {
  const base = schemaConfig()
  base.lists.Post.ui = {
    listView: {
      rowActions: [
        {
          key: 'publish',
          label: 'Publish now',
          isAvailable: ({ item }) => item.status !== 'published',
          handler: async ({ id, context }) => {
            const updated = await context.db.Post.update({
              where: { id },
              data: { status: 'published' },
            })
            return { message: updated ? 'Published' : 'Not published' }
          },
          ...overrides,
        },
      ],
    },
  }
  return base
}

/** The shape a Postgres driver raises, before the stack normalises it. */
function driverError(message: string, sqlState: string): Error {
  return Object.assign(new Error(message), { kind: 'sql_query', sqlState, constraint: undefined })
}

describe('context.serverAction', () => {
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

  describe('relationshipOptions', () => {
    test('answers with { options } and never a success key', async () => {
      const created = await harness.context.serverAction({
        listKey: 'User',
        action: 'create',
        data: { name: 'Ada', email: 'ada@x.io' },
      })
      const id = String((created as { data: { id: unknown } }).data.id)

      const response = await harness.context.serverAction({
        listKey: 'Post',
        action: 'relationshipOptions',
        field: 'author',
        search: 'Ada',
      })

      expect(response).not.toHaveProperty('success')
      expect(response).toMatchObject({ options: [{ id }] })
    })
  })

  describe('the CRUD actions', () => {
    test('no write response carries a column other than id', async () => {
      const context = harness.context
      const created = await context.serverAction({
        listKey: 'User',
        action: 'create',
        data: { name: 'a', email: 'a@x.io', apiToken: 'sk_live_secret' },
      })
      const id = String((created as { data: { id: unknown } }).data.id)
      const updated = await context.serverAction({
        listKey: 'User',
        action: 'update',
        id,
        data: { apiToken: 'sk_live_other' },
      })
      const deleted = await context.serverAction({ listKey: 'User', action: 'delete', id })
      for (const response of [created, updated, deleted]) {
        expect(JSON.stringify(response)).not.toContain('sk_live')
        expect(response).toEqual({ success: true, data: { id } })
      }
    })

    test(
      'create, update and delete each round-trip through the secured surface',
      async () => {
        const context = harness.context

        const created = await context.serverAction({
          listKey: 'User',
          action: 'create',
          data: { name: 'John', email: 'john@example.com' },
        })
        expect(created).toMatchObject({ success: true })
        expect(Object.keys((created as { data: object }).data)).toEqual(['id'])
        const id = String((created as { data: { id: unknown } }).data.id)

        expect(
          await context.serverAction({
            listKey: 'User',
            action: 'update',
            id,
            data: { name: 'John Updated' },
          }),
        ).toMatchObject({ success: true, data: { id } })

        expect(await context.serverAction({ listKey: 'User', action: 'delete', id })).toMatchObject(
          { success: true },
        )
        expect(await context.db.User.all()).toEqual([])
      },
      BOOT,
    )

    test(
      'an unknown action and an unknown list each answer with a failure, not a throw',
      async () => {
        expect(
          await harness.context.serverAction({
            listKey: 'User',
            action: 'unknown' as unknown as 'create',
            data: {},
          }),
        ).toEqual({ success: false, error: 'Access denied or operation failed' })

        expect(
          await harness.context.serverAction({ listKey: 'Nope', action: 'create', data: {} }),
        ).toEqual({ success: false, error: 'List "Nope" not found in configuration' })
      },
      BOOT,
    )

    test(
      'a denied create is the same generic failure, whichever list it was',
      async () => {
        const denied = schemaConfig()
        denied.lists.User.access = { operation: { ...OPEN, create: () => false } }

        expect(
          await contextAt(denied).serverAction({
            listKey: 'User',
            action: 'create',
            data: { name: 'John' },
          }),
        ).toEqual({ success: false, error: 'Access denied or operation failed' })
      },
      BOOT,
    )
  })

  describe('error redaction', () => {
    test(
      'a throwing bulk-action hasAccess is redacted',
      async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
          const context = contextAt(
            withBulkAction({
              hasAccess: () => {
                throw new Error('INTERNAL sk-live-123')
              },
            }),
          )
          const result = await context.serverAction({
            listKey: 'Post',
            action: 'bulkAction',
            key: 'publish',
            ids: [],
          })
          expect(result).toEqual({ bulkAction: false, error: 'Action failed' })
        } finally {
          logged.mockRestore()
        }
      },
      BOOT,
    )

    function withHook(throwing: () => never): OpenSaasConfig {
      const config = schemaConfig()
      config.lists.Post.hooks = { beforeOperation: throwing }
      return config
    }

    test(
      'a non-validation error is logged and replaced with a generic message',
      async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
          const context = contextAt(
            withHook(() => {
              throw new Error('INTERNAL api key sk-live-123')
            }),
          )
          const result = await context.serverAction({
            listKey: 'Post',
            action: 'create',
            data: { title: 'x' },
          })
          expect(result).toEqual({
            success: false,
            error: 'Create on "Post" failed due to an internal error.',
            fieldErrors: undefined,
          })
          expect(JSON.stringify(result)).not.toContain('sk-live-123')
          expect(
            logged.mock.calls
              .flat()
              .some((arg) => arg instanceof Error && /sk-live/.test(arg.message)),
          ).toBe(true)
        } finally {
          logged.mockRestore()
        }
      },
      BOOT,
    )

    test(
      'update and delete redact a throwing afterOperation too',
      async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
          const seeded = await harness.context.db.Post.create({ data: { title: 'x' } })
          if (seeded === null) throw new Error('seed failed')
          const id = String(seeded.id)
          const config = schemaConfig()
          config.lists.Post.hooks = {
            afterOperation: () => {
              throw new Error('INTERNAL api key sk-live-123')
            },
          }
          const context = contextAt(config)
          for (const action of ['update', 'delete'] as const) {
            const result = await context.serverAction(
              action === 'update'
                ? { listKey: 'Post', action, id, data: { title: 'y' } }
                : { listKey: 'Post', action, id },
            )
            expect(result).toMatchObject({ success: false })
            expect(JSON.stringify(result)).not.toContain('sk-live-123')
          }
        } finally {
          logged.mockRestore()
        }
      },
      BOOT,
    )

    test(
      'a ValidationError reaches the client verbatim',
      async () => {
        const context = contextAt(
          withHook(() => {
            throw new ValidationError(['Title is taken'])
          }),
        )
        const result = await context.serverAction({
          listKey: 'Post',
          action: 'create',
          data: { title: 'x' },
        })
        expect(result).toMatchObject({ success: false })
        expect(JSON.stringify(result)).toContain('Title is taken')
      },
      BOOT,
    )
  })

  describe('ui.classifyActionError', () => {
    class ClaimConflict extends Error {}

    function classified(
      classify: NonNullable<NonNullable<OpenSaasConfig['ui']>['classifyActionError']>,
      hook: () => never,
    ): OpenSaasConfig {
      const config = schemaConfig()
      config.ui = { classifyActionError: classify }
      config.lists.Post.hooks = { beforeOperation: hook }
      return config
    }

    const create = { listKey: 'Post', action: 'create', data: { title: 'x' } } as const

    test(
      'a mapped hook error resolves with its code and message',
      async () => {
        const result = await contextAt(
          classified(
            (error) =>
              error instanceof ClaimConflict
                ? { code: 'CLAIM_CONFLICT', message: 'Reload and try again.' }
                : undefined,
            () => {
              throw new ClaimConflict('claimed')
            },
          ),
        ).serverAction(create)

        expect(result).toEqual({
          success: false,
          error: 'Reload and try again.',
          code: 'CLAIM_CONFLICT',
        })
      },
      BOOT,
    )

    test(
      'undefined falls through to the default mapping',
      async () => {
        const result = await contextAt(
          classified(
            () => undefined,
            () => {
              throw new ValidationError(['Title is bad'], { title: 'Title is bad' })
            },
          ),
        ).serverAction(create)

        expect(result).toMatchObject({ success: false, fieldErrors: { title: 'Title is bad' } })
        expect(result).not.toHaveProperty('code')
      },
      BOOT,
    )

    test(
      'a throwing classifier is logged and the default mapping applies',
      async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
          const result = await contextAt(
            classified(
              () => {
                throw new Error('classifier bug')
              },
              () => {
                throw new Error('INTERNAL sk-live-123')
              },
            ),
          ).serverAction(create)

          expect(result).toMatchObject({
            success: false,
            error: 'Create on "Post" failed due to an internal error.',
          })
          expect(result).not.toHaveProperty('code')
          expect(logged).toHaveBeenCalledWith('classifyActionError threw:', expect.any(Error))
        } finally {
          logged.mockRestore()
        }
      },
      BOOT,
    )

    test(
      'a bulk action failure carries the code',
      async () => {
        const config = withBulkAction({
          handler: async () => {
            throw new ClaimConflict('claimed')
          },
        })
        config.ui = {
          classifyActionError: (error) =>
            error instanceof ClaimConflict
              ? { code: 'CLAIM_CONFLICT', message: 'Reload.' }
              : undefined,
        }
        const result = await contextAt(config).serverAction({
          listKey: 'Post',
          action: 'bulkAction',
          key: 'publish',
          ids: [],
        })
        expect(result).toEqual({ bulkAction: false, error: 'Reload.', code: 'CLAIM_CONFLICT' })
      },
      BOOT,
    )
  })

  describe('a bulk action', () => {
    async function seedPosts(): Promise<string[]> {
      const first = await harness.context.db.Post.create({ data: { title: 'a' } })
      const second = await harness.context.db.Post.create({ data: { title: 'b' } })
      return [String(first?.id), String(second?.id)]
    }

    test(
      'the handler runs over the selected ids through the secured context',
      async () => {
        const ids = await seedPosts()

        expect(
          await contextAt(withBulkAction()).serverAction({
            listKey: 'Post',
            action: 'bulkAction',
            key: 'publish',
            ids,
          }),
        ).toEqual({ bulkAction: true, message: 'Published 2 of 2' })

        expect((await harness.context.db.Post.all()).map((row) => row.status).sort()).toEqual([
          'published',
          'published',
        ])
      },
      BOOT,
    )

    /**
     * A per-id Silent failure is absorbed into the handler's own count. The
     * outcome must not say which id was denied — that is the leak the count
     * exists to avoid.
     */
    test(
      'a per-id denial is absorbed into the count and never named',
      async () => {
        const ids = await seedPosts()
        const scoped = withBulkAction()
        scoped.lists.Post.access = {
          operation: { ...OPEN, update: () => ({ title: { equals: 'a' } }) },
        }

        expect(
          await contextAt(scoped).serverAction({
            listKey: 'Post',
            action: 'bulkAction',
            key: 'publish',
            ids,
          }),
        ).toEqual({ bulkAction: true, message: 'Published 1 of 2' })

        const rows = await harness.context.db.Post.all()
        expect(rows.find((row) => row.title === 'a')?.status).toBe('published')
        expect(rows.find((row) => row.title === 'b')?.status ?? null).toBeNull()
      },
      BOOT,
    )

    test(
      'an unknown key is refused',
      async () => {
        expect(
          await contextAt(withBulkAction()).serverAction({
            listKey: 'Post',
            action: 'bulkAction',
            key: 'nope',
            ids: ['whatever'],
          }),
        ).toMatchObject({ bulkAction: false })
      },
      BOOT,
    )

    test(
      'hasAccess is re-checked on the server, so a hidden action cannot be invoked',
      async () => {
        const ids = await seedPosts()

        expect(
          await contextAt(withBulkAction({ hasAccess: () => false })).serverAction({
            listKey: 'Post',
            action: 'bulkAction',
            key: 'publish',
            ids,
          }),
        ).toEqual({ bulkAction: false, error: 'Access denied' })

        expect((await harness.context.db.Post.all()).every((row) => row.status === null)).toBe(true)
      },
      BOOT,
    )

    /** #761: an unexpected bug inside a handler must not travel to the client. */
    test(
      'a handler that throws a plain Error yields a generic message, and logs the real one',
      async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
          const config = withBulkAction({
            handler: async () => {
              throw new Error('secret internal detail: connection string leaked')
            },
          })

          const result = await contextAt(config).serverAction({
            listKey: 'Post',
            action: 'bulkAction',
            key: 'publish',
            ids: ['p1'],
          })

          expect(result).toEqual({ bulkAction: false, error: 'Action failed' })
          expect(logged.mock.calls.flat().some((arg) => arg instanceof Error)).toBe(true)
        } finally {
          logged.mockRestore()
        }
      },
      BOOT,
    )

    test(
      'a driver failure reaches the client as the stack’s own message, and the driver text only the log',
      async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        const text = 'null value in column "status" of relation "Post" violates not-null constraint'
        try {
          const config = withBulkAction({
            handler: async () => {
              throw driverError(text, '23502')
            },
          })

          const result = await contextAt(config).serverAction({
            listKey: 'Post',
            action: 'bulkAction',
            key: 'publish',
            ids: ['p1'],
          })

          expect(result).toEqual({
            bulkAction: false,
            error: 'The database refused this operation',
          })
          const cause = logged.mock.calls.flat().find((arg): arg is Error => arg instanceof Error)
          expect(cause?.message).toBe(text)
        } finally {
          logged.mockRestore()
        }
      },
      BOOT,
    )
  })

  describe('a row action', () => {
    async function seedPost(title = 'a', status: string | null = null): Promise<string> {
      const post = await harness.context.db.Post.create({ data: { title, status } })
      return String(post?.id)
    }

    test(
      'the handler runs with the list key, the id, the re-read row and the secured context',
      async () => {
        const id = await seedPost('a', 'draft')
        const seen: RowActionContext[] = []
        const config = withRowAction()
        const declared = config.lists.Post.ui?.listView?.rowActions?.[0]
        if (!declared) throw new Error('row action missing')
        const handler = declared.handler
        declared.handler = async (args) => {
          seen.push(args)
          return handler(args)
        }

        expect(
          await contextAt(config).serverAction({
            listKey: 'Post',
            action: 'rowAction',
            key: 'publish',
            id,
          }),
        ).toEqual({ rowAction: true, message: 'Published' })

        expect(seen).toHaveLength(1)
        expect(seen[0]).toMatchObject({ listKey: 'Post', id, item: { id, status: 'draft' } })
        expect(seen[0].context.session).toEqual({ userId: 'u1' })
        expect((await harness.context.db.Post.all())[0]?.status).toBe('published')
      },
      BOOT,
    )

    test(
      'isAvailable is re-run against the re-read row, so a stale page cannot run it',
      async () => {
        const id = await seedPost('a', 'published')
        const handler = vi.fn(async () => ({ message: 'ran' }))

        expect(
          await contextAt(withRowAction({ handler })).serverAction({
            listKey: 'Post',
            action: 'rowAction',
            key: 'publish',
            id,
          }),
        ).toEqual({ rowAction: false, error: 'This action was not run' })
        expect(handler).not.toHaveBeenCalled()
      },
      BOOT,
    )

    test(
      'a row that became denied answers exactly as a missing row does',
      async () => {
        const id = await seedPost('hidden', 'draft')
        const handler = vi.fn(async () => ({ message: 'ran' }))
        const denied = withRowAction({ handler })
        denied.lists.Post.access = {
          operation: { ...OPEN, query: () => ({ title: { equals: 'visible' } }) },
        }

        const deniedOutcome = await contextAt(denied).serverAction({
          listKey: 'Post',
          action: 'rowAction',
          key: 'publish',
          id,
        })
        await harness.truncate()
        const missingOutcome = await contextAt(withRowAction({ handler })).serverAction({
          listKey: 'Post',
          action: 'rowAction',
          key: 'publish',
          id,
        })

        expect(deniedOutcome).toEqual(missingOutcome)
        expect(deniedOutcome).toEqual({ rowAction: false, error: 'This action was not run' })
        expect(handler).not.toHaveBeenCalled()
      },
      BOOT,
    )

    test(
      'hasAccess is re-checked on dispatch and answers as Silent failure',
      async () => {
        const id = await seedPost('a', 'draft')
        const handler = vi.fn(async () => ({ message: 'ran' }))

        expect(
          await contextAt(withRowAction({ handler, hasAccess: () => false })).serverAction({
            listKey: 'Post',
            action: 'rowAction',
            key: 'publish',
            id,
          }),
        ).toEqual({ rowAction: false, error: 'This action was not run' })
        expect(handler).not.toHaveBeenCalled()
      },
      BOOT,
    )

    test(
      'a hasAccess that throws answers as Silent failure and is logged',
      async () => {
        const id = await seedPost('a', 'draft')
        const handler = vi.fn(async () => ({ message: 'ran' }))
        const thrown = new Error('no role')
        const hasAccess = () => {
          throw thrown
        }
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
          expect(
            await contextAt(withRowAction({ handler, hasAccess })).serverAction({
              listKey: 'Post',
              action: 'rowAction',
              key: 'publish',
              id,
            }),
          ).toEqual({ rowAction: false, error: 'This action was not run' })
          expect(handler).not.toHaveBeenCalled()
          expect(logged).toHaveBeenCalledWith(expect.stringContaining('hasAccess threw'), thrown)
        } finally {
          logged.mockRestore()
        }
      },
      BOOT,
    )

    test(
      'an isAvailable that throws answers as Silent failure and is logged',
      async () => {
        const id = await seedPost('a', 'draft')
        const handler = vi.fn(async () => ({ message: 'ran' }))
        const thrown = new Error('bad row')
        const isAvailable = () => {
          throw thrown
        }
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
          expect(
            await contextAt(withRowAction({ handler, isAvailable })).serverAction({
              listKey: 'Post',
              action: 'rowAction',
              key: 'publish',
              id,
            }),
          ).toEqual({ rowAction: false, error: 'This action was not run' })
          expect(handler).not.toHaveBeenCalled()
          expect(logged).toHaveBeenCalledWith(expect.stringContaining('isAvailable threw'), thrown)
        } finally {
          logged.mockRestore()
        }
      },
      BOOT,
    )

    test(
      'on an int autoincrement list the handler gets the parsed id and can write with it',
      async () => {
        const ticket = await harness.context.db.Ticket.create({ data: { status: 'open' } })
        if (ticket === null) throw new Error('ticket not created')
        const seen: unknown[] = []
        const config = schemaConfig()
        config.lists.Ticket.ui = {
          listView: {
            rowActions: [
              {
                key: 'close',
                label: 'Close',
                handler: async ({ id, context }) => {
                  seen.push(id)
                  const updated = await context.db.Ticket.update({
                    where: { id },
                    data: { status: 'closed' },
                  })
                  return { message: updated ? 'Closed' : 'Not closed' }
                },
              },
            ],
          },
        }

        expect(
          await contextAt(config).serverAction({
            listKey: 'Ticket',
            action: 'rowAction',
            key: 'close',
            id: String(ticket.id),
          }),
        ).toEqual({ rowAction: true, message: 'Closed' })
        expect(seen).toEqual([ticket.id])
        expect(typeof seen[0]).toBe('number')
        expect((await harness.context.db.Ticket.all())[0]?.status).toBe('closed')
      },
      BOOT,
    )

    test(
      'an id the list key cannot hold is not run',
      async () => {
        const handler = vi.fn(async () => ({ message: 'ran' }))
        expect(
          await contextAt(withRowAction({ handler })).serverAction({
            listKey: 'Post',
            action: 'rowAction',
            key: 'publish',
            id: 'not-a-uuid',
          }),
        ).toEqual({ rowAction: false, error: 'This action was not run' })
        expect(handler).not.toHaveBeenCalled()
      },
      BOOT,
    )

    test(
      'an unknown key is refused and never answers success',
      async () => {
        const result = await contextAt(withRowAction()).serverAction({
          listKey: 'Post',
          action: 'rowAction',
          key: 'nope',
          id: 'whatever',
        })
        expect(result).toMatchObject({ rowAction: false })
        expect(result).not.toHaveProperty('success')
      },
      BOOT,
    )

    test(
      'the handler runs inside the transaction, so its write rolls back when it throws',
      async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
          const id = await seedPost('a', 'draft')
          const result = await contextAt(
            withRowAction({
              handler: async ({ id: rowId, context }) => {
                const updated = await context.db.Post.update({
                  where: { id: rowId },
                  data: { status: 'published' },
                })
                if (updated === null) throw new Error('write denied')
                throw new Error('after the write')
              },
            }),
          ).serverAction({ listKey: 'Post', action: 'rowAction', key: 'publish', id })
          expect(result).toEqual({ rowAction: false, error: 'Action failed' })
          expect((await harness.context.db.Post.all())[0]?.status).toBe('draft')
        } finally {
          logged.mockRestore()
        }
      },
      BOOT,
    )

    test(
      'the handler context is transaction-bound, so it can take a row lock',
      async () => {
        const id = await seedPost('a', 'draft')
        const result = await contextAt(
          withRowAction({
            handler: async ({ id: rowId, context }) => {
              const locked = await context.db.Post.where({ id: { equals: rowId } })
                .forUpdate()
                .first()
              return { message: locked === null ? 'not locked' : 'locked' }
            },
          }),
        ).serverAction({ listKey: 'Post', action: 'rowAction', key: 'publish', id })
        expect(result).toEqual({ rowAction: true, message: 'locked' })
      },
      BOOT,
    )

    test(
      'a handler that throws a plain Error yields a generic message',
      async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
          const id = await seedPost('a', 'draft')
          const result = await contextAt(
            withRowAction({
              handler: async () => {
                throw new Error('secret internal detail')
              },
            }),
          ).serverAction({ listKey: 'Post', action: 'rowAction', key: 'publish', id })
          expect(result).toEqual({ rowAction: false, error: 'Action failed' })
        } finally {
          logged.mockRestore()
        }
      },
      BOOT,
    )
  })

  describe('an inline cell edit', () => {
    test(
      'it updates the one field it names, and deletes nothing',
      async () => {
        const created = await harness.context.db.Post.create({ data: { title: 'Old' } })

        expect(
          await harness.context.serverAction({
            listKey: 'Post',
            action: 'updateRelated',
            id: String(created?.id),
            field: 'title',
            value: 'New',
          }),
        ).toEqual({ updated: true })

        expect(await harness.context.db.Post.all()).toMatchObject([{ title: 'New' }])
      },
      BOOT,
    )

    test(
      'a denied edit is a generic failure, with no denied-versus-absent tell',
      async () => {
        const created = await harness.context.db.Post.create({ data: { title: 'Old' } })
        const denied = schemaConfig()
        denied.lists.Post.access = { operation: { ...OPEN, update: () => false } }

        const onExisting = await contextAt(denied).serverAction({
          listKey: 'Post',
          action: 'updateRelated',
          id: String(created?.id),
          field: 'title',
          value: 'New',
        })
        const onAbsent = await contextAt(denied).serverAction({
          listKey: 'Post',
          action: 'updateRelated',
          id: '00000000-0000-4000-8000-000000000000',
          field: 'title',
          value: 'New',
        })

        expect(onExisting).toEqual({ updated: false, error: 'Access denied or operation failed' })
        expect(onAbsent).toEqual(onExisting)
      },
      BOOT,
    )

    test(
      'a validation failure comes back with its reason, so the cell can revert',
      async () => {
        const created = await harness.context.db.Post.create({ data: { title: 'Old' } })
        const validating = schemaConfig()
        validating.lists.Post.hooks = {
          validate: async (args) => {
            if (args.operation === 'delete') return
            if (args.resolvedData.title === 'spam') {
              args.addValidationError('Title cannot contain "spam"')
            }
          },
        }

        const result = await contextAt(validating).serverAction({
          listKey: 'Post',
          action: 'updateRelated',
          id: String(created?.id),
          field: 'title',
          value: 'spam',
        })

        expect(result).toMatchObject({ updated: false })
        expect((result as { error?: string }).error).toContain('spam')
        expect(await harness.context.db.Post.all()).toMatchObject([{ title: 'Old' }])
      },
      BOOT,
    )
  })
})
