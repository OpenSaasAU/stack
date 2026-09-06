import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getContext } from '../src/context/index.js'
import type { OpenSaasConfig } from '../src/config/types.js'

/**
 * End-to-end regression coverage for issue #974: `include`-ing a to-one
 * relation whose related list's `query` access resolves to a filter used to
 * throw `PrismaClientValidationError` — the access-scoped include builder
 * attached that filter as a nested `where`, which Prisma only accepts on a
 * to-many include. These tests exercise the fix through `context.db`, the
 * same surface the issue's reproduction used, with a membership-derived
 * filter (an `OR` reaching through a relation) matching the reporter's real
 * case — proving the filter is handed to Prisma unmodified rather than
 * hand-evaluated.
 */
describe('include on a to-one relationship with a filtered related list (#974)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockPrisma: any
  let config: OpenSaasConfig
  const membershipFilter = {
    OR: [
      { id: { equals: 'self-id' } },
      { memberships: { some: { studio: { admins: { some: { id: { equals: 'self-id' } } } } } } },
    ],
  }

  beforeEach(() => {
    mockPrisma = {
      Child: { findFirst: vi.fn(), findMany: vi.fn() },
      User: { findFirst: vi.fn(), findMany: vi.fn() },
    }

    config = {
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      lists: {
        Child: {
          fields: {
            name: { type: 'text' },
            owner: { type: 'relationship', ref: 'User' },
          },
          access: { operation: { query: () => true } },
        },
        User: {
          fields: { name: { type: 'text' } },
          access: { operation: { query: () => membershipFilter } },
        },
      },
    }
  })

  it('findMany succeeds instead of throwing, admits a visible owner, and nulls an excluded one', async () => {
    mockPrisma.Child.findMany.mockResolvedValue([
      { id: 'c1', name: 'A', owner: { id: 'u1', name: 'Visible' } },
      { id: 'c2', name: 'B', owner: { id: 'u2', name: 'Hidden' } },
      { id: 'c3', name: 'C', owner: null },
    ])
    // Only u1 satisfies the access filter.
    mockPrisma.User.findMany.mockResolvedValue([{ id: 'u1' }])

    const context = getContext(config, mockPrisma, { userId: 'self-id' })
    const result = await context.db.Child.findMany({ include: { owner: true } })

    // The Prisma call itself carries no `where` on `owner` — this is exactly
    // the shape Prisma rejected before the fix.
    expect(mockPrisma.Child.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: { owner: true } }),
    )

    // One batched existence check, evaluating the EXACT filter `checkAccess`
    // produced — never a hand-rolled interpretation of it.
    expect(mockPrisma.User.findMany).toHaveBeenCalledTimes(1)
    expect(mockPrisma.User.findMany).toHaveBeenCalledWith({
      where: { AND: [membershipFilter, { id: { in: ['u1', 'u2'] } }] },
      select: { id: true },
    })

    expect(result).toHaveLength(3)
    expect(result[0].owner).toEqual({ id: 'u1', name: 'Visible' })
    expect(result[1].owner).toBeNull()
    expect(result[2].owner).toBeNull()
  })

  it('findUnique and findFirst apply the same nulling for a single row', async () => {
    const deniedRow = { id: 'c2', name: 'B', owner: { id: 'u2', name: 'Hidden' } }
    // findUnique reads through the model's own `findFirst`; findFirst is
    // sugar over `findMany` (see `createFindFirst` in context/index.ts) — both
    // need mocking here.
    mockPrisma.Child.findFirst.mockResolvedValue(deniedRow)
    mockPrisma.Child.findMany.mockResolvedValue([deniedRow])
    mockPrisma.User.findMany.mockResolvedValue([])

    const context = getContext(config, mockPrisma, { userId: 'self-id' })
    const viaFindUnique = await context.db.Child.findUnique({
      where: { id: 'c2' },
      include: { owner: true },
    })
    const viaFindFirst = await context.db.Child.findFirst({ include: { owner: true } })

    expect(viaFindUnique?.owner).toBeNull()
    expect(viaFindFirst?.owner).toBeNull()
  })

  it('nulls every parent row when the related list denies query access outright, without issuing an existence check', async () => {
    config.lists.User.access = { operation: { query: () => false } }
    mockPrisma.Child.findMany.mockResolvedValue([
      { id: 'c1', name: 'A' }, // never fetched at all — access-filter drops the key from `include`
    ])

    const context = getContext(config, mockPrisma, { userId: 'self-id' })
    const result = await context.db.Child.findMany({ include: { owner: true } })

    expect(mockPrisma.Child.findMany).toHaveBeenCalledWith(expect.objectContaining({ include: {} }))
    expect(mockPrisma.User.findMany).not.toHaveBeenCalled()
    expect(result[0].owner).toBeNull()
  })

  it('leaves the relation unchanged and issues no extra query when the related list is fully open', async () => {
    config.lists.User.access = { operation: { query: () => true } }
    mockPrisma.Child.findMany.mockResolvedValue([
      { id: 'c1', name: 'A', owner: { id: 'u1', name: 'Ann' } },
    ])

    const context = getContext(config, mockPrisma, { userId: 'self-id' })
    const result = await context.db.Child.findMany({ include: { owner: true } })

    expect(mockPrisma.Child.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: { owner: true } }),
    )
    expect(mockPrisma.User.findMany).not.toHaveBeenCalled()
    expect(result[0].owner).toEqual({ id: 'u1', name: 'Ann' })
  })

  it('scopes a filtered to-one relation nested inside a to-many include, at every row', async () => {
    config.lists.Child.fields.notes = { type: 'relationship', ref: 'Note.child', many: true }
    config.lists.Note = {
      fields: {
        body: { type: 'text' },
        child: { type: 'relationship', ref: 'Child.notes' },
        author: { type: 'relationship', ref: 'User' },
      },
      access: { operation: { query: () => true } },
    }
    mockPrisma.Child.findMany.mockResolvedValue([
      {
        id: 'c1',
        name: 'A',
        notes: [
          { id: 'n1', body: 'ok', author: { id: 'u1', name: 'Visible' } },
          { id: 'n2', body: 'no', author: { id: 'u2', name: 'Hidden' } },
        ],
      },
    ])
    mockPrisma.User.findMany.mockResolvedValue([{ id: 'u1' }])

    const context = getContext(config, mockPrisma, { userId: 'self-id' })
    const result = await context.db.Child.findMany({
      include: { notes: { include: { author: true } } },
    })

    // The to-many `notes` relation still carries no `where` here (Note's
    // query access is fully open); the nested to-one `author` inside it is
    // resolved via ONE batched existence check across both notes.
    expect(mockPrisma.User.findMany).toHaveBeenCalledTimes(1)
    expect(mockPrisma.User.findMany).toHaveBeenCalledWith({
      where: { AND: [membershipFilter, { id: { in: ['u1', 'u2'] } }] },
      select: { id: true },
    })

    expect(result[0].notes[0].author).toEqual({ id: 'u1', name: 'Visible' })
    expect(result[0].notes[1].author).toBeNull()
  })
})
