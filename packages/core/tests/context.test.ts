import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getContext } from '../src/context/index.js'
import { defineFragment } from '../src/query/index.js'
import { virtual } from '../src/fields/index.js'
import {
  AccessScopeDepthExceededError,
  InvalidFieldAccessResultError,
} from '../src/access/index.js'
import { READ_INCLUDE_MAX_DEPTH } from '../src/access/depth-limits.js'
import type { OpenSaasConfig } from '../src/config/types.js'

describe('getContext', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockPrisma: any
  let config: OpenSaasConfig

  beforeEach(() => {
    // Mock Prisma client with all methods needed by context
    mockPrisma = {
      User: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      },
      Post: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      },
    }

    // Sample config with open access (no access control to simplify tests)
    config = {
      db: {
        provider: 'postgresql',
        url: 'postgresql://localhost:5432/test',
      },
      lists: {
        User: {
          fields: {
            name: { type: 'text' },
            email: { type: 'text', isIndexed: 'unique' },
            posts: { type: 'relationship', ref: 'Post.author', many: true },
          },
          access: {
            operation: {
              query: () => true,
              create: () => true,
              update: () => true,
              delete: () => true,
            },
          },
        },
        Post: {
          fields: {
            title: { type: 'text' },
            content: { type: 'text' },
            author: { type: 'relationship', ref: 'User.posts' },
          },
          access: {
            operation: {
              query: () => true,
              create: () => true,
              update: () => true,
              delete: () => true,
            },
          },
        },
      },
    }
  })

  it('should create context with lowercase db keys', async () => {
    const context = await getContext(config, mockPrisma, null)

    expect(context.db).toBeDefined()
    expect(context.db.User).toBeDefined()
    expect(context.db.Post).toBeDefined()
    expect(context.session).toBeNull()
    // Built from a hand-made ORM double, so there is no client behind the
    // Unsafe surface and every lane refuses by name rather than being absent.
    expect(() => context.unsafe.orm).toThrow(/context\.unsafe\.orm/)
  })

  it('should include session when provided', async () => {
    const session = { userId: '123', role: 'admin' }
    const context = await getContext(config, mockPrisma, session)

    expect(context.session).toEqual(session)
  })

  describe('serverAction', () => {
    it('should create an item', async () => {
      const mockCreatedUser = { id: '1', name: 'John', email: 'john@example.com' }
      mockPrisma.User.create.mockResolvedValue(mockCreatedUser)

      const context = await getContext(config, mockPrisma, null)
      const result = await context.serverAction({
        listKey: 'User',
        action: 'create',
        data: { name: 'John', email: 'john@example.com' },
      })

      expect(mockPrisma.User.create).toHaveBeenCalledWith({
        data: { name: 'John', email: 'john@example.com' },
      })
      expect(result).toEqual({ success: true, data: mockCreatedUser })
    })

    it('should update an item', async () => {
      const existingUser = { id: '1', name: 'John', email: 'john@example.com' }
      const mockUpdatedUser = { id: '1', name: 'John Updated', email: 'john@example.com' }
      // Update operation first fetches the existing item
      mockPrisma.User.findUnique.mockResolvedValue(existingUser)
      mockPrisma.User.update.mockResolvedValue(mockUpdatedUser)

      const context = await getContext(config, mockPrisma, null)
      const result = await context.serverAction({
        listKey: 'User',
        action: 'update',
        id: '1',
        data: { name: 'John Updated' },
      })

      expect(mockPrisma.User.findUnique).toHaveBeenCalled()
      expect(mockPrisma.User.update).toHaveBeenCalled()
      expect(result).toEqual({ success: true, data: mockUpdatedUser })
    })

    it('should delete an item', async () => {
      const mockDeletedUser = { id: '1', name: 'John', email: 'john@example.com' }
      // Delete operation first fetches the existing item
      mockPrisma.User.findUnique.mockResolvedValue(mockDeletedUser)
      mockPrisma.User.delete.mockResolvedValue(mockDeletedUser)

      const context = await getContext(config, mockPrisma, null)
      const result = await context.serverAction({
        listKey: 'User',
        action: 'delete',
        id: '1',
      })

      expect(mockPrisma.User.findUnique).toHaveBeenCalled()
      expect(mockPrisma.User.delete).toHaveBeenCalled()
      expect(result).toEqual({ success: true, data: mockDeletedUser })
    })

    it('should convert listKey to lowercase for db operations', async () => {
      const mockCreatedPost = { id: '1', title: 'Test Post' }
      mockPrisma.Post.create.mockResolvedValue(mockCreatedPost)

      const context = await getContext(config, mockPrisma, null)
      const result = await context.serverAction({
        listKey: 'Post',
        action: 'create',
        data: { title: 'Test Post' },
      })

      expect(mockPrisma.Post.create).toHaveBeenCalled()
      expect(result).toEqual({ success: true, data: mockCreatedPost })
    })

    it('should return error for unknown action', async () => {
      const context = await getContext(config, mockPrisma, null)
      const result = await context.serverAction({
        listKey: 'User',
        action: 'unknown' as unknown as 'create',
        data: {},
      })

      expect(result).toEqual({ success: false, error: 'Access denied or operation failed' })
    })

    it('should return error for unknown list', async () => {
      const context = await getContext(config, mockPrisma, null)
      const result = await context.serverAction({
        listKey: 'UnknownList',
        action: 'create',
        data: {},
      })

      expect(result).toEqual({
        success: false,
        error: 'List "UnknownList" not found in configuration',
      })
    })

    it('should handle database errors', async () => {
      const dbError = new Error('Database connection failed')
      mockPrisma.User.create.mockRejectedValue(dbError)

      const context = await getContext(config, mockPrisma, null)
      const result = await context.serverAction({
        listKey: 'User',
        action: 'create',
        data: { name: 'John', email: 'john@example.com' },
      })

      expect(result).toMatchObject({
        success: false,
        error: 'Database connection failed',
      })
    })

    describe('removeRelated (relationship-table row removal)', () => {
      it('unlinks a to-one back-reference via an update on the related list', async () => {
        const existing = { id: 'p1', title: 'T', content: 'c', authorId: 'u1' }
        mockPrisma.Post.findUnique.mockResolvedValue(existing)
        mockPrisma.Post.update.mockResolvedValue({ id: 'p1', title: 'T', authorId: null })

        const context = await getContext(config, mockPrisma, { userId: 'u1' })
        const result = await context.serverAction({
          listKey: 'Post',
          action: 'removeRelated',
          mode: 'disconnect',
          id: 'p1',
          field: 'author',
          parentId: 'u1',
        })

        // Disconnect is an UPDATE on the related list nulling the back-reference
        // (a to-one back-ref disconnects with `true`), never a delete. The
        // distinct `{ removed }` shape avoids a redirect-on-success wrapper.
        expect(mockPrisma.Post.update).toHaveBeenCalled()
        const updateArg = mockPrisma.Post.update.mock.calls[0][0]
        expect(updateArg.where).toEqual({ id: 'p1' })
        expect(updateArg.data.author).toEqual({ disconnect: true })
        expect(mockPrisma.Post.delete).not.toHaveBeenCalled()
        expect(result).toEqual({ removed: true })
      })

      it('deletes the related row when mode is delete', async () => {
        mockPrisma.Post.findUnique.mockResolvedValue({ id: 'p1', title: 'T', authorId: 'u1' })
        mockPrisma.Post.delete.mockResolvedValue({ id: 'p1', title: 'T' })

        const context = await getContext(config, mockPrisma, { userId: 'u1' })
        const result = await context.serverAction({
          listKey: 'Post',
          action: 'removeRelated',
          mode: 'delete',
          id: 'p1',
        })

        expect(mockPrisma.Post.delete).toHaveBeenCalled()
        expect(mockPrisma.Post.update).not.toHaveBeenCalled()
        expect(result).toEqual({ removed: true })
      })

      it('disconnects a to-many back-reference by parent id (many-to-many)', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const m2mPrisma: any = {
          Lesson: {
            findUnique: vi.fn().mockResolvedValue({ id: 'l1', title: 'L' }),
            update: vi.fn().mockResolvedValue({ id: 'l1', title: 'L' }),
            delete: vi.fn(),
          },
        }
        const m2mConfig: OpenSaasConfig = {
          db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
          lists: {
            Lesson: {
              fields: {
                title: { type: 'text' },
                teachers: { type: 'relationship', ref: 'Teacher.lessons', many: true },
              },
              access: {
                operation: {
                  query: () => true,
                  create: () => true,
                  update: () => true,
                  delete: () => true,
                },
              },
            },
            Teacher: {
              fields: {
                name: { type: 'text' },
                lessons: { type: 'relationship', ref: 'Lesson.teachers', many: true },
              },
              access: {
                operation: {
                  query: () => true,
                  create: () => true,
                  update: () => true,
                  delete: () => true,
                },
              },
            },
          },
        }

        const context = await getContext(m2mConfig, m2mPrisma, { userId: 'u1' })
        await context.serverAction({
          listKey: 'Lesson',
          action: 'removeRelated',
          mode: 'disconnect',
          id: 'l1',
          field: 'teachers',
          parentId: 't1',
        })

        const updateArg = m2mPrisma.Lesson.update.mock.calls[0][0]
        // A to-many back-reference disconnects the specific parent by id.
        expect(updateArg.data.teachers).toEqual({ disconnect: { id: 't1' } })
      })

      it('returns a generic error (Silent failure) when the update is access-denied', async () => {
        const deniedConfig: OpenSaasConfig = {
          ...config,
          lists: {
            ...config.lists,
            Post: {
              ...config.lists.Post,
              access: {
                operation: {
                  query: () => true,
                  create: () => true,
                  update: () => false, // no update access → disconnect denied
                  delete: () => true,
                },
              },
            },
          },
        }

        const context = await getContext(deniedConfig, mockPrisma, { userId: 'u1' })
        const result = await context.serverAction({
          listKey: 'Post',
          action: 'removeRelated',
          mode: 'disconnect',
          id: 'p1',
          field: 'author',
          parentId: 'u1',
        })

        // Denied: reported as not removed with a generic reason (no leak).
        expect(result).toEqual({ removed: false, error: 'Access denied or operation failed' })
      })
    })

    describe('bulkAction (custom list bulk actions, #736)', () => {
      // A config whose Post list declares a custom bulk action that runs each
      // selected id through the SECURED context (`context.db.Post.update`), so
      // access control + hooks apply per id.
      function configWithPublishAction(
        overrides?: Partial<import('../src/config/types.js').BulkAction>,
      ): OpenSaasConfig {
        return {
          ...config,
          lists: {
            ...config.lists,
            Post: {
              ...config.lists.Post,
              fields: {
                ...config.lists.Post.fields,
                status: { type: 'text' },
              },
              ui: {
                listView: {
                  bulkActions: [
                    {
                      key: 'publish',
                      label: 'Publish',
                      handler: async ({ ids, context }) => {
                        let n = 0
                        for (const id of ids) {
                          const r = await context.db.Post.update({
                            where: { id },
                            data: { status: 'published' },
                          })
                          if (r) n++
                        }
                        return { message: `Published ${n} of ${ids.length}` }
                      },
                      ...overrides,
                    },
                  ],
                },
              },
            },
          },
        }
      }

      it('runs the handler over the selected ids through the secured context', async () => {
        mockPrisma.Post.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve({ id: where.id, title: 'T', content: 'c' }),
        )
        mockPrisma.Post.update.mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve({ id: where.id, status: 'published' }),
        )

        const context = await getContext(configWithPublishAction(), mockPrisma, { userId: 'u1' })
        const result = await context.serverAction({
          listKey: 'Post',
          action: 'bulkAction',
          key: 'publish',
          ids: ['p1', 'p2'],
        })

        // Each id went through the secured update delegate, not a raw call.
        expect(mockPrisma.Post.update).toHaveBeenCalledTimes(2)
        expect(result).toEqual({ bulkAction: true, message: 'Published 2 of 2' })
      })

      it('absorbs a per-id Silent failure into the handler count (no leak)', async () => {
        // Update access scopes writes to id p1 only → p2 is denied and returns
        // null through the secured delegate. The handler simply does not count
        // it; the outcome never reveals which id was denied.
        const scopedConfig = configWithPublishAction()
        scopedConfig.lists.Post.access = {
          operation: {
            query: () => true,
            create: () => true,
            update: () => ({ id: { equals: 'p1' } }),
            delete: () => true,
          },
        }
        // The access filter merges into the existence pre-check: only p1 is
        // visible, so p2's update is denied (Silent failure → null) before it
        // ever reaches the update delegate.
        mockPrisma.Post.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
          where.id === 'p1'
            ? Promise.resolve({ id: 'p1', title: 'T', content: 'c' })
            : Promise.resolve(null),
        )
        // The filter-match re-check (mergeFilters) only ever runs for the row
        // that passed the existence pre-check (p1), so returning it is enough.
        mockPrisma.Post.findFirst.mockResolvedValue({ id: 'p1', title: 'T', content: 'c' })
        mockPrisma.Post.update.mockResolvedValue({ id: 'p1', status: 'published' })

        const context = await getContext(scopedConfig, mockPrisma, { userId: 'u1' })
        const result = await context.serverAction({
          listKey: 'Post',
          action: 'bulkAction',
          key: 'publish',
          ids: ['p1', 'p2'],
        })

        expect(result).toEqual({ bulkAction: true, message: 'Published 1 of 2' })
      })

      it('returns an error for an unknown action key', async () => {
        const context = await getContext(configWithPublishAction(), mockPrisma, { userId: 'u1' })
        const result = await context.serverAction({
          listKey: 'Post',
          action: 'bulkAction',
          key: 'nope',
          ids: ['p1'],
        })

        expect(result).toMatchObject({ bulkAction: false })
      })

      it('re-checks hasAccess server-side so a hidden action cannot be invoked', async () => {
        const context = await getContext(
          configWithPublishAction({ hasAccess: () => false }),
          mockPrisma,
          { userId: 'u1' },
        )
        const result = await context.serverAction({
          listKey: 'Post',
          action: 'bulkAction',
          key: 'publish',
          ids: ['p1', 'p2'],
        })

        expect(result).toEqual({ bulkAction: false, error: 'Access denied' })
        // The handler never ran.
        expect(mockPrisma.Post.update).not.toHaveBeenCalled()
      })

      it('returns a generic message (not the internal text) and logs when the handler throws a plain Error', async () => {
        // An unexpected, non-Prisma, non-known-error bug inside the handler must
        // not surface its internal message to the client (#761).
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
          const context = await getContext(
            configWithPublishAction({
              handler: async () => {
                throw new Error('secret internal detail: connection string leaked')
              },
            }),
            mockPrisma,
            { userId: 'u1' },
          )
          const result = await context.serverAction({
            listKey: 'Post',
            action: 'bulkAction',
            key: 'publish',
            ids: ['p1', 'p2'],
          })

          // Client sees the generic fallback — never the internal message.
          expect(result).toEqual({ bulkAction: false, error: 'Action failed' })
          if ('error' in result) {
            expect(result.error).not.toContain('secret internal detail')
          }
          // The real error is logged server-side for the operator.
          expect(consoleError).toHaveBeenCalled()
          const loggedArgs = consoleError.mock.calls[0]
          expect(loggedArgs.some((arg) => arg instanceof Error)).toBe(true)
        } finally {
          consoleError.mockRestore()
        }
      })
    })

    describe('updateRelated (relationship-table inline cell edit)', () => {
      it('updates a single field on the related row through the secured context', async () => {
        mockPrisma.Post.findUnique.mockResolvedValue({
          id: 'p1',
          title: 'Old',
          content: 'c',
          authorId: 'u1',
        })
        mockPrisma.Post.update.mockResolvedValue({
          id: 'p1',
          title: 'New',
          content: 'c',
          authorId: 'u1',
        })

        const context = await getContext(config, mockPrisma, { userId: 'u1' })
        const result = await context.serverAction({
          listKey: 'Post',
          action: 'updateRelated',
          id: 'p1',
          field: 'title',
          value: 'New',
        })

        // The edit is an UPDATE on the RELATED list, one field only. The distinct
        // `{ updated }` shape avoids a redirect-on-success wrapper.
        expect(mockPrisma.Post.update).toHaveBeenCalled()
        const updateArg = mockPrisma.Post.update.mock.calls[0][0]
        expect(updateArg.where).toEqual({ id: 'p1' })
        expect(updateArg.data.title).toBe('New')
        expect(mockPrisma.Post.delete).not.toHaveBeenCalled()
        expect(result).toEqual({ updated: true })
      })

      it('returns a generic error (Silent failure) when the update is access-denied', async () => {
        const deniedConfig: OpenSaasConfig = {
          ...config,
          lists: {
            ...config.lists,
            Post: {
              ...config.lists.Post,
              access: {
                operation: {
                  query: () => true,
                  create: () => true,
                  update: () => false, // no update access → inline edit denied
                  delete: () => true,
                },
              },
            },
          },
        }

        const context = await getContext(deniedConfig, mockPrisma, { userId: 'u1' })
        const result = await context.serverAction({
          listKey: 'Post',
          action: 'updateRelated',
          id: 'p1',
          field: 'title',
          value: 'New',
        })

        // Denied: reported as not updated with a generic reason (no denied-vs-absent leak).
        expect(result).toEqual({ updated: false, error: 'Access denied or operation failed' })
      })

      it('surfaces a validation error so the cell can revert with a reason', async () => {
        const validationConfig: OpenSaasConfig = {
          ...config,
          lists: {
            ...config.lists,
            Post: {
              ...config.lists.Post,
              hooks: {
                validateInput: async (args) => {
                  if (args.operation === 'delete') return
                  const { resolvedData, addValidationError } = args
                  if (resolvedData.title === 'spam') {
                    addValidationError('Title cannot contain the word "spam"')
                  }
                },
              },
            },
          },
        }
        mockPrisma.Post.findUnique.mockResolvedValue({
          id: 'p1',
          title: 'Old',
          content: 'c',
          authorId: 'u1',
        })

        const context = await getContext(validationConfig, mockPrisma, { userId: 'u1' })
        const result = await context.serverAction({
          listKey: 'Post',
          action: 'updateRelated',
          id: 'p1',
          field: 'title',
          value: 'spam',
        })

        // A validation error becomes { updated: false } with the reason; the write
        // never reaches the database.
        expect(mockPrisma.Post.update).not.toHaveBeenCalled()
        expect(result).toMatchObject({ updated: false })
        const failure = result as { updated: boolean; error?: string }
        expect(failure.error).toContain('spam')
      })
    })

    describe('createRelated (relationship-table pre-linked create)', () => {
      it('creates a row on the related list with the to-one back-reference preset to the parent', async () => {
        const created = { id: 'p1', title: 'New', content: 'c', authorId: 'u1' }
        mockPrisma.Post.create.mockResolvedValue(created)
        // The connect target must be reachable (the related list's read access).
        mockPrisma.User.findUnique.mockResolvedValue({ id: 'u1' })

        const context = await getContext(config, mockPrisma, { userId: 'u1' })
        const result = await context.serverAction({
          listKey: 'Post',
          action: 'createRelated',
          data: { title: 'New', content: 'c' },
          field: 'author',
          parentId: 'u1',
        })

        // The back-reference is set on the SERVER (a to-one back-ref connects a
        // single parent), so the new row links to exactly the parent being edited.
        expect(mockPrisma.Post.create).toHaveBeenCalled()
        const createArg = mockPrisma.Post.create.mock.calls[0][0]
        expect(createArg.data.title).toBe('New')
        expect(createArg.data.author).toEqual({ connect: { id: 'u1' } })
        // Distinct `{ created }` shape (never a single-op `success`).
        expect(result).toEqual({ created: true, id: 'p1' })
      })

      it('connects a to-many back-reference by parent id (many-to-many)', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const m2mPrisma: any = {
          Lesson: {
            findUnique: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
            create: vi.fn().mockResolvedValue({ id: 'l1', title: 'L' }),
          },
          Teacher: {
            findUnique: vi.fn().mockResolvedValue({ id: 't1' }),
            update: vi.fn(),
            delete: vi.fn(),
            create: vi.fn(),
          },
        }
        const m2mConfig: OpenSaasConfig = {
          db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
          lists: {
            Lesson: {
              fields: {
                title: { type: 'text' },
                teachers: { type: 'relationship', ref: 'Teacher.lessons', many: true },
              },
              access: {
                operation: {
                  query: () => true,
                  create: () => true,
                  update: () => true,
                  delete: () => true,
                },
              },
            },
            Teacher: {
              fields: {
                name: { type: 'text' },
                lessons: { type: 'relationship', ref: 'Lesson.teachers', many: true },
              },
              access: {
                operation: {
                  query: () => true,
                  create: () => true,
                  update: () => true,
                  delete: () => true,
                },
              },
            },
          },
        }

        const context = await getContext(m2mConfig, m2mPrisma, { userId: 'u1' })
        await context.serverAction({
          listKey: 'Lesson',
          action: 'createRelated',
          data: { title: 'L' },
          field: 'teachers',
          parentId: 't1',
        })

        const createArg = m2mPrisma.Lesson.create.mock.calls[0][0]
        // A to-many back-reference connects the parent by id.
        expect(createArg.data.teachers).toEqual({ connect: [{ id: 't1' }] })
      })

      // Security-critical invariant (#758): the server sets the back-reference by
      // spreading client `data` and THEN overwriting `data[field]` from the
      // trusted `parentId`, so a HOSTILE client-supplied `data[field]` can never
      // re-target the link to a different parent. These lock that overwrite for
      // both the to-one and the to-many back-reference shapes.
      it('overwrites a hostile client-supplied to-one back-reference with the trusted parentId', async () => {
        const created = { id: 'p1', title: 'New', authorId: 'u1' }
        mockPrisma.Post.create.mockResolvedValue(created)
        // The connect target must be reachable (the related list's read access).
        mockPrisma.User.findUnique.mockResolvedValue({ id: 'u1' })

        const context = await getContext(config, mockPrisma, { userId: 'u1' })
        await context.serverAction({
          listKey: 'Post',
          action: 'createRelated',
          // Hostile: the client tries to re-target the link to a different parent
          // by supplying the back-reference field itself.
          data: { title: 'New', author: 'evil-id' },
          field: 'author',
          parentId: 'u1',
        })

        // The server OVERWRITES the spread-in hostile value with a connect to the
        // trusted parentId — the evil id never reaches the secured create.
        const createArg = mockPrisma.Post.create.mock.calls[0][0]
        expect(createArg.data.author).toEqual({ connect: { id: 'u1' } })
        expect(createArg.data.author).not.toBe('evil-id')
      })

      it('overwrites a hostile client-supplied to-many back-reference with the trusted parentId', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const m2mPrisma: any = {
          Lesson: {
            findUnique: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
            create: vi.fn().mockResolvedValue({ id: 'l1', title: 'L' }),
          },
          Teacher: {
            findUnique: vi.fn().mockResolvedValue({ id: 't1' }),
            update: vi.fn(),
            delete: vi.fn(),
            create: vi.fn(),
          },
        }
        const m2mConfig: OpenSaasConfig = {
          db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
          lists: {
            Lesson: {
              fields: {
                title: { type: 'text' },
                teachers: { type: 'relationship', ref: 'Teacher.lessons', many: true },
              },
              access: {
                operation: {
                  query: () => true,
                  create: () => true,
                  update: () => true,
                  delete: () => true,
                },
              },
            },
            Teacher: {
              fields: {
                name: { type: 'text' },
                lessons: { type: 'relationship', ref: 'Lesson.teachers', many: true },
              },
              access: {
                operation: {
                  query: () => true,
                  create: () => true,
                  update: () => true,
                  delete: () => true,
                },
              },
            },
          },
        }

        const context = await getContext(m2mConfig, m2mPrisma, { userId: 'u1' })
        await context.serverAction({
          listKey: 'Lesson',
          action: 'createRelated',
          // Hostile: the client tries to connect a different teacher.
          data: { title: 'L', teachers: { connect: [{ id: 'evil-id' }] } },
          field: 'teachers',
          parentId: 't1',
        })

        // The to-many back-reference is overwritten to connect exactly the trusted
        // parent by id — the hostile connect is discarded.
        const createArg = m2mPrisma.Lesson.create.mock.calls[0][0]
        expect(createArg.data.teachers).toEqual({ connect: [{ id: 't1' }] })
      })

      // Defensive guard (#758): malformed direct calls (unreachable from the
      // drawer, which always sends a valid relationship back-reference plus both
      // field and parentId) are rejected rather than degrading to an unguarded
      // create.
      it('rejects a malformed call supplying only one of field/parentId (defensive guard)', async () => {
        const context = await getContext(config, mockPrisma, { userId: 'u1' })
        const result = await context.serverAction({
          listKey: 'Post',
          action: 'createRelated',
          data: { title: 'New', author: 'evil-id' },
          field: 'author',
          // parentId omitted — a lone back-reference field is malformed.
        })

        expect(result).toEqual({
          created: false,
          error: 'createRelated requires both field and parentId, or neither',
        })
        // The unguarded create is never attempted.
        expect(mockPrisma.Post.create).not.toHaveBeenCalled()
      })

      it('rejects a back-reference that does not name a relationship field (defensive guard)', async () => {
        const context = await getContext(config, mockPrisma, { userId: 'u1' })
        const result = await context.serverAction({
          listKey: 'Post',
          action: 'createRelated',
          data: { title: 'New' },
          field: 'title', // a scalar field, not a relationship
          parentId: 'u1',
        })

        expect(result).toMatchObject({ created: false })
        expect(mockPrisma.Post.create).not.toHaveBeenCalled()
      })

      it('returns a generic error (Silent failure) when the create is access-denied', async () => {
        const deniedConfig: OpenSaasConfig = {
          ...config,
          lists: {
            ...config.lists,
            Post: {
              ...config.lists.Post,
              access: {
                operation: {
                  query: () => true,
                  create: () => false, // no create access → create denied
                  update: () => true,
                  delete: () => true,
                },
              },
            },
          },
        }

        const context = await getContext(deniedConfig, mockPrisma, { userId: 'u1' })
        const result = await context.serverAction({
          listKey: 'Post',
          action: 'createRelated',
          data: { title: 'New' },
          field: 'author',
          parentId: 'u1',
        })

        // Denied: reported as not created with a generic reason (no leak). The
        // create is never attempted at the Prisma layer.
        expect(result).toEqual({ created: false, error: 'Access denied or operation failed' })
        expect(mockPrisma.Post.create).not.toHaveBeenCalled()
      })

      it('surfaces field errors from the create (e.g. a unique constraint) in the drawer shape', async () => {
        mockPrisma.Post.create.mockRejectedValue({ code: 'P2002', meta: { target: ['title'] } })
        mockPrisma.User.findUnique.mockResolvedValue({ id: 'u1' })

        const context = await getContext(config, mockPrisma, { userId: 'u1' })
        const result = await context.serverAction({
          listKey: 'Post',
          action: 'createRelated',
          data: { title: 'Dup' },
          field: 'author',
          parentId: 'u1',
        })

        // Parsed to a distinct { created: false } with per-field errors the drawer
        // renders — never a single-op `success` envelope.
        expect(result).toMatchObject({ created: false })
        const created = result as { created: boolean; fieldErrors?: Record<string, string> }
        expect(created.fieldErrors?.title).toBeDefined()
      })

      // Prisma 7 driver adapters (verified against @prisma/adapter-pg and PGlite,
      // issue #979) leave `meta.target` undefined and put the equivalent data at
      // `meta.driverAdapterError.cause` instead, as free-text-adjacent structured
      // data rather than the documented shape.
      describe('P2002 under Prisma 7 driver adapters (issue #979)', () => {
        it('produces per-field errors for a composite unique violation', async () => {
          mockPrisma.Post.create.mockRejectedValue({
            code: 'P2002',
            meta: {
              modelName: 'Post',
              driverAdapterError: {
                name: 'DriverAdapterError',
                cause: {
                  originalCode: '23505',
                  originalMessage:
                    'duplicate key value violates unique constraint "post_title_content_key"',
                  kind: 'UniqueConstraintViolation',
                  constraint: { fields: ['title', 'content'] },
                },
              },
            },
          })
          mockPrisma.User.findUnique.mockResolvedValue({ id: 'u1' })

          const context = await getContext(config, mockPrisma, { userId: 'u1' })
          const result = await context.serverAction({
            listKey: 'Post',
            action: 'createRelated',
            data: { title: 'Dup', content: 'Dup' },
            field: 'author',
            parentId: 'u1',
          })

          expect(result).toMatchObject({ created: false })
          const created = result as { created: boolean; fieldErrors?: Record<string, string> }
          expect(created.fieldErrors?.title).toBeDefined()
          expect(created.fieldErrors?.content).toBeDefined()
        })

        it('produces a field error for a single-column unique violation', async () => {
          mockPrisma.Post.create.mockRejectedValue({
            code: 'P2002',
            meta: {
              modelName: 'Post',
              driverAdapterError: {
                cause: {
                  originalMessage:
                    'duplicate key value violates unique constraint "post_title_key"',
                  constraint: { fields: ['title'] },
                },
              },
            },
          })
          mockPrisma.User.findUnique.mockResolvedValue({ id: 'u1' })

          const context = await getContext(config, mockPrisma, { userId: 'u1' })
          const result = await context.serverAction({
            listKey: 'Post',
            action: 'createRelated',
            data: { title: 'Dup' },
            field: 'author',
            parentId: 'u1',
          })

          const created = result as { created: boolean; fieldErrors?: Record<string, string> }
          expect(created.fieldErrors?.title).toBeDefined()
        })

        it('strips quotes so a camelCase column is keyed correctly (not left quoted)', async () => {
          // Postgres quotes an identifier in `constraint.fields` only when it
          // needed quoting — a camelCase column arrives as `"authorId"`. A naive
          // fix that skips stripping would key fieldErrors by the literal string
          // `"authorId"` (quotes included), missing the real field name.
          mockPrisma.Post.create.mockRejectedValue({
            code: 'P2002',
            meta: {
              driverAdapterError: {
                cause: {
                  originalMessage:
                    'duplicate key value violates unique constraint "post_authorId_key"',
                  constraint: { fields: ['"authorId"'] },
                },
              },
            },
          })
          mockPrisma.User.findUnique.mockResolvedValue({ id: 'u1' })

          const context = await getContext(config, mockPrisma, { userId: 'u1' })
          const result = await context.serverAction({
            listKey: 'Post',
            action: 'createRelated',
            data: { title: 'Dup' },
            field: 'author',
            parentId: 'u1',
          })

          const created = result as { created: boolean; fieldErrors?: Record<string, string> }
          expect(created.fieldErrors).toEqual({ authorId: 'This value is already in use' })
        })

        it('humanizes a camelCase field name in the message instead of running words together', async () => {
          // Before this fix, `target` was always empty under a driver adapter, so
          // this label-formatting path never ran for a camelCase column. Recovering
          // real column names makes it reachable — verify it reads as words, not
          // "tenantid".
          const camelCaseConfig: OpenSaasConfig = {
            ...config,
            lists: {
              ...config.lists,
              Post: {
                ...config.lists.Post,
                fields: { ...config.lists.Post.fields, tenantSlug: { type: 'text' } },
              },
            },
          }
          mockPrisma.Post.create.mockRejectedValue({
            code: 'P2002',
            meta: {
              driverAdapterError: {
                cause: {
                  originalMessage:
                    'duplicate key value violates unique constraint "post_tenantSlug_key"',
                  constraint: { fields: ['"tenantSlug"'] },
                },
              },
            },
          })
          mockPrisma.User.findUnique.mockResolvedValue({ id: 'u1' })

          const context = await getContext(camelCaseConfig, mockPrisma, { userId: 'u1' })
          const result = await context.serverAction({
            listKey: 'Post',
            action: 'createRelated',
            data: { title: 'Dup' },
            field: 'author',
            parentId: 'u1',
          })

          const created = result as { created: boolean; fieldErrors?: Record<string, string> }
          expect(created.fieldErrors).toEqual({
            tenantSlug: 'This tenant slug is already in use',
          })
        })

        it('leaves an already-populated meta.target unaffected (existing path still wins)', async () => {
          mockPrisma.Post.create.mockRejectedValue({
            code: 'P2002',
            meta: {
              target: ['title'],
              // Present but must be ignored — meta.target already answers the question.
              driverAdapterError: {
                cause: {
                  originalMessage: 'duplicate key value violates unique constraint "other_key"',
                  constraint: { fields: ['content'] },
                },
              },
            },
          })
          mockPrisma.User.findUnique.mockResolvedValue({ id: 'u1' })

          const context = await getContext(config, mockPrisma, { userId: 'u1' })
          const result = await context.serverAction({
            listKey: 'Post',
            action: 'createRelated',
            data: { title: 'Dup' },
            field: 'author',
            parentId: 'u1',
          })

          const created = result as { created: boolean; fieldErrors?: Record<string, string> }
          expect(created.fieldErrors).toEqual({ title: 'This title is already in use' })
        })

        it('falls back to the generic message (not a throw) when nothing is recoverable', async () => {
          mockPrisma.Post.create.mockRejectedValue({ code: 'P2002', meta: {} })
          mockPrisma.User.findUnique.mockResolvedValue({ id: 'u1' })

          const context = await getContext(config, mockPrisma, { userId: 'u1' })
          const result = await context.serverAction({
            listKey: 'Post',
            action: 'createRelated',
            data: { title: 'Dup' },
            field: 'author',
            parentId: 'u1',
          })

          expect(result).toEqual({
            created: false,
            error: 'A record with this value already exists',
            fieldErrors: {},
          })
        })

        it('leaves a non-P2002 Prisma error unaffected', async () => {
          mockPrisma.Post.create.mockRejectedValue({
            code: 'P2025',
            meta: { driverAdapterError: { cause: { constraint: { fields: ['title'] } } } },
            message: 'Record to update not found',
          })
          mockPrisma.User.findUnique.mockResolvedValue({ id: 'u1' })

          const context = await getContext(config, mockPrisma, { userId: 'u1' })
          const result = await context.serverAction({
            listKey: 'Post',
            action: 'createRelated',
            data: { title: 'Dup' },
            field: 'author',
            parentId: 'u1',
          })

          expect(result).toEqual({
            created: false,
            error: 'Record to update not found',
            fieldErrors: {},
          })
        })
      })
    })

    describe('relationshipOptions', () => {
      it('returns { id, label }[] for the related list, unfiltered/unincluded', async () => {
        mockPrisma.User.findMany.mockResolvedValue([
          { id: 'u1', name: 'Ada' },
          { id: 'u2', name: 'Alan' },
        ])

        const context = await getContext(config, mockPrisma, null)
        const result = await context.serverAction({
          listKey: 'Post',
          action: 'relationshipOptions',
          field: 'author',
        })

        expect(result).toEqual({
          success: true,
          data: [
            { id: 'u1', label: 'Ada' },
            { id: 'u2', label: 'Alan' },
          ],
        })
        const call = mockPrisma.User.findMany.mock.calls[0][0]
        expect(call.include).toBeUndefined()
      })

      it('bounds the query by take', async () => {
        mockPrisma.User.findMany.mockResolvedValue([{ id: 'u1', name: 'Ada' }])

        const context = await getContext(config, mockPrisma, null)
        await context.serverAction({
          listKey: 'Post',
          action: 'relationshipOptions',
          field: 'author',
          take: 1,
        })

        expect(mockPrisma.User.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1 }))
      })

      it('unions selectedIds beyond the take/search window', async () => {
        mockPrisma.User.findMany.mockResolvedValueOnce([{ id: 'u1', name: 'Ada' }])
        mockPrisma.User.findMany.mockResolvedValueOnce([{ id: 'u9', name: 'Zed' }])

        const context = await getContext(config, mockPrisma, null)
        const result = await context.serverAction({
          listKey: 'Post',
          action: 'relationshipOptions',
          field: 'author',
          take: 1,
          selectedIds: ['u9'],
        })

        expect(result).toEqual({
          success: true,
          data: [
            { id: 'u1', label: 'Ada' },
            { id: 'u9', label: 'Zed' },
          ],
        })
      })

      it('returns [] data when the related list query access is denied', async () => {
        const deniedConfig: OpenSaasConfig = {
          ...config,
          lists: {
            ...config.lists,
            User: {
              ...config.lists.User,
              access: { operation: { query: () => false } },
            },
          },
        }
        mockPrisma.User.findMany.mockResolvedValue([{ id: 'u1', name: 'Ada' }])

        const context = await getContext(deniedConfig, mockPrisma, null)
        const result = await context.serverAction({
          listKey: 'Post',
          action: 'relationshipOptions',
          field: 'author',
        })

        expect(result).toEqual({ success: true, data: [] })
      })

      it('returns an error when the field is not a relationship field', async () => {
        const context = await getContext(config, mockPrisma, null)
        const result = await context.serverAction({
          listKey: 'Post',
          action: 'relationshipOptions',
          field: 'title',
        })

        expect(result).toEqual({
          success: false,
          error: 'Field "title" on list "Post" is not a relationship field',
        })
      })

      it('returns an error when the field does not exist', async () => {
        const context = await getContext(config, mockPrisma, null)
        const result = await context.serverAction({
          listKey: 'Post',
          action: 'relationshipOptions',
          field: 'nonexistent',
        })

        expect(result).toEqual({
          success: false,
          error: 'Field "nonexistent" on list "Post" is not a relationship field',
        })
      })
    })
  })

  describe('db operations', () => {
    it('should delegate findUnique to prisma with access control', async () => {
      const mockUser = { id: '1', name: 'John', email: 'john@example.com' }
      mockPrisma.User.findFirst.mockResolvedValue(mockUser)

      const context = await getContext(config, mockPrisma, null)
      const result = await context.db.User.findUnique({ where: { id: '1' } })

      expect(mockPrisma.User.findFirst).toHaveBeenCalled()
      expect(result).toEqual(mockUser)
    })

    describe('findUnique unique-where enforcement (#567)', () => {
      it('accepts a valid unique where (id) and keeps access + include intact', async () => {
        const mockUser = { id: '1', name: 'John', email: 'john@example.com' }
        mockPrisma.User.findFirst.mockResolvedValue(mockUser)

        const context = await getContext(config, mockPrisma, null)
        const result = await context.db.User.findUnique({
          where: { id: '1' },
          include: { posts: true },
        })

        // Access control still runs and the underlying delegate is invoked with
        // the merged where + include (proving access + include path is intact).
        expect(mockPrisma.User.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ id: '1' }),
            include: { posts: true },
          }),
        )
        expect(result).toEqual(mockUser)
      })

      it('accepts a configured-unique field (email) as the unique where', async () => {
        const mockUser = { id: '1', name: 'John', email: 'john@example.com' }
        mockPrisma.User.findFirst.mockResolvedValue(mockUser)

        const context = await getContext(config, mockPrisma, null)
        const result = await context.db.User.findUnique({
          where: { email: 'john@example.com' },
        })

        expect(mockPrisma.User.findFirst).toHaveBeenCalled()
        expect(result).toEqual(mockUser)
      })

      it('narrows the result through a query fragment with a unique where', async () => {
        const mockUser = { id: '1', name: 'John', email: 'john@example.com' }
        mockPrisma.User.findFirst.mockResolvedValue(mockUser)

        const fragment = defineFragment<{ id: string; name: string; email: string }>()({
          id: true,
          name: true,
        } as const)

        const context = await getContext(config, mockPrisma, null)
        const result = await context.db.User.findUnique({ where: { id: '1' }, query: fragment })

        // Fragment narrows the result to only the requested fields (email omitted)
        expect(result).toEqual({ id: '1', name: 'John' })
      })

      it('THROWS on a non-unique where (caller-shape error, not a silent null)', async () => {
        mockPrisma.User.findFirst.mockResolvedValue({ id: '1', name: 'John' })

        const context = await getContext(config, mockPrisma, null)

        // `name` is not a unique key — this is misuse and must throw, not return null.
        await expect(context.db.User.findUnique({ where: { name: 'John' } })).rejects.toThrow(
          /requires a unique `where`/,
        )
        // The error guides the caller toward findFirst (the non-unique escape hatch).
        await expect(context.db.User.findUnique({ where: { name: 'John' } })).rejects.toThrow(
          /findFirst/,
        )
        // Guard runs before any DB access.
        expect(mockPrisma.User.findFirst).not.toHaveBeenCalled()
      })

      it('THROWS when a unique key is mixed with extra non-unique keys', async () => {
        const context = await getContext(config, mockPrisma, null)

        await expect(
          context.db.User.findUnique({ where: { id: '1', name: 'John' } }),
        ).rejects.toThrow(/requires a unique `where`/)
        expect(mockPrisma.User.findFirst).not.toHaveBeenCalled()
      })

      it('THROWS on an empty where', async () => {
        const context = await getContext(config, mockPrisma, null)

        await expect(context.db.User.findUnique({ where: {} })).rejects.toThrow(
          /requires a unique `where`/,
        )
        expect(mockPrisma.User.findFirst).not.toHaveBeenCalled()
      })

      it('returns null on access denial (silent-failure contract preserved)', async () => {
        const deniedConfig: OpenSaasConfig = {
          ...config,
          lists: {
            ...config.lists,
            User: {
              ...config.lists.User,
              access: {
                operation: {
                  query: () => false,
                  create: () => true,
                  update: () => true,
                  delete: () => true,
                },
              },
            },
          },
        }
        mockPrisma.User.findFirst.mockResolvedValue({ id: '1', name: 'John' })

        const context = await getContext(deniedConfig, mockPrisma, null)
        const result = await context.db.User.findUnique({ where: { id: '1' } })

        // Access denied -> null (not a throw), and the DB is never queried.
        expect(result).toBeNull()
        expect(mockPrisma.User.findFirst).not.toHaveBeenCalled()
      })

      it('returns null when no record matches a valid unique where', async () => {
        mockPrisma.User.findFirst.mockResolvedValue(null)

        const context = await getContext(config, mockPrisma, null)
        const result = await context.db.User.findUnique({ where: { id: 'missing' } })

        expect(result).toBeNull()
        expect(mockPrisma.User.findFirst).toHaveBeenCalled()
      })
    })

    it('should delegate findMany to prisma with access control', async () => {
      const mockUsers = [
        { id: '1', name: 'John' },
        { id: '2', name: 'Jane' },
      ]
      mockPrisma.User.findMany.mockResolvedValue(mockUsers)

      const context = await getContext(config, mockPrisma, null)
      const result = await context.db.User.findMany()

      expect(mockPrisma.User.findMany).toHaveBeenCalled()
      expect(result).toEqual(mockUsers)
    })

    describe('findFirst', () => {
      it('should return the first matching row', async () => {
        const mockUsers = [
          { id: '1', name: 'John', email: 'john@example.com' },
          { id: '2', name: 'Jane', email: 'jane@example.com' },
        ]
        mockPrisma.User.findMany.mockResolvedValue(mockUsers)

        const context = await getContext(config, mockPrisma, null)
        const result = await context.db.User.findFirst()

        // Delegates to the access-controlled findMany with take: 1
        expect(mockPrisma.User.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1 }))
        expect(result).toEqual(mockUsers[0])
      })

      it('should return null (not undefined, not throw) when nothing matches', async () => {
        mockPrisma.User.findMany.mockResolvedValue([])

        const context = await getContext(config, mockPrisma, null)
        const result = await context.db.User.findFirst({ where: { name: 'Nobody' } })

        expect(result).toBeNull()
        expect(result).not.toBeUndefined()
      })

      it('should respect where and orderBy', async () => {
        const mockUser = { id: '2', name: 'Jane', email: 'jane@example.com' }
        mockPrisma.User.findMany.mockResolvedValue([mockUser])

        const context = await getContext(config, mockPrisma, null)
        const result = await context.db.User.findFirst({
          where: { name: 'Jane' },
          orderBy: { name: 'asc' },
        })

        expect(mockPrisma.User.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ name: 'Jane' }),
            orderBy: { name: 'asc' },
            take: 1,
          }),
        )
        expect(result).toEqual(mockUser)
      })

      it('should honour query-access denial the same as findMany (denied -> null)', async () => {
        const deniedConfig: OpenSaasConfig = {
          ...config,
          lists: {
            ...config.lists,
            User: {
              ...config.lists.User,
              access: {
                operation: {
                  query: () => false,
                  create: () => true,
                  update: () => true,
                  delete: () => true,
                },
              },
            },
          },
        }
        mockPrisma.User.findMany.mockResolvedValue([
          { id: '1', name: 'John', email: 'john@example.com' },
        ])

        const context = await getContext(deniedConfig, mockPrisma, null)
        const result = await context.db.User.findFirst()

        // Denied query short-circuits before hitting prisma — exactly like findMany
        expect(result).toBeNull()
        expect(mockPrisma.User.findMany).not.toHaveBeenCalled()
      })

      it('should respect a query fragment, narrowing the returned single result', async () => {
        const mockUsers = [
          { id: '1', name: 'John', email: 'john@example.com' },
          { id: '2', name: 'Jane', email: 'jane@example.com' },
        ]
        mockPrisma.User.findMany.mockResolvedValue(mockUsers)

        const fragment = defineFragment<{ id: string; name: string; email: string }>()({
          id: true,
          name: true,
        } as const)

        const context = await getContext(config, mockPrisma, null)
        const result = await context.db.User.findFirst({ query: fragment })

        // Fragment narrows the result to only the requested fields (email omitted)
        expect(result).toEqual({ id: '1', name: 'John' })
      })
    })

    describe('read-path key validation (#912)', () => {
      it('throws on an undeclared `where` key on findMany, naming the list and the key', async () => {
        const context = await getContext(config, mockPrisma, null)

        await expect(context.db.Post.findMany({ where: { bogusKey: 'x' } })).rejects.toThrow(/Post/)
        await expect(context.db.Post.findMany({ where: { bogusKey: 'x' } })).rejects.toThrow(
          /bogusKey/,
        )
        expect(mockPrisma.Post.findMany).not.toHaveBeenCalled()
      })

      it('throws on an undeclared `where` key on count', async () => {
        const context = await getContext(config, mockPrisma, null)

        await expect(context.db.User.count({ where: { bogusKey: 'x' } })).rejects.toThrow(
          /bogusKey/,
        )
        expect(mockPrisma.User.count).not.toHaveBeenCalled()
      })

      it('throws on an undeclared `orderBy` key on findMany', async () => {
        const context = await getContext(config, mockPrisma, null)

        await expect(context.db.Post.findMany({ orderBy: { bogusKey: 'asc' } })).rejects.toThrow(
          /bogusKey/,
        )
        expect(mockPrisma.Post.findMany).not.toHaveBeenCalled()
      })

      it('throws on an undeclared key nested inside a logical operator (AND/OR/NOT)', async () => {
        const context = await getContext(config, mockPrisma, null)

        await expect(
          context.db.Post.findMany({
            where: { OR: [{ title: { contains: 'a' } }, { bogusKey: 'x' }] },
          }),
        ).rejects.toThrow(/bogusKey/)

        await expect(
          context.db.Post.findMany({
            where: { AND: [{ NOT: { bogusKey: 'x' } }] },
          }),
        ).rejects.toThrow(/bogusKey/)
      })

      it('throws on an undeclared key nested inside a relation filter, naming the RELATED list', async () => {
        const context = await getContext(config, mockPrisma, null)

        await expect(
          context.db.Post.findMany({ where: { author: { is: { bogusKey: 'x' } } } }),
        ).rejects.toThrow(/User/)
        await expect(
          context.db.Post.findMany({ where: { author: { is: { bogusKey: 'x' } } } }),
        ).rejects.toThrow(/bogusKey/)
      })

      it("throws on an undeclared key reached via Prisma's direct-nesting to-one filter (no `is` wrapper)", async () => {
        // Prisma's documented default for filtering a to-one relation nests the
        // related list's fields directly, with no `is`/`isNot` wrapper at all —
        // e.g. `{ author: { email: { contains: '...' } } }`. An undeclared key
        // reached this way (one hop through a to-one relation, rather than at
        // the root) must be rejected exactly like the wrapped `is` form.
        const context = await getContext(config, mockPrisma, null)

        await expect(
          context.db.Post.findMany({ where: { author: { bogusKey: 'x' } } }),
        ).rejects.toThrow(/User/)
        await expect(
          context.db.Post.findMany({ where: { author: { bogusKey: 'x' } } }),
        ).rejects.toThrow(/bogusKey/)
        expect(mockPrisma.Post.findMany).not.toHaveBeenCalled()
      })

      it('accepts a declared field on the direct-nesting to-one filter form', async () => {
        mockPrisma.Post.findMany.mockResolvedValue([])

        const context = await getContext(config, mockPrisma, null)
        const where = { author: { name: { equals: 'John' } } }
        await context.db.Post.findMany({ where })

        expect(mockPrisma.Post.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }))
      })

      it('rejects a Prisma-generated back-relation the list config never declares (the regression that matters most)', async () => {
        // Organisation declares no relationship back to Document — mirrors a
        // list whose Prisma model gets a `from_Document_organisation`
        // back-relation purely because Document holds an FK pointing at it.
        const backRelationPrisma = {
          Organisation: { findMany: vi.fn(), count: vi.fn() },
        }
        const backRelationConfig: OpenSaasConfig = {
          db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
          lists: {
            Organisation: {
              fields: { name: { type: 'text' } },
              access: { operation: { query: () => true } },
            },
          },
        }

        const context = await getContext(backRelationConfig, backRelationPrisma, null)

        await expect(
          context.db.Organisation.findMany({
            where: { from_Document_organisation: { some: {} } },
          }),
        ).rejects.toThrow(/from_Document_organisation/)
        await expect(
          context.db.Organisation.count({
            where: { from_Document_organisation: { some: {} } },
          }),
        ).rejects.toThrow(/from_Document_organisation/)

        expect(backRelationPrisma.Organisation.findMany).not.toHaveBeenCalled()
        expect(backRelationPrisma.Organisation.count).not.toHaveBeenCalled()
      })

      it('never mistakes a Prisma filter operator (equals/contains/startsWith/in/is/isNot) for a field name', async () => {
        mockPrisma.Post.findMany.mockResolvedValue([
          { id: '1', title: 'Test Post', content: 'x', authorId: 'u1' },
        ])

        const context = await getContext(config, mockPrisma, null)
        const where = {
          title: { equals: 'Test Post', contains: 'Test', startsWith: 'T', in: ['Test Post'] },
          author: { is: { name: 'John' }, isNot: null },
        }

        await context.db.Post.findMany({ where })

        expect(mockPrisma.Post.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }))
      })

      it('passes all of the above through under sudo (the single trusted bypass)', async () => {
        mockPrisma.Post.findMany.mockResolvedValue([])

        const context = (await getContext(config, mockPrisma, null)).sudo()
        await context.db.Post.findMany({
          where: { bogusKey: 'x', OR: [{ alsoBogus: 'y' }] },
          orderBy: { alsoOrderByBogus: 'asc' },
        })

        expect(mockPrisma.Post.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { bogusKey: 'x', OR: [{ alsoBogus: 'y' }] },
            orderBy: { alsoOrderByBogus: 'asc' },
          }),
        )
      })

      it('keeps an implied foreign-key scalar filterable (authorId for author: relationship(...))', async () => {
        mockPrisma.Post.findMany.mockResolvedValue([])

        const context = await getContext(config, mockPrisma, null)
        await context.db.Post.findMany({ where: { authorId: 'user-1' } })

        expect(mockPrisma.Post.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { authorId: 'user-1' } }),
        )
      })

      it('findFirst inherits the check through findMany, with no second copy', async () => {
        const context = await getContext(config, mockPrisma, null)

        await expect(context.db.Post.findFirst({ where: { bogusKey: 'x' } })).rejects.toThrow(
          /bogusKey/,
        )
        expect(mockPrisma.Post.findMany).not.toHaveBeenCalled()
      })

      it('updateMany inherits the check through findMany, with no second copy', async () => {
        const context = await getContext(config, mockPrisma, null)

        await expect(
          context.db.User.updateMany({ where: { bogusKey: 'x' }, data: { name: 'y' } }),
        ).rejects.toThrow(/bogusKey/)
        expect(mockPrisma.User.findMany).not.toHaveBeenCalled()
        expect(mockPrisma.User.update).not.toHaveBeenCalled()
      })

      it('an ordinary read using only declared keys is unaffected', async () => {
        const mockUsers = [{ id: '1', name: 'John', email: 'john@example.com' }]
        mockPrisma.User.findMany.mockResolvedValue(mockUsers)

        const context = await getContext(config, mockPrisma, null)
        const result = await context.db.User.findMany({
          where: { name: 'John' },
          orderBy: { name: 'asc' },
        })

        expect(result).toEqual(mockUsers)
      })
    })

    describe('predicate-time field-read access (#915)', () => {
      // The exact shape from the issue: a public `query` gate with one
      // field-level `read` gate. Without this fix, `billingAddress`'s withheld
      // value can be recovered one character at a time via `count()`, and its
      // relative order leaked via `orderBy`, despite no session ever being
      // allowed to READ it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let orgPrisma: any
      let orgConfig: OpenSaasConfig

      beforeEach(() => {
        orgPrisma = {
          Organisation: { findMany: vi.fn(), count: vi.fn() },
        }
        orgConfig = {
          db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
          lists: {
            Organisation: {
              fields: {
                name: { type: 'text' },
                billingAddress: {
                  type: 'text',
                  access: { read: () => false },
                },
              },
              access: { operation: { query: () => true } },
            },
          },
        }
      })

      it('denies a `where` filter naming a read-denied field, on both findMany and count', async () => {
        const context = await getContext(orgConfig, orgPrisma, null)

        await expect(
          context.db.Organisation.findMany({
            where: { billingAddress: { startsWith: '12 ' } },
          }),
        ).rejects.toThrow(/billingAddress/)
        await expect(
          context.db.Organisation.count({
            where: { billingAddress: { startsWith: '12 ' } },
          }),
        ).rejects.toThrow(/billingAddress/)

        expect(orgPrisma.Organisation.findMany).not.toHaveBeenCalled()
        expect(orgPrisma.Organisation.count).not.toHaveBeenCalled()
      })

      it('a count probe answers identically for a matching and a non-matching prefix (no oracle)', async () => {
        // Before the fix, these two counts would differ (1 vs 0), letting the
        // withheld value be recovered one character at a time. After the fix,
        // both throw the SAME denial — there is no distinguishing signal left.
        const context = await getContext(orgConfig, orgPrisma, null)

        const matching = context.db.Organisation.count({
          where: { billingAddress: { startsWith: '12 ' } },
        }).catch((err: Error) => err.message)
        const nonMatching = context.db.Organisation.count({
          where: { billingAddress: { startsWith: '99 ' } },
        }).catch((err: Error) => err.message)

        expect(await matching).toEqual(await nonMatching)
        expect(orgPrisma.Organisation.count).not.toHaveBeenCalled()
      })

      it('denies ordering by a read-denied field', async () => {
        const context = await getContext(orgConfig, orgPrisma, null)

        await expect(
          context.db.Organisation.findMany({ orderBy: { billingAddress: 'asc' } }),
        ).rejects.toThrow(/billingAddress/)
        expect(orgPrisma.Organisation.findMany).not.toHaveBeenCalled()
      })

      it('checks keys nested inside logical operators (AND/OR/NOT)', async () => {
        const context = await getContext(orgConfig, orgPrisma, null)

        await expect(
          context.db.Organisation.findMany({
            where: { OR: [{ name: { contains: 'a' } }, { billingAddress: { contains: 'x' } }] },
          }),
        ).rejects.toThrow(/billingAddress/)
        await expect(
          context.db.Organisation.findMany({
            where: { AND: [{ NOT: { billingAddress: { contains: 'x' } } }] },
          }),
        ).rejects.toThrow(/billingAddress/)
      })

      it('a row-dependent read rule resolves to a denial, not a skipped check', async () => {
        // `item` cannot be evaluated before the query runs — there is no row
        // yet — so a rule that depends on it (the shape `FieldAccess['read']`
        // documents as the norm) must deny here even though, post-query, the
        // very same rule might have allowed this session to read the field.
        const rowDependentConfig: OpenSaasConfig = {
          ...orgConfig,
          lists: {
            Organisation: {
              ...orgConfig.lists.Organisation,
              fields: {
                ...orgConfig.lists.Organisation.fields,
                billingAddress: {
                  type: 'text',
                  access: {
                    read: ({ item, session }: { item: { ownerId: string }; session: unknown }) =>
                      item.ownerId === (session as { userId?: string } | null)?.userId,
                  },
                },
              },
            },
          },
        }

        const context = await getContext(rowDependentConfig, orgPrisma, { userId: 'user-1' })

        await expect(
          context.db.Organisation.findMany({
            where: { billingAddress: { contains: 'x' } },
          }),
        ).rejects.toThrow(/billingAddress/)
        expect(orgPrisma.Organisation.findMany).not.toHaveBeenCalled()
      })

      it('propagates InvalidFieldAccessResultError (#913), never folding it into a plain denial', async () => {
        const filterReturningConfig: OpenSaasConfig = {
          ...orgConfig,
          lists: {
            Organisation: {
              ...orgConfig.lists.Organisation,
              fields: {
                ...orgConfig.lists.Organisation.fields,
                billingAddress: {
                  type: 'text',
                  // Bypasses the FieldAccessControl boolean-only type on purpose —
                  // this is the exact misconfiguration #913 closed.
                  access: { read: (() => ({ ownerId: 'x' })) as unknown as () => boolean },
                },
              },
            },
          },
        }

        const context = await getContext(filterReturningConfig, orgPrisma, null)

        await expect(
          context.db.Organisation.findMany({
            where: { billingAddress: { contains: 'x' } },
          }),
        ).rejects.toThrow(InvalidFieldAccessResultError)
      })

      it('leaves a readable field filterable and sortable (no regression)', async () => {
        orgPrisma.Organisation.findMany.mockResolvedValue([])

        const context = await getContext(orgConfig, orgPrisma, null)
        await context.db.Organisation.findMany({
          where: { name: { contains: 'Acme' } },
          orderBy: { name: 'asc' },
        })

        expect(orgPrisma.Organisation.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { name: { contains: 'Acme' } },
            orderBy: { name: 'asc' },
          }),
        )
      })

      it('sudo bypasses the check entirely, matching #912', async () => {
        orgPrisma.Organisation.findMany.mockResolvedValue([])
        orgPrisma.Organisation.count.mockResolvedValue(3)

        const context = (await getContext(orgConfig, orgPrisma, null)).sudo()
        await context.db.Organisation.findMany({
          where: { billingAddress: { startsWith: '12 ' } },
          orderBy: { billingAddress: 'asc' },
        })
        await context.db.Organisation.count({
          where: { billingAddress: { startsWith: '12 ' } },
        })

        expect(orgPrisma.Organisation.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { billingAddress: { startsWith: '12 ' } },
            orderBy: { billingAddress: 'asc' },
          }),
        )
        expect(orgPrisma.Organisation.count).toHaveBeenCalledWith(
          expect.objectContaining({ where: { billingAddress: { startsWith: '12 ' } } }),
        )
      })

      it('a caller with zero list access gets the ordinary silent denial, not a validation error naming the field (found in review of #925)', async () => {
        // Operation-level `query` access is fully denied for this session.
        // The #912/#915 where/orderBy validation must never run in that case
        // — the thrown ValidationError names the offending key, which would
        // let a caller with NO access to the list at all learn a field's
        // name and its read-gating status purely from the error message.
        // That is itself the kind of oracle #915 exists to close, just
        // pointed at "does this field exist and is it read-gated" instead of
        // "what is this field's value" — so a fully denied caller must see
        // the SAME silent []/0 whether or not the where/orderBy names an
        // undeclared or read-denied key.
        const deniedConfig: OpenSaasConfig = {
          ...orgConfig,
          lists: {
            Organisation: {
              ...orgConfig.lists.Organisation,
              access: { operation: { query: () => false } },
            },
          },
        }
        const context = await getContext(deniedConfig, orgPrisma, null)

        await expect(
          context.db.Organisation.findMany({
            where: { billingAddress: { startsWith: '12 ' } },
          }),
        ).resolves.toEqual([])
        await expect(
          context.db.Organisation.findMany({ where: { bogusKey: 'x' } }),
        ).resolves.toEqual([])
        await expect(
          context.db.Organisation.count({
            where: { billingAddress: { startsWith: '12 ' } },
          }),
        ).resolves.toBe(0)
        await expect(context.db.Organisation.count({ where: { bogusKey: 'x' } })).resolves.toBe(0)

        expect(orgPrisma.Organisation.findMany).not.toHaveBeenCalled()
        expect(orgPrisma.Organisation.count).not.toHaveBeenCalled()
      })

      it('#915 itself does not recurse into a related list nested inside a relation filter, but #916 now does', async () => {
        // #915 (`validateQueryFieldReadAccess`) checks whether THIS list's
        // relationship field may be named at all — it does not by itself
        // reject a field on the RELATED list reached through it. Once #916
        // landed, that gap is closed by a SEPARATE pass
        // (`buildAccessScopedWhere`) that scopes relation filters and applies
        // the related list's own field-read access to keys nested inside
        // them — so the read-denied `User.secret` field is still rejected
        // overall, just not by #915's own top-level-only check.
        const relPrisma = {
          Post: { findMany: vi.fn(), count: vi.fn() },
        }
        const relConfig: OpenSaasConfig = {
          db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
          lists: {
            User: {
              fields: {
                name: { type: 'text' },
                secret: { type: 'text', access: { read: () => false } },
              },
              access: { operation: { query: () => true } },
            },
            Post: {
              fields: {
                title: { type: 'text' },
                author: { type: 'relationship', ref: 'User.posts' },
              },
              access: { operation: { query: () => true } },
            },
          },
        }
        relPrisma.Post.findMany.mockResolvedValue([])

        const context = await getContext(relConfig, relPrisma, null)
        // Names a field on the RELATED list (User.secret) nested inside the
        // relation filter — not a key of Post itself, so #915's own check
        // (which only inspects Post's own fields) does not deny it, but
        // #916's relation-filter scoping (which checks the RELATED list's
        // field-read access) now does.
        await expect(
          context.db.Post.findMany({ where: { author: { is: { secret: { contains: 'x' } } } } }),
        ).rejects.toThrow(/secret/)

        expect(relPrisma.Post.findMany).not.toHaveBeenCalled()
      })
    })

    describe('relation filter access scoping (#916)', () => {
      // The exact shape from the issue: a publicly-queryable Organisation,
      // reachable Document/Membership/User lists each gated differently, and
      // a two-hop chain (Organisation -> members -> user -> email) that lets
      // an anonymous caller binary-search a field it could never read
      // directly, unless the relation filter itself is scoped.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let orgPrisma: any
      let orgConfig: OpenSaasConfig

      beforeEach(() => {
        orgPrisma = {
          Organisation: { findMany: vi.fn(), count: vi.fn() },
        }
        orgConfig = {
          db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
          lists: {
            Organisation: {
              fields: {
                name: { type: 'text' },
                documents: { type: 'relationship', ref: 'Document.organisation', many: true },
                members: { type: 'relationship', ref: 'Membership.organisation', many: true },
              },
              access: { operation: { query: () => true } },
            },
            // Membership-scoped: `query` denies everything for an anonymous
            // session (no session means no membership filter can match).
            Document: {
              fields: {
                organisation: { type: 'relationship', ref: 'Organisation.documents' },
                billingAddress: { type: 'text' },
              },
              access: { operation: { query: () => false } },
            },
            Membership: {
              fields: {
                organisation: { type: 'relationship', ref: 'Organisation.members' },
                user: { type: 'relationship', ref: 'User.memberships' },
              },
              // Readable by anyone — the hop itself isn't the leak, the
              // identity list at the end of the chain is.
              access: { operation: { query: () => true } },
            },
            User: {
              fields: {
                memberships: { type: 'relationship', ref: 'Membership.user', many: true },
                email: { type: 'text' },
              },
              // Not queryable at all by an anonymous session.
              access: { operation: { query: () => false } },
            },
          },
        }
      })

      it('denies a single-hop relation filter through a fully denied related list, on both findMany and count', async () => {
        const context = await getContext(orgConfig, orgPrisma, null)

        await expect(
          context.db.Organisation.findMany({
            where: { documents: { some: { billingAddress: { startsWith: '12 ' } } } },
          }),
        ).rejects.toThrow(/Document/)
        await expect(
          context.db.Organisation.count({
            where: { documents: { some: { billingAddress: { startsWith: '12 ' } } } },
          }),
        ).rejects.toThrow(/Document/)

        expect(orgPrisma.Organisation.findMany).not.toHaveBeenCalled()
        expect(orgPrisma.Organisation.count).not.toHaveBeenCalled()
      })

      it('a count probe through a denied relation answers identically for a matching and non-matching value (no oracle)', async () => {
        // Before the fix these counts could differ (1 vs 0), letting a caller
        // recover `billingAddress` one character at a time. After the fix
        // both throw the SAME denial.
        const context = await getContext(orgConfig, orgPrisma, null)

        const matching = context.db.Organisation.count({
          where: { documents: { some: { billingAddress: { startsWith: '12 ' } } } },
        }).catch((err: Error) => err.message)
        const nonMatching = context.db.Organisation.count({
          where: { documents: { some: { billingAddress: { startsWith: '99 ' } } } },
        }).catch((err: Error) => err.message)

        expect(await matching).toEqual(await nonMatching)
        expect(orgPrisma.Organisation.count).not.toHaveBeenCalled()
      })

      it('denies a two-hop chain reaching a denied identity list, the exact probe from the issue', async () => {
        const context = await getContext(orgConfig, orgPrisma, null)

        await expect(
          context.db.Organisation.count({
            where: {
              members: { some: { user: { is: { email: { equals: 'ada@example.com' } } } } },
            },
          }),
        ).rejects.toThrow(/User/)

        expect(orgPrisma.Organisation.count).not.toHaveBeenCalled()
      })

      it('a two-hop count probe answers identically for a real and a fabricated email (no identity-confirmation oracle)', async () => {
        const context = await getContext(orgConfig, orgPrisma, null)

        const real = context.db.Organisation.count({
          where: {
            members: { some: { user: { is: { email: { equals: 'real@example.com' } } } } },
          },
        }).catch((err: Error) => err.message)
        const fabricated = context.db.Organisation.count({
          where: {
            members: { some: { user: { is: { email: { equals: 'nobody@example.com' } } } } },
          },
        }).catch((err: Error) => err.message)

        expect(await real).toEqual(await fabricated)
        expect(orgPrisma.Organisation.count).not.toHaveBeenCalled()
      })

      it("folds the related list's access filter into a relation filter rather than denying or passing it through unscoped", async () => {
        orgPrisma.Organisation.findMany.mockResolvedValue([])
        const scopedConfig: OpenSaasConfig = {
          ...orgConfig,
          lists: {
            ...orgConfig.lists,
            Document: {
              ...orgConfig.lists.Document,
              // A filter, not a boolean: only this org's own published docs.
              access: { operation: { query: () => ({ published: { equals: true } }) } },
            },
          },
        }

        const context = await getContext(scopedConfig, orgPrisma, null)
        await context.db.Organisation.findMany({
          where: { documents: { some: { billingAddress: { startsWith: '12 ' } } } },
        })

        expect(orgPrisma.Organisation.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              documents: {
                some: {
                  AND: [{ published: { equals: true } }, { billingAddress: { startsWith: '12 ' } }],
                },
              },
            },
          }),
        )
      })

      it('leaves a relation filter through a fully readable related list unwrapped (no perturbation)', async () => {
        orgPrisma.Organisation.findMany.mockResolvedValue([])
        const openConfig: OpenSaasConfig = {
          ...orgConfig,
          lists: {
            ...orgConfig.lists,
            Membership: {
              ...orgConfig.lists.Membership,
              access: { operation: { query: () => true } },
            },
          },
        }
        const context = await getContext(openConfig, orgPrisma, null)
        const where = { members: { some: { organisation: { is: { name: { equals: 'Acme' } } } } } }

        await context.db.Organisation.findMany({ where })

        expect(orgPrisma.Organisation.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where }),
        )
      })

      it('sudo bypasses relation-filter scoping entirely (#916 unaffected)', async () => {
        orgPrisma.Organisation.findMany.mockResolvedValue([])

        const context = (await getContext(orgConfig, orgPrisma, null)).sudo()
        const where = { documents: { some: { billingAddress: { startsWith: '12 ' } } } }
        await context.db.Organisation.findMany({ where })

        expect(orgPrisma.Organisation.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where }),
        )
      })

      it('a caller with zero list access gets the ordinary silent denial, never the relation-filter error', async () => {
        const deniedConfig: OpenSaasConfig = {
          ...orgConfig,
          lists: {
            ...orgConfig.lists,
            Organisation: {
              ...orgConfig.lists.Organisation,
              access: { operation: { query: () => false } },
            },
          },
        }
        const context = await getContext(deniedConfig, orgPrisma, null)

        await expect(
          context.db.Organisation.findMany({
            where: { documents: { some: { billingAddress: { startsWith: '12 ' } } } },
          }),
        ).resolves.toEqual([])
        await expect(
          context.db.Organisation.count({
            where: { documents: { some: { billingAddress: { startsWith: '12 ' } } } },
          }),
        ).resolves.toBe(0)

        expect(orgPrisma.Organisation.findMany).not.toHaveBeenCalled()
        expect(orgPrisma.Organisation.count).not.toHaveBeenCalled()
      })
    })

    describe('explicit include merges with access control (#566)', () => {
      // Author has many Posts; Post.query access scopes to published posts only.
      // A caller-supplied `include` must NOT bypass that per-relation filter.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let relPrisma: any
      let relConfig: OpenSaasConfig

      beforeEach(() => {
        relPrisma = {
          Author: {
            findFirst: vi.fn(),
            findUnique: vi.fn(),
            findMany: vi.fn(),
          },
          Post: {
            findFirst: vi.fn(),
            findUnique: vi.fn(),
            findMany: vi.fn(),
          },
          Comment: {
            findFirst: vi.fn(),
            findMany: vi.fn(),
          },
        }

        relConfig = {
          db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
          lists: {
            Author: {
              fields: {
                name: { type: 'text' },
                posts: { type: 'relationship', ref: 'Post.author', many: true },
              },
              access: { operation: { query: () => true } },
            },
            Post: {
              fields: {
                title: { type: 'text' },
                author: { type: 'relationship', ref: 'Author.posts' },
                comments: { type: 'relationship', ref: 'Comment.post', many: true },
              },
              access: {
                // Row filter: only published posts are visible.
                operation: { query: () => ({ status: { equals: 'published' } }) },
              },
            },
            Comment: {
              fields: {
                body: { type: 'text' },
                post: { type: 'relationship', ref: 'Post.comments' },
              },
              access: {
                operation: { query: () => ({ approved: { equals: true } }) },
              },
            },
            Secret: {
              fields: {
                value: { type: 'text' },
              },
              // Fully denied list.
              access: { operation: { query: () => false } },
            },
          },
        }
        // Add a denied relation onto Author for the "drop denied relation" test.
        relConfig.lists.Author.fields.secrets = {
          type: 'relationship',
          ref: 'Secret',
          many: true,
        }
      })

      it('findMany: caller include {posts:true} applies the relation access where (not bare true)', async () => {
        relPrisma.Author.findMany.mockResolvedValue([{ id: 'a1', name: 'Jo', posts: [] }])

        const context = await getContext(relConfig, relPrisma, null)
        await context.db.Author.findMany({ include: { posts: true } })

        // The relation is fetched WITH the Post query-access where (NOT bare true),
        // proving the row-level bypass is closed.
        const call = relPrisma.Author.findMany.mock.calls[0][0]
        expect(call.include.posts).not.toBe(true)
        expect(call.include.posts.where).toEqual({ status: { equals: 'published' } })
      })

      it('findUnique: caller include {posts:true} applies the relation access where', async () => {
        relPrisma.Author.findFirst.mockResolvedValue({ id: 'a1', name: 'Jo', posts: [] })

        const context = await getContext(relConfig, relPrisma, null)
        await context.db.Author.findUnique({ where: { id: 'a1' }, include: { posts: true } })

        const call = relPrisma.Author.findFirst.mock.calls[0][0]
        expect(call.where).toEqual(expect.objectContaining({ id: 'a1' }))
        expect(call.include.posts).not.toBe(true)
        expect(call.include.posts.where).toEqual({ status: { equals: 'published' } })
      })

      it('drops a relation whose query access is false when named in the caller include', async () => {
        relPrisma.Author.findMany.mockResolvedValue([{ id: 'a1', name: 'Jo' }])

        const context = await getContext(relConfig, relPrisma, null)
        await context.db.Author.findMany({ include: { secrets: true, posts: true } })

        const call = relPrisma.Author.findMany.mock.calls[0][0]
        // Denied `secrets` relation is dropped; allowed `posts` keeps its filter.
        expect(call.include.secrets).toBeUndefined()
        expect(call.include.posts.where).toEqual({ status: { equals: 'published' } })
      })

      it('caller `_count` folds the relation access where into the select (#1087)', async () => {
        relPrisma.Author.findMany.mockResolvedValue([
          { id: 'a1', name: 'Jo', _count: { posts: 3 } },
        ])

        const context = await getContext(relConfig, relPrisma, null)
        const result = await context.db.Author.findMany({
          include: { _count: { select: { posts: true } } },
        })

        const call = relPrisma.Author.findMany.mock.calls[0][0]
        expect(call.include._count).toEqual({
          select: { posts: { where: { status: { equals: 'published' } } } },
        })
        expect(result[0]._count).toEqual({ posts: 3 })
      })

      it('caller `_count` on a fully-denied relation is omitted from the select and returns 0 (#1087)', async () => {
        relPrisma.Author.findMany.mockResolvedValue([{ id: 'a1', name: 'Jo' }])

        const context = await getContext(relConfig, relPrisma, null)
        const result = await context.db.Author.findMany({
          include: { _count: { select: { posts: true, secrets: true } } },
        })

        const call = relPrisma.Author.findMany.mock.calls[0][0]
        // The denied `Secret` list is never asked to be counted...
        expect(call.include._count).toEqual({
          select: { posts: { where: { status: { equals: 'published' } } } },
        })
        // ...but the caller still sees an explicit `0`, never an absent key —
        // a count is session-relative, and `0` is what "no visible rows" means.
        expect(result[0]._count).toEqual({ secrets: 0 })
      })

      it('sudo `_count` is used as-is, unscoped (behaviour preserved)', async () => {
        relPrisma.Author.findMany.mockResolvedValue([
          { id: 'a1', name: 'Jo', _count: { posts: 3, secrets: 7 } },
        ])

        const context = await getContext(relConfig, relPrisma, null).sudo()
        const result = await context.db.Author.findMany({
          include: { _count: { select: { posts: true, secrets: true } } },
        })

        expect(relPrisma.Author.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            include: { _count: { select: { posts: true, secrets: true } } },
          }),
        )
        expect(result[0]._count).toEqual({ posts: 3, secrets: 7 })
      })

      it('AND-combines a caller nested where with the relation access where', async () => {
        relPrisma.Author.findMany.mockResolvedValue([{ id: 'a1', name: 'Jo', posts: [] }])

        const context = await getContext(relConfig, relPrisma, null)
        await context.db.Author.findMany({
          include: { posts: { where: { title: { contains: 'hello' } } } },
        })

        const call = relPrisma.Author.findMany.mock.calls[0][0]
        // Both the access where and the caller where are applied via AND.
        expect(call.include.posts.where).toEqual({
          AND: [{ status: { equals: 'published' } }, { title: { contains: 'hello' } }],
        })
      })

      it('access-filters nested (2-level) caller includes at every level', async () => {
        relPrisma.Author.findMany.mockResolvedValue([{ id: 'a1', name: 'Jo', posts: [] }])

        const context = await getContext(relConfig, relPrisma, null)
        await context.db.Author.findMany({
          include: { posts: { include: { comments: true } } },
        })

        const call = relPrisma.Author.findMany.mock.calls[0][0]
        // Level 1 (posts) and level 2 (comments) both carry their access where.
        expect(call.include.posts.where).toEqual({ status: { equals: 'published' } })
        expect(call.include.posts.include.comments.where).toEqual({ approved: { equals: true } })
      })

      it('sudo with explicit include returns the include unfiltered (behaviour preserved)', async () => {
        relPrisma.Author.findMany.mockResolvedValue([{ id: 'a1', name: 'Jo' }])

        const context = await getContext(relConfig, relPrisma, null).sudo()
        await context.db.Author.findMany({ include: { posts: true, secrets: true } })

        // Under sudo the caller include is used as-is: no filter, nothing dropped.
        expect(relPrisma.Author.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ include: { posts: true, secrets: true } }),
        )
      })

      it('query fragment path carries the access filter, same as the include: path (#1088)', async () => {
        relPrisma.Author.findMany.mockResolvedValue([{ id: 'a1', name: 'Jo', posts: [] }])

        const postsFragment = defineFragment<{ id: string; title: string }>()({
          title: true,
        } as const)
        const fragment = defineFragment<{ id: string; name: string; posts: unknown }>()({
          id: true,
          name: true,
          posts: postsFragment,
        } as const)

        const context = await getContext(relConfig, relPrisma, null)
        await context.db.Author.findMany({ query: fragment })

        const call = relPrisma.Author.findMany.mock.calls[0][0]
        // The fragment-built include now runs through the same scoping walk as
        // an explicit caller `include`, so `posts` carries Post's access where
        // (matching the `include: { posts: true }` test above) instead of a
        // bare, unfiltered `true`.
        expect(call.include).toEqual({ posts: { where: { status: { equals: 'published' } } } })
      })

      it('drops a relation whose query access is false when named in a query fragment', async () => {
        relPrisma.Author.findMany.mockResolvedValue([{ id: 'a1', name: 'Jo' }])

        const secretsFragment = defineFragment<{ id: string; value: string }>()({
          value: true,
        } as const)
        const fragment = defineFragment<{ id: string; name: string; secrets: unknown }>()({
          id: true,
          name: true,
          secrets: secretsFragment,
        } as const)

        const context = await getContext(relConfig, relPrisma, null)
        await context.db.Author.findMany({ query: fragment })

        const call = relPrisma.Author.findMany.mock.calls[0][0]
        // `Secret`'s query access is `() => false` — the denied relation is
        // dropped from the include entirely, same as the `include:` path.
        expect(call.include.secrets).toBeUndefined()
      })

      it('a fragment nesting past the depth cap raises the same depth error a caller include does', async () => {
        const chainLength = READ_INCLUDE_MAX_DEPTH + 2
        const chainConfig: OpenSaasConfig = {
          db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
          lists: {},
        }
        for (let i = 0; i < chainLength; i++) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
          const fields: Record<string, any> = { name: { type: 'text' } }
          if (i < chainLength - 1) fields.next = { type: 'relationship', ref: `D${i + 1}.prev` }
          if (i > 0) fields.prev = { type: 'relationship', ref: `D${i - 1}.next` }
          chainConfig.lists[`D${i}`] = { fields, access: { operation: { query: () => true } } }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chainPrisma: any = {}
        for (let i = 0; i < chainLength; i++) {
          chainPrisma[`D${i}`] = { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() }
        }

        // A fragment selecting `next` recursively, `hops` levels deep.
        function nestedFragmentFields(hops: number): Record<string, unknown> {
          if (hops <= 0) return { name: true }
          return {
            name: true,
            next: defineFragment<Record<string, unknown>>()(nestedFragmentFields(hops - 1)),
          }
        }
        const deepFragment = defineFragment<Record<string, unknown>>()(
          nestedFragmentFields(READ_INCLUDE_MAX_DEPTH + 1),
        )

        const context = await getContext(chainConfig, chainPrisma, null)

        await expect(context.db.D0.findMany({ query: deepFragment })).rejects.toThrow(
          AccessScopeDepthExceededError,
        )
        expect(chainPrisma.D0.findMany).not.toHaveBeenCalled()
      })

      it('sudo query fragment reads stay unscoped (behaviour preserved)', async () => {
        relPrisma.Author.findMany.mockResolvedValue([{ id: 'a1', name: 'Jo' }])

        const secretsFragment = defineFragment<{ id: string; value: string }>()({
          value: true,
        } as const)
        const fragment = defineFragment<{ id: string; name: string; secrets: unknown }>()({
          id: true,
          name: true,
          secrets: secretsFragment,
        } as const)

        const context = await getContext(relConfig, relPrisma, null).sudo()
        await context.db.Author.findMany({ query: fragment })

        // Under sudo, the fragment-built include is used as-is: the denied
        // `Secret` relation is fetched unfiltered, matching sudo's existing
        // include: behaviour.
        expect(relPrisma.Author.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ include: { secrets: true } }),
        )
      })

      it('a fragment read on a to-one relation nulls out a row its related list denies, matching include: (#974)', async () => {
        // `Comment.post` is a to-one relation onto `Post`, whose query access
        // is a row filter (`status: published`) rather than a plain boolean —
        // Prisma can't carry that as a `where` on a to-one include, so it's
        // resolved via the post-query existence check instead.
        const postFragment = defineFragment<{ id: string; title: string }>()({
          title: true,
        } as const)
        const fragment = defineFragment<{ id: string; body: string; post: unknown }>()({
          id: true,
          body: true,
          post: postFragment,
        } as const)

        relPrisma.Comment.findMany.mockResolvedValue([
          { id: 'c1', body: 'hi', post: { id: 'p1', title: 'Draft' } },
        ])
        // The batched existence check queries the raw Post model directly;
        // an empty result means `p1` does not satisfy Post's access filter.
        relPrisma.Post.findMany.mockResolvedValue([])

        const context = await getContext(relConfig, relPrisma, null)
        const result = await context.db.Comment.findMany({ query: fragment })

        expect(result[0].post).toBeNull()
      })

      it('a fragment read and an equivalent include: read produce the same access-scoped include', async () => {
        relPrisma.Author.findMany.mockResolvedValue([{ id: 'a1', name: 'Jo', posts: [] }])

        const postsFragment = defineFragment<{ id: string; title: string }>()({
          title: true,
        } as const)
        const fragment = defineFragment<{ id: string; name: string; posts: unknown }>()({
          id: true,
          name: true,
          posts: postsFragment,
        } as const)

        const context = await getContext(relConfig, relPrisma, null)
        await context.db.Author.findMany({ query: fragment })
        const fragmentInclude = relPrisma.Author.findMany.mock.calls[0][0].include

        relPrisma.Author.findMany.mockClear()
        await context.db.Author.findMany({ include: { posts: true } })
        const callerInclude = relPrisma.Author.findMany.mock.calls[0][0].include

        expect(fragmentInclude).toEqual(callerInclude)
      })

      // Core new guarantee introduced by #852 / ADR-0026: naming one relation
      // no longer walks (and access-checks) every other relationship of the
      // list. Before this fix, `include: { posts: true }` would ALSO evaluate
      // `Secret`'s query access (and, one hop further, `Comment`'s) even
      // though the caller never named `secrets` — wasted access calls the
      // caller never asked to pay for. Asserted directly on the access
      // function, not just on the resulting include shape.
      it('does not invoke query access on a relation the caller did not name (#852)', async () => {
        const postQuerySpy = vi.fn(() => ({ status: { equals: 'published' } }))
        const secretQuerySpy = vi.fn(() => false)
        const spiedConfig: OpenSaasConfig = {
          ...relConfig,
          lists: {
            ...relConfig.lists,
            Post: { ...relConfig.lists.Post, access: { operation: { query: postQuerySpy } } },
            Secret: { ...relConfig.lists.Secret, access: { operation: { query: secretQuerySpy } } },
          },
        }
        relPrisma.Author.findMany.mockResolvedValue([{ id: 'a1', name: 'Jo', posts: [] }])

        const context = await getContext(spiedConfig, relPrisma, null)
        await context.db.Author.findMany({ include: { posts: true } })

        expect(postQuerySpy).toHaveBeenCalledTimes(1)
        expect(secretQuerySpy).not.toHaveBeenCalled()
      })

      // Regression for issue #830: a read issued from inside a `resolveOutput`
      // hook used to lose relation row scoping ENTIRELY — `buildIncludeWithAccessControl`
      // returned a whole-object `undefined` for the inner read (any
      // `_resolveOutputChain.length > 0`), which `mergeIncludeWithAccessControl`
      // treated as "nothing to merge against" and passed the caller's include
      // through completely unscoped. The fix scopes each immediate relation with
      // its own access `where` while still not auto-EXPANDING into that
      // relation's own nested relations (preserving the original loop-prevention
      // — see the self-referential coverage in `access-filter.test.ts`).
      describe('scopes (without expanding) a caller include used inside a resolveOutput hook (#830)', () => {
        // Build an Author config with a virtual field whose resolveOutput issues a
        // read WITH an explicit include. While that hook runs,
        // _resolveOutputChain.length > 0.
        function configWithResolveOutputProbe(
          callerInclude: Record<string, unknown>,
          capture: (include: unknown) => void,
        ): OpenSaasConfig {
          return {
            ...relConfig,
            lists: {
              ...relConfig.lists,
              Author: {
                ...relConfig.lists.Author,
                fields: {
                  ...relConfig.lists.Author.fields,
                  commentSummary: virtual({
                    type: 'string',
                    hooks: {
                      resolveOutput: async ({ context }) => {
                        await context.db.Comment.findMany({ include: callerInclude })
                        capture(relPrisma.Comment.findMany.mock.calls[0][0].include)
                        return 'summary'
                      },
                    },
                  }),
                },
              },
            },
          }
        }

        it('findUnique inside a resolveOutput hook still fetches the relation, unscoped at the Prisma level (#974)', async () => {
          let innerIncludeSeen: unknown
          const hookConfig = configWithResolveOutputProbe({ post: true }, (include) => {
            innerIncludeSeen = include
          })

          relPrisma.Author.findFirst.mockResolvedValue({ id: 'a1', name: 'Jo' })
          relPrisma.Comment.findMany.mockResolvedValue([{ id: 'c1', body: 'hi', post: null }])

          const context = await getContext(hookConfig, relPrisma, null)
          await context.db.Author.findUnique({ where: { id: 'a1' } })

          // `post` is still fetched (not dropped). It carries no `where` — Post
          // is a to-one relation here, and Prisma rejects a `where` on a to-one
          // include (#974); Post's own access filter is enforced afterward via
          // a batched existence check instead (see access-filter.test.ts).
          expect(innerIncludeSeen).toEqual({ post: true })
        })

        it('findMany inside a resolveOutput hook scopes the relation but does not auto-expand its nested include', async () => {
          let innerIncludeSeen: unknown
          const hookConfig = configWithResolveOutputProbe(
            { post: { include: { author: true } } },
            (include) => {
              innerIncludeSeen = include
            },
          )

          relPrisma.Author.findMany.mockResolvedValue([{ id: 'a1', name: 'Jo' }])
          relPrisma.Comment.findMany.mockResolvedValue([{ id: 'c1', body: 'hi', post: null }])

          const context = await getContext(hookConfig, relPrisma, null)
          await context.db.Author.findMany()

          // The caller's own nested selection (`post.include.author`) is honoured
          // as-is (access control does not auto-descend further here). `post`
          // itself carries no `where` — see the findUnique test above (#974).
          expect(innerIncludeSeen).toEqual({
            post: { include: { author: true } },
          })
        })
      })

      // Regression for issue #830: a caller `include` nested deeper than the
      // Access Filter can scope used to be returned unscoped rather than
      // denied. This exercises the fix end-to-end through `context.db`,
      // matching the reproduction in the issue: a chain of lists deep enough
      // to cross `READ_INCLUDE_MAX_DEPTH`, read as a non-privileged session.
      describe('fail-closed at the read-include depth cap through context.db (#830)', () => {
        function chainListConfig(count: number): OpenSaasConfig['lists'] {
          const lists: OpenSaasConfig['lists'] = {}
          for (let i = 0; i < count; i++) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal config for unit test
            const fields: Record<string, any> = { name: { type: 'text' } }
            if (i < count - 1) fields.next = { type: 'relationship', ref: `C${i + 1}.prev` }
            if (i > 0) fields.prev = { type: 'relationship', ref: `C${i - 1}.next` }
            lists[`C${i}`] = {
              fields,
              access: {
                operation: { query: () => (i === 0 ? true : { ownerId: { equals: `C${i}` } }) },
              },
            }
          }
          return lists
        }

        // A caller include selecting `next` `hops` more times, ending bare.
        function nestedCallerInclude(hops: number): Record<string, unknown> {
          if (hops <= 0) return true as unknown as Record<string, unknown>
          return { include: { next: nestedCallerInclude(hops - 1) } }
        }

        it('throws AccessScopeDepthExceededError for a caller include one hop past the cap', async () => {
          const chainLength = READ_INCLUDE_MAX_DEPTH + 2
          const chainConfig: OpenSaasConfig = {
            db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
            lists: chainListConfig(chainLength),
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const chainPrisma: any = {}
          for (let i = 0; i < chainLength; i++) {
            chainPrisma[`C${i}`] = { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() }
          }

          const context = await getContext(chainConfig, chainPrisma, null)

          await expect(
            context.db.C0.findMany({
              include: { next: nestedCallerInclude(READ_INCLUDE_MAX_DEPTH) },
            }),
          ).rejects.toThrow(AccessScopeDepthExceededError)

          // The database is never even queried — the denial happens before the
          // Prisma call, not as a post-hoc filter on returned data.
          expect(chainPrisma.C0.findMany).not.toHaveBeenCalled()
        })

        it('still applies row-scoping at the deepest hop for the same include one hop shallower', async () => {
          const chainLength = READ_INCLUDE_MAX_DEPTH + 1
          const chainConfig: OpenSaasConfig = {
            db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
            lists: chainListConfig(chainLength),
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const chainPrisma: any = {}
          for (let i = 0; i < chainLength; i++) {
            chainPrisma[`C${i}`] = { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() }
          }

          // Every hop here is to-one (no `many: true`), so none of them can
          // carry a `where` on the Prisma include (#974) — the chain comes
          // back unscoped at the Prisma level, one nested object per hop, and
          // row-scoping is enforced afterward via a batched existence check
          // per hop instead.
          let deepestItem: Record<string, unknown> = { id: `id${chainLength - 1}`, name: 'leaf' }
          for (let i = chainLength - 2; i >= 0; i--) {
            deepestItem = { id: `id${i}`, name: 'x', next: deepestItem }
          }
          chainPrisma.C0.findMany.mockResolvedValue([deepestItem])
          for (let i = 1; i < chainLength; i++) {
            chainPrisma[`C${i}`].findMany.mockResolvedValue([{ id: `id${i}` }])
          }

          const context = await getContext(chainConfig, chainPrisma, null)

          await context.db.C0.findMany({
            include: { next: nestedCallerInclude(READ_INCLUDE_MAX_DEPTH - 1) },
          })

          // Walk the built include down to the last list — no hop carries a
          // `where` (they are all to-one).
          let entry = chainPrisma.C0.findMany.mock.calls[0][0].include.next
          for (let i = 1; i < READ_INCLUDE_MAX_DEPTH; i++) {
            expect(entry.where).toBeUndefined()
            entry = entry.include.next
          }
          expect(entry.where).toBeUndefined()

          // The deepest hop's own existence check still carries that list's
          // access filter — row scoping reaches all the way down, just not
          // through the Prisma `include` itself.
          expect(chainPrisma[`C${READ_INCLUDE_MAX_DEPTH}`].findMany).toHaveBeenCalledWith({
            where: {
              AND: [
                { ownerId: { equals: `C${READ_INCLUDE_MAX_DEPTH}` } },
                { id: { in: [`id${READ_INCLUDE_MAX_DEPTH}`] } },
              ],
            },
            select: { id: true },
          })
        })
      })

      // Regression for #628: a virtual field named in `include` used to be
      // forwarded straight through to Prisma, which throws "Unknown field"
      // because virtual fields have no database column. The runtime must
      // strip virtual keys from the include payload while still computing
      // the virtual value (via resolveOutput) and leaving real relationship
      // includes — access-controlled or not — untouched.
      describe('virtual fields named in include no longer reach Prisma (#628)', () => {
        function configWithVirtualDisplayName(): OpenSaasConfig {
          return {
            ...relConfig,
            lists: {
              ...relConfig.lists,
              Author: {
                ...relConfig.lists.Author,
                fields: {
                  ...relConfig.lists.Author.fields,
                  displayName: virtual({
                    type: 'string',
                    hooks: {
                      resolveOutput: ({ item }) => `Author: ${item.name}`,
                    },
                  }),
                },
              },
            },
          }
        }

        it('findMany: strips the virtual key from the Prisma include but keeps the real relationship include, and computes the virtual value', async () => {
          const vConfig = configWithVirtualDisplayName()
          relPrisma.Author.findMany.mockResolvedValue([{ id: 'a1', name: 'Jo', posts: [] }])

          const context = await getContext(vConfig, relPrisma, null)
          const result = await context.db.Author.findMany({
            include: { displayName: true, posts: true },
          })

          const call = relPrisma.Author.findMany.mock.calls[0][0]
          expect(call.include).not.toHaveProperty('displayName')
          expect(call.include.posts).toBeDefined()
          expect(result[0].displayName).toBe('Author: Jo')
        })

        it('findUnique: strips the virtual key from the Prisma include but keeps the real relationship include, and computes the virtual value', async () => {
          const vConfig = configWithVirtualDisplayName()
          relPrisma.Author.findFirst.mockResolvedValue({ id: 'a1', name: 'Jo', posts: [] })

          const context = await getContext(vConfig, relPrisma, null)
          const result = await context.db.Author.findUnique({
            where: { id: 'a1' },
            include: { displayName: true, posts: true },
          })

          const call = relPrisma.Author.findFirst.mock.calls[0][0]
          expect(call.include).not.toHaveProperty('displayName')
          expect(call.include.posts).toBeDefined()
          expect(result.displayName).toBe('Author: Jo')
        })

        it('the virtual value is populated even when omitted from include', async () => {
          const vConfig = configWithVirtualDisplayName()
          relPrisma.Author.findFirst.mockResolvedValue({ id: 'a1', name: 'Jo' })

          const context = await getContext(vConfig, relPrisma, null)
          const result = await context.db.Author.findUnique({ where: { id: 'a1' } })

          expect(result.displayName).toBe('Author: Jo')
        })

        it('sudo: the virtual key is stripped from the Prisma include even though it bypasses access control', async () => {
          const vConfig = configWithVirtualDisplayName()
          relPrisma.Author.findMany.mockResolvedValue([{ id: 'a1', name: 'Jo' }])

          const context = await getContext(vConfig, relPrisma, null).sudo()
          const result = await context.db.Author.findMany({
            include: { displayName: true, posts: true },
          })

          const call = relPrisma.Author.findMany.mock.calls[0][0]
          expect(call.include).not.toHaveProperty('displayName')
          // The real relationship is unaffected — sudo still passes it through as-is.
          expect(call.include.posts).toBe(true)
          expect(result[0].displayName).toBe('Author: Jo')
        })

        it('read access control on the virtual field is still enforced (denied field is omitted)', async () => {
          const vConfig = configWithVirtualDisplayName()
          vConfig.lists.Author.fields.displayName = virtual({
            type: 'string',
            access: { read: () => false },
            hooks: {
              resolveOutput: ({ item }) => `Author: ${item.name}`,
            },
          })
          relPrisma.Author.findFirst.mockResolvedValue({ id: 'a1', name: 'Jo' })

          const context = await getContext(vConfig, relPrisma, null)
          const result = await context.db.Author.findUnique({
            where: { id: 'a1' },
            include: { displayName: true },
          })

          expect(result).not.toHaveProperty('displayName')
        })
      })
    })

    it('should delegate create to prisma with access control and hooks', async () => {
      const mockUser = { id: '1', name: 'John', email: 'john@example.com' }
      mockPrisma.User.create.mockResolvedValue(mockUser)

      const context = await getContext(config, mockPrisma, null)
      const result = await context.db.User.create({
        data: { name: 'John', email: 'john@example.com' },
      })

      expect(mockPrisma.User.create).toHaveBeenCalled()
      expect(result).toEqual(mockUser)
    })

    it('should delegate update to prisma with access control and hooks', async () => {
      const existingUser = { id: '1', name: 'John', email: 'john@example.com' }
      const updatedUser = { id: '1', name: 'John Updated', email: 'john@example.com' }
      mockPrisma.User.findUnique.mockResolvedValue(existingUser)
      mockPrisma.User.update.mockResolvedValue(updatedUser)

      const context = await getContext(config, mockPrisma, null)
      const result = await context.db.User.update({
        where: { id: '1' },
        data: { name: 'John Updated' },
      })

      expect(mockPrisma.User.update).toHaveBeenCalled()
      expect(result).toEqual(updatedUser)
    })

    it('should delegate delete to prisma with access control and hooks', async () => {
      const mockUser = { id: '1', name: 'John', email: 'john@example.com' }
      mockPrisma.User.findUnique.mockResolvedValue(mockUser)
      mockPrisma.User.delete.mockResolvedValue(mockUser)

      const context = await getContext(config, mockPrisma, null)
      const result = await context.db.User.delete({ where: { id: '1' } })

      expect(mockPrisma.User.delete).toHaveBeenCalled()
      expect(result).toEqual(mockUser)
    })

    it('should delegate count to prisma with access control', async () => {
      mockPrisma.User.count.mockResolvedValue(5)

      const context = await getContext(config, mockPrisma, null)
      const result = await context.db.User.count()

      expect(mockPrisma.User.count).toHaveBeenCalled()
      expect(result).toBe(5)
    })

    it('should batch create items via createMany', async () => {
      const mockUsers = [
        { id: '1', name: 'John', email: 'john@example.com' },
        { id: '2', name: 'Jane', email: 'jane@example.com' },
        { id: '3', name: 'Bob', email: 'bob@example.com' },
      ]

      // Mock create to return each user in sequence
      mockPrisma.User.create
        .mockResolvedValueOnce(mockUsers[0])
        .mockResolvedValueOnce(mockUsers[1])
        .mockResolvedValueOnce(mockUsers[2])

      const context = await getContext(config, mockPrisma, null)
      const result = await context.db.User.createMany({
        data: [
          { name: 'John', email: 'john@example.com' },
          { name: 'Jane', email: 'jane@example.com' },
          { name: 'Bob', email: 'bob@example.com' },
        ],
      })

      // Should call create 3 times (once for each item)
      expect(mockPrisma.User.create).toHaveBeenCalledTimes(3)
      expect(result).toEqual(mockUsers)
    })

    it('should batch update items via updateMany', async () => {
      const mockUsers = [
        { id: '1', name: 'John', email: 'john@example.com' },
        { id: '2', name: 'Jane', email: 'jane@example.com' },
      ]

      const updatedUsers = [
        { id: '1', name: 'John Updated', email: 'john@example.com' },
        { id: '2', name: 'Jane Updated', email: 'jane@example.com' },
      ]

      // Mock findMany to return the users
      mockPrisma.User.findMany.mockResolvedValue(mockUsers)

      // Mock findUnique for each update's access check
      mockPrisma.User.findUnique
        .mockResolvedValueOnce(mockUsers[0])
        .mockResolvedValueOnce(mockUsers[1])

      // Mock update to return updated users
      mockPrisma.User.update
        .mockResolvedValueOnce(updatedUsers[0])
        .mockResolvedValueOnce(updatedUsers[1])

      const context = await getContext(config, mockPrisma, null)
      const result = await context.db.User.updateMany({
        where: { id: { in: ['1', '2'] } },
        data: { name: 'Updated' },
      })

      // Should call findMany once to get records
      expect(mockPrisma.User.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['1', '2'] } },
        take: undefined,
        skip: undefined,
        include: undefined,
      })

      // Should call update twice (once for each item)
      expect(mockPrisma.User.update).toHaveBeenCalledTimes(2)
      expect(result).toEqual(updatedUsers)
    })

    it('should run hooks and access control for each item in createMany', async () => {
      // Test that hooks are called for each item
      const mockUsers = [
        { id: '1', name: 'John', email: 'john@example.com' },
        { id: '2', name: 'Jane', email: 'jane@example.com' },
      ]

      mockPrisma.User.create.mockResolvedValueOnce(mockUsers[0]).mockResolvedValueOnce(mockUsers[1])

      // Config with hook
      const configWithHook: OpenSaasConfig = {
        ...config,
        lists: {
          ...config.lists,
          User: {
            ...config.lists.User,
            hooks: {
              resolveInput: vi.fn(async ({ resolvedData }) => resolvedData),
            },
          },
        },
      }

      const context = await getContext(configWithHook, mockPrisma, null)
      await context.db.User.createMany({
        data: [
          { name: 'John', email: 'john@example.com' },
          { name: 'Jane', email: 'jane@example.com' },
        ],
      })

      // Hook should be called twice (once for each item)
      expect(configWithHook.lists.User.hooks?.resolveInput).toHaveBeenCalledTimes(2)
    })

    it('should run hooks and access control for each item in updateMany', async () => {
      const mockUsers = [
        { id: '1', name: 'John', email: 'john@example.com' },
        { id: '2', name: 'Jane', email: 'jane@example.com' },
      ]

      const updatedUsers = [
        { id: '1', name: 'John Updated', email: 'john@example.com' },
        { id: '2', name: 'Jane Updated', email: 'jane@example.com' },
      ]

      mockPrisma.User.findMany.mockResolvedValue(mockUsers)
      mockPrisma.User.findUnique
        .mockResolvedValueOnce(mockUsers[0])
        .mockResolvedValueOnce(mockUsers[1])
      mockPrisma.User.update
        .mockResolvedValueOnce(updatedUsers[0])
        .mockResolvedValueOnce(updatedUsers[1])

      // Config with hook
      const configWithHook: OpenSaasConfig = {
        ...config,
        lists: {
          ...config.lists,
          User: {
            ...config.lists.User,
            hooks: {
              resolveInput: vi.fn(async ({ resolvedData }) => resolvedData),
            },
          },
        },
      }

      const context = await getContext(configWithHook, mockPrisma, null)
      await context.db.User.updateMany({
        where: { id: { in: ['1', '2'] } },
        data: { name: 'Updated' },
      })

      // Hook should be called twice (once for each item)
      expect(configWithHook.lists.User.hooks?.resolveInput).toHaveBeenCalledTimes(2)
    })
  })

  // `select` is not honoured by context.db reads — it is a visible no-op: the
  // op warns (once per list+operation) and still returns the full, access-
  // filtered result. Each test re-imports getContext via vi.resetModules() so
  // the module-level warn-once cache starts empty.
  describe('select no-op warning', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>
    let freshGetContext: typeof getContext

    beforeEach(async () => {
      vi.resetModules()
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const mod = await import('../src/context/index.js')
      freshGetContext = mod.getContext
    })

    afterEach(() => {
      warnSpy.mockRestore()
    })

    it('warns AND still returns the row when findUnique is passed a select', async () => {
      const mockUser = { id: '1', name: 'John', email: 'john@example.com' }
      mockPrisma.User.findFirst.mockResolvedValue(mockUser)

      const context = await freshGetContext(config, mockPrisma, null)
      const result = await context.db.User.findUnique({
        where: { id: '1' },
        select: { name: true },
      })

      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls[0][0]).toContain('`select` is ignored')
      expect(warnSpy.mock.calls[0][0]).toContain('findUnique')
      // Behaviour unchanged: the op still runs and returns the full row.
      expect(mockPrisma.User.findFirst).toHaveBeenCalled()
      expect(result).toEqual(mockUser)
    })

    it('warns AND still returns the rows when findMany is passed a select', async () => {
      const mockUsers = [
        { id: '1', name: 'John' },
        { id: '2', name: 'Jane' },
      ]
      mockPrisma.User.findMany.mockResolvedValue(mockUsers)

      const context = await freshGetContext(config, mockPrisma, null)
      const result = await context.db.User.findMany({ select: { name: true } })

      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls[0][0]).toContain('`select` is ignored')
      expect(warnSpy.mock.calls[0][0]).toContain('findMany')
      expect(mockPrisma.User.findMany).toHaveBeenCalled()
      expect(result).toEqual(mockUsers)
    })

    it('warns only once per list+operation across repeated calls', async () => {
      mockPrisma.User.findMany.mockResolvedValue([])

      const context = await freshGetContext(config, mockPrisma, null)
      await context.db.User.findMany({ select: { name: true } })
      await context.db.User.findMany({ select: { name: true } })
      await context.db.User.findMany({ select: { email: true } })

      expect(warnSpy).toHaveBeenCalledTimes(1)
    })

    it('does NOT warn for findUnique/findMany using only include or query', async () => {
      const mockUser = { id: '1', name: 'John' }
      mockPrisma.User.findFirst.mockResolvedValue(mockUser)
      mockPrisma.User.findMany.mockResolvedValue([mockUser])

      const context = await freshGetContext(config, mockPrisma, null)
      await context.db.User.findUnique({ where: { id: '1' }, include: { posts: true } })
      await context.db.User.findMany({ include: { posts: true } })
      await context.db.User.findMany()

      expect(warnSpy).not.toHaveBeenCalled()
    })
  })
})
