import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getContext } from '../src/context/index.js'
import { defineFragment } from '../src/query/index.js'
import { virtual } from '../src/fields/index.js'
import type { OpenSaasConfig } from '../src/config/types.js'

describe('getContext', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockPrisma: any
  let config: OpenSaasConfig

  beforeEach(() => {
    // Mock Prisma client with all methods needed by context
    mockPrisma = {
      user: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      },
      post: {
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
    expect(context.db.user).toBeDefined()
    expect(context.db.post).toBeDefined()
    expect(context.session).toBeNull()
    expect(context.prisma).toBe(mockPrisma)
  })

  it('should include session when provided', async () => {
    const session = { userId: '123', role: 'admin' }
    const context = await getContext(config, mockPrisma, session)

    expect(context.session).toEqual(session)
  })

  describe('serverAction', () => {
    it('should create an item', async () => {
      const mockCreatedUser = { id: '1', name: 'John', email: 'john@example.com' }
      mockPrisma.user.create.mockResolvedValue(mockCreatedUser)

      const context = await getContext(config, mockPrisma, null)
      const result = await context.serverAction({
        listKey: 'User',
        action: 'create',
        data: { name: 'John', email: 'john@example.com' },
      })

      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: { name: 'John', email: 'john@example.com' },
      })
      expect(result).toEqual({ success: true, data: mockCreatedUser })
    })

    it('should update an item', async () => {
      const existingUser = { id: '1', name: 'John', email: 'john@example.com' }
      const mockUpdatedUser = { id: '1', name: 'John Updated', email: 'john@example.com' }
      // Update operation first fetches the existing item
      mockPrisma.user.findUnique.mockResolvedValue(existingUser)
      mockPrisma.user.update.mockResolvedValue(mockUpdatedUser)

      const context = await getContext(config, mockPrisma, null)
      const result = await context.serverAction({
        listKey: 'User',
        action: 'update',
        id: '1',
        data: { name: 'John Updated' },
      })

      expect(mockPrisma.user.findUnique).toHaveBeenCalled()
      expect(mockPrisma.user.update).toHaveBeenCalled()
      expect(result).toEqual({ success: true, data: mockUpdatedUser })
    })

    it('should delete an item', async () => {
      const mockDeletedUser = { id: '1', name: 'John', email: 'john@example.com' }
      // Delete operation first fetches the existing item
      mockPrisma.user.findUnique.mockResolvedValue(mockDeletedUser)
      mockPrisma.user.delete.mockResolvedValue(mockDeletedUser)

      const context = await getContext(config, mockPrisma, null)
      const result = await context.serverAction({
        listKey: 'User',
        action: 'delete',
        id: '1',
      })

      expect(mockPrisma.user.findUnique).toHaveBeenCalled()
      expect(mockPrisma.user.delete).toHaveBeenCalled()
      expect(result).toEqual({ success: true, data: mockDeletedUser })
    })

    it('should convert listKey to lowercase for db operations', async () => {
      const mockCreatedPost = { id: '1', title: 'Test Post' }
      mockPrisma.post.create.mockResolvedValue(mockCreatedPost)

      const context = await getContext(config, mockPrisma, null)
      const result = await context.serverAction({
        listKey: 'Post',
        action: 'create',
        data: { title: 'Test Post' },
      })

      expect(mockPrisma.post.create).toHaveBeenCalled()
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
      mockPrisma.user.create.mockRejectedValue(dbError)

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
        mockPrisma.post.findUnique.mockResolvedValue(existing)
        mockPrisma.post.update.mockResolvedValue({ id: 'p1', title: 'T', authorId: null })

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
        expect(mockPrisma.post.update).toHaveBeenCalled()
        const updateArg = mockPrisma.post.update.mock.calls[0][0]
        expect(updateArg.where).toEqual({ id: 'p1' })
        expect(updateArg.data.author).toEqual({ disconnect: true })
        expect(mockPrisma.post.delete).not.toHaveBeenCalled()
        expect(result).toEqual({ removed: true })
      })

      it('deletes the related row when mode is delete', async () => {
        mockPrisma.post.findUnique.mockResolvedValue({ id: 'p1', title: 'T', authorId: 'u1' })
        mockPrisma.post.delete.mockResolvedValue({ id: 'p1', title: 'T' })

        const context = await getContext(config, mockPrisma, { userId: 'u1' })
        const result = await context.serverAction({
          listKey: 'Post',
          action: 'removeRelated',
          mode: 'delete',
          id: 'p1',
        })

        expect(mockPrisma.post.delete).toHaveBeenCalled()
        expect(mockPrisma.post.update).not.toHaveBeenCalled()
        expect(result).toEqual({ removed: true })
      })

      it('disconnects a to-many back-reference by parent id (many-to-many)', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const m2mPrisma: any = {
          lesson: {
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

        const updateArg = m2mPrisma.lesson.update.mock.calls[0][0]
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
      // selected id through the SECURED context (`context.db.post.update`), so
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
                          const r = await context.db.post.update({
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
        mockPrisma.post.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve({ id: where.id, title: 'T', content: 'c' }),
        )
        mockPrisma.post.update.mockImplementation(({ where }: { where: { id: string } }) =>
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
        expect(mockPrisma.post.update).toHaveBeenCalledTimes(2)
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
        mockPrisma.post.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
          where.id === 'p1'
            ? Promise.resolve({ id: 'p1', title: 'T', content: 'c' })
            : Promise.resolve(null),
        )
        // The filter-match re-check (mergeFilters) only ever runs for the row
        // that passed the existence pre-check (p1), so returning it is enough.
        mockPrisma.post.findFirst.mockResolvedValue({ id: 'p1', title: 'T', content: 'c' })
        mockPrisma.post.update.mockResolvedValue({ id: 'p1', status: 'published' })

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
        expect(mockPrisma.post.update).not.toHaveBeenCalled()
      })
    })

    describe('updateRelated (relationship-table inline cell edit)', () => {
      it('updates a single field on the related row through the secured context', async () => {
        mockPrisma.post.findUnique.mockResolvedValue({
          id: 'p1',
          title: 'Old',
          content: 'c',
          authorId: 'u1',
        })
        mockPrisma.post.update.mockResolvedValue({
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
        expect(mockPrisma.post.update).toHaveBeenCalled()
        const updateArg = mockPrisma.post.update.mock.calls[0][0]
        expect(updateArg.where).toEqual({ id: 'p1' })
        expect(updateArg.data.title).toBe('New')
        expect(mockPrisma.post.delete).not.toHaveBeenCalled()
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
        mockPrisma.post.findUnique.mockResolvedValue({
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
        expect(mockPrisma.post.update).not.toHaveBeenCalled()
        expect(result).toMatchObject({ updated: false })
        const failure = result as { updated: boolean; error?: string }
        expect(failure.error).toContain('spam')
      })
    })

    describe('createRelated (relationship-table pre-linked create)', () => {
      it('creates a row on the related list with the to-one back-reference preset to the parent', async () => {
        const created = { id: 'p1', title: 'New', content: 'c', authorId: 'u1' }
        mockPrisma.post.create.mockResolvedValue(created)
        // The connect target must be reachable (the related list's read access).
        mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1' })

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
        expect(mockPrisma.post.create).toHaveBeenCalled()
        const createArg = mockPrisma.post.create.mock.calls[0][0]
        expect(createArg.data.title).toBe('New')
        expect(createArg.data.author).toEqual({ connect: { id: 'u1' } })
        // Distinct `{ created }` shape (never a single-op `success`).
        expect(result).toEqual({ created: true, id: 'p1' })
      })

      it('connects a to-many back-reference by parent id (many-to-many)', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const m2mPrisma: any = {
          lesson: {
            findUnique: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
            create: vi.fn().mockResolvedValue({ id: 'l1', title: 'L' }),
          },
          teacher: {
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

        const createArg = m2mPrisma.lesson.create.mock.calls[0][0]
        // A to-many back-reference connects the parent by id.
        expect(createArg.data.teachers).toEqual({ connect: [{ id: 't1' }] })
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
        expect(mockPrisma.post.create).not.toHaveBeenCalled()
      })

      it('surfaces field errors from the create (e.g. a unique constraint) in the drawer shape', async () => {
        mockPrisma.post.create.mockRejectedValue({ code: 'P2002', meta: { target: ['title'] } })
        mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1' })

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
    })

    describe('relationshipOptions', () => {
      it('returns { id, label }[] for the related list, unfiltered/unincluded', async () => {
        mockPrisma.user.findMany.mockResolvedValue([
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
        const call = mockPrisma.user.findMany.mock.calls[0][0]
        expect(call.include).toBeUndefined()
      })

      it('bounds the query by take', async () => {
        mockPrisma.user.findMany.mockResolvedValue([{ id: 'u1', name: 'Ada' }])

        const context = await getContext(config, mockPrisma, null)
        await context.serverAction({
          listKey: 'Post',
          action: 'relationshipOptions',
          field: 'author',
          take: 1,
        })

        expect(mockPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1 }))
      })

      it('unions selectedIds beyond the take/search window', async () => {
        mockPrisma.user.findMany.mockResolvedValueOnce([{ id: 'u1', name: 'Ada' }])
        mockPrisma.user.findMany.mockResolvedValueOnce([{ id: 'u9', name: 'Zed' }])

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
        mockPrisma.user.findMany.mockResolvedValue([{ id: 'u1', name: 'Ada' }])

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
      mockPrisma.user.findFirst.mockResolvedValue(mockUser)

      const context = await getContext(config, mockPrisma, null)
      const result = await context.db.user.findUnique({ where: { id: '1' } })

      expect(mockPrisma.user.findFirst).toHaveBeenCalled()
      expect(result).toEqual(mockUser)
    })

    describe('findUnique unique-where enforcement (#567)', () => {
      it('accepts a valid unique where (id) and keeps access + include intact', async () => {
        const mockUser = { id: '1', name: 'John', email: 'john@example.com' }
        mockPrisma.user.findFirst.mockResolvedValue(mockUser)

        const context = await getContext(config, mockPrisma, null)
        const result = await context.db.user.findUnique({
          where: { id: '1' },
          include: { posts: true },
        })

        // Access control still runs and the underlying delegate is invoked with
        // the merged where + include (proving access + include path is intact).
        expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ id: '1' }),
            include: { posts: true },
          }),
        )
        expect(result).toEqual(mockUser)
      })

      it('accepts a configured-unique field (email) as the unique where', async () => {
        const mockUser = { id: '1', name: 'John', email: 'john@example.com' }
        mockPrisma.user.findFirst.mockResolvedValue(mockUser)

        const context = await getContext(config, mockPrisma, null)
        const result = await context.db.user.findUnique({
          where: { email: 'john@example.com' },
        })

        expect(mockPrisma.user.findFirst).toHaveBeenCalled()
        expect(result).toEqual(mockUser)
      })

      it('narrows the result through a query fragment with a unique where', async () => {
        const mockUser = { id: '1', name: 'John', email: 'john@example.com' }
        mockPrisma.user.findFirst.mockResolvedValue(mockUser)

        const fragment = defineFragment<{ id: string; name: string; email: string }>()({
          id: true,
          name: true,
        } as const)

        const context = await getContext(config, mockPrisma, null)
        const result = await context.db.user.findUnique({ where: { id: '1' }, query: fragment })

        // Fragment narrows the result to only the requested fields (email omitted)
        expect(result).toEqual({ id: '1', name: 'John' })
      })

      it('THROWS on a non-unique where (caller-shape error, not a silent null)', async () => {
        mockPrisma.user.findFirst.mockResolvedValue({ id: '1', name: 'John' })

        const context = await getContext(config, mockPrisma, null)

        // `name` is not a unique key — this is misuse and must throw, not return null.
        await expect(context.db.user.findUnique({ where: { name: 'John' } })).rejects.toThrow(
          /requires a unique `where`/,
        )
        // The error guides the caller toward findFirst (the non-unique escape hatch).
        await expect(context.db.user.findUnique({ where: { name: 'John' } })).rejects.toThrow(
          /findFirst/,
        )
        // Guard runs before any DB access.
        expect(mockPrisma.user.findFirst).not.toHaveBeenCalled()
      })

      it('THROWS when a unique key is mixed with extra non-unique keys', async () => {
        const context = await getContext(config, mockPrisma, null)

        await expect(
          context.db.user.findUnique({ where: { id: '1', name: 'John' } }),
        ).rejects.toThrow(/requires a unique `where`/)
        expect(mockPrisma.user.findFirst).not.toHaveBeenCalled()
      })

      it('THROWS on an empty where', async () => {
        const context = await getContext(config, mockPrisma, null)

        await expect(context.db.user.findUnique({ where: {} })).rejects.toThrow(
          /requires a unique `where`/,
        )
        expect(mockPrisma.user.findFirst).not.toHaveBeenCalled()
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
        mockPrisma.user.findFirst.mockResolvedValue({ id: '1', name: 'John' })

        const context = await getContext(deniedConfig, mockPrisma, null)
        const result = await context.db.user.findUnique({ where: { id: '1' } })

        // Access denied -> null (not a throw), and the DB is never queried.
        expect(result).toBeNull()
        expect(mockPrisma.user.findFirst).not.toHaveBeenCalled()
      })

      it('returns null when no record matches a valid unique where', async () => {
        mockPrisma.user.findFirst.mockResolvedValue(null)

        const context = await getContext(config, mockPrisma, null)
        const result = await context.db.user.findUnique({ where: { id: 'missing' } })

        expect(result).toBeNull()
        expect(mockPrisma.user.findFirst).toHaveBeenCalled()
      })
    })

    it('should delegate findMany to prisma with access control', async () => {
      const mockUsers = [
        { id: '1', name: 'John' },
        { id: '2', name: 'Jane' },
      ]
      mockPrisma.user.findMany.mockResolvedValue(mockUsers)

      const context = await getContext(config, mockPrisma, null)
      const result = await context.db.user.findMany()

      expect(mockPrisma.user.findMany).toHaveBeenCalled()
      expect(result).toEqual(mockUsers)
    })

    describe('findFirst', () => {
      it('should return the first matching row', async () => {
        const mockUsers = [
          { id: '1', name: 'John', email: 'john@example.com' },
          { id: '2', name: 'Jane', email: 'jane@example.com' },
        ]
        mockPrisma.user.findMany.mockResolvedValue(mockUsers)

        const context = await getContext(config, mockPrisma, null)
        const result = await context.db.user.findFirst()

        // Delegates to the access-controlled findMany with take: 1
        expect(mockPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1 }))
        expect(result).toEqual(mockUsers[0])
      })

      it('should return null (not undefined, not throw) when nothing matches', async () => {
        mockPrisma.user.findMany.mockResolvedValue([])

        const context = await getContext(config, mockPrisma, null)
        const result = await context.db.user.findFirst({ where: { name: 'Nobody' } })

        expect(result).toBeNull()
        expect(result).not.toBeUndefined()
      })

      it('should respect where and orderBy', async () => {
        const mockUser = { id: '2', name: 'Jane', email: 'jane@example.com' }
        mockPrisma.user.findMany.mockResolvedValue([mockUser])

        const context = await getContext(config, mockPrisma, null)
        const result = await context.db.user.findFirst({
          where: { name: 'Jane' },
          orderBy: { name: 'asc' },
        })

        expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
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
        mockPrisma.user.findMany.mockResolvedValue([
          { id: '1', name: 'John', email: 'john@example.com' },
        ])

        const context = await getContext(deniedConfig, mockPrisma, null)
        const result = await context.db.user.findFirst()

        // Denied query short-circuits before hitting prisma — exactly like findMany
        expect(result).toBeNull()
        expect(mockPrisma.user.findMany).not.toHaveBeenCalled()
      })

      it('should respect a query fragment, narrowing the returned single result', async () => {
        const mockUsers = [
          { id: '1', name: 'John', email: 'john@example.com' },
          { id: '2', name: 'Jane', email: 'jane@example.com' },
        ]
        mockPrisma.user.findMany.mockResolvedValue(mockUsers)

        const fragment = defineFragment<{ id: string; name: string; email: string }>()({
          id: true,
          name: true,
        } as const)

        const context = await getContext(config, mockPrisma, null)
        const result = await context.db.user.findFirst({ query: fragment })

        // Fragment narrows the result to only the requested fields (email omitted)
        expect(result).toEqual({ id: '1', name: 'John' })
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
          author: {
            findFirst: vi.fn(),
            findUnique: vi.fn(),
            findMany: vi.fn(),
          },
          post: {
            findFirst: vi.fn(),
            findUnique: vi.fn(),
            findMany: vi.fn(),
          },
          comment: {
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
        relPrisma.author.findMany.mockResolvedValue([{ id: 'a1', name: 'Jo', posts: [] }])

        const context = await getContext(relConfig, relPrisma, null)
        await context.db.author.findMany({ include: { posts: true } })

        // The relation is fetched WITH the Post query-access where (NOT bare true),
        // proving the row-level bypass is closed.
        const call = relPrisma.author.findMany.mock.calls[0][0]
        expect(call.include.posts).not.toBe(true)
        expect(call.include.posts.where).toEqual({ status: { equals: 'published' } })
      })

      it('findUnique: caller include {posts:true} applies the relation access where', async () => {
        relPrisma.author.findFirst.mockResolvedValue({ id: 'a1', name: 'Jo', posts: [] })

        const context = await getContext(relConfig, relPrisma, null)
        await context.db.author.findUnique({ where: { id: 'a1' }, include: { posts: true } })

        const call = relPrisma.author.findFirst.mock.calls[0][0]
        expect(call.where).toEqual(expect.objectContaining({ id: 'a1' }))
        expect(call.include.posts).not.toBe(true)
        expect(call.include.posts.where).toEqual({ status: { equals: 'published' } })
      })

      it('drops a relation whose query access is false when named in the caller include', async () => {
        relPrisma.author.findMany.mockResolvedValue([{ id: 'a1', name: 'Jo' }])

        const context = await getContext(relConfig, relPrisma, null)
        await context.db.author.findMany({ include: { secrets: true, posts: true } })

        const call = relPrisma.author.findMany.mock.calls[0][0]
        // Denied `secrets` relation is dropped; allowed `posts` keeps its filter.
        expect(call.include.secrets).toBeUndefined()
        expect(call.include.posts.where).toEqual({ status: { equals: 'published' } })
      })

      it('AND-combines a caller nested where with the relation access where', async () => {
        relPrisma.author.findMany.mockResolvedValue([{ id: 'a1', name: 'Jo', posts: [] }])

        const context = await getContext(relConfig, relPrisma, null)
        await context.db.author.findMany({
          include: { posts: { where: { title: { contains: 'hello' } } } },
        })

        const call = relPrisma.author.findMany.mock.calls[0][0]
        // Both the access where and the caller where are applied via AND.
        expect(call.include.posts.where).toEqual({
          AND: [{ status: { equals: 'published' } }, { title: { contains: 'hello' } }],
        })
      })

      it('access-filters nested (2-level) caller includes at every level', async () => {
        relPrisma.author.findMany.mockResolvedValue([{ id: 'a1', name: 'Jo', posts: [] }])

        const context = await getContext(relConfig, relPrisma, null)
        await context.db.author.findMany({
          include: { posts: { include: { comments: true } } },
        })

        const call = relPrisma.author.findMany.mock.calls[0][0]
        // Level 1 (posts) and level 2 (comments) both carry their access where.
        expect(call.include.posts.where).toEqual({ status: { equals: 'published' } })
        expect(call.include.posts.include.comments.where).toEqual({ approved: { equals: true } })
      })

      it('sudo with explicit include returns the include unfiltered (behaviour preserved)', async () => {
        relPrisma.author.findMany.mockResolvedValue([{ id: 'a1', name: 'Jo' }])

        const context = await getContext(relConfig, relPrisma, null).sudo()
        await context.db.author.findMany({ include: { posts: true, secrets: true } })

        // Under sudo the caller include is used as-is: no filter, nothing dropped.
        expect(relPrisma.author.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ include: { posts: true, secrets: true } }),
        )
      })

      it('query fragment path is unaffected by the merge (fragment include used, unfiltered)', async () => {
        relPrisma.author.findMany.mockResolvedValue([{ id: 'a1', name: 'Jo', posts: [] }])

        const postsFragment = defineFragment<{ id: string; title: string }>()({
          title: true,
        } as const)
        const fragment = defineFragment<{ id: string; name: string; posts: unknown }>()({
          id: true,
          name: true,
          posts: postsFragment,
        } as const)

        const context = await getContext(relConfig, relPrisma, null)
        await context.db.author.findMany({ query: fragment })

        const call = relPrisma.author.findMany.mock.calls[0][0]
        // Fragment-built include is used as-is; the merge helper is NOT applied to
        // the fragment path, so the relation carries no access `where` here. (The
        // fragment posts-selection contains only scalars, so it builds to `true`.)
        expect(call.include).toEqual({ posts: true })
      })

      // Regression: when buildIncludeWithAccessControl returns `undefined` (a
      // NON-denial outcome), the caller include must PASS THROUGH unchanged
      // rather than every declared relation being silently dropped. The original
      // #566 merge treated `undefined` as "all relations denied" (fail-closed
      // data loss). `undefined` is returned in three non-denial cases:
      //   1. inside a resolveOutput hook / virtual-field context,
      //   2. at MAX_DEPTH,
      //   3. when a list has no relationships.
      describe('passes caller include through when no access include is computed', () => {
        // Build an Author config with a virtual field whose resolveOutput issues a
        // read WITH an explicit include. While that hook runs,
        // _resolveOutputCounter.depth > 0, so buildIncludeWithAccessControl
        // returns undefined for the inner read — exercising the
        // `accessControlledInclude === undefined` passthrough path.
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
                        await context.db.comment.findMany({ include: callerInclude })
                        capture(relPrisma.comment.findMany.mock.calls[0][0].include)
                        return 'summary'
                      },
                    },
                  }),
                },
              },
            },
          }
        }

        it('findUnique inside a resolveOutput hook keeps the caller include (not dropped)', async () => {
          let innerIncludeSeen: unknown
          const hookConfig = configWithResolveOutputProbe({ post: true }, (include) => {
            innerIncludeSeen = include
          })

          relPrisma.author.findFirst.mockResolvedValue({ id: 'a1', name: 'Jo' })
          relPrisma.comment.findMany.mockResolvedValue([{ id: 'c1', body: 'hi', post: null }])

          const context = await getContext(hookConfig, relPrisma, null)
          await context.db.author.findUnique({ where: { id: 'a1' } })

          // The caller include `{ post: true }` survives: the declared `post`
          // relation is NOT dropped despite the access include being undefined here.
          expect(innerIncludeSeen).toEqual({ post: true })
        })

        it('findMany inside a resolveOutput hook passes a NESTED caller include through whole', async () => {
          let innerIncludeSeen: unknown
          const hookConfig = configWithResolveOutputProbe(
            { post: { include: { author: true } } },
            (include) => {
              innerIncludeSeen = include
            },
          )

          relPrisma.author.findMany.mockResolvedValue([{ id: 'a1', name: 'Jo' }])
          relPrisma.comment.findMany.mockResolvedValue([{ id: 'c1', body: 'hi', post: null }])

          const context = await getContext(hookConfig, relPrisma, null)
          await context.db.author.findMany()

          // The whole nested caller include passes through untouched (no access
          // include exists to merge against in resolveOutput context).
          expect(innerIncludeSeen).toEqual({ post: { include: { author: true } } })
        })

        // The MAX_DEPTH and no-relationships cases also make
        // buildIncludeWithAccessControl return undefined; they flow through the
        // identical `accessControlledInclude === undefined` branch verified above,
        // so the resolveOutput probe covers all three non-denial cases.
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
          relPrisma.author.findMany.mockResolvedValue([{ id: 'a1', name: 'Jo', posts: [] }])

          const context = await getContext(vConfig, relPrisma, null)
          const result = await context.db.author.findMany({
            include: { displayName: true, posts: true },
          })

          const call = relPrisma.author.findMany.mock.calls[0][0]
          expect(call.include).not.toHaveProperty('displayName')
          expect(call.include.posts).toBeDefined()
          expect(result[0].displayName).toBe('Author: Jo')
        })

        it('findUnique: strips the virtual key from the Prisma include but keeps the real relationship include, and computes the virtual value', async () => {
          const vConfig = configWithVirtualDisplayName()
          relPrisma.author.findFirst.mockResolvedValue({ id: 'a1', name: 'Jo', posts: [] })

          const context = await getContext(vConfig, relPrisma, null)
          const result = await context.db.author.findUnique({
            where: { id: 'a1' },
            include: { displayName: true, posts: true },
          })

          const call = relPrisma.author.findFirst.mock.calls[0][0]
          expect(call.include).not.toHaveProperty('displayName')
          expect(call.include.posts).toBeDefined()
          expect(result.displayName).toBe('Author: Jo')
        })

        it('the virtual value is populated even when omitted from include', async () => {
          const vConfig = configWithVirtualDisplayName()
          relPrisma.author.findFirst.mockResolvedValue({ id: 'a1', name: 'Jo' })

          const context = await getContext(vConfig, relPrisma, null)
          const result = await context.db.author.findUnique({ where: { id: 'a1' } })

          expect(result.displayName).toBe('Author: Jo')
        })

        it('sudo: the virtual key is stripped from the Prisma include even though it bypasses access control', async () => {
          const vConfig = configWithVirtualDisplayName()
          relPrisma.author.findMany.mockResolvedValue([{ id: 'a1', name: 'Jo' }])

          const context = await getContext(vConfig, relPrisma, null).sudo()
          const result = await context.db.author.findMany({
            include: { displayName: true, posts: true },
          })

          const call = relPrisma.author.findMany.mock.calls[0][0]
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
          relPrisma.author.findFirst.mockResolvedValue({ id: 'a1', name: 'Jo' })

          const context = await getContext(vConfig, relPrisma, null)
          const result = await context.db.author.findUnique({
            where: { id: 'a1' },
            include: { displayName: true },
          })

          expect(result).not.toHaveProperty('displayName')
        })
      })
    })

    it('should delegate create to prisma with access control and hooks', async () => {
      const mockUser = { id: '1', name: 'John', email: 'john@example.com' }
      mockPrisma.user.create.mockResolvedValue(mockUser)

      const context = await getContext(config, mockPrisma, null)
      const result = await context.db.user.create({
        data: { name: 'John', email: 'john@example.com' },
      })

      expect(mockPrisma.user.create).toHaveBeenCalled()
      expect(result).toEqual(mockUser)
    })

    it('should delegate update to prisma with access control and hooks', async () => {
      const existingUser = { id: '1', name: 'John', email: 'john@example.com' }
      const updatedUser = { id: '1', name: 'John Updated', email: 'john@example.com' }
      mockPrisma.user.findUnique.mockResolvedValue(existingUser)
      mockPrisma.user.update.mockResolvedValue(updatedUser)

      const context = await getContext(config, mockPrisma, null)
      const result = await context.db.user.update({
        where: { id: '1' },
        data: { name: 'John Updated' },
      })

      expect(mockPrisma.user.update).toHaveBeenCalled()
      expect(result).toEqual(updatedUser)
    })

    it('should delegate delete to prisma with access control and hooks', async () => {
      const mockUser = { id: '1', name: 'John', email: 'john@example.com' }
      mockPrisma.user.findUnique.mockResolvedValue(mockUser)
      mockPrisma.user.delete.mockResolvedValue(mockUser)

      const context = await getContext(config, mockPrisma, null)
      const result = await context.db.user.delete({ where: { id: '1' } })

      expect(mockPrisma.user.delete).toHaveBeenCalled()
      expect(result).toEqual(mockUser)
    })

    it('should delegate count to prisma with access control', async () => {
      mockPrisma.user.count.mockResolvedValue(5)

      const context = await getContext(config, mockPrisma, null)
      const result = await context.db.user.count()

      expect(mockPrisma.user.count).toHaveBeenCalled()
      expect(result).toBe(5)
    })

    it('should batch create items via createMany', async () => {
      const mockUsers = [
        { id: '1', name: 'John', email: 'john@example.com' },
        { id: '2', name: 'Jane', email: 'jane@example.com' },
        { id: '3', name: 'Bob', email: 'bob@example.com' },
      ]

      // Mock create to return each user in sequence
      mockPrisma.user.create
        .mockResolvedValueOnce(mockUsers[0])
        .mockResolvedValueOnce(mockUsers[1])
        .mockResolvedValueOnce(mockUsers[2])

      const context = await getContext(config, mockPrisma, null)
      const result = await context.db.user.createMany({
        data: [
          { name: 'John', email: 'john@example.com' },
          { name: 'Jane', email: 'jane@example.com' },
          { name: 'Bob', email: 'bob@example.com' },
        ],
      })

      // Should call create 3 times (once for each item)
      expect(mockPrisma.user.create).toHaveBeenCalledTimes(3)
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
      mockPrisma.user.findMany.mockResolvedValue(mockUsers)

      // Mock findUnique for each update's access check
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(mockUsers[0])
        .mockResolvedValueOnce(mockUsers[1])

      // Mock update to return updated users
      mockPrisma.user.update
        .mockResolvedValueOnce(updatedUsers[0])
        .mockResolvedValueOnce(updatedUsers[1])

      const context = await getContext(config, mockPrisma, null)
      const result = await context.db.user.updateMany({
        where: { id: { in: ['1', '2'] } },
        data: { name: 'Updated' },
      })

      // Should call findMany once to get records
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['1', '2'] } },
        take: undefined,
        skip: undefined,
        include: undefined,
      })

      // Should call update twice (once for each item)
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(2)
      expect(result).toEqual(updatedUsers)
    })

    it('should run hooks and access control for each item in createMany', async () => {
      // Test that hooks are called for each item
      const mockUsers = [
        { id: '1', name: 'John', email: 'john@example.com' },
        { id: '2', name: 'Jane', email: 'jane@example.com' },
      ]

      mockPrisma.user.create.mockResolvedValueOnce(mockUsers[0]).mockResolvedValueOnce(mockUsers[1])

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
      await context.db.user.createMany({
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

      mockPrisma.user.findMany.mockResolvedValue(mockUsers)
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(mockUsers[0])
        .mockResolvedValueOnce(mockUsers[1])
      mockPrisma.user.update
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
      await context.db.user.updateMany({
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
      mockPrisma.user.findFirst.mockResolvedValue(mockUser)

      const context = await freshGetContext(config, mockPrisma, null)
      const result = await context.db.user.findUnique({
        where: { id: '1' },
        select: { name: true },
      })

      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls[0][0]).toContain('`select` is ignored')
      expect(warnSpy.mock.calls[0][0]).toContain('findUnique')
      // Behaviour unchanged: the op still runs and returns the full row.
      expect(mockPrisma.user.findFirst).toHaveBeenCalled()
      expect(result).toEqual(mockUser)
    })

    it('warns AND still returns the rows when findMany is passed a select', async () => {
      const mockUsers = [
        { id: '1', name: 'John' },
        { id: '2', name: 'Jane' },
      ]
      mockPrisma.user.findMany.mockResolvedValue(mockUsers)

      const context = await freshGetContext(config, mockPrisma, null)
      const result = await context.db.user.findMany({ select: { name: true } })

      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls[0][0]).toContain('`select` is ignored')
      expect(warnSpy.mock.calls[0][0]).toContain('findMany')
      expect(mockPrisma.user.findMany).toHaveBeenCalled()
      expect(result).toEqual(mockUsers)
    })

    it('warns only once per list+operation across repeated calls', async () => {
      mockPrisma.user.findMany.mockResolvedValue([])

      const context = await freshGetContext(config, mockPrisma, null)
      await context.db.user.findMany({ select: { name: true } })
      await context.db.user.findMany({ select: { name: true } })
      await context.db.user.findMany({ select: { email: true } })

      expect(warnSpy).toHaveBeenCalledTimes(1)
    })

    it('does NOT warn for findUnique/findMany using only include or query', async () => {
      const mockUser = { id: '1', name: 'John' }
      mockPrisma.user.findFirst.mockResolvedValue(mockUser)
      mockPrisma.user.findMany.mockResolvedValue([mockUser])

      const context = await freshGetContext(config, mockPrisma, null)
      await context.db.user.findUnique({ where: { id: '1' }, include: { posts: true } })
      await context.db.user.findMany({ include: { posts: true } })
      await context.db.user.findMany()

      expect(warnSpy).not.toHaveBeenCalled()
    })
  })
})
