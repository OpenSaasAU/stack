import { describe, it, expect, vi } from 'vitest'
import { createMcpHandlers } from '../src/mcp/handler.js'
import { getContext as buildContext } from '../src/context/index.js'
import { config, list } from '../src/config/index.js'
import { text, relationship, virtual, checkbox } from '../src/fields/index.js'
import type { McpSessionProvider } from '../src/mcp/types.js'

/**
 * Coverage for issue #851 / ADR-0033: the `query` tool's `fields` projection
 * exercised through the REAL access-control pipeline (`getContext`), not the
 * lightweight mocked-`context.db` harness `mcp-handler.test.ts` uses. This is
 * what actually proves a nested to-many `where` gets AND-combined with the
 * related list's own access filter, a to-one relation failing that filter is
 * nulled by the real existence check, field-level access still drops values
 * regardless of the projection, and a selected computed field's declared
 * `needs` are folded in by the ordinary read pipeline — none of which the
 * mocked-`context.db` harness can exercise, since it bypasses the engine.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockPrisma(): any {
  const model = () => ({
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  })
  return { user: model(), comment: model(), post: model() }
}

async function buildTestConfig() {
  return config({
    db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
    mcp: { enabled: true },
    lists: {
      User: list({
        fields: { name: text() },
        // Only "u1" is queryable — a FILTER, not a boolean, so a to-one
        // relation pointing at a different user gets nulled post-query.
        access: { operation: { query: () => ({ id: { equals: 'u1' } }) } },
      }),
      Comment: list({
        fields: {
          text: text(),
          approved: checkbox(),
          post: relationship({ ref: 'Post.comments' }),
        },
        // Only approved comments are queryable.
        access: { operation: { query: () => ({ approved: { equals: true } }) } },
      }),
      Post: list({
        fields: {
          title: text(),
          author: relationship({ ref: 'User' }),
          comments: relationship({ ref: 'Comment.post', many: true }),
          secret: text({ access: { read: () => false } }),
          commentCount: virtual({
            type: 'number',
            needs: ['comments'],
            hooks: {
              resolveOutput: ({ item }) => {
                const typed = item as { comments?: unknown[] }
                return (typed.comments ?? []).length
              },
            },
          }),
        },
        access: { operation: { query: () => true } },
      }),
    },
  })
}

const mockGetSession: McpSessionProvider = vi.fn(async () => ({ userId: 'me' }))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callPostQuery(testConfig: any, mockPrisma: any, args: Record<string, unknown>) {
  const handlers = createMcpHandlers({
    config: testConfig,
    getSession: mockGetSession,
    getContext: async (session) => buildContext(testConfig, mockPrisma, session ?? null),
  })

  const response = await handlers.POST(
    new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_post_query', arguments: args },
      }),
    }),
  )
  return response.json()
}

describe('MCP `fields` projection against the real access-control pipeline (#851)', () => {
  it('nulls a to-one relation whose related row fails the related list access filter', async () => {
    const testConfig = await buildTestConfig()
    const mockPrisma = createMockPrisma()
    mockPrisma.post.findMany.mockResolvedValue([
      { id: 'p1', title: 'Hi', author: { id: 'u2', name: 'Bob' } },
    ])
    // The batched existence check queries the RAW prisma client for ids
    // matching the access filter — "u2" doesn't, so it comes back empty.
    mockPrisma.user.findMany.mockResolvedValue([])

    const data = await callPostQuery(testConfig, mockPrisma, {
      fields: { title: true, author: { fields: { name: true } } },
    })

    const result = JSON.parse(data.result.content[0].text)
    expect(result.items).toEqual([{ id: 'p1', title: 'Hi', author: null }])
  })

  it('AND-combines a nested to-many where with the related list’s own access filter', async () => {
    const testConfig = await buildTestConfig()
    const mockPrisma = createMockPrisma()
    mockPrisma.post.findMany.mockResolvedValue([
      { id: 'p1', title: 'Hi', comments: [{ id: 'c1', text: 'nice' }] },
    ])

    await callPostQuery(testConfig, mockPrisma, {
      fields: { comments: { fields: { text: true }, where: { text: { contains: 'nice' } } } },
    })

    expect(mockPrisma.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          comments: {
            where: { AND: [{ approved: { equals: true } }, { text: { contains: 'nice' } }] },
            take: 5,
          },
        },
      }),
    )
  })

  it('still drops a field-level-denied field even when named in fields', async () => {
    const testConfig = await buildTestConfig()
    const mockPrisma = createMockPrisma()
    mockPrisma.post.findMany.mockResolvedValue([{ id: 'p1', title: 'Hi', secret: 'shh' }])

    const data = await callPostQuery(testConfig, mockPrisma, {
      fields: { title: true, secret: true },
    })

    const result = JSON.parse(data.result.content[0].text)
    expect(result.items).toEqual([{ id: 'p1', title: 'Hi' }])
  })

  it('running a selected computed field folds its declared `needs`, and the count reflects the access-scoped rows', async () => {
    const testConfig = await buildTestConfig()
    const mockPrisma = createMockPrisma()
    // The engine fetches `comments` unscoped by our projection (folded via
    // `needs`) and access-scopes it exactly like any other named relation —
    // only the approved one should count.
    mockPrisma.post.findMany.mockResolvedValue([
      { id: 'p1', title: 'Hi', comments: [{ id: 'c1', approved: true }] },
    ])

    const data = await callPostQuery(testConfig, mockPrisma, {
      fields: { commentCount: true },
    })

    const result = JSON.parse(data.result.content[0].text)
    expect(result.items).toEqual([{ id: 'p1', commentCount: 1 }])

    // `needs` folded `comments` into the include even though the caller's
    // own `fields` never named it.
    const callArgs = mockPrisma.post.findMany.mock.calls[0][0]
    expect(callArgs.include.comments).toBeDefined()
  })
})
