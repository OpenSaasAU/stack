import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AccessControlledDB, Session } from '../access/index.js'
import type { BulkAction, OpenSaasConfig } from '../config/types.js'
import { relationship, text } from '../fields/index.js'
import { createTestContext, ormClientFor, type TestContext } from '../testing/context.js'
import type { StackContext } from '../types/context.js'
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

  describe('the CRUD actions', () => {
    test(
      'create, update and delete each round-trip through the secured surface',
      async () => {
        const context = harness.context

        const created = await context.serverAction({
          listKey: 'User',
          action: 'create',
          data: { name: 'John', email: 'john@example.com' },
        })
        expect(created).toMatchObject({ success: true, data: { name: 'John' } })
        const id = String((created as { data: { id: unknown } }).data.id)

        expect(
          await context.serverAction({
            listKey: 'User',
            action: 'update',
            id,
            data: { name: 'John Updated' },
          }),
        ).toMatchObject({ success: true, data: { name: 'John Updated' } })

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
