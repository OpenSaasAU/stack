import { describe, it, expect } from 'vitest'
import { filterWritableFields } from './engine.js'

describe('filterWritableFields', () => {
  it('should filter out foreign key fields when their corresponding relationship field exists', async () => {
    // Setup: Define field configs with a relationship field
    const fieldConfigs = {
      title: {
        type: 'text',
      },
      author: {
        type: 'relationship',
        many: false,
      },
      tags: {
        type: 'relationship',
        many: true, // Many-to-many relationships don't have foreign keys
      },
    }

    // Data that includes both the foreign key (authorId) and other fields
    const data = {
      title: 'Test Post',
      authorId: 'user-123', // This should be filtered out
      tagsId: 'tag-456', // This should NOT be filtered (tags is many:true)
      author: {
        connect: { id: 'user-123' },
      },
    }

    const filtered = await filterWritableFields(data, fieldConfigs, 'create', {
      session: null,
      context: {
        session: null,
        _isSudo: true, // Use sudo to bypass access control checks
      } as any,
    })

    // authorId should be filtered out
    expect(filtered).not.toHaveProperty('authorId')

    // title should remain
    expect(filtered).toHaveProperty('title', 'Test Post')

    // author relationship should remain
    expect(filtered).toHaveProperty('author')
    expect(filtered.author).toEqual({ connect: { id: 'user-123' } })

    // tagsId should remain (tags is many:true, so no foreign key is created)
    expect(filtered).toHaveProperty('tagsId', 'tag-456')
  })

  it('should filter out system fields', async () => {
    const fieldConfigs = {
      title: { type: 'text' },
    }

    const data = {
      id: 'post-123',
      title: 'Test',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const filtered = await filterWritableFields(data, fieldConfigs, 'create', {
      session: null,
      context: {
        session: null,
        _isSudo: true,
      } as any,
    })

    // System fields should be filtered out
    expect(filtered).not.toHaveProperty('id')
    expect(filtered).not.toHaveProperty('createdAt')
    expect(filtered).not.toHaveProperty('updatedAt')

    // Regular fields should remain
    expect(filtered).toHaveProperty('title', 'Test')
  })

  it('should handle update operation', async () => {
    const fieldConfigs = {
      title: { type: 'text' },
      author: {
        type: 'relationship',
        many: false,
      },
    }

    const data = {
      title: 'Updated Title',
      authorId: 'user-456', // Should be filtered out
      author: {
        connect: { id: 'user-456' },
      },
    }

    const filtered = await filterWritableFields(data, fieldConfigs, 'update', {
      session: null,
      item: { id: 'post-123' },
      context: {
        session: null,
        _isSudo: true,
      } as any,
    })

    expect(filtered).not.toHaveProperty('authorId')
    expect(filtered).toHaveProperty('title', 'Updated Title')
    expect(filtered).toHaveProperty('author')
  })

  it('should not filter fields that happen to end with "Id" but are not foreign keys', async () => {
    const fieldConfigs = {
      trackingId: { type: 'text' }, // Regular field that happens to end with "Id"
      author: {
        type: 'relationship',
        many: false,
      },
    }

    const data = {
      trackingId: 'track-123', // Should NOT be filtered (it's a regular field)
      authorId: 'user-456', // SHOULD be filtered (it's a foreign key)
    }

    const filtered = await filterWritableFields(data, fieldConfigs, 'create', {
      session: null,
      context: {
        session: null,
        _isSudo: true,
      } as any,
    })

    // trackingId is a defined field, so it should remain
    expect(filtered).toHaveProperty('trackingId', 'track-123')

    // authorId is a foreign key for author relationship, so it should be filtered
    expect(filtered).not.toHaveProperty('authorId')
  })
})
