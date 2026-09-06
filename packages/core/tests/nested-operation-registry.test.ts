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
    Post: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    User: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    Tag: {
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
    mockPrisma.Post.findUnique.mockResolvedValue({ id: '1', title: 'Original' })
    mockPrisma.Post.update.mockResolvedValue({ id: '1', title: 'Original' })
  })

  describe('pass-through kinds', () => {
    it('passes disconnect through unchanged', async () => {
      const context = getContext(await buildConfig(), mockPrisma, { userId: '1' })

      await context.db.Post.update({
        where: { id: '1' },
        data: { author: { disconnect: true } },
      })

      const passedData = mockPrisma.Post.update.mock.calls[0][0].data
      expect(passedData.author).toEqual({ disconnect: true })
    })

    it('passes deleteMany, set and updateMany through unchanged', async () => {
      // NOTE (#569 / ADR-0010): nested `delete` is no longer a pass-through kind —
      // it now runs the full delete hook pipeline (access + before/afterOperation),
      // so it is tested separately below. `deleteMany`/`set`/`updateMany` remain
      // pass-through (out of scope for #569) and the payload is handed to Prisma
      // unchanged.
      const context = getContext(await buildConfig(), mockPrisma, { userId: '1' })

      await context.db.Post.update({
        where: { id: '1' },
        data: {
          tags: {
            deleteMany: { label: { contains: 'x' } },
            set: [{ id: 'b' }],
            updateMany: { where: { id: 'c' }, data: { label: 'renamed' } },
          },
        },
      })

      const passedTags = mockPrisma.Post.update.mock.calls[0][0].data.tags
      expect(passedTags).toEqual({
        deleteMany: { label: { contains: 'x' } },
        set: [{ id: 'b' }],
        updateMany: { where: { id: 'c' }, data: { label: 'renamed' } },
      })
    })

    it('runs the delete hook pipeline for nested delete then hands the payload to Prisma', async () => {
      // Nested `delete` now resolves the target row (access + hooks), then the
      // identifying payload is still handed to Prisma's nested write unchanged.
      mockPrisma.Tag.findUnique.mockResolvedValue({ id: 'a', label: 'doomed' })
      const context = getContext(await buildConfig(), mockPrisma, { userId: '1' })

      await context.db.Post.update({
        where: { id: '1' },
        data: {
          tags: {
            delete: { id: 'a' },
          },
        },
      })

      // The target row was resolved for access/hooks.
      expect(mockPrisma.Tag.findUnique).toHaveBeenCalledWith({ where: { id: 'a' } })
      // The delete payload reaches Prisma unchanged.
      const passedTags = mockPrisma.Post.update.mock.calls[0][0].data.tags
      expect(passedTags).toEqual({ delete: { id: 'a' } })
    })
  })

  describe('multiple kinds on a single field', () => {
    it('dispatches create and disconnect together, preserving both', async () => {
      const context = getContext(await buildConfig(), mockPrisma, { userId: '1' })

      await context.db.Post.update({
        where: { id: '1' },
        data: {
          tags: {
            create: { label: 'new-tag' },
            disconnect: { id: 'old-tag' },
          },
        },
      })

      const passedTags = mockPrisma.Post.update.mock.calls[0][0].data.tags
      // create is processed through hooks/access (object preserved)
      expect(passedTags.create).toEqual({ label: 'new-tag' })
      // disconnect is passed through untouched
      expect(passedTags.disconnect).toEqual({ id: 'old-tag' })
    })
  })

  describe('connectOrCreate kind', () => {
    it('produces a { where, create } payload via the registry', async () => {
      mockPrisma.User.findUnique.mockResolvedValue(null)
      const context = getContext(await buildConfig(), mockPrisma, { userId: '1' })

      await context.db.Post.update({
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

      const passedAuthor = mockPrisma.Post.update.mock.calls[0][0].data.author
      expect(passedAuthor.connectOrCreate).toEqual({
        where: { id: '99' },
        create: { name: 'Created Author' },
      })
    })
  })

  describe('non-relationship fields', () => {
    it('leaves scalar field values untouched', async () => {
      const context = getContext(await buildConfig(), mockPrisma, { userId: '1' })

      await context.db.Post.update({
        where: { id: '1' },
        data: { title: 'Updated Title' },
      })

      const passedData = mockPrisma.Post.update.mock.calls[0][0].data
      expect(passedData.title).toBe('Updated Title')
    })
  })
})
