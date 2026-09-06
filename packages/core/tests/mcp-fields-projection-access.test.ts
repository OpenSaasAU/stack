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
  return { User: model(), Comment: model(), Post: model() }
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
          // Field-level read denied on the RELATIONSHIP FIELD itself —
          // distinct from a related list's operation-level access.
          restrictedComments: relationship({
            ref: 'Comment',
            many: true,
            access: { read: () => false },
          }),
          // Field-level read access that depends on the relation's OWN
          // fetched value — proves the count mechanism doesn't corrupt that
          // value with a synthetic empty array to make the check cheaper.
          commentsVisibleIfEmpty: relationship({
            ref: 'Comment',
            many: true,
            access: {
              read: ({ item }) => {
                const value = (item as { commentsVisibleIfEmpty?: unknown[] })
                  .commentsVisibleIfEmpty
                return Array.isArray(value) ? value.length === 0 : true
              },
            },
          }),
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
    mockPrisma.Post.findMany.mockResolvedValue([
      { id: 'p1', title: 'Hi', author: { id: 'u2', name: 'Bob' } },
    ])
    // The batched existence check queries the RAW ORM handle for ids
    // matching the access filter — "u2" doesn't, so it comes back empty.
    mockPrisma.User.findMany.mockResolvedValue([])

    const data = await callPostQuery(testConfig, mockPrisma, {
      fields: { title: true, author: { fields: { name: true } } },
    })

    const result = JSON.parse(data.result.content[0].text)
    expect(result.items).toEqual([{ id: 'p1', title: 'Hi', author: null }])
  })

  it('AND-combines a nested to-many where with the related list’s own access filter', async () => {
    const testConfig = await buildTestConfig()
    const mockPrisma = createMockPrisma()
    mockPrisma.Post.findMany.mockResolvedValue([
      { id: 'p1', title: 'Hi', comments: [{ id: 'c1', text: 'nice' }] },
    ])

    await callPostQuery(testConfig, mockPrisma, {
      fields: { comments: { fields: { text: true }, where: { text: { contains: 'nice' } } } },
    })

    expect(mockPrisma.Post.findMany).toHaveBeenCalledWith(
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
    mockPrisma.Post.findMany.mockResolvedValue([{ id: 'p1', title: 'Hi', secret: 'shh' }])

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
    mockPrisma.Post.findMany.mockResolvedValue([
      { id: 'p1', title: 'Hi', comments: [{ id: 'c1', approved: true }] },
    ])

    const data = await callPostQuery(testConfig, mockPrisma, {
      fields: { commentCount: true },
    })

    const result = JSON.parse(data.result.content[0].text)
    expect(result.items).toEqual([{ id: 'p1', commentCount: 1 }])

    // `needs` folded `comments` into the include even though the caller's
    // own `fields` never named it.
    const callArgs = mockPrisma.Post.findMany.mock.calls[0][0]
    expect(callArgs.include.comments).toBeDefined()
  })

  it('suppresses a relation count denied by the relationship field’s own access, through the real field-visibility pass', async () => {
    const testConfig = await buildTestConfig()
    const mockPrisma = createMockPrisma()
    // The real pipeline's `filterReadableFields` runs before `projectMcpResult`
    // ever sees this row: it evaluates `restrictedComments`'s field-level
    // `access.read` against the TRUE raw row below and strips the key
    // entirely (denied), so `_count.restrictedComments` survives in the raw
    // Prisma row but the relation key itself does not.
    mockPrisma.Post.findMany.mockResolvedValue([
      { id: 'p1', title: 'Hi', restrictedComments: [], _count: { restrictedComments: 4 } },
    ])

    const data = await callPostQuery(testConfig, mockPrisma, {
      fields: { title: true, restrictedComments: { count: true } },
    })

    const result = JSON.parse(data.result.content[0].text)
    expect(result.items).toEqual([{ id: 'p1', title: 'Hi' }])
  })

  it('evaluates a value-dependent field-level access rule against the relation’s TRUE fetched rows, not a synthetic empty placeholder', async () => {
    const testConfig = await buildTestConfig()
    const mockPrisma = createMockPrisma()
    // `commentsVisibleIfEmpty`'s own access rule denies read when the
    // relation actually has rows. A `take: 0` "cheap" fetch would make
    // field-visibility see an empty array regardless of the truth and
    // wrongly GRANT access here — asserting the count is suppressed proves
    // the real (non-empty) rows reached the access check.
    mockPrisma.Post.findMany.mockResolvedValue([
      {
        id: 'p1',
        title: 'Hi',
        commentsVisibleIfEmpty: [{ id: 'c1', text: 'nice' }],
        _count: { commentsVisibleIfEmpty: 1 },
      },
    ])

    const data = await callPostQuery(testConfig, mockPrisma, {
      fields: { title: true, commentsVisibleIfEmpty: { count: true } },
    })

    const result = JSON.parse(data.result.content[0].text)
    expect(result.items).toEqual([{ id: 'p1', title: 'Hi' }])

    // Real rows were fetched (access-scoped by Comment's own operation-level
    // query access, folded in the same way any other named relation is) —
    // never a synthetic `take: 0` placeholder.
    const callArgs = mockPrisma.Post.findMany.mock.calls[0][0]
    expect(callArgs.include.commentsVisibleIfEmpty).toMatchObject({ take: 5 })
    expect(callArgs.include.commentsVisibleIfEmpty.take).not.toBe(0)
  })
})
