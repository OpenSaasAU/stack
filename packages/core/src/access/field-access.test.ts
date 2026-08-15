import { describe, it, expect } from 'vitest'
import { checkFieldAccess, filterWritableFields } from './field-access.js'
import { InvalidFieldAccessResultError } from './errors.js'
import { ValidationError } from '../hooks/index.js'

// A non-sudo access context. The cast is localized to test setup (mirrors the
// existing sudo-context casts in this file): the runtime AccessContext carries
// Prisma plumbing the unit under test never touches.
function nonSudoContext() {
  return {
    session: null,
    _isSudo: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function sudoContext() {
  return {
    session: null,
    _isSudo: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

// ── #913: a field rule returning a filter must not be granted blanket access ──

describe('checkFieldAccess', () => {
  it('allows when the rule returns true', async () => {
    const allowed = await checkFieldAccess({ read: () => true }, 'read', {
      session: null,
      item: { ownerId: 'someone-else' },
      context: nonSudoContext(),
    })
    expect(allowed).toBe(true)
  })

  it('denies when the rule returns false', async () => {
    const allowed = await checkFieldAccess({ read: () => false }, 'read', {
      session: null,
      item: { ownerId: 'someone-else' },
      context: nonSudoContext(),
    })
    expect(allowed).toBe(false)
  })

  it('allows when no field access is configured', async () => {
    const allowed = await checkFieldAccess(undefined, 'read', {
      session: null,
      context: nonSudoContext(),
    })
    expect(allowed).toBe(true)
  })

  it('allows when no rule is configured for the operation', async () => {
    const allowed = await checkFieldAccess({ update: () => false }, 'read', {
      session: null,
      context: nonSudoContext(),
    })
    expect(allowed).toBe(true)
  })

  it('throws InvalidFieldAccessResultError, not allow, when a read rule returns a filter', async () => {
    // The exact reproduction from the issue: a rule written to scope a field
    // by row, which the previous fail-open default granted full access to.
    const fieldAccess = {
      read: () => ({ ownerId: { equals: 'someone-else' } }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    await expect(
      checkFieldAccess(fieldAccess, 'read', {
        session: null,
        item: { ownerId: 'the-owner' },
        context: nonSudoContext(),
      }),
    ).rejects.toThrow(InvalidFieldAccessResultError)
  })

  it('throws for a filter-returning rule on create, where there is no item to test it against', async () => {
    const fieldAccess = {
      create: () => ({ ownerId: { equals: 'someone-else' } }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    await expect(
      checkFieldAccess(fieldAccess, 'create', {
        session: null,
        context: nonSudoContext(),
        inputData: { ownerId: 'the-owner' },
      }),
    ).rejects.toThrow(InvalidFieldAccessResultError)
  })

  it('throws for a filter-returning rule on update', async () => {
    const fieldAccess = {
      update: () => ({ ownerId: { equals: 'someone-else' } }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    await expect(
      checkFieldAccess(fieldAccess, 'update', {
        session: null,
        item: { ownerId: 'the-owner' },
        context: nonSudoContext(),
        inputData: { ownerId: 'someone-else' },
      }),
    ).rejects.toThrow(InvalidFieldAccessResultError)
  })

  it('throws for a non-boolean, non-filter result too (e.g. undefined)', async () => {
    const fieldAccess = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      read: () => undefined as any,
    }

    await expect(
      checkFieldAccess(fieldAccess, 'read', {
        session: null,
        item: {},
        context: nonSudoContext(),
      }),
    ).rejects.toThrow(InvalidFieldAccessResultError)
  })

  it('throws with a descriptive message for null, and for other primitive results', async () => {
    const nullAccess = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      read: () => null as any,
    }
    await expect(
      checkFieldAccess(nullAccess, 'read', {
        session: null,
        item: {},
        context: nonSudoContext(),
      }),
    ).rejects.toThrow(/returned null, not a boolean/)

    const numberAccess = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      read: () => 42 as any,
    }
    await expect(
      checkFieldAccess(numberAccess, 'read', {
        session: null,
        item: {},
        context: nonSudoContext(),
      }),
    ).rejects.toThrow(/returned a number, not a boolean/)
  })

  it('sudo bypasses the rule entirely, so a filter-returning rule never reaches the throw', async () => {
    const fieldAccess = {
      read: () => ({ ownerId: { equals: 'someone-else' } }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    const allowed = await checkFieldAccess(fieldAccess, 'read', {
      session: null,
      item: { ownerId: 'the-owner' },
      context: sudoContext(),
    })
    expect(allowed).toBe(true)
  })
})

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      inputData: data,
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      inputData: data,
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      inputData: data,
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      inputData: data,
    })

    // trackingId is a defined field, so it should remain
    expect(filtered).toHaveProperty('trackingId', 'track-123')

    // authorId is a foreign key for author relationship, so it should be filtered
    expect(filtered).not.toHaveProperty('authorId')
  })

  // ── #564: undeclared data keys must fail CLOSED (throw) for non-sudo writes ──

  it('throws on an undeclared data key for a non-sudo create', async () => {
    const fieldConfigs = { title: { type: 'text' } }
    const data = {
      title: 'Test',
      // Not a declared field — e.g. a Prisma back-relation the config never
      // exposed (`from_Enrolment_student`). Must be rejected, not passed through.
      from_Enrolment_student: { disconnect: [{ id: 'e1' }] },
    }

    await expect(
      filterWritableFields(data, fieldConfigs, 'create', {
        session: null,
        context: nonSudoContext(),
        inputData: data,
      }),
    ).rejects.toThrow(ValidationError)
    await expect(
      filterWritableFields(data, fieldConfigs, 'create', {
        session: null,
        context: nonSudoContext(),
        inputData: data,
      }),
    ).rejects.toThrow(/from_Enrolment_student/)
  })

  it('throws on an undeclared data key for a non-sudo update', async () => {
    const fieldConfigs = { title: { type: 'text' } }
    const data = {
      title: 'Updated',
      bogusKey: 'value',
    }

    await expect(
      filterWritableFields(data, fieldConfigs, 'update', {
        session: null,
        item: { id: 'post-1' },
        context: nonSudoContext(),
        inputData: data,
      }),
    ).rejects.toThrow(/bogusKey/)
  })

  it('passes undeclared data keys through under sudo (the single trusted bypass)', async () => {
    const fieldConfigs = { title: { type: 'text' } }
    const data = {
      title: 'Test',
      from_Enrolment_student: { disconnect: [{ id: 'e1' }] },
    }

    const filtered = await filterWritableFields(data, fieldConfigs, 'create', {
      session: null,
      context: sudoContext(),
      inputData: data,
    })

    expect(filtered).toHaveProperty('title', 'Test')
    expect(filtered).toHaveProperty('from_Enrolment_student')
  })

  it('still skips system fields and relationship FK fields cleanly for a non-sudo write', async () => {
    const fieldConfigs = {
      title: { type: 'text' },
      author: { type: 'relationship', many: false },
    }
    const data = {
      id: 'post-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      title: 'Test',
      authorId: 'user-1', // FK skipped, not rejected
    }

    const filtered = await filterWritableFields(data, fieldConfigs, 'create', {
      session: null,
      context: nonSudoContext(),
      inputData: data,
    })

    expect(filtered).not.toHaveProperty('id')
    expect(filtered).not.toHaveProperty('createdAt')
    expect(filtered).not.toHaveProperty('updatedAt')
    expect(filtered).not.toHaveProperty('authorId')
    expect(filtered).toHaveProperty('title', 'Test')
  })

  it('passes through raw per-part columns from a multi-column field whose write access ALLOWS (non-sudo)', async () => {
    // Multi-column fields inject raw columns (e.g. m_url/m_size) that are not
    // declared in fieldConfigs; they must not trip the undeclared-key reject.
    // With no field-level access (allow), they pass through.
    const fieldConfigs = {
      media: {
        type: 'image',
        getColumnNames: (fieldName: string) => [`${fieldName}_url`, `${fieldName}_size`],
      },
    }
    const data = {
      media_url: 'https://x/y.jpg',
      media_size: 99,
    }

    const filtered = await filterWritableFields(data, fieldConfigs, 'create', {
      session: null,
      context: nonSudoContext(),
      inputData: data,
    })

    expect(filtered).toHaveProperty('media_url', 'https://x/y.jpg')
    expect(filtered).toHaveProperty('media_size', 99)
  })

  it('THROWS when raw split columns are supplied for a field whose write access is DENIED (non-sudo)', async () => {
    // Security (#568): a non-sudo caller who supplies the raw per-part columns
    // DIRECTLY must not bypass the owning field's write-access gate. The
    // logical-key gate in the hooks layer never fires here (no `media` key), so
    // this filter is the only enforcement point — it must throw.
    const fieldConfigs = {
      media: {
        type: 'image',
        access: { create: () => false, update: () => false },
        getColumnNames: (fieldName: string) => [`${fieldName}_url`, `${fieldName}_size`],
      },
    }
    const data = {
      media_url: 'https://evil/x.jpg',
      media_size: 1,
    }

    // Throws ValidationError, and the message names the owning field.
    await expect(
      filterWritableFields(data, fieldConfigs, 'create', {
        session: null,
        context: nonSudoContext(),
        inputData: data,
      }),
    ).rejects.toThrow(ValidationError)
    await expect(
      filterWritableFields(data, fieldConfigs, 'update', {
        session: null,
        item: { id: 'item-1' },
        context: nonSudoContext(),
        inputData: data,
      }),
    ).rejects.toThrow(/media/)
  })

  it('passes raw split columns through under sudo regardless of denied owning-field access', async () => {
    // sudo is the single trusted bypass; `checkFieldAccess` returns true under
    // sudo, so even a would-be-denied multi-column field passes through.
    const fieldConfigs = {
      media: {
        type: 'image',
        access: { create: () => false, update: () => false },
        getColumnNames: (fieldName: string) => [`${fieldName}_url`, `${fieldName}_size`],
      },
    }
    const data = {
      media_url: 'https://x/y.jpg',
      media_size: 99,
    }

    const filtered = await filterWritableFields(data, fieldConfigs, 'create', {
      session: null,
      context: sudoContext(),
      inputData: data,
    })

    expect(filtered).toHaveProperty('media_url', 'https://x/y.jpg')
    expect(filtered).toHaveProperty('media_size', 99)
  })

  // ── #568: field-access-denied keys must THROW, not be silently stripped ──────

  it('throws when a declared field is denied by field-level access (non-sudo)', async () => {
    const fieldConfigs = {
      title: { type: 'text' },
      status: {
        type: 'text',
        access: { update: () => false, create: () => false },
      },
    }
    const data = { title: 'Test', status: 'published' }

    await expect(
      filterWritableFields(data, fieldConfigs, 'update', {
        session: null,
        item: { id: 'post-1' },
        context: nonSudoContext(),
        inputData: data,
      }),
    ).rejects.toThrow(/status/)
  })

  // ── #913: a field rule returning a filter must not grant blanket write access ──

  it('throws InvalidFieldAccessResultError, not a blanket write, when field access returns a filter (non-sudo)', async () => {
    const fieldConfigs = {
      title: { type: 'text' },
      status: {
        type: 'text',
        access: {
          // Written as a row-scoping rule; field access does not honour filters.
          update: () => ({ status: { equals: 'draft' } }),
          create: () => ({ status: { equals: 'draft' } }),
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
    const data = { title: 'Test', status: 'published' }

    await expect(
      filterWritableFields(data, fieldConfigs, 'update', {
        session: null,
        item: { id: 'post-1', status: 'draft' },
        context: nonSudoContext(),
        inputData: data,
      }),
    ).rejects.toThrow(InvalidFieldAccessResultError)
  })

  it('does NOT throw on a would-be-denied field under sudo', async () => {
    const fieldConfigs = {
      title: { type: 'text' },
      status: {
        type: 'text',
        access: { update: () => false, create: () => false },
      },
    }
    const data = { title: 'Test', status: 'published' }

    const filtered = await filterWritableFields(data, fieldConfigs, 'update', {
      session: null,
      item: { id: 'post-1' },
      context: sudoContext(),
      inputData: data,
    })

    expect(filtered).toHaveProperty('title', 'Test')
    expect(filtered).toHaveProperty('status', 'published')
  })

  it('passes a declared relationship field through to nested operations (non-sudo)', async () => {
    const fieldConfigs = {
      title: { type: 'text' },
      author: { type: 'relationship', many: false },
    }
    const data = {
      title: 'Test',
      author: { connect: { id: 'user-1' } },
    }

    const filtered = await filterWritableFields(data, fieldConfigs, 'create', {
      session: null,
      context: nonSudoContext(),
      inputData: data,
    })

    expect(filtered).toHaveProperty('author')
    expect(filtered.author).toEqual({ connect: { id: 'user-1' } })
  })
})
