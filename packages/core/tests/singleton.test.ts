import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getContext } from '../src/context/index.js'
import type { OpenSaasConfig } from '../src/config/types.js'
import { ValidationError } from '../src/hooks/index.js'

describe('Singleton Lists', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockPrisma: any
  let config: OpenSaasConfig

  beforeEach(() => {
    // Mock Prisma client
    mockPrisma = {
      settings: {
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

    // Config with a singleton list
    config = {
      db: {
        provider: 'postgresql',
        url: 'postgresql://localhost:5432/test',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prismaClientConstructor: (PrismaClient: any) => new PrismaClient(),
      },
      lists: {
        Settings: {
          fields: {
            siteName: { type: 'text', defaultValue: 'My Site' },
            maintenanceMode: { type: 'checkbox', defaultValue: false },
            maxUploadSize: { type: 'integer', defaultValue: 10 },
          },
          access: {
            operation: {
              query: () => true,
              create: () => true,
              update: () => true,
              delete: () => true,
            },
          },
          isSingleton: true,
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

  describe('create operation', () => {
    it('should allow creating the first record', async () => {
      mockPrisma.settings.count.mockResolvedValue(0)
      mockPrisma.settings.create.mockResolvedValue({
        id: 1,
        siteName: 'Test Site',
        maintenanceMode: false,
        maxUploadSize: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const context = getContext(config, mockPrisma, null)

      const result = await context.db.settings.create({
        data: { siteName: 'Test Site' },
      })

      expect(result).toBeDefined()
      expect(mockPrisma.settings.count).toHaveBeenCalled()
      expect(mockPrisma.settings.create).toHaveBeenCalled()
    })

    it('should prevent creating a second record', async () => {
      mockPrisma.settings.count.mockResolvedValue(1)

      const context = getContext(config, mockPrisma, null)

      await expect(
        context.db.settings.create({
          data: { siteName: 'Second Site' },
        }),
      ).rejects.toThrow(ValidationError)

      await expect(
        context.db.settings.create({
          data: { siteName: 'Second Site' },
        }),
      ).rejects.toThrow('singleton list with an existing record')
    })

    it('should enforce singleton even in sudo mode', async () => {
      mockPrisma.settings.count.mockResolvedValue(1)

      const context = getContext(config, mockPrisma, null)
      const sudoContext = context.sudo()

      await expect(
        sudoContext.db.settings.create({
          data: { siteName: 'Second Site' },
        }),
      ).rejects.toThrow(ValidationError)
    })
  })

  describe('get operation', () => {
    it('should have get() method for singleton lists', () => {
      const context = getContext(config, mockPrisma, null)

      expect(context.db.settings.get).toBeDefined()
      expect(typeof context.db.settings.get).toBe('function')
    })

    it('should not have get() method for non-singleton lists', () => {
      const context = getContext(config, mockPrisma, null)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((context.db.post as any).get).toBeUndefined()
    })

    it('should return existing record on get()', async () => {
      const mockSettings = {
        id: 1,
        siteName: 'My Site',
        maintenanceMode: false,
        maxUploadSize: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockPrisma.settings.findFirst.mockResolvedValue(mockSettings)

      const context = getContext(config, mockPrisma, null)
      const result = await context.db.settings.get()

      expect(result).toBeDefined()
      expect(result?.siteName).toBe('My Site')
      expect(mockPrisma.settings.findFirst).toHaveBeenCalled()
    })

    it('should auto-create record with defaults when none exists (autoCreate: true by default)', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue(null)
      mockPrisma.settings.count.mockResolvedValue(0)
      mockPrisma.settings.create.mockResolvedValue({
        id: 1,
        siteName: 'My Site',
        maintenanceMode: false,
        maxUploadSize: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const context = getContext(config, mockPrisma, null)
      const result = await context.db.settings.get()

      expect(result).toBeDefined()
      expect(result?.siteName).toBe('My Site')
      expect(mockPrisma.settings.create).toHaveBeenCalledWith({
        data: {
          id: 1,
          siteName: 'My Site',
          maintenanceMode: false,
          maxUploadSize: 10,
        },
      })
    })

    it('should not auto-create when autoCreate is false', async () => {
      // Update config to disable auto-create
      config.lists.Settings.isSingleton = { autoCreate: false }

      mockPrisma.settings.findFirst.mockResolvedValue(null)

      const context = getContext(config, mockPrisma, null)
      const result = await context.db.settings.get()

      expect(result).toBeNull()
      expect(mockPrisma.settings.create).not.toHaveBeenCalled()
    })
  })

  describe('get() with a caller include (#848, ADR-0024)', () => {
    // A singleton read gains the same caller-`include` handling as findUnique
    // and findMany: bare fetches scalars only, and a caller include is merged
    // with the access-controlled include (row-scoped per relation).
    it("a bare get() sends no include and does not evaluate the related list's query access", async () => {
      const homeAuthorQuerySpy = vi.fn(() => true)
      const relConfig: OpenSaasConfig = {
        db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
        lists: {
          HomePage: {
            fields: {
              title: { type: 'text' },
              featuredAuthor: { type: 'relationship', ref: 'Author' },
            },
            access: { operation: { query: () => true, create: () => true } },
            isSingleton: true,
          },
          Author: {
            fields: { name: { type: 'text' } },
            access: { operation: { query: homeAuthorQuerySpy } },
          },
        },
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const relPrisma: any = {
        homePage: { findFirst: vi.fn(), create: vi.fn(), count: vi.fn() },
        author: { findFirst: vi.fn(), findMany: vi.fn() },
      }
      relPrisma.homePage.findFirst.mockResolvedValue({
        id: 1,
        title: 'Home',
        featuredAuthorId: 'a1',
      })

      const context = getContext(relConfig, relPrisma, null)
      const result = await context.db.homePage.get()

      expect(relPrisma.homePage.findFirst).toHaveBeenCalledWith({ where: {}, include: undefined })
      expect(homeAuthorQuerySpy).not.toHaveBeenCalled()
      expect(result).toEqual({ id: 1, title: 'Home', featuredAuthorId: 'a1' })
      expect(result).not.toHaveProperty('featuredAuthor')
    })

    it('a caller include on get() is merged with the access-controlled include, row-scoped like any other read', async () => {
      const homeAuthorQuerySpy = vi.fn(() => ({ published: { equals: true } }))
      const relConfig: OpenSaasConfig = {
        db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
        lists: {
          HomePage: {
            fields: {
              title: { type: 'text' },
              featuredAuthor: { type: 'relationship', ref: 'Author' },
            },
            access: { operation: { query: () => true, create: () => true } },
            isSingleton: true,
          },
          Author: {
            fields: { name: { type: 'text' } },
            access: { operation: { query: homeAuthorQuerySpy } },
          },
        },
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const relPrisma: any = {
        homePage: { findFirst: vi.fn(), create: vi.fn(), count: vi.fn() },
        author: { findFirst: vi.fn(), findMany: vi.fn() },
      }
      relPrisma.homePage.findFirst.mockResolvedValue({
        id: 1,
        title: 'Home',
        featuredAuthorId: 'a1',
        featuredAuthor: { id: 'a1', name: 'Ann' },
      })
      // `featuredAuthor` is to-one, so Prisma cannot scope it with a nested
      // `where` (#974) — it's fetched unscoped, then this batched existence
      // check decides whether it survives.
      relPrisma.author.findMany.mockResolvedValue([{ id: 'a1' }])

      const context = getContext(relConfig, relPrisma, null)
      const result = await context.db.homePage.get({ include: { featuredAuthor: true } })

      const call = relPrisma.homePage.findFirst.mock.calls[0][0]
      expect(call.include.featuredAuthor).toBe(true)
      expect(relPrisma.author.findMany).toHaveBeenCalledWith({
        where: { AND: [{ published: { equals: true } }, { id: { in: ['a1'] } }] },
        select: { id: true },
      })
      expect(result?.featuredAuthor).toEqual({ id: 'a1', name: 'Ann' })
    })
  })

  describe('delete operation', () => {
    it('should block delete on singleton lists', async () => {
      mockPrisma.settings.findUnique.mockResolvedValue({
        id: 1,
        siteName: 'My Site',
        maintenanceMode: false,
        maxUploadSize: 10,
      })

      const context = getContext(config, mockPrisma, null)

      await expect(context.db.settings.delete({ where: { id: 1 } })).rejects.toThrow(
        ValidationError,
      )

      await expect(context.db.settings.delete({ where: { id: 1 } })).rejects.toThrow(
        'singleton list',
      )
    })

    it('should block delete even in sudo mode', async () => {
      mockPrisma.settings.findUnique.mockResolvedValue({
        id: 1,
        siteName: 'My Site',
        maintenanceMode: false,
        maxUploadSize: 10,
      })

      const context = getContext(config, mockPrisma, null)
      const sudoContext = context.sudo()

      await expect(sudoContext.db.settings.delete({ where: { id: 1 } })).rejects.toThrow(
        ValidationError,
      )
    })
  })

  describe('findMany operation', () => {
    it('should block findMany on singleton lists', async () => {
      const context = getContext(config, mockPrisma, null)

      await expect(context.db.settings.findMany()).rejects.toThrow(ValidationError)

      await expect(context.db.settings.findMany()).rejects.toThrow('Cannot use findMany')
    })

    it('should allow findMany on non-singleton lists', async () => {
      mockPrisma.post.findMany.mockResolvedValue([
        { id: '1', title: 'Post 1', content: 'Content 1' },
      ])

      const context = getContext(config, mockPrisma, null)
      const result = await context.db.post.findMany()

      expect(result).toBeDefined()
      expect(result).toHaveLength(1)
      expect(mockPrisma.post.findMany).toHaveBeenCalled()
    })
  })

  describe('update operation', () => {
    it('should allow updating the singleton record', async () => {
      mockPrisma.settings.findUnique.mockResolvedValue({
        id: 1,
        siteName: 'My Site',
        maintenanceMode: false,
        maxUploadSize: 10,
      })

      mockPrisma.settings.update.mockResolvedValue({
        id: 1,
        siteName: 'Updated Site',
        maintenanceMode: true,
        maxUploadSize: 20,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const context = getContext(config, mockPrisma, null)

      const result = await context.db.settings.update({
        where: { id: 1 },
        data: { siteName: 'Updated Site', maintenanceMode: true, maxUploadSize: 20 },
      })

      expect(result).toBeDefined()
      expect(result?.siteName).toBe('Updated Site')
      expect(mockPrisma.settings.update).toHaveBeenCalled()
    })
  })

  describe('findUnique operation', () => {
    it('should allow findUnique on singleton lists', async () => {
      mockPrisma.settings.findFirst.mockResolvedValue({
        id: 1,
        siteName: 'My Site',
        maintenanceMode: false,
        maxUploadSize: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const context = getContext(config, mockPrisma, null)
      const result = await context.db.settings.findUnique({ where: { id: 1 } })

      expect(result).toBeDefined()
      expect(result?.siteName).toBe('My Site')
      expect(mockPrisma.settings.findFirst).toHaveBeenCalled()
    })
  })

  describe('count operation', () => {
    it('should allow count on singleton lists', async () => {
      mockPrisma.settings.count.mockResolvedValue(1)

      const context = getContext(config, mockPrisma, null)
      const result = await context.db.settings.count()

      expect(result).toBe(1)
      expect(mockPrisma.settings.count).toHaveBeenCalled()
    })
  })
})
