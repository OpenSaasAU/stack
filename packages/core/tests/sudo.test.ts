import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getContext } from '../src/context/index.js'
import { config, list } from '../src/config/index.js'
import { text, integer } from '../src/fields/index.js'
import type { PrismaClient } from '@prisma/client'

describe('Sudo Context', () => {
  // Mock Prisma client
  const mockPrisma = {
    post: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
  } as unknown as PrismaClient

  // Track hook execution
  const hookExecutions: string[] = []

  const testConfig = config({
    db: {
      provider: 'sqlite',
    },
    lists: {
      Post: list({
        fields: {
          title: text({
            validation: { isRequired: true },
            hooks: {
              resolveInput: async ({ inputValue }) => {
                hookExecutions.push('field-resolveInput')
                return inputValue
              },
              beforeOperation: async () => {
                hookExecutions.push('field-beforeOperation')
              },
              afterOperation: async () => {
                hookExecutions.push('field-afterOperation')
              },
            },
          }),
          secretField: text({
            access: {
              read: async () => false,
              create: async () => false,
              update: async () => false,
            },
          }),
          views: integer({ defaultValue: 0 }),
        },
        access: {
          operation: {
            query: async () => false,
            create: async () => false,
            update: async () => false,
            delete: async () => false,
          },
        },
        hooks: {
          resolveInput: async ({ resolvedData }) => {
            hookExecutions.push('list-resolveInput')
            return resolvedData
          },
          validateInput: async () => {
            hookExecutions.push('list-validateInput')
          },
          beforeOperation: async () => {
            hookExecutions.push('list-beforeOperation')
          },
          afterOperation: async () => {
            hookExecutions.push('list-afterOperation')
          },
        },
      }),
    },
  })

  beforeEach(() => {
    vi.clearAllMocks()
    hookExecutions.length = 0
  })

  describe('Query Operations', () => {
    it('should bypass operation-level access control with sudo()', async () => {
      const context = getContext(testConfig, mockPrisma, null)
      const sudoContext = context.sudo()

      mockPrisma.post.findMany.mockResolvedValue([{ id: '1', title: 'Test Post' }])

      // Regular context should return empty array (access denied)
      const regularResult = await context.db.post.findMany()
      expect(regularResult).toEqual([])

      // Sudo context should return results
      const sudoResult = await sudoContext.db.post.findMany()
      expect(sudoResult).toHaveLength(1)
      expect(sudoResult[0].title).toBe('Test Post')
    })

    it('should bypass field-level read access control with sudo()', async () => {
      const context = getContext(testConfig, mockPrisma, null)
      const sudoContext = context.sudo()

      mockPrisma.post.findFirst.mockResolvedValue({
        id: '1',
        title: 'Test Post',
        secretField: 'secret-value',
        views: 10,
      })

      // Sudo context should return all fields including secretField
      const sudoResult = await sudoContext.db.post.findUnique({ where: { id: '1' } })
      expect(sudoResult?.secretField).toBe('secret-value')
    })

    it('should execute field afterOperation hooks with sudo()', async () => {
      const context = getContext(testConfig, mockPrisma, null)
      const sudoContext = context.sudo()

      mockPrisma.post.findMany.mockResolvedValue([{ id: '1', title: 'Test Post' }])

      await sudoContext.db.post.findMany()

      expect(hookExecutions).toContain('field-afterOperation')
    })
  })

  describe('Create Operations', () => {
    it('should bypass operation-level access control with sudo()', async () => {
      const context = getContext(testConfig, mockPrisma, null)
      const sudoContext = context.sudo()

      const mockPost = { id: '1', title: 'New Post', views: 0 }
      mockPrisma.post.create.mockResolvedValue(mockPost)

      // Regular context should return null (access denied)
      const regularResult = await context.db.post.create({
        data: { title: 'New Post' },
      })
      expect(regularResult).toBeNull()

      // Sudo context should create successfully
      hookExecutions.length = 0
      const sudoResult = await sudoContext.db.post.create({
        data: { title: 'New Post' },
      })
      expect(sudoResult).toMatchObject({ title: 'New Post' })
      expect(mockPrisma.post.create).toHaveBeenCalledWith({
        data: { title: 'New Post' },
      })
    })

    it('should bypass field-level write access control with sudo()', async () => {
      const context = getContext(testConfig, mockPrisma, null)
      const sudoContext = context.sudo()

      const mockPost = { id: '1', title: 'New Post', secretField: 'secret', views: 0 }
      mockPrisma.post.create.mockResolvedValue(mockPost)

      // Sudo context should allow writing to secretField
      await sudoContext.db.post.create({
        data: { title: 'New Post', secretField: 'secret' },
      })

      // Verify that secretField was passed to Prisma
      expect(mockPrisma.post.create).toHaveBeenCalledWith({
        data: { title: 'New Post', secretField: 'secret' },
      })
    })

    it('should execute all hooks with sudo()', async () => {
      const context = getContext(testConfig, mockPrisma, null)
      const sudoContext = context.sudo()

      const mockPost = { id: '1', title: 'New Post', views: 0 }
      mockPrisma.post.create.mockResolvedValue(mockPost)

      await sudoContext.db.post.create({
        data: { title: 'New Post' },
      })

      // Verify all hooks were executed
      expect(hookExecutions).toContain('list-resolveInput')
      expect(hookExecutions).toContain('field-resolveInput')
      expect(hookExecutions).toContain('list-validateInput')
      expect(hookExecutions).toContain('field-beforeOperation')
      expect(hookExecutions).toContain('list-beforeOperation')
      expect(hookExecutions).toContain('list-afterOperation')
      expect(hookExecutions).toContain('field-afterOperation')
    })

    it('should still validate required fields with sudo()', async () => {
      const context = getContext(testConfig, mockPrisma, null)
      const sudoContext = context.sudo()

      // Should throw validation error for missing required field
      await expect(
        sudoContext.db.post.create({
          data: { views: 10 },
        }),
      ).rejects.toThrow('Title must be text')
    })
  })

  describe('Update Operations', () => {
    it('should bypass operation-level access control with sudo()', async () => {
      const context = getContext(testConfig, mockPrisma, null)
      const sudoContext = context.sudo()

      const existingPost = { id: '1', title: 'Old Title', views: 5 }
      const updatedPost = { id: '1', title: 'New Title', views: 5 }

      mockPrisma.post.findUnique.mockResolvedValue(existingPost)
      mockPrisma.post.findFirst.mockResolvedValue(null)
      mockPrisma.post.update.mockResolvedValue(updatedPost)

      // Regular context should return null (access denied)
      const regularResult = await context.db.post.update({
        where: { id: '1' },
        data: { title: 'New Title' },
      })
      expect(regularResult).toBeNull()

      // Reset mocks
      mockPrisma.post.findUnique.mockResolvedValue(existingPost)
      hookExecutions.length = 0

      // Sudo context should update successfully
      const sudoResult = await sudoContext.db.post.update({
        where: { id: '1' },
        data: { title: 'New Title' },
      })
      expect(sudoResult).toMatchObject({ title: 'New Title' })
    })

    it('should bypass field-level write access control with sudo()', async () => {
      const context = getContext(testConfig, mockPrisma, null)
      const sudoContext = context.sudo()

      const existingPost = { id: '1', title: 'Old Title', secretField: 'old-secret', views: 5 }
      const updatedPost = { id: '1', title: 'Old Title', secretField: 'new-secret', views: 5 }

      mockPrisma.post.findUnique.mockResolvedValue(existingPost)
      mockPrisma.post.update.mockResolvedValue(updatedPost)

      // Sudo context should allow updating secretField
      await sudoContext.db.post.update({
        where: { id: '1' },
        data: { secretField: 'new-secret' },
      })

      // Verify that secretField was passed to Prisma
      expect(mockPrisma.post.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { secretField: 'new-secret' },
      })
    })

    it('should execute all hooks with sudo()', async () => {
      const context = getContext(testConfig, mockPrisma, null)
      const sudoContext = context.sudo()

      const existingPost = { id: '1', title: 'Old Title', views: 5 }
      const updatedPost = { id: '1', title: 'New Title', views: 5 }

      mockPrisma.post.findUnique.mockResolvedValue(existingPost)
      mockPrisma.post.update.mockResolvedValue(updatedPost)

      await sudoContext.db.post.update({
        where: { id: '1' },
        data: { title: 'New Title' },
      })

      // Verify all hooks were executed
      expect(hookExecutions).toContain('list-resolveInput')
      expect(hookExecutions).toContain('field-resolveInput')
      expect(hookExecutions).toContain('list-validateInput')
      expect(hookExecutions).toContain('field-beforeOperation')
      expect(hookExecutions).toContain('list-beforeOperation')
      expect(hookExecutions).toContain('list-afterOperation')
      expect(hookExecutions).toContain('field-afterOperation')
    })
  })

  describe('Delete Operations', () => {
    it('should bypass operation-level access control with sudo()', async () => {
      const context = getContext(testConfig, mockPrisma, null)
      const sudoContext = context.sudo()

      const existingPost = { id: '1', title: 'Post to Delete', views: 5 }

      mockPrisma.post.findUnique.mockResolvedValue(existingPost)
      mockPrisma.post.findFirst.mockResolvedValue(null)
      mockPrisma.post.delete.mockResolvedValue(existingPost)

      // Regular context should return null (access denied)
      const regularResult = await context.db.post.delete({
        where: { id: '1' },
      })
      expect(regularResult).toBeNull()

      // Reset mocks
      mockPrisma.post.findUnique.mockResolvedValue(existingPost)
      hookExecutions.length = 0

      // Sudo context should delete successfully
      const sudoResult = await sudoContext.db.post.delete({
        where: { id: '1' },
      })
      expect(sudoResult).toMatchObject({ title: 'Post to Delete' })
    })

    it('should execute all hooks with sudo()', async () => {
      const context = getContext(testConfig, mockPrisma, null)
      const sudoContext = context.sudo()

      const existingPost = { id: '1', title: 'Post to Delete', views: 5 }

      mockPrisma.post.findUnique.mockResolvedValue(existingPost)
      mockPrisma.post.delete.mockResolvedValue(existingPost)

      await sudoContext.db.post.delete({
        where: { id: '1' },
      })

      // Verify hooks were executed
      expect(hookExecutions).toContain('field-beforeOperation')
      expect(hookExecutions).toContain('list-beforeOperation')
      expect(hookExecutions).toContain('list-afterOperation')
      expect(hookExecutions).toContain('field-afterOperation')
    })
  })

  describe('Count Operations', () => {
    it('should bypass operation-level access control with sudo()', async () => {
      const context = getContext(testConfig, mockPrisma, null)
      const sudoContext = context.sudo()

      mockPrisma.post.count.mockResolvedValue(10)

      // Regular context should return 0 (access denied)
      const regularResult = await context.db.post.count()
      expect(regularResult).toBe(0)

      // Sudo context should return actual count
      const sudoResult = await sudoContext.db.post.count()
      expect(sudoResult).toBe(10)
    })
  })

  describe('Sudo Context Properties', () => {
    it('should maintain the same session object', async () => {
      const session = { userId: 'user-123', role: 'admin' }
      const context = getContext(testConfig, mockPrisma, session)
      const sudoContext = context.sudo()

      expect(sudoContext.session).toEqual(session)
      expect(sudoContext.session).toBe(context.session)
    })

    it('should maintain the same prisma client', async () => {
      const context = getContext(testConfig, mockPrisma, null)
      const sudoContext = context.sudo()

      expect(sudoContext.prisma).toBe(context.prisma)
    })

    it('should maintain the same storage utilities', async () => {
      const context = getContext(testConfig, mockPrisma, null)
      const sudoContext = context.sudo()

      expect(sudoContext.storage).toBe(context.storage)
    })

    it('should allow chaining sudo() calls', async () => {
      const context = getContext(testConfig, mockPrisma, null)
      const sudoContext1 = context.sudo()
      const sudoContext2 = sudoContext1.sudo()

      mockPrisma.post.findMany.mockResolvedValue([{ id: '1', title: 'Test Post' }])

      const result = await sudoContext2.db.post.findMany()
      expect(result).toHaveLength(1)
    })

    it('should create independent contexts', async () => {
      const context = getContext(testConfig, mockPrisma, null)
      const sudoContext = context.sudo()

      mockPrisma.post.findMany.mockResolvedValue([{ id: '1', title: 'Test Post' }])

      // Regular context still denies access
      const regularResult = await context.db.post.findMany()
      expect(regularResult).toEqual([])

      // Sudo context allows access
      const sudoResult = await sudoContext.db.post.findMany()
      expect(sudoResult).toHaveLength(1)
    })
  })
})
