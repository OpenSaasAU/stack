import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getContext } from '../src/context/index.js'
import { defineFragment } from '../src/query/index.js'
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
