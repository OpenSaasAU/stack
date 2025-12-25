import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getContext } from '../src/context/index.js'
import { config, list } from '../src/config/index.js'
import { text, relationship } from '../src/fields/index.js'

/**
 * Mock Prisma Client for testing
 */
function createMockPrisma() {
  const db = {
    post: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    comment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
  }

  return db
}

describe('Nested Operations - Access Control and Hooks', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>

  beforeEach(() => {
    mockPrisma = createMockPrisma()
    vi.clearAllMocks()
  })

  describe('Nested Create Operations', () => {
    it('should run hooks and access control for nested create', async () => {
      const userResolveInputHook = vi.fn(async ({ resolvedData, fieldKey }) => {
        const value = resolvedData[fieldKey]
        return typeof value === 'string' ? value.toUpperCase() : value
      })
      const userListResolveInputHook = vi.fn(async ({ resolvedData }) => resolvedData)
      const userValidateInputHook = vi.fn(async () => {})
      const postResolveInputHook = vi.fn(async ({ resolvedData }) => resolvedData)

      const testConfig = config({
        db: {
          provider: 'postgresql',
          url: 'postgresql://localhost:5432/test',
        },
        lists: {
          User: list({
            fields: {
              name: text({
                hooks: {
                  resolveInput: userResolveInputHook,
                },
              }),
              email: text(),
            },
            access: {
              operation: {
                query: () => true,
                create: () => true,
              },
            },
            hooks: {
              resolveInput: userListResolveInputHook,
              validateInput: userValidateInputHook,
            },
          }),
          Post: list({
            fields: {
              title: text(),
              author: relationship({ ref: 'User.posts' }),
            },
            access: {
              operation: {
                query: () => true,
                update: () => true,
              },
            },
            hooks: {
              resolveInput: postResolveInputHook,
            },
          }),
        },
      })

      // Mock the database to return existing post
      mockPrisma.post.findUnique.mockResolvedValue({
        id: '1',
        title: 'Original Title',
      })

      // Mock the update to return the updated post
      mockPrisma.post.update.mockResolvedValue({
        id: '1',
        title: 'Updated Title',
        authorId: '2',
      })

      const context = await getContext(testConfig, mockPrisma, { userId: '1' })

      await context.db.post.update({
        where: { id: '1' },
        data: {
          title: 'Updated Title',
          author: {
            create: {
              name: 'john',
              email: 'john@example.com',
            },
          },
        },
      })

      // Verify User hooks were called
      expect(userListResolveInputHook).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'create',
          resolvedData: expect.objectContaining({
            name: 'john',
            email: 'john@example.com',
          }),
        }),
      )

      expect(userResolveInputHook).toHaveBeenCalledWith(
        expect.objectContaining({
          fieldKey: 'name',
          operation: 'create',
          resolvedData: expect.objectContaining({
            name: 'john',
          }),
        }),
      )

      expect(userValidateInputHook).toHaveBeenCalled()

      // Verify Post hooks were called
      expect(postResolveInputHook).toHaveBeenCalled()
    })

    it('should enforce create access control on nested create', async () => {
      const testConfig = config({
        db: {
          provider: 'postgresql',
          url: 'postgresql://localhost:5432/test',
        },
        lists: {
          User: list({
            fields: {
              name: text(),
              email: text(),
            },
            access: {
              operation: {
                query: () => true,
                create: () => false, // Deny create
              },
            },
          }),
          Post: list({
            fields: {
              title: text(),
              author: relationship({ ref: 'User.posts' }),
            },
            access: {
              operation: {
                query: () => true,
                update: () => true,
              },
            },
          }),
        },
      })

      mockPrisma.post.findUnique.mockResolvedValue({
        id: '1',
        title: 'Original Title',
      })

      const context = getContext(await testConfig, mockPrisma, null)

      await expect(
        context.db.post.update({
          where: { id: '1' },
          data: {
            title: 'Updated Title',
            author: {
              create: {
                name: 'John',
                email: 'john@example.com',
              },
            },
          },
        }),
      ).rejects.toThrow('Access denied: Cannot create related item')
    })

    it('should apply field-level access control to nested create', async () => {
      const testConfig = config({
        db: {
          provider: 'postgresql',
          url: 'postgresql://localhost:5432/test',
        },
        lists: {
          User: list({
            fields: {
              name: text(),
              email: text(),
              role: text({
                access: {
                  create: () => false, // Cannot set role on create
                },
              }),
            },
            access: {
              operation: {
                query: () => true,
                create: () => true,
              },
            },
          }),
          Post: list({
            fields: {
              title: text(),
              author: relationship({ ref: 'User.posts' }),
            },
            access: {
              operation: {
                query: () => true,
                update: () => true,
              },
            },
          }),
        },
      })

      mockPrisma.post.findUnique.mockResolvedValue({
        id: '1',
        title: 'Original Title',
      })

      mockPrisma.post.update.mockResolvedValue({
        id: '1',
        title: 'Updated Title',
        authorId: '2',
      })

      const context = getContext(await testConfig, mockPrisma, null)

      await context.db.post.update({
        where: { id: '1' },
        data: {
          title: 'Updated Title',
          author: {
            create: {
              name: 'John',
              email: 'john@example.com',
              role: 'admin', // Should be filtered out
            },
          },
        },
      })

      // Verify the update was called
      expect(mockPrisma.post.update).toHaveBeenCalled()

      // Get the actual data passed to Prisma
      const callArgs = mockPrisma.post.update.mock.calls[0][0]
      const authorCreateData = callArgs.data.author.create

      // Role should be filtered out
      expect(authorCreateData.role).toBeUndefined()
      expect(authorCreateData.name).toBe('John')
      expect(authorCreateData.email).toBe('john@example.com')
    })

    it('should run field validation on nested create', async () => {
      const testConfig = config({
        db: {
          provider: 'postgresql',
          url: 'postgresql://localhost:5432/test',
        },
        lists: {
          User: list({
            fields: {
              name: text({ validation: { isRequired: true } }),
              email: text({ validation: { isRequired: true } }),
            },
            access: {
              operation: {
                query: () => true,
                create: () => true,
              },
            },
          }),
          Post: list({
            fields: {
              title: text(),
              author: relationship({ ref: 'User.posts' }),
            },
            access: {
              operation: {
                query: () => true,
                update: () => true,
              },
            },
          }),
        },
      })

      mockPrisma.post.findUnique.mockResolvedValue({
        id: '1',
        title: 'Original Title',
      })

      const context = getContext(await testConfig, mockPrisma, null)

      await expect(
        context.db.post.update({
          where: { id: '1' },
          data: {
            title: 'Updated Title',
            author: {
              create: {
                name: '', // Empty required field
                email: 'john@example.com',
              },
            },
          },
        }),
      ).rejects.toThrow('Name is required')
    })
  })

  describe('Nested Read Operations with Includes', () => {
    it('should apply query access control to relationships', async () => {
      const testConfig = config({
        db: {
          provider: 'postgresql',
          url: 'postgresql://localhost:5432/test',
        },
        lists: {
          User: list({
            fields: {
              name: text(),
              email: text(),
              posts: relationship({ ref: 'Post.author', many: true }),
            },
            access: {
              operation: {
                query: () => true,
              },
            },
          }),
          Post: list({
            fields: {
              title: text(),
              status: text(),
              author: relationship({ ref: 'User.posts' }),
            },
            access: {
              operation: {
                // Only show published posts
                query: () => ({ status: { equals: 'published' } }),
              },
            },
          }),
        },
      })

      mockPrisma.user.findFirst.mockResolvedValue({
        id: '1',
        name: 'John Doe',
        email: 'john@example.com',
        posts: [
          { id: '1', title: 'Published Post', status: 'published' },
          { id: '2', title: 'Draft Post', status: 'draft' },
        ],
      })

      const context = getContext(await testConfig, mockPrisma, null)

      await context.db.user.findUnique({
        where: { id: '1' },
      })

      // Verify findFirst was called with access filter
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            posts: expect.objectContaining({
              where: { status: { equals: 'published' } },
            }),
          }),
        }),
      )
    })

    it('should apply field-level read access to nested relationships', async () => {
      const userResolveOutputHook = vi.fn(({ value }) => `***${value}***`)

      const testConfig = config({
        db: {
          provider: 'postgresql',
          url: 'postgresql://localhost:5432/test',
        },
        lists: {
          User: list({
            fields: {
              name: text(),
              email: text({
                access: {
                  read: () => false, // Hide email
                },
              }),
              secretField: text({
                hooks: {
                  resolveOutput: userResolveOutputHook,
                },
              }),
            },
            access: {
              operation: {
                query: () => true,
              },
            },
          }),
          Post: list({
            fields: {
              title: text(),
              author: relationship({ ref: 'User.posts' }),
            },
            access: {
              operation: {
                query: () => true,
              },
            },
          }),
        },
      })

      mockPrisma.post.findFirst.mockResolvedValue({
        id: '1',
        title: 'Test Post',
        author: {
          id: '1',
          name: 'John Doe',
          email: 'john@example.com',
          secretField: 'secret',
        },
      })

      const context = getContext(await testConfig, mockPrisma, null)

      const result = await context.db.post.findUnique({
        where: { id: '1' },
      })

      // Email should be filtered out
      expect(result?.author?.email).toBeUndefined()
      expect(result?.author?.name).toBe('John Doe')

      // resolveOutput hook should have been applied
      expect(result?.author?.secretField).toBe('***secret***')
      expect(userResolveOutputHook).toHaveBeenCalled()
    })

    it('should deny access to relationships when query access is false', async () => {
      const testConfig = config({
        db: {
          provider: 'postgresql',
          url: 'postgresql://localhost:5432/test',
        },
        lists: {
          User: list({
            fields: {
              name: text(),
              email: text(),
            },
            access: {
              operation: {
                query: () => false, // Deny access to users
              },
            },
          }),
          Post: list({
            fields: {
              title: text(),
              author: relationship({ ref: 'User.posts' }),
            },
            access: {
              operation: {
                query: () => true,
              },
            },
          }),
        },
      })

      mockPrisma.post.findFirst.mockResolvedValue({
        id: '1',
        title: 'Test Post',
        // Author should not be included due to access control
      })

      const context = getContext(await testConfig, mockPrisma, null)

      await context.db.post.findUnique({
        where: { id: '1' },
      })

      // Verify include does NOT include author (access denied)
      expect(mockPrisma.post.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.not.objectContaining({
            author: expect.anything(),
          }),
        }),
      )
    })
  })

  describe('Update Return Values with Field Access', () => {
    it('should filter return fields based on field-level read access', async () => {
      const testConfig = config({
        db: {
          provider: 'postgresql',
          url: 'postgresql://localhost:5432/test',
        },
        lists: {
          Post: list({
            fields: {
              title: text(),
              content: text(),
              internalNotes: text({
                access: {
                  read: () => false, // Hide from read
                },
              }),
            },
            access: {
              operation: {
                query: () => true,
                update: () => true,
              },
            },
          }),
        },
      })

      mockPrisma.post.findUnique.mockResolvedValue({
        id: '1',
        title: 'Original Title',
        content: 'Original Content',
        internalNotes: 'Old notes',
      })

      mockPrisma.post.update.mockResolvedValue({
        id: '1',
        title: 'Updated Title',
        content: 'Updated Content',
        internalNotes: 'New secret notes',
      })

      const context = getContext(await testConfig, mockPrisma, null)

      const result = await context.db.post.update({
        where: { id: '1' },
        data: {
          title: 'Updated Title',
          content: 'Updated Content',
          internalNotes: 'New secret notes',
        },
      })

      // internalNotes should be filtered out from response
      expect(result?.title).toBe('Updated Title')
      expect(result?.content).toBe('Updated Content')
      expect(result?.internalNotes).toBeUndefined()
    })

    it('should apply resolveOutput hooks to update return value', async () => {
      const titleResolveOutputHook = vi.fn(({ value }) => value.toUpperCase())

      const testConfig = config({
        db: {
          provider: 'postgresql',
          url: 'postgresql://localhost:5432/test',
        },
        lists: {
          Post: list({
            fields: {
              title: text({
                hooks: {
                  resolveOutput: titleResolveOutputHook,
                },
              }),
            },
            access: {
              operation: {
                query: () => true,
                update: () => true,
              },
            },
          }),
        },
      })

      mockPrisma.post.findUnique.mockResolvedValue({
        id: '1',
        title: 'Original Title',
      })

      mockPrisma.post.update.mockResolvedValue({
        id: '1',
        title: 'updated title',
      })

      const context = getContext(await testConfig, mockPrisma, null)

      const result = await context.db.post.update({
        where: { id: '1' },
        data: {
          title: 'updated title',
        },
      })

      // resolveOutput hook should transform the return value
      expect(result?.title).toBe('UPDATED TITLE')
      expect(titleResolveOutputHook).toHaveBeenCalled()
    })

    it('should filter nested relationships in update return value', async () => {
      const testConfig = config({
        db: {
          provider: 'postgresql',
          url: 'postgresql://localhost:5432/test',
        },
        lists: {
          User: list({
            fields: {
              name: text(),
              email: text({
                access: {
                  read: () => false, // Hide email
                },
              }),
            },
            access: {
              operation: {
                query: () => true,
                create: () => true,
              },
            },
          }),
          Post: list({
            fields: {
              title: text(),
              author: relationship({ ref: 'User.posts' }),
            },
            access: {
              operation: {
                query: () => true,
                update: () => true,
              },
            },
          }),
        },
      })

      mockPrisma.post.findUnique.mockResolvedValue({
        id: '1',
        title: 'Original Title',
      })

      mockPrisma.post.update.mockResolvedValue({
        id: '1',
        title: 'Updated Title',
        authorId: '2',
      })

      const context = getContext(await testConfig, mockPrisma, null)

      const result = await context.db.post.update({
        where: { id: '1' },
        data: {
          title: 'Updated Title',
          author: {
            create: {
              name: 'John',
              email: 'john@example.com',
            },
          },
        },
      })

      // Verify result exists
      expect(result).toBeDefined()
      expect(result?.title).toBe('Updated Title')
    })
  })

  describe('Access Denial Scenarios', () => {
    it('should deny nested connect when update access is denied on related item', async () => {
      const testConfig = config({
        db: {
          provider: 'postgresql',
          url: 'postgresql://localhost:5432/test',
        },
        lists: {
          User: list({
            fields: {
              name: text(),
            },
            access: {
              operation: {
                query: () => true,
                update: ({ session }) => {
                  // Only allow updating own profile
                  return { id: { equals: session?.userId } }
                },
              },
            },
          }),
          Post: list({
            fields: {
              title: text(),
              author: relationship({ ref: 'User.posts' }),
            },
            access: {
              operation: {
                query: () => true,
                update: () => true,
              },
            },
          }),
        },
      })

      mockPrisma.post.findUnique.mockResolvedValue({
        id: '1',
        title: 'Original Title',
      })

      // Mock finding the user to connect (different from session user)
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '2',
        name: 'Other User',
      })

      const context = getContext(await testConfig, mockPrisma, { userId: '1' })

      await expect(
        context.db.post.update({
          where: { id: '1' },
          data: {
            author: {
              connect: { id: '2' }, // Connecting to user 2, but session is user 1
            },
          },
        }),
      ).rejects.toThrow('Access denied: Cannot connect to this item')
    })

    it('should allow nested connect when update access is granted', async () => {
      const testConfig = config({
        db: {
          provider: 'postgresql',
          url: 'postgresql://localhost:5432/test',
        },
        lists: {
          User: list({
            fields: {
              name: text(),
            },
            access: {
              operation: {
                query: () => true,
                update: () => true, // Allow all updates
              },
            },
          }),
          Post: list({
            fields: {
              title: text(),
              author: relationship({ ref: 'User.posts' }),
            },
            access: {
              operation: {
                query: () => true,
                update: () => true,
              },
            },
          }),
        },
      })

      mockPrisma.post.findUnique.mockResolvedValue({
        id: '1',
        title: 'Original Title',
      })

      mockPrisma.user.findUnique.mockResolvedValue({
        id: '2',
        name: 'John Doe',
      })

      mockPrisma.post.update.mockResolvedValue({
        id: '1',
        title: 'Original Title',
        authorId: '2',
      })

      const context = getContext(await testConfig, mockPrisma, { userId: '1' })

      const result = await context.db.post.update({
        where: { id: '1' },
        data: {
          author: {
            connect: { id: '2' },
          },
        },
      })

      expect(result).toBeDefined()
      expect(mockPrisma.post.update).toHaveBeenCalled()
    })

    it('should deny nested update when update access is denied on related item', async () => {
      const testConfig = config({
        db: {
          provider: 'postgresql',
          url: 'postgresql://localhost:5432/test',
        },
        lists: {
          User: list({
            fields: {
              name: text(),
            },
            access: {
              operation: {
                query: () => true,
                update: () => false, // Deny all updates
              },
            },
          }),
          Post: list({
            fields: {
              title: text(),
              author: relationship({ ref: 'User.posts' }),
            },
            access: {
              operation: {
                query: () => true,
                update: () => true,
              },
            },
          }),
        },
      })

      mockPrisma.post.findUnique.mockResolvedValue({
        id: '1',
        title: 'Original Title',
      })

      mockPrisma.user.findUnique.mockResolvedValue({
        id: '2',
        name: 'John Doe',
      })

      const context = getContext(await testConfig, mockPrisma, null)

      await expect(
        context.db.post.update({
          where: { id: '1' },
          data: {
            author: {
              update: {
                where: { id: '2' },
                data: { name: 'Jane Doe' },
              },
            },
          },
        }),
      ).rejects.toThrow('Access denied: Cannot update related item')
    })
  })
})
