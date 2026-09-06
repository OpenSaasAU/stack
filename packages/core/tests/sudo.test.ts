import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getContext } from '../src/context/index.js'
import { config, list } from '../src/config/index.js'
import { text, integer, relationship } from '../src/fields/index.js'
import type { Plugin } from '../src/config/types.js'
import type { AccessContext } from '../src/access/types.js'

describe('Sudo Context', () => {
  // Mock Prisma client
  const mockPrisma = {
    Post: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
  }

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
              resolveInput: async ({ resolvedData, fieldKey }) => {
                hookExecutions.push('field-resolveInput')
                return resolvedData[fieldKey]
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

      mockPrisma.Post.findMany.mockResolvedValue([{ id: '1', title: 'Test Post' }])

      // Regular context should return empty array (access denied)
      const regularResult = await context.db.Post.findMany()
      expect(regularResult).toEqual([])

      // Sudo context should return results
      const sudoResult = await sudoContext.db.Post.findMany()
      expect(sudoResult).toHaveLength(1)
      expect(sudoResult[0].title).toBe('Test Post')
    })

    it('should bypass field-level read access control with sudo()', async () => {
      const context = getContext(testConfig, mockPrisma, null)
      const sudoContext = context.sudo()

      mockPrisma.Post.findFirst.mockResolvedValue({
        id: '1',
        title: 'Test Post',
        secretField: 'secret-value',
        views: 10,
      })

      // Sudo context should return all fields including secretField
      const sudoResult = await sudoContext.db.Post.findUnique({ where: { id: '1' } })
      expect(sudoResult?.secretField).toBe('secret-value')
    })
  })

  describe('Create Operations', () => {
    it('should bypass operation-level access control with sudo()', async () => {
      const context = getContext(testConfig, mockPrisma, null)
      const sudoContext = context.sudo()

      const mockPost = { id: '1', title: 'New Post', views: 0 }
      mockPrisma.Post.create.mockResolvedValue(mockPost)

      // Regular context should return null (access denied)
      const regularResult = await context.db.Post.create({
        data: { title: 'New Post' },
      })
      expect(regularResult).toBeNull()

      // Sudo context should create successfully
      hookExecutions.length = 0
      const sudoResult = await sudoContext.db.Post.create({
        data: { title: 'New Post' },
      })
      expect(sudoResult).toMatchObject({ title: 'New Post' })
      // `views` declares `defaultValue: 0`, so the omitted value is resolved to
      // its default before persistence (#615 resolve-then-validate).
      expect(mockPrisma.Post.create).toHaveBeenCalledWith({
        data: { title: 'New Post', views: 0 },
      })
    })

    it('should bypass field-level write access control with sudo()', async () => {
      const context = getContext(testConfig, mockPrisma, null)
      const sudoContext = context.sudo()

      const mockPost = { id: '1', title: 'New Post', secretField: 'secret', views: 0 }
      mockPrisma.Post.create.mockResolvedValue(mockPost)

      // Sudo context should allow writing to secretField
      await sudoContext.db.Post.create({
        data: { title: 'New Post', secretField: 'secret' },
      })

      // Verify that secretField was passed to Prisma. `views` declares
      // `defaultValue: 0`, so the omitted value is resolved to its default
      // before persistence (#615 resolve-then-validate).
      expect(mockPrisma.Post.create).toHaveBeenCalledWith({
        data: { title: 'New Post', secretField: 'secret', views: 0 },
      })
    })

    it('should execute all hooks with sudo()', async () => {
      const context = getContext(testConfig, mockPrisma, null)
      const sudoContext = context.sudo()

      const mockPost = { id: '1', title: 'New Post', views: 0 }
      mockPrisma.Post.create.mockResolvedValue(mockPost)

      await sudoContext.db.Post.create({
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
        sudoContext.db.Post.create({
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

      mockPrisma.Post.findUnique.mockResolvedValue(existingPost)
      mockPrisma.Post.findFirst.mockResolvedValue(null)
      mockPrisma.Post.update.mockResolvedValue(updatedPost)

      // Regular context should return null (access denied)
      const regularResult = await context.db.Post.update({
        where: { id: '1' },
        data: { title: 'New Title' },
      })
      expect(regularResult).toBeNull()

      // Reset mocks
      mockPrisma.Post.findUnique.mockResolvedValue(existingPost)
      hookExecutions.length = 0

      // Sudo context should update successfully
      const sudoResult = await sudoContext.db.Post.update({
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

      mockPrisma.Post.findUnique.mockResolvedValue(existingPost)
      mockPrisma.Post.update.mockResolvedValue(updatedPost)

      // Sudo context should allow updating secretField
      await sudoContext.db.Post.update({
        where: { id: '1' },
        data: { secretField: 'new-secret' },
      })

      // Verify that secretField was passed to Prisma
      expect(mockPrisma.Post.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { secretField: 'new-secret' },
      })
    })

    it('should execute all hooks with sudo()', async () => {
      const context = getContext(testConfig, mockPrisma, null)
      const sudoContext = context.sudo()

      const existingPost = { id: '1', title: 'Old Title', views: 5 }
      const updatedPost = { id: '1', title: 'New Title', views: 5 }

      mockPrisma.Post.findUnique.mockResolvedValue(existingPost)
      mockPrisma.Post.update.mockResolvedValue(updatedPost)

      await sudoContext.db.Post.update({
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

      mockPrisma.Post.findUnique.mockResolvedValue(existingPost)
      mockPrisma.Post.findFirst.mockResolvedValue(null)
      mockPrisma.Post.delete.mockResolvedValue(existingPost)

      // Regular context should return null (access denied)
      const regularResult = await context.db.Post.delete({
        where: { id: '1' },
      })
      expect(regularResult).toBeNull()

      // Reset mocks
      mockPrisma.Post.findUnique.mockResolvedValue(existingPost)
      hookExecutions.length = 0

      // Sudo context should delete successfully
      const sudoResult = await sudoContext.db.Post.delete({
        where: { id: '1' },
      })
      expect(sudoResult).toMatchObject({ title: 'Post to Delete' })
    })

    it('should execute all hooks with sudo()', async () => {
      const context = getContext(testConfig, mockPrisma, null)
      const sudoContext = context.sudo()

      const existingPost = { id: '1', title: 'Post to Delete', views: 5 }

      mockPrisma.Post.findUnique.mockResolvedValue(existingPost)
      mockPrisma.Post.delete.mockResolvedValue(existingPost)

      await sudoContext.db.Post.delete({
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

      mockPrisma.Post.count.mockResolvedValue(10)

      // Regular context should return 0 (access denied)
      const regularResult = await context.db.Post.count()
      expect(regularResult).toBe(0)

      // Sudo context should return actual count
      const sudoResult = await sudoContext.db.Post.count()
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

    it('should carry the same Unsafe surface shape', async () => {
      const context = getContext(testConfig, mockPrisma, null)
      const sudoContext = context.sudo()

      expect(Object.keys(sudoContext.unsafe).sort()).toEqual(Object.keys(context.unsafe).sort())
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

      mockPrisma.Post.findMany.mockResolvedValue([{ id: '1', title: 'Test Post' }])

      const result = await sudoContext2.db.Post.findMany()
      expect(result).toHaveLength(1)
    })

    it('should create independent contexts', async () => {
      const context = getContext(testConfig, mockPrisma, null)
      const sudoContext = context.sudo()

      mockPrisma.Post.findMany.mockResolvedValue([{ id: '1', title: 'Test Post' }])

      // Regular context still denies access
      const regularResult = await context.db.Post.findMany()
      expect(regularResult).toEqual([])

      // Sudo context allows access
      const sudoResult = await sudoContext.db.Post.findMany()
      expect(sudoResult).toHaveLength(1)
    })
  })

  describe('Nested Operations with Sudo Mode', () => {
    // Mock Prisma client with User and Post models for nested operations
    const mockPrismaWithRelations = {
      User: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      Post: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    }

    const nestedTestConfig = config({
      db: {
        provider: 'sqlite',
      },
      lists: {
        User: list({
          fields: {
            email: text({ validation: { isRequired: true } }),
            name: text(),
            posts: relationship({ ref: 'Post.author', many: true }),
          },
          access: {
            operation: {
              create: async () => false, // Block all creates
              update: async () => false, // Block all updates
            },
          },
        }),
        Post: list({
          fields: {
            title: text({ validation: { isRequired: true } }),
            content: text(),
            author: relationship({ ref: 'User.posts' }),
          },
          access: {
            operation: {
              create: async () => true,
              update: async () => true,
            },
          },
        }),
      },
    })

    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should allow nested create in sudo mode when access control would deny', async () => {
      const context = getContext(nestedTestConfig, mockPrismaWithRelations, null)
      const sudoContext = context.sudo()

      // Mock successful creation
      mockPrismaWithRelations.Post.create.mockResolvedValue({
        id: '1',
        title: 'Test Post',
        content: 'Test Content',
        authorId: 'user-1',
      })

      // In sudo mode, nested create should succeed despite User access control blocking creates
      const result = await sudoContext.db.Post.create({
        data: {
          title: 'Test Post',
          content: 'Test Content',
          author: {
            create: {
              email: 'test@example.com',
              name: 'Test User',
            },
          },
        },
      })

      expect(result).toBeDefined()
      expect(mockPrismaWithRelations.Post.create).toHaveBeenCalled()
    })

    it('should allow nested connect in sudo mode when access control would deny', async () => {
      const context = getContext(nestedTestConfig, mockPrismaWithRelations, null)
      const sudoContext = context.sudo()

      // Mock existing user
      mockPrismaWithRelations.User.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'existing@example.com',
        name: 'Existing User',
      })

      // Mock successful creation
      mockPrismaWithRelations.Post.create.mockResolvedValue({
        id: '1',
        title: 'Test Post',
        content: 'Test Content',
        authorId: 'user-1',
      })

      // In sudo mode, nested connect should succeed despite User access control blocking updates
      const result = await sudoContext.db.Post.create({
        data: {
          title: 'Test Post',
          content: 'Test Content',
          author: {
            connect: { id: 'user-1' },
          },
        },
      })

      expect(result).toBeDefined()
      expect(mockPrismaWithRelations.Post.create).toHaveBeenCalled()
    })

    it('should allow nested update in sudo mode when access control would deny', async () => {
      const context = getContext(nestedTestConfig, mockPrismaWithRelations, null)
      const sudoContext = context.sudo()

      // Mock existing post (needed for access control check in main operation)
      mockPrismaWithRelations.Post.findUnique.mockResolvedValue({
        id: '1',
        title: 'Original Post',
        content: 'Original Content',
        authorId: 'user-1',
      })

      // Mock existing user (for nested update)
      mockPrismaWithRelations.User.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'existing@example.com',
        name: 'Existing User',
      })

      // Mock successful update
      mockPrismaWithRelations.Post.update.mockResolvedValue({
        id: '1',
        title: 'Updated Post',
        content: 'Updated Content',
        authorId: 'user-1',
      })

      // In sudo mode, nested update should succeed despite User access control blocking updates
      const result = await sudoContext.db.Post.update({
        where: { id: '1' },
        data: {
          title: 'Updated Post',
          author: {
            update: {
              where: { id: 'user-1' },
              data: { name: 'Updated Name' },
            },
          },
        },
      })

      expect(result).toBeDefined()
      expect(mockPrismaWithRelations.Post.update).toHaveBeenCalled()
    })

    it('should allow nested connectOrCreate in sudo mode when access control would deny', async () => {
      const context = getContext(nestedTestConfig, mockPrismaWithRelations, null)
      const sudoContext = context.sudo()

      // Mock existing user check (will find existing user)
      mockPrismaWithRelations.User.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'existing@example.com',
        name: 'Existing User',
      })

      // Mock successful creation
      mockPrismaWithRelations.Post.create.mockResolvedValue({
        id: '1',
        title: 'Test Post',
        content: 'Test Content',
        authorId: 'user-1',
      })

      // In sudo mode, nested connectOrCreate should succeed despite access control
      const result = await sudoContext.db.Post.create({
        data: {
          title: 'Test Post',
          content: 'Test Content',
          author: {
            connectOrCreate: {
              where: { id: 'user-1' },
              create: {
                email: 'new@example.com',
                name: 'New User',
              },
            },
          },
        },
      })

      expect(result).toBeDefined()
      expect(mockPrismaWithRelations.Post.create).toHaveBeenCalled()
    })

    it('should still enforce access control in nested operations without sudo mode', async () => {
      const context = getContext(nestedTestConfig, mockPrismaWithRelations, null)

      // Mock existing user
      mockPrismaWithRelations.User.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'existing@example.com',
        name: 'Existing User',
      })

      // Without sudo, nested connect should fail due to User update access control
      await expect(
        context.db.Post.create({
          data: {
            title: 'Test Post',
            content: 'Test Content',
            author: {
              connect: { id: 'user-1' },
            },
          },
        }),
      ).rejects.toThrow('Access denied')
    })
  })

  describe('Plugin runtime sudo access', () => {
    // A plugin's `runtime(context, sudo)` factory receives a `sudo` helper as a
    // plain second argument — NOT a method on `AccessContext` itself. A
    // self-referential `sudo(): AccessContext` field on that shared, widely
    // instantiated interface was found to break TypeScript's structural
    // checking of unrelated generated Prisma types in a downstream app
    // (nullable JSON `CreateInput` fields); passing it as a separate argument
    // avoids that recursion while still giving plugins (e.g. the auth
    // plugin's getUser/getCurrentUser, see ADR-0013) an access-bypassing
    // identity-lookup path.
    it('passes a working sudo() as the second argument to plugin.runtime()', async () => {
      let capturedSudo: (() => AccessContext) | undefined

      const plugin: Plugin = {
        name: 'test-plugin',
        init: async () => {},
        runtime: (_context, sudo) => {
          capturedSudo = sudo as () => AccessContext
          return {}
        },
      }

      const pluginConfig = await config({
        db: { provider: 'sqlite' },
        plugins: [plugin],
        lists: {
          Post: list({
            fields: { title: text({ validation: { isRequired: true } }) },
            // Closed list: only sudo() should be able to read from it.
            access: { operation: { query: () => false } },
          }),
        },
      })

      mockPrisma.Post.findMany.mockResolvedValue([{ id: '1', title: 'Test Post' }])

      getContext(pluginConfig, mockPrisma, null)

      expect(capturedSudo).toBeTypeOf('function')

      const sudoContext = capturedSudo!()
      const sudoResult = await sudoContext.db.Post.findMany()
      expect(sudoResult).toHaveLength(1)
      expect(sudoResult[0].title).toBe('Test Post')
    })
  })
})
