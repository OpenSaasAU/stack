import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getContext } from '../src/context/index.js'
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

      mockPrisma.user.create
        .mockResolvedValueOnce(mockUsers[0])
        .mockResolvedValueOnce(mockUsers[1])

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
})
