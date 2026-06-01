import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getContext } from '../src/context/index.js'
import { config, list } from '../src/config/index.js'
import { text, relationship } from '../src/fields/index.js'

/**
 * These tests pin the behaviour of the nested-operation handler registry that
 * sits behind `processNestedOperations`. Each nested-op kind (create, connect,
 * connectOrCreate, update) plus the pass-through kinds (disconnect, delete,
 * deleteMany, set, updateMany) is dispatched via the registry. The tests assert
 * the exact payload handed to Prisma so a regression in dispatch/ordering is
 * caught.
 */

function createMockPrisma() {
  return {
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
    tag: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
  }
}

function buildConfig() {
  return config({
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
            create: () => true,
            update: () => true,
            delete: () => true,
          },
        },
      }),
      Tag: list({
        fields: {
          label: text(),
        },
        access: {
          operation: {
            query: () => true,
            create: () => true,
            update: () => true,
            delete: () => true,
          },
        },
      }),
      Post: list({
        fields: {
          title: text(),
          author: relationship({ ref: 'User.posts' }),
          tags: relationship({ ref: 'Tag', many: true }),
        },
        access: {
          operation: {
            query: () => true,
            create: () => true,
            update: () => true,
          },
        },
      }),
    },
  })
}

describe('Nested Operation Handler Registry', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>

  beforeEach(() => {
    mockPrisma = createMockPrisma()
    vi.clearAllMocks()
    mockPrisma.post.findUnique.mockResolvedValue({ id: '1', title: 'Original' })
    mockPrisma.post.update.mockResolvedValue({ id: '1', title: 'Original' })
  })

  describe('pass-through kinds', () => {
    it('passes disconnect through unchanged', async () => {
      const context = getContext(await buildConfig(), mockPrisma, { userId: '1' })

      await context.db.post.update({
        where: { id: '1' },
        data: { author: { disconnect: true } },
      })

      const passedData = mockPrisma.post.update.mock.calls[0][0].data
      expect(passedData.author).toEqual({ disconnect: true })
    })

    it('passes delete, deleteMany, set and updateMany through unchanged', async () => {
      const context = getContext(await buildConfig(), mockPrisma, { userId: '1' })

      await context.db.post.update({
        where: { id: '1' },
        data: {
          tags: {
            delete: { id: 'a' },
            deleteMany: { label: { contains: 'x' } },
            set: [{ id: 'b' }],
            updateMany: { where: { id: 'c' }, data: { label: 'renamed' } },
          },
        },
      })

      const passedTags = mockPrisma.post.update.mock.calls[0][0].data.tags
      expect(passedTags).toEqual({
        delete: { id: 'a' },
        deleteMany: { label: { contains: 'x' } },
        set: [{ id: 'b' }],
        updateMany: { where: { id: 'c' }, data: { label: 'renamed' } },
      })
    })
  })

  describe('multiple kinds on a single field', () => {
    it('dispatches create and disconnect together, preserving both', async () => {
      const context = getContext(await buildConfig(), mockPrisma, { userId: '1' })

      await context.db.post.update({
        where: { id: '1' },
        data: {
          tags: {
            create: { label: 'new-tag' },
            disconnect: { id: 'old-tag' },
          },
        },
      })

      const passedTags = mockPrisma.post.update.mock.calls[0][0].data.tags
      // create is processed through hooks/access (object preserved)
      expect(passedTags.create).toEqual({ label: 'new-tag' })
      // disconnect is passed through untouched
      expect(passedTags.disconnect).toEqual({ id: 'old-tag' })
    })
  })

  describe('connectOrCreate kind', () => {
    it('produces a { where, create } payload via the registry', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null)
      const context = getContext(await buildConfig(), mockPrisma, { userId: '1' })

      await context.db.post.update({
        where: { id: '1' },
        data: {
          author: {
            connectOrCreate: {
              where: { id: '99' },
              create: { name: 'Created Author' },
            },
          },
        },
      })

      const passedAuthor = mockPrisma.post.update.mock.calls[0][0].data.author
      expect(passedAuthor.connectOrCreate).toEqual({
        where: { id: '99' },
        create: { name: 'Created Author' },
      })
    })
  })

  describe('non-relationship fields', () => {
    it('leaves scalar field values untouched', async () => {
      const context = getContext(await buildConfig(), mockPrisma, { userId: '1' })

      await context.db.post.update({
        where: { id: '1' },
        data: { title: 'Updated Title' },
      })

      const passedData = mockPrisma.post.update.mock.calls[0][0].data
      expect(passedData.title).toBe('Updated Title')
    })
  })
})
