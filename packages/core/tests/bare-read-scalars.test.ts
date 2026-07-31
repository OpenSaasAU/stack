import { describe, it, expect, vi } from 'vitest'
import { getContext } from '../src/context/index.js'
import { config, list } from '../src/config/index.js'
import { text, relationship, virtual } from '../src/fields/index.js'

/**
 * Regression coverage for issue #848 / ADR-0024: a `context.db` read with no
 * `include` (and no fragment `query`) used to auto-include every readable
 * relationship of the list, recursing to `READ_INCLUDE_MAX_DEPTH` and
 * evaluating every related list's operation-level `query` access along the
 * way. It now returns the row's own columns plus its virtual fields — nothing
 * more — matching Prisma's own semantics for a bare read. Relations are
 * fetched only when a caller names them via `include` (covered, unmodified,
 * by the #566/#830 regression suites in `context.test.ts`).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockPrisma(): any {
  return {
    author: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    post: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
  }
}

function buildTestConfig(authorQuerySpy: ReturnType<typeof vi.fn>) {
  return config({
    db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
    lists: {
      Author: list({
        fields: {
          name: text(),
        },
        access: { operation: { query: authorQuerySpy } },
      }),
      Post: list({
        fields: {
          title: text(),
          // List-only ref keeps the schema minimal — the relation still owns
          // an `authorId` foreign-key column, which is what matters here.
          author: relationship({ ref: 'Author' }),
          shout: virtual({
            type: 'string',
            hooks: {
              resolveOutput: ({ item }) => `${(item as { title?: string }).title}!`,
            },
          }),
        },
        access: { operation: { query: () => true } },
      }),
    },
  })
}

describe('a bare read fetches scalars, not relations (#848, ADR-0024)', () => {
  it('findUnique with no include sends no include to the ORM and evaluates no related query access', async () => {
    const authorQuerySpy = vi.fn(() => true)
    const testConfig = await buildTestConfig(authorQuerySpy)
    const mockPrisma = createMockPrisma()
    mockPrisma.post.findFirst.mockResolvedValue({ id: '1', title: 'Hello', authorId: 'a1' })

    const context = getContext(testConfig, mockPrisma, null)
    const result = await context.db.post.findUnique({ where: { id: '1' } })

    expect(mockPrisma.post.findFirst).toHaveBeenCalledWith({
      where: { id: '1' },
      include: undefined,
    })
    // Related list's operation-level `query` access is never invoked — a bare
    // read never even considers whether the relation is fetchable.
    expect(authorQuerySpy).not.toHaveBeenCalled()

    // Own columns (including the FK column) and the computed virtual field
    // are present; the relation key is absent entirely.
    expect(result).toEqual({ id: '1', title: 'Hello', authorId: 'a1', shout: 'Hello!' })
    expect(result).not.toHaveProperty('author')
  })

  it('findMany with no include sends no include to the ORM and evaluates no related query access', async () => {
    const authorQuerySpy = vi.fn(() => true)
    const testConfig = await buildTestConfig(authorQuerySpy)
    const mockPrisma = createMockPrisma()
    mockPrisma.post.findMany.mockResolvedValue([{ id: '1', title: 'Hello', authorId: 'a1' }])

    const context = getContext(testConfig, mockPrisma, null)
    const result = await context.db.post.findMany({})

    expect(mockPrisma.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: undefined }),
    )
    expect(authorQuerySpy).not.toHaveBeenCalled()

    expect(result).toEqual([{ id: '1', title: 'Hello', authorId: 'a1', shout: 'Hello!' }])
    expect(result[0]).not.toHaveProperty('author')
  })

  it('a caller-supplied include still evaluates the related query access (unchanged)', async () => {
    const authorQuerySpy = vi.fn(() => true)
    const testConfig = await buildTestConfig(authorQuerySpy)
    const mockPrisma = createMockPrisma()
    mockPrisma.post.findFirst.mockResolvedValue({
      id: '1',
      title: 'Hello',
      authorId: 'a1',
      author: { id: 'a1', name: 'Ann' },
    })

    const context = getContext(testConfig, mockPrisma, null)
    const result = await context.db.post.findUnique({
      where: { id: '1' },
      include: { author: true },
    })

    expect(authorQuerySpy).toHaveBeenCalled()
    expect(result?.author).toEqual({ id: 'a1', name: 'Ann' })
  })

  it('sudo bare read also sends no include (behaviour already matched Prisma; unaffected by this change)', async () => {
    const authorQuerySpy = vi.fn(() => true)
    const testConfig = await buildTestConfig(authorQuerySpy)
    const mockPrisma = createMockPrisma()
    mockPrisma.post.findFirst.mockResolvedValue({ id: '1', title: 'Hello', authorId: 'a1' })

    const context = getContext(testConfig, mockPrisma, null).sudo()
    const result = await context.db.post.findUnique({ where: { id: '1' } })

    expect(mockPrisma.post.findFirst).toHaveBeenCalledWith({
      where: { id: '1' },
      include: undefined,
    })
    expect(authorQuerySpy).not.toHaveBeenCalled()
    expect(result).toEqual({ id: '1', title: 'Hello', authorId: 'a1', shout: 'Hello!' })
  })
})
