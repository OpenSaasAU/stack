import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getContext } from '../src/context/index.js'
import { config, list } from '../src/config/index.js'
import { text, relationship } from '../src/fields/index.js'
import { NestedRelationInputError } from '../src/context/nested-operations.js'

/**
 * These tests pin the behaviour of the nested-operation handler registry that
 * sits behind `processNestedOperations`. Each nested-op kind (create, connect,
 * connectOrCreate, update, delete) plus `disconnect` (gated, #1384) is
 * dispatched via the registry. `set`/`updateMany`/`deleteMany` are refused
 * for non-sudo contexts (#1384) rather than dispatched at all. The tests
 * assert the exact payload handed to Prisma so a regression in
 * dispatch/ordering is caught.
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

  describe('disconnect (gated, #1384)', () => {
    it('passes { disconnect: true } through unchanged with no target check', async () => {
      const context = getContext(await buildConfig(), mockPrisma, { userId: '1' })

      await context.db.post.update({
        where: { id: '1' },
        data: { author: { disconnect: true } },
      })

      const passedData = mockPrisma.post.update.mock.calls[0][0].data
      expect(passedData.author).toEqual({ disconnect: true })
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
    })

    it('verifies target query access before passing a criteria-form disconnect through', async () => {
      mockPrisma.tag.findUnique.mockResolvedValue({ id: 'old-tag', label: 'x' })
      const context = getContext(await buildConfig(), mockPrisma, { userId: '1' })

      await context.db.post.update({
        where: { id: '1' },
        data: { tags: { disconnect: { id: 'old-tag' } } },
      })

      expect(mockPrisma.tag.findUnique).toHaveBeenCalledWith({ where: { id: 'old-tag' } })
      const passedTags = mockPrisma.post.update.mock.calls[0][0].data.tags
      expect(passedTags).toEqual({ disconnect: { id: 'old-tag' } })
    })

    it('denies a criteria-form disconnect naming a target the session cannot reach', async () => {
      mockPrisma.tag.findUnique.mockResolvedValue(null)
      const context = getContext(await buildConfig(), mockPrisma, { userId: '1' })

      await expect(
        context.db.post.update({
          where: { id: '1' },
          data: { tags: { disconnect: { id: 'missing-tag' } } },
        }),
      ).rejects.toThrow(/Cannot disconnect: Item not found/)
      expect(mockPrisma.post.update).not.toHaveBeenCalled()
    })

    it('skips the target check under sudo, matching the historical pass-through', async () => {
      const context = getContext(await buildConfig(), mockPrisma, { userId: '1' }).sudo()

      await context.db.post.update({
        where: { id: '1' },
        data: { tags: { disconnect: { id: 'old-tag' } } },
      })

      expect(mockPrisma.tag.findUnique).not.toHaveBeenCalled()
      const passedTags = mockPrisma.post.update.mock.calls[0][0].data.tags
      expect(passedTags).toEqual({ disconnect: { id: 'old-tag' } })
    })

    it('runs the delete hook pipeline for nested delete then hands the payload to Prisma', async () => {
      // Nested `delete` now resolves the target row (access + hooks), then the
      // identifying payload is still handed to Prisma's nested write unchanged.
      mockPrisma.tag.findUnique.mockResolvedValue({ id: 'a', label: 'doomed' })
      const context = getContext(await buildConfig(), mockPrisma, { userId: '1' })

      await context.db.post.update({
        where: { id: '1' },
        data: {
          tags: {
            delete: { id: 'a' },
          },
        },
      })

      // The target row was resolved for access/hooks.
      expect(mockPrisma.tag.findUnique).toHaveBeenCalledWith({ where: { id: 'a' } })
      // The delete payload reaches Prisma unchanged.
      const passedTags = mockPrisma.post.update.mock.calls[0][0].data.tags
      expect(passedTags).toEqual({ delete: { id: 'a' } })
    })
  })

  describe('refused kinds (set/updateMany/deleteMany, #1384)', () => {
    it('refuses a non-sudo deleteMany/set/updateMany payload, naming the list, field and kinds', async () => {
      const context = getContext(await buildConfig(), mockPrisma, { userId: '1' })

      let caught: unknown
      try {
        await context.db.post.update({
          where: { id: '1' },
          data: {
            tags: {
              deleteMany: { label: { contains: 'x' } },
              set: [{ id: 'b' }],
              updateMany: { where: { id: 'c' }, data: { label: 'renamed' } },
            },
          },
        })
      } catch (err) {
        caught = err
      }

      expect(caught).toBeInstanceOf(NestedRelationInputError)
      const error = caught as NestedRelationInputError
      expect(error.listKey).toBe('Post')
      expect(error.fieldKey).toBe('tags')
      expect(error.kinds).toEqual(['set', 'updateMany', 'deleteMany'])
      // Nothing persisted — the refusal fires before the parent write executes.
      expect(mockPrisma.post.update).not.toHaveBeenCalled()
    })

    it('refuses even when the same payload also carries a permitted kind', async () => {
      const context = getContext(await buildConfig(), mockPrisma, { userId: '1' })

      await expect(
        context.db.post.update({
          where: { id: '1' },
          data: {
            tags: {
              create: { label: 'new-tag' },
              deleteMany: { label: { contains: 'x' } },
            },
          },
        }),
      ).rejects.toThrow(NestedRelationInputError)
      expect(mockPrisma.post.update).not.toHaveBeenCalled()
    })

    it('still passes deleteMany, set and updateMany through unchanged under sudo', async () => {
      const context = getContext(await buildConfig(), mockPrisma, { userId: '1' }).sudo()

      await context.db.post.update({
        where: { id: '1' },
        data: {
          tags: {
            deleteMany: { label: { contains: 'x' } },
            set: [{ id: 'b' }],
            updateMany: { where: { id: 'c' }, data: { label: 'renamed' } },
          },
        },
      })

      const passedTags = mockPrisma.post.update.mock.calls[0][0].data.tags
      expect(passedTags).toEqual({
        deleteMany: { label: { contains: 'x' } },
        set: [{ id: 'b' }],
        updateMany: { where: { id: 'c' }, data: { label: 'renamed' } },
      })
    })
  })

  describe('multiple kinds on a single field', () => {
    it('dispatches create and disconnect together, preserving both', async () => {
      mockPrisma.tag.findUnique.mockResolvedValue({ id: 'old-tag', label: 'x' })
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
      // disconnect is passed through once its target is verified reachable
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
