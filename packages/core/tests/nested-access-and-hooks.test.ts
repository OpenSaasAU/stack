import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getContext } from '../src/context/index.js'
import { config, list } from '../src/config/index.js'
import { text, relationship } from '../src/fields/index.js'
import { checkFieldAccess } from '../src/access/field-access.js'

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

      // #568: a nested-create field denied by field-level access now THROWS
      // (Keystone fail-loud parity) instead of being silently stripped. Nested
      // writes flow through the same `filterWritableFields` gate, so the denied
      // `role` field rejects the whole write.
      await expect(
        context.db.post.update({
          where: { id: '1' },
          data: {
            title: 'Updated Title',
            author: {
              create: {
                name: 'John',
                email: 'john@example.com',
                role: 'admin', // Denied on create -> throws
              },
            },
          },
        }),
      ).rejects.toThrow(/role/)

      // The denied field must abort the write, not let it proceed.
      expect(mockPrisma.post.update).not.toHaveBeenCalled()
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
    it('should deny nested connect when read (query) access scopes out the target row', async () => {
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
                // Only allow reading own profile (a scalar filter)
                query: ({ session }) => ({ id: { equals: session?.userId } }),
                update: () => true,
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

      // User 2 is NOT reachable under { id: { equals: '1' } } → findFirst returns null.
      mockPrisma.user.findFirst.mockResolvedValue(null)

      const context = getContext(await testConfig, mockPrisma, { userId: '1' })

      await expect(
        context.db.post.update({
          where: { id: '1' },
          data: {
            author: {
              connect: { id: '2' }, // Connecting to user 2, but session can only read user 1
            },
          },
        }),
      ).rejects.toThrow('Access denied: Cannot connect to this item')

      // Reachability must be evaluated in the DB, AND-combining connection + filter.
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { AND: [{ id: '2' }, { id: { equals: '1' } }] },
      })
    })

    it('should allow nested connect when read (query) access is granted (boolean true)', async () => {
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
                query: () => true, // Allow reading all users
                update: () => true,
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
      // Boolean-true access must not run a reachability re-check.
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled()
    })

    it('connect requires READ access, not target UPDATE (read-not-update repro)', async () => {
      // Caller can READ the target (query=allowAll) but CANNOT update it
      // (update=admin-only). Under the old behaviour this denied the connect;
      // it must now succeed because connect only references the row.
      const testConfig = config({
        db: {
          provider: 'postgresql',
          url: 'postgresql://localhost:5432/test',
        },
        lists: {
          LessonTerm: list({
            fields: {
              name: text(),
            },
            access: {
              operation: {
                query: () => true, // anyone can read
                update: () => false, // nobody (non-admin) can update
              },
            },
          }),
          Enrolment: list({
            fields: {
              title: text(),
              term: relationship({ ref: 'LessonTerm' }),
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

      mockPrisma.enrolment = {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({ id: 'e1', title: 'Term 1 Enrolment' }),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: 'e1', title: 'Term 1 Enrolment', termId: 't1' }),
        delete: vi.fn(),
        count: vi.fn(),
      }
      mockPrisma.lessonTerm = {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({ id: 't1', name: 'Term 1' }),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      }

      const context = getContext(await testConfig, mockPrisma, { userId: 'student-1' })

      const result = await context.db.enrolment.update({
        where: { id: 'e1' },
        data: {
          term: {
            connect: { id: 't1' },
          },
        },
      })

      expect(result).toBeDefined()
      expect(mockPrisma.enrolment.update).toHaveBeenCalled()
      // query=true → existence check via findUnique, no reachability re-check.
      expect(mockPrisma.lessonTerm.findUnique).toHaveBeenCalledWith({ where: { id: 't1' } })
      expect(mockPrisma.lessonTerm.findFirst).not.toHaveBeenCalled()
    })

    it('allows nested connect when a NESTED-RELATION filter is reachable (account-holder self-connect)', async () => {
      // Account's row filter is a nested-relation filter:
      //   { user: { id: { equals: session.userId } } }
      // The old in-memory matcher could not evaluate this and always denied.
      const testConfig = config({
        db: {
          provider: 'postgresql',
          url: 'postgresql://localhost:5432/test',
        },
        lists: {
          Account: list({
            fields: {
              name: text(),
            },
            access: {
              operation: {
                query: ({ session }) => ({ user: { id: { equals: session?.userId } } }),
                update: () => true,
              },
            },
          }),
          Student: list({
            fields: {
              name: text(),
              account: relationship({ ref: 'Account' }),
            },
            access: {
              operation: {
                query: () => true,
                create: () => true,
              },
            },
          }),
        },
      })

      mockPrisma.account = {
        findFirst: vi.fn().mockResolvedValue({ id: 'acc-1', name: 'My Account' }),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      }
      mockPrisma.student = {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: 's1', name: 'Kid', accountId: 'acc-1' }),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      }

      const context = getContext(await testConfig, mockPrisma, { userId: 'user-1' })

      const result = await context.db.student.create({
        data: {
          name: 'Kid',
          account: { connect: { id: 'acc-1' } },
        },
      })

      expect(result).toBeDefined()
      expect(mockPrisma.student.create).toHaveBeenCalled()
      // Reachability check evaluated the nested-relation filter in the DB.
      expect(mockPrisma.account.findFirst).toHaveBeenCalledWith({
        where: {
          AND: [{ id: 'acc-1' }, { user: { id: { equals: 'user-1' } } }],
        },
      })
    })

    it('denies nested connect when a NESTED-RELATION filter is NOT reachable', async () => {
      const testConfig = config({
        db: {
          provider: 'postgresql',
          url: 'postgresql://localhost:5432/test',
        },
        lists: {
          Account: list({
            fields: {
              name: text(),
            },
            access: {
              operation: {
                query: ({ session }) => ({ user: { id: { equals: session?.userId } } }),
                update: () => true,
              },
            },
          }),
          Student: list({
            fields: {
              name: text(),
              account: relationship({ ref: 'Account' }),
            },
            access: {
              operation: {
                query: () => true,
                create: () => true,
              },
            },
          }),
        },
      })

      mockPrisma.account = {
        // Not reachable for this caller → findFirst returns null.
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      }
      mockPrisma.student = {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      }

      const context = getContext(await testConfig, mockPrisma, { userId: 'attacker' })

      await expect(
        context.db.student.create({
          data: {
            name: 'Kid',
            account: { connect: { id: 'someone-elses-account' } },
          },
        }),
      ).rejects.toThrow('Access denied: Cannot connect to this item')
      expect(mockPrisma.student.create).not.toHaveBeenCalled()
    })

    it('evaluates AND/OR/some/none/not boolean-combinator filters via DB reachability', async () => {
      const complexFilter = {
        OR: [
          { AND: [{ status: { equals: 'active' } }, { NOT: { archived: { equals: true } } }] },
          { members: { some: { userId: { equals: 'user-1' } } } },
        ],
      }

      const testConfig = config({
        db: {
          provider: 'postgresql',
          url: 'postgresql://localhost:5432/test',
        },
        lists: {
          Team: list({
            fields: {
              name: text(),
            },
            access: {
              operation: {
                query: () => complexFilter,
                update: () => true,
              },
            },
          }),
          Project: list({
            fields: {
              title: text(),
              team: relationship({ ref: 'Team' }),
            },
            access: {
              operation: {
                query: () => true,
                create: () => true,
              },
            },
          }),
        },
      })

      mockPrisma.team = {
        findFirst: vi.fn().mockResolvedValue({ id: 'team-1', name: 'Team A' }),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      }
      mockPrisma.project = {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: 'p1', title: 'P1', teamId: 'team-1' }),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      }

      const context = getContext(await testConfig, mockPrisma, { userId: 'user-1' })

      const result = await context.db.project.create({
        data: {
          title: 'P1',
          team: { connect: { id: 'team-1' } },
        },
      })

      expect(result).toBeDefined()
      // The full boolean-combinator filter is AND-combined with the connection
      // and handed to the DB — no in-memory walk, no false denial.
      expect(mockPrisma.team.findFirst).toHaveBeenCalledWith({
        where: { AND: [{ id: 'team-1' }, complexFilter] },
      })
    })

    it('sudo connect bypasses the access check entirely', async () => {
      const queryAccess = vi.fn(() => false as const)

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
                query: queryAccess, // would deny everything
                update: () => false,
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

      mockPrisma.post.findUnique.mockResolvedValue({ id: '1', title: 'Original Title' })
      mockPrisma.post.update.mockResolvedValue({ id: '1', title: 'Original Title', authorId: '2' })

      const context = getContext(await testConfig, mockPrisma, { userId: '1' }).sudo()

      const result = await context.db.post.update({
        where: { id: '1' },
        data: {
          author: { connect: { id: '2' } },
        },
      })

      expect(result).toBeDefined()
      expect(mockPrisma.post.update).toHaveBeenCalled()
      // Sudo skips access evaluation: neither the access fn nor reachability run.
      expect(queryAccess).not.toHaveBeenCalled()
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled()
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
    })

    it("connectOrCreate's connect branch uses read-access + DB reachability and denies unreachable rows", async () => {
      const testConfig = config({
        db: {
          provider: 'postgresql',
          url: 'postgresql://localhost:5432/test',
        },
        lists: {
          Account: list({
            fields: {
              name: text(),
            },
            access: {
              operation: {
                query: ({ session }) => ({ user: { id: { equals: session?.userId } } }),
                create: () => true,
                update: () => true,
              },
            },
          }),
          Student: list({
            fields: {
              name: text(),
              account: relationship({ ref: 'Account' }),
            },
            access: {
              operation: {
                query: () => true,
                create: () => true,
              },
            },
          }),
        },
      })

      mockPrisma.account = {
        // Row exists ...
        findUnique: vi.fn().mockResolvedValue({ id: 'acc-x', name: 'Other Account' }),
        // ... but is NOT reachable under the access filter for this caller.
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      }
      mockPrisma.student = {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      }

      const context = getContext(await testConfig, mockPrisma, { userId: 'user-1' })

      await expect(
        context.db.student.create({
          data: {
            name: 'Kid',
            account: {
              connectOrCreate: {
                where: { id: 'acc-x' },
                create: { name: 'New Account' },
              },
            },
          },
        }),
      ).rejects.toThrow('Access denied: Cannot connect to existing item')

      expect(mockPrisma.account.findFirst).toHaveBeenCalledWith({
        where: { AND: [{ id: 'acc-x' }, { user: { id: { equals: 'user-1' } } }] },
      })
      expect(mockPrisma.student.create).not.toHaveBeenCalled()
    })

    it("connectOrCreate's connect branch allows a reachable existing row", async () => {
      const testConfig = config({
        db: {
          provider: 'postgresql',
          url: 'postgresql://localhost:5432/test',
        },
        lists: {
          Account: list({
            fields: {
              name: text(),
            },
            access: {
              operation: {
                query: ({ session }) => ({ user: { id: { equals: session?.userId } } }),
                create: () => true,
                update: () => true,
              },
            },
          }),
          Student: list({
            fields: {
              name: text(),
              account: relationship({ ref: 'Account' }),
            },
            access: {
              operation: {
                query: () => true,
                create: () => true,
              },
            },
          }),
        },
      })

      mockPrisma.account = {
        findUnique: vi.fn().mockResolvedValue({ id: 'acc-1', name: 'My Account' }),
        findFirst: vi.fn().mockResolvedValue({ id: 'acc-1', name: 'My Account' }),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      }
      mockPrisma.student = {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: 's1', name: 'Kid', accountId: 'acc-1' }),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      }

      const context = getContext(await testConfig, mockPrisma, { userId: 'user-1' })

      const result = await context.db.student.create({
        data: {
          name: 'Kid',
          account: {
            connectOrCreate: {
              where: { id: 'acc-1' },
              create: { name: 'New Account' },
            },
          },
        },
      })

      expect(result).toBeDefined()
      expect(mockPrisma.student.create).toHaveBeenCalled()
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

  // #588 — nested connect must ALSO be gated by the OWNING relationship field's
  // field-level access (the `access` on the relationship field of the list being
  // written, e.g. `Post.author`), in addition to the target read-access + DB
  // reachability check from #578. A deny on the owning field denies the connect
  // even when the target row is fully readable/reachable.
  //
  // NOTE: the owning relationship field's create/update access is enforced at two
  // points for a write that names the relationship key: (1) the parent write's
  // own `filterWritableFields` gate (#568), which fires FIRST and fail-louds with
  // a "Cannot create/update <field>" ValidationError, and (2) the connect-site
  // gate added here (#588), which fail-louds with "Access denied: Cannot
  // connect…". For the standard nested-connect payload #568 short-circuits, so
  // these deny tests assert the write is denied fail-loud (and never persisted)
  // rather than pinning the exact layer. The ALLOW + sudo tests below exercise
  // the connect-site gate's pass-through behaviour directly.
  const OWNING_FIELD_DENIES = /field-level access denied|Cannot connect/

  describe('Owning-field field-level access gate on nested connect (#588)', () => {
    it('denies connect (enclosing UPDATE) when the owning field update access is denied, even though target is readable/reachable', async () => {
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
                query: () => true, // target fully readable
                update: () => true,
              },
            },
          }),
          Post: list({
            fields: {
              title: text(),
              // Owning relationship field denies update-time writes.
              author: relationship({
                ref: 'User.posts',
                access: {
                  update: () => false,
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

      mockPrisma.post.findUnique.mockResolvedValue({ id: '1', title: 'Original Title' })
      // Target row is readable (query=true) and exists.
      mockPrisma.user.findUnique.mockResolvedValue({ id: '2', name: 'John Doe' })

      const context = getContext(await testConfig, mockPrisma, { userId: '1' })

      await expect(
        context.db.post.update({
          where: { id: '1' },
          data: {
            author: { connect: { id: '2' } },
          },
        }),
      ).rejects.toThrow(OWNING_FIELD_DENIES)

      expect(mockPrisma.post.update).not.toHaveBeenCalled()
      // Denied owning field short-circuits before the target row is touched.
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
    })

    it('denies connect (enclosing CREATE) when the owning field create access is denied, even though target is readable/reachable', async () => {
      const testConfig = config({
        db: {
          provider: 'postgresql',
          url: 'postgresql://localhost:5432/test',
        },
        lists: {
          Account: list({
            fields: {
              name: text(),
            },
            access: {
              operation: {
                query: () => true, // target fully readable
                create: () => true,
              },
            },
          }),
          Student: list({
            fields: {
              name: text(),
              // Owning relationship field denies create-time writes.
              account: relationship({
                ref: 'Account',
                access: {
                  create: () => false,
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
        },
      })

      mockPrisma.account = {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({ id: 'acc-1', name: 'My Account' }),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      }
      mockPrisma.student = {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      }

      const context = getContext(await testConfig, mockPrisma, { userId: 'user-1' })

      await expect(
        context.db.student.create({
          data: {
            name: 'Kid',
            account: { connect: { id: 'acc-1' } },
          },
        }),
      ).rejects.toThrow(OWNING_FIELD_DENIES)

      expect(mockPrisma.student.create).not.toHaveBeenCalled()
      expect(mockPrisma.account.findUnique).not.toHaveBeenCalled()
    })

    it('allows connect when the owning field access permits and the target row is reachable (enclosing UPDATE)', async () => {
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
                update: () => true,
              },
            },
          }),
          Post: list({
            fields: {
              title: text(),
              author: relationship({
                ref: 'User.posts',
                access: {
                  update: () => true, // owning field permits
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

      mockPrisma.post.findUnique.mockResolvedValue({ id: '1', title: 'Original Title' })
      mockPrisma.user.findUnique.mockResolvedValue({ id: '2', name: 'John Doe' })
      mockPrisma.post.update.mockResolvedValue({ id: '1', title: 'Original Title', authorId: '2' })

      const context = getContext(await testConfig, mockPrisma, { userId: '1' })

      const result = await context.db.post.update({
        where: { id: '1' },
        data: {
          author: { connect: { id: '2' } },
        },
      })

      expect(result).toBeDefined()
      expect(mockPrisma.post.update).toHaveBeenCalled()
      // Owning field allowed → fall through to the #578 target existence check.
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: '2' } })
    })

    it('sudo bypasses the owning-field gate (denied owning field, connect still succeeds)', async () => {
      const owningFieldUpdate = vi.fn(() => false as const)

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
                query: () => false,
                update: () => false,
              },
            },
          }),
          Post: list({
            fields: {
              title: text(),
              author: relationship({
                ref: 'User.posts',
                access: {
                  update: owningFieldUpdate, // would deny
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

      mockPrisma.post.findUnique.mockResolvedValue({ id: '1', title: 'Original Title' })
      mockPrisma.post.update.mockResolvedValue({ id: '1', title: 'Original Title', authorId: '2' })

      const context = getContext(await testConfig, mockPrisma, { userId: '1' }).sudo()

      const result = await context.db.post.update({
        where: { id: '1' },
        data: {
          author: { connect: { id: '2' } },
        },
      })

      expect(result).toBeDefined()
      expect(mockPrisma.post.update).toHaveBeenCalled()
      // Sudo skips the whole connect check: neither the owning-field access fn
      // nor the target reachability/existence read run.
      expect(owningFieldUpdate).not.toHaveBeenCalled()
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled()
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
    })

    it("connectOrCreate's connect branch is gated by the owning field access (denied → throws, existing row)", async () => {
      const testConfig = config({
        db: {
          provider: 'postgresql',
          url: 'postgresql://localhost:5432/test',
        },
        lists: {
          Account: list({
            fields: {
              name: text(),
            },
            access: {
              operation: {
                query: () => true, // target readable
                create: () => true,
                update: () => true,
              },
            },
          }),
          Student: list({
            fields: {
              name: text(),
              account: relationship({
                ref: 'Account',
                access: {
                  create: () => false, // owning field denies on create
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
        },
      })

      mockPrisma.account = {
        // Row exists and is reachable, but the owning field gate must still deny.
        findUnique: vi.fn().mockResolvedValue({ id: 'acc-1', name: 'My Account' }),
        findFirst: vi.fn().mockResolvedValue({ id: 'acc-1', name: 'My Account' }),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      }
      mockPrisma.student = {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      }

      const context = getContext(await testConfig, mockPrisma, { userId: 'user-1' })

      await expect(
        context.db.student.create({
          data: {
            name: 'Kid',
            account: {
              connectOrCreate: {
                where: { id: 'acc-1' },
                create: { name: 'New Account' },
              },
            },
          },
        }),
      ).rejects.toThrow(OWNING_FIELD_DENIES)

      expect(mockPrisma.student.create).not.toHaveBeenCalled()
      // Denied owning field short-circuits before the target reachability re-check.
      expect(mockPrisma.account.findFirst).not.toHaveBeenCalled()
    })

    it("connectOrCreate's connect branch succeeds when the owning field access permits a reachable existing row", async () => {
      const testConfig = config({
        db: {
          provider: 'postgresql',
          url: 'postgresql://localhost:5432/test',
        },
        lists: {
          Account: list({
            fields: {
              name: text(),
            },
            access: {
              operation: {
                query: () => true,
                create: () => true,
                update: () => true,
              },
            },
          }),
          Student: list({
            fields: {
              name: text(),
              account: relationship({
                ref: 'Account',
                access: {
                  create: () => true, // owning field permits
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
        },
      })

      mockPrisma.account = {
        findUnique: vi.fn().mockResolvedValue({ id: 'acc-1', name: 'My Account' }),
        findFirst: vi.fn().mockResolvedValue({ id: 'acc-1', name: 'My Account' }),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      }
      mockPrisma.student = {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: 's1', name: 'Kid', accountId: 'acc-1' }),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      }

      const context = getContext(await testConfig, mockPrisma, { userId: 'user-1' })

      const result = await context.db.student.create({
        data: {
          name: 'Kid',
          account: {
            connectOrCreate: {
              where: { id: 'acc-1' },
              create: { name: 'New Account' },
            },
          },
        },
      })

      expect(result).toBeDefined()
      expect(mockPrisma.student.create).toHaveBeenCalled()
    })

    // #588 finding — the connect-site owning-field gate must receive the SAME
    // `item`/`inputData` the canonical Phase-5 `filterWritableFields` call passes,
    // so a field-access rule that depends on `item`/`inputData` cannot be ALLOWED
    // by Phase 5 yet DENIED at the connect site (a spurious denial). With those
    // values threaded, an item-/inputData-dependent rule that resolves to ALLOW at
    // Phase 5 also resolves to ALLOW at the connect site, so the legitimate connect
    // succeeds. (#568's Phase-5 gate is the first line of defense and evaluates the
    // identical rule with the identical values; this test pins that the connect-site
    // gate does not diverge from it.)
    it('does not spuriously deny: owning-field access depending on item/inputData allows the connect (enclosing UPDATE)', async () => {
      const owningUpdate = vi.fn(
        ({ item, inputData }: { item?: { status?: string }; inputData?: { title?: string } }) =>
          // Depends on BOTH the existing row (`item`) and the write payload
          // (`inputData`). If the connect-site gate were called without these, it
          // would throw on `item.status`/`inputData.title` and the legitimate
          // connect would fail spuriously.
          item?.status === 'draft' && inputData?.title === 'Updated',
      )

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
                update: () => true,
              },
            },
          }),
          Post: list({
            fields: {
              title: text(),
              author: relationship({
                ref: 'User.posts',
                access: {
                  // Item-/inputData-dependent: allowed only when editing a draft
                  // and setting title to 'Updated'.
                  update: owningUpdate,
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

      // Existing row is a draft → the item-dependent rule allows.
      mockPrisma.post.findUnique.mockResolvedValue({
        id: '1',
        title: 'Original Title',
        status: 'draft',
      })
      mockPrisma.user.findUnique.mockResolvedValue({ id: '2', name: 'John Doe' })
      mockPrisma.post.update.mockResolvedValue({ id: '1', title: 'Updated', authorId: '2' })

      const context = getContext(await testConfig, mockPrisma, { userId: '1' })

      const result = await context.db.post.update({
        where: { id: '1' },
        data: {
          title: 'Updated',
          author: { connect: { id: '2' } },
        },
      })

      // No spurious denial: the connect succeeded.
      expect(result).toBeDefined()
      expect(mockPrisma.post.update).toHaveBeenCalled()
      // Owning field allowed → fall through to the #578 target existence check.
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: '2' } })

      // The gate was evaluated with the enclosing write's `item` (the draft
      // originalItem) and `inputData` (the update payload) — the same values
      // Phase-5 uses — proving the two evaluations cannot diverge.
      const sawItemAndInput = owningUpdate.mock.calls.some(
        ([arg]) => arg?.item?.status === 'draft' && arg?.inputData?.title === 'Updated',
      )
      expect(sawItemAndInput).toBe(true)
    })
  })

  // Focused unit test of the connect-site gate's evaluator (#588 finding).
  //
  // The connect-site gate calls the SHARED `checkFieldAccess` evaluator with the
  // enclosing write's `item`/`inputData`. #568 (Phase-5 `filterWritableFields`) is
  // the first line of defense and calls the same evaluator with the same values,
  // so an end-to-end sole-connect-site DENY is not separately constructible. This
  // test therefore pins the evaluator directly: with `item`/`inputData` provided
  // it honours an item-/inputData-dependent rule (DENY and ALLOW branches), which
  // is exactly the contract the connect-site gate now relies on.
  describe('Connect-site field gate evaluator honours item/inputData (#588)', () => {
    it('DENIES when the item-/inputData-dependent rule resolves false', async () => {
      const access = {
        update: ({
          item,
          inputData,
        }: {
          item?: { status?: string }
          inputData?: { title?: string }
        }) => item?.status === 'draft' && inputData?.title === 'Updated',
      }
      const ctx = getContext(
        await config({
          db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
          lists: { User: list({ fields: { name: text() } }) },
        }),
        mockPrisma,
        { userId: '1' },
      )

      const allowed = await checkFieldAccess(access, 'update', {
        session: ctx.session,
        item: { status: 'published' }, // not a draft → rule is false
        inputData: { title: 'Updated' },
        context: ctx,
      })
      expect(allowed).toBe(false)
    })

    it('ALLOWS when the item-/inputData-dependent rule resolves true', async () => {
      const access = {
        update: ({
          item,
          inputData,
        }: {
          item?: { status?: string }
          inputData?: { title?: string }
        }) => item?.status === 'draft' && inputData?.title === 'Updated',
      }
      const ctx = getContext(
        await config({
          db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
          lists: { User: list({ fields: { name: text() } }) },
        }),
        mockPrisma,
        { userId: '1' },
      )

      const allowed = await checkFieldAccess(access, 'update', {
        session: ctx.session,
        item: { status: 'draft' },
        inputData: { title: 'Updated' },
        context: ctx,
      })
      expect(allowed).toBe(true)
    })
  })

  describe('Async resolveOutput Hooks', () => {
    it('should await async resolveOutput hooks for regular fields', async () => {
      const asyncResolveOutputHook = vi.fn(async ({ value }) => {
        // Simulate async operation (e.g., external API call, database lookup)
        await new Promise((resolve) => setTimeout(resolve, 10))
        return `async:${value}`
      })

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
                  resolveOutput: asyncResolveOutputHook,
                },
              }),
            },
            access: {
              operation: {
                query: () => true,
              },
            },
          }),
        },
      })

      mockPrisma.post.findMany.mockResolvedValue([
        { id: '1', title: 'Hello World', createdAt: new Date(), updatedAt: new Date() },
      ])

      const context = getContext(testConfig, mockPrisma, null)
      const results = await context.db.post.findMany()

      // The resolved value should be the async result, not a Promise object
      expect(results[0].title).toBe('async:Hello World')
      expect(results[0].title).not.toBeInstanceOf(Promise)
      expect(asyncResolveOutputHook).toHaveBeenCalled()
    })

    it('should await async resolveOutput hooks for virtual fields', async () => {
      const asyncVirtualHook = vi.fn(async ({ item }) => {
        // Simulate async operation (e.g., compute from related data)
        await new Promise((resolve) => setTimeout(resolve, 10))
        return `computed:${item.firstName}-${item.lastName}`
      })

      const testConfig = config({
        db: {
          provider: 'postgresql',
          url: 'postgresql://localhost:5432/test',
        },
        lists: {
          User: list({
            fields: {
              firstName: text(),
              lastName: text(),
              fullName: {
                type: 'virtual',
                virtual: true,
                outputType: 'string',
                hooks: {
                  resolveOutput: asyncVirtualHook,
                },
              },
            },
            access: {
              operation: {
                query: () => true,
              },
            },
          }),
        },
      })

      mockPrisma.user.findMany.mockResolvedValue([
        {
          id: '1',
          firstName: 'John',
          lastName: 'Doe',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ])

      const context = getContext(testConfig, mockPrisma, null)
      const results = await context.db.user.findMany()

      // The resolved value should be the async result, not a Promise object
      expect(results[0].fullName).toBe('computed:John-Doe')
      expect(results[0].fullName).not.toBeInstanceOf(Promise)
      expect(asyncVirtualHook).toHaveBeenCalled()
    })

    it('should still work with sync resolveOutput hooks (backwards compatibility)', async () => {
      const syncResolveOutputHook = vi.fn(({ value }) => {
        // Synchronous transformation
        return value.toUpperCase()
      })

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
                  resolveOutput: syncResolveOutputHook,
                },
              }),
            },
            access: {
              operation: {
                query: () => true,
              },
            },
          }),
        },
      })

      mockPrisma.post.findMany.mockResolvedValue([
        { id: '1', title: 'hello world', createdAt: new Date(), updatedAt: new Date() },
      ])

      const context = getContext(testConfig, mockPrisma, null)
      const results = await context.db.post.findMany()

      // Sync hooks should still work as before
      expect(results[0].title).toBe('HELLO WORLD')
      expect(syncResolveOutputHook).toHaveBeenCalled()
    })

    it('should pass context to async resolveOutput hooks', async () => {
      const asyncHookWithContext = vi.fn(async ({ value, context }) => {
        // Verify context is passed correctly
        expect(context).toBeDefined()
        expect(context.session).toEqual({ userId: 'user-123' })
        await new Promise((resolve) => setTimeout(resolve, 5))
        return `${value}:${context.session?.userId}`
      })

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
                  resolveOutput: asyncHookWithContext,
                },
              }),
            },
            access: {
              operation: {
                query: () => true,
              },
            },
          }),
        },
      })

      mockPrisma.post.findMany.mockResolvedValue([
        { id: '1', title: 'Test', createdAt: new Date(), updatedAt: new Date() },
      ])

      const context = getContext(testConfig, mockPrisma, { userId: 'user-123' })
      const results = await context.db.post.findMany()

      expect(results[0].title).toBe('Test:user-123')
      expect(asyncHookWithContext).toHaveBeenCalled()
    })
  })
})
