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
      expect(result).toEqual(mockCreatedUser)
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
      expect(result).toEqual(mockUpdatedUser)
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
      expect(result).toEqual(mockDeletedUser)
    })

    it('should convert listKey to lowercase for db operations', async () => {
      const mockCreatedPost = { id: '1', title: 'Test Post' }
      mockPrisma.post.create.mockResolvedValue(mockCreatedPost)

      const context = await getContext(config, mockPrisma, null)
      await context.serverAction({
        listKey: 'Post',
        action: 'create',
        data: { title: 'Test Post' },
      })

      expect(mockPrisma.post.create).toHaveBeenCalled()
    })

    it('should return null for unknown action', async () => {
      const context = await getContext(config, mockPrisma, null)
      const result = await context.serverAction({
        listKey: 'User',
        action: 'unknown' as unknown as 'create',
        data: {},
      })

      expect(result).toBeNull()
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
  })
})
