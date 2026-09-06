import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as z from 'zod'
import { createMcpHandlers } from '../src/mcp/handler.js'
import type { OpenSaasConfig } from '../src/config/types.js'
import type { AccessContext } from '../src/access/types.js'
import type { McpSession, McpSessionProvider } from '../src/mcp/types.js'
import { HashedPassword } from '../src/utils/password.js'
import {
  AccessScopeDepthExceededError,
  RelationFilterAccessDeniedError,
} from '../src/access/errors.js'

describe('MCP Handler', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockPrisma: any
  let config: OpenSaasConfig
  let getContext: (session?: { userId: string }) => AccessContext
  let mockGetSession: McpSessionProvider

  beforeEach(() => {
    // Mock Prisma client
    mockPrisma = {
      post: {
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    }

    // Sample config with MCP enabled
    config = {
      db: {
        provider: 'postgresql',
        url: 'postgresql://localhost:5432/test',
      },
      mcp: {
        enabled: true,
        basePath: '/api/mcp',
      },
      lists: {
        Post: {
          fields: {
            title: { type: 'text', validation: { isRequired: true } },
            content: { type: 'text' },
          },
          access: {
            operation: {
              query: () => true,
              create: ({ session }) => !!session,
              update: ({ session }) => !!session,
              delete: ({ session }) => !!session,
            },
          },
        },
      },
    }

    // Mock getContext function
    getContext = vi.fn((session?: { userId: string }) => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: mockPrisma as any,
      session: session || null,
      ormHandle: mockPrisma,
    }))

    // Mock session provider
    mockGetSession = vi.fn(async () => ({
      userId: 'user-123',
      scopes: ['read', 'write'],
    }))
  })

  describe('createMcpHandlers', () => {
    it('should create GET, POST, DELETE handlers', () => {
      const handlers = createMcpHandlers({ config, getSession: mockGetSession, getContext })

      expect(handlers.GET).toBeDefined()
      expect(handlers.POST).toBeDefined()
      expect(handlers.DELETE).toBeDefined()
      expect(typeof handlers.GET).toBe('function')
      expect(typeof handlers.POST).toBe('function')
      expect(typeof handlers.DELETE).toBe('function')
    })

    it('should return 404 when MCP is not enabled', async () => {
      const disabledConfig = { ...config, mcp: { enabled: false } }
      const handlers = createMcpHandlers({
        config: disabledConfig,
        getSession: mockGetSession,
        getContext,
      })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'initialize' }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(404)

      const data = await response.json()
      expect(data.error).toBe('MCP not enabled')
    })

    it('should return 401 when session is not provided', async () => {
      const noSessionProvider: McpSessionProvider = vi.fn(async () => null)
      const handlers = createMcpHandlers({
        config,
        getSession: noSessionProvider,
        getContext,
      })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'initialize' }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(401)
      expect(response.headers.get('WWW-Authenticate')).toContain('Bearer')
    })
  })

  describe('initialize method', () => {
    it('should handle initialize request', async () => {
      const handlers = createMcpHandlers({ config, getSession: mockGetSession, getContext })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {},
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.jsonrpc).toBe('2.0')
      expect(data.id).toBe(1)
      expect(data.result.protocolVersion).toBe('2024-11-05')
      expect(data.result.capabilities.tools).toBeDefined()
      expect(data.result.serverInfo.name).toBe('opensaas-mcp-server')
    })
  })

  describe('notifications/initialized method', () => {
    it('should handle initialized notification with 204 response', async () => {
      const handlers = createMcpHandlers({ config, getSession: mockGetSession, getContext })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(204)
    })
  })

  describe('tools/list method', () => {
    it('should list all CRUD tools for enabled lists', async () => {
      const handlers = createMcpHandlers({ config, getSession: mockGetSession, getContext })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.result.tools).toBeDefined()
      expect(Array.isArray(data.result.tools)).toBe(true)

      const toolNames = data.result.tools.map((t: { name: string }) => t.name)
      expect(toolNames).toContain('list_post_query')
      expect(toolNames).toContain('list_post_create')
      expect(toolNames).toContain('list_post_update')
      expect(toolNames).toContain('list_post_delete')
    })

    it('should exclude disabled tools', async () => {
      const configWithDisabledTools = {
        ...config,
        lists: {
          Post: {
            ...config.lists.Post,
            mcp: {
              tools: {
                read: true,
                create: true,
                update: false,
                delete: false,
              },
            },
          },
        },
      }

      const handlers = createMcpHandlers({
        config: configWithDisabledTools,
        getSession: mockGetSession,
        getContext,
      })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
        }),
      })

      const response = await handlers.POST(request)
      const data = await response.json()

      const toolNames = data.result.tools.map((t: { name: string }) => t.name)
      expect(toolNames).toContain('list_post_query')
      expect(toolNames).toContain('list_post_create')
      expect(toolNames).not.toContain('list_post_update')
      expect(toolNames).not.toContain('list_post_delete')
    })

    it('should include custom tools', async () => {
      const configWithCustomTools = {
        ...config,
        lists: {
          Post: {
            ...config.lists.Post,
            mcp: {
              customTools: [
                {
                  name: 'publishPost',
                  description: 'Publish a post',
                  inputSchema: {
                    type: 'object' as const,
                    properties: { postId: { type: 'string' } },
                  },
                  handler: vi.fn(),
                },
              ],
            },
          },
        },
      }

      const handlers = createMcpHandlers({
        config: configWithCustomTools,
        getSession: mockGetSession,
        getContext,
      })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
        }),
      })

      const response = await handlers.POST(request)
      const data = await response.json()

      const toolNames = data.result.tools.map((t: { name: string }) => t.name)
      expect(toolNames).toContain('publishPost')
    })
  })

  describe('tools/call method - CRUD operations', () => {
    it('should execute query operation', async () => {
      const mockResults = [
        { id: '1', title: 'Post 1', content: 'Content 1' },
        { id: '2', title: 'Post 2', content: 'Content 2' },
      ]
      mockPrisma.post.findMany.mockResolvedValue(mockResults)

      const handlers = createMcpHandlers({ config, getSession: mockGetSession, getContext })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'list_post_query',
            arguments: {
              where: {},
              take: 10,
            },
          },
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.result.content[0].type).toBe('text')

      const result = JSON.parse(data.result.content[0].text)
      expect(result.items).toEqual(mockResults)
      expect(result.count).toBe(2)
      expect(mockPrisma.post.findMany).toHaveBeenCalledWith({
        where: {},
        take: 10,
        skip: undefined,
        orderBy: undefined,
      })
    })

    // Regression test (issue #907 / ADR-0029): a bare `JSON.stringify` throws
    // `TypeError: Do not know how to serialize a BigInt` on a bigInt() field's
    // value. This must respond successfully, rendering the value as a decimal
    // string — the field's MCP wire representation.
    it('should serialize a bigint field value as a decimal string instead of throwing', async () => {
      const mockResults = [{ id: '1', title: 'Post 1', occurredAtMs: 9007199254740993n }]
      mockPrisma.post.findMany.mockResolvedValue(mockResults)

      const handlers = createMcpHandlers({ config, getSession: mockGetSession, getContext })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'list_post_query',
            arguments: { where: {}, take: 10 },
          },
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.result.content[0].text).toContain('"occurredAtMs": "9007199254740993"')

      const result = JSON.parse(data.result.content[0].text)
      expect(result.items[0].occurredAtMs).toBe('9007199254740993')
    })

    // Regression test (issue #965): the response's JSON.stringify replacer runs
    // AFTER toJSON, so it can't intercept a HashedPassword that leaks its hash
    // from toJSON — the redaction has to live in HashedPassword itself.
    it('should not leak a bcrypt hash for a password field in the query response', async () => {
      const hash = '$2b$04$q5yvruv7NaUYCQvV.UGzf.92.dpteicGq5MoSHYNWqzIm.bsIIJrW'
      const mockResults = [{ id: '1', title: 'Post 1', password: new HashedPassword(hash) }]
      mockPrisma.post.findMany.mockResolvedValue(mockResults)

      const handlers = createMcpHandlers({ config, getSession: mockGetSession, getContext })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'list_post_query',
            arguments: { where: {}, take: 10 },
          },
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(200)

      const data = await response.json()
      const responseBody = data.result.content[0].text
      expect(responseBody).not.toContain(hash)

      const result = JSON.parse(responseBody)
      expect(result.items[0].password).toEqual({ isSet: true })
    })

    it('should execute create operation', async () => {
      const mockResult = { id: '1', title: 'New Post', content: 'New Content' }
      mockPrisma.post.create.mockResolvedValue(mockResult)

      const handlers = createMcpHandlers({ config, getSession: mockGetSession, getContext })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'list_post_create',
            arguments: {
              data: { title: 'New Post', content: 'New Content' },
            },
          },
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(200)

      const data = await response.json()
      const result = JSON.parse(data.result.content[0].text)
      expect(result.success).toBe(true)
      expect(result.item).toEqual(mockResult)
      expect(mockPrisma.post.create).toHaveBeenCalledWith({
        data: { title: 'New Post', content: 'New Content' },
      })
    })

    it('should execute update operation', async () => {
      const mockResult = { id: '1', title: 'Updated Post', content: 'Updated Content' }
      mockPrisma.post.update.mockResolvedValue(mockResult)

      const handlers = createMcpHandlers({ config, getSession: mockGetSession, getContext })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'list_post_update',
            arguments: {
              where: { id: '1' },
              data: { title: 'Updated Post' },
            },
          },
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(200)

      const data = await response.json()
      const result = JSON.parse(data.result.content[0].text)
      expect(result.success).toBe(true)
      expect(result.item).toEqual(mockResult)
    })

    it('should execute delete operation', async () => {
      const mockResult = { id: '1', title: 'Deleted Post', content: 'Deleted Content' }
      mockPrisma.post.delete.mockResolvedValue(mockResult)

      const handlers = createMcpHandlers({ config, getSession: mockGetSession, getContext })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'list_post_delete',
            arguments: {
              where: { id: '1' },
            },
          },
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(200)

      const data = await response.json()
      const result = JSON.parse(data.result.content[0].text)
      expect(result.success).toBe(true)
      expect(result.deletedId).toBe('1')
    })

    it('should limit query results to max 100', async () => {
      mockPrisma.post.findMany.mockResolvedValue([])

      const handlers = createMcpHandlers({ config, getSession: mockGetSession, getContext })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'list_post_query',
            arguments: {
              take: 200, // Request more than max
            },
          },
        }),
      })

      await handlers.POST(request)

      expect(mockPrisma.post.findMany).toHaveBeenCalledWith({
        where: undefined,
        take: 100, // Should be limited to 100
        skip: undefined,
        orderBy: undefined,
      })
    })

    it('should handle access denied by returning error', async () => {
      mockPrisma.post.create.mockResolvedValue(null) // Simulates access denial

      const handlers = createMcpHandlers({ config, getSession: mockGetSession, getContext })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'list_post_create',
            arguments: {
              data: { title: 'Test' },
            },
          },
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.error).toBeUndefined()
      expect(data.result.isError).toBe(true)
      expect(data.result.content[0].text).toContain('Access denied')
    })
  })

  describe('tools/call method - custom tools', () => {
    it('should execute custom tool handler', async () => {
      const customHandler = vi.fn(async () => ({ published: true }))

      const configWithCustomTools = {
        ...config,
        lists: {
          Post: {
            ...config.lists.Post,
            mcp: {
              customTools: [
                {
                  name: 'publishPost',
                  description: 'Publish a post',
                  inputSchema: {
                    type: 'object' as const,
                    properties: { postId: { type: 'string' } },
                  },
                  handler: customHandler,
                },
              ],
            },
          },
        },
      }

      const handlers = createMcpHandlers({
        config: configWithCustomTools,
        getSession: mockGetSession,
        getContext,
      })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'publishPost',
            arguments: {
              postId: 'post-123',
            },
          },
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(200)

      expect(customHandler).toHaveBeenCalledWith({
        input: { postId: 'post-123' },
        context: expect.any(Object),
      })

      const data = await response.json()
      const result = JSON.parse(data.result.content[0].text)
      expect(result.published).toBe(true)
    })

    it('should handle unknown tool name', async () => {
      const handlers = createMcpHandlers({ config, getSession: mockGetSession, getContext })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'unknown_tool',
            arguments: {},
          },
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(400)

      const data = await response.json()
      expect(data.error.message).toContain('Unknown tool')
    })

    it('should return a custom tool input schema validation failure as a tool result', async () => {
      const configWithCustomTools = {
        ...config,
        lists: {
          Post: {
            ...config.lists.Post,
            mcp: {
              customTools: [
                {
                  name: 'publishPost',
                  description: 'Publish a post',
                  inputSchema: z.object({ postId: z.string() }),
                  handler: vi.fn(),
                },
              ],
            },
          },
        },
      }

      const handlers = createMcpHandlers({
        config: configWithCustomTools,
        getSession: mockGetSession,
        getContext,
      })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'publishPost',
            arguments: {},
          },
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.error).toBeUndefined()
      expect(data.result.isError).toBe(true)
      expect(data.result.content[0].text).toContain('Invalid params')
    })

    it('should return a thrown custom tool error as a tool result', async () => {
      const configWithCustomTools = {
        ...config,
        lists: {
          Post: {
            ...config.lists.Post,
            mcp: {
              customTools: [
                {
                  name: 'publishPost',
                  description: 'Publish a post',
                  inputSchema: {
                    type: 'object' as const,
                    properties: { postId: { type: 'string' } },
                  },
                  handler: vi.fn(async () => {
                    throw new Error('cannot publish an already-published post')
                  }),
                },
              ],
            },
          },
        },
      }

      const handlers = createMcpHandlers({
        config: configWithCustomTools,
        getSession: mockGetSession,
        getContext,
      })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'publishPost',
            arguments: { postId: 'post-123' },
          },
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.error).toBeUndefined()
      expect(data.result.isError).toBe(true)
      expect(data.result.content[0].text).toContain('cannot publish an already-published post')
    })
  })

  describe('error handling', () => {
    it('should handle invalid method', async () => {
      const handlers = createMcpHandlers({ config, getSession: mockGetSession, getContext })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'invalid/method',
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(400)

      const data = await response.json()
      expect(data.error.code).toBe(-32601)
      expect(data.error.message).toBe('Method not found')
    })

    it('should handle missing tool name in tools/call', async () => {
      const handlers = createMcpHandlers({ config, getSession: mockGetSession, getContext })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            arguments: {},
          },
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(400)

      const data = await response.json()
      expect(data.error.message).toContain('Tool name required')
    })

    it('should handle operation errors gracefully', async () => {
      mockPrisma.post.findMany.mockRejectedValue(new Error('Database error'))

      const handlers = createMcpHandlers({ config, getSession: mockGetSession, getContext })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'list_post_query',
            arguments: {},
          },
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.error).toBeUndefined()
      expect(data.result.isError).toBe(true)
      expect(data.result.content[0].text).toContain('Database error')
    })

    it('should return a relation-filter access-denial error as a tool result naming the relation and related list', async () => {
      mockPrisma.post.findMany.mockRejectedValue(
        new RelationFilterAccessDeniedError('Post', 'author', 'User'),
      )

      const handlers = createMcpHandlers({ config, getSession: mockGetSession, getContext })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'list_post_query',
            arguments: { where: { author: { is: {} } } },
          },
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.error).toBeUndefined()
      expect(data.result.isError).toBe(true)
      expect(data.result.content[0].text).toContain('Post.author')
      expect(data.result.content[0].text).toContain('User')
    })

    it('should return a depth-exceeded error as a tool result worded as a cost refusal', async () => {
      mockPrisma.post.findMany.mockRejectedValue(
        new AccessScopeDepthExceededError('Post', 'author', 3),
      )

      const handlers = createMcpHandlers({ config, getSession: mockGetSession, getContext })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'list_post_query',
            arguments: {},
          },
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.error).toBeUndefined()
      expect(data.result.isError).toBe(true)
      expect(data.result.content[0].text).toContain('Post.author')
      expect(data.result.content[0].text).toContain('cost limit')
    })
  })

  describe('session integration', () => {
    it('should pass session to getContext', async () => {
      const mockSession: McpSession = {
        userId: 'user-456',
        scopes: ['admin'],
      }

      const sessionProvider: McpSessionProvider = vi.fn(async () => mockSession)
      const mockGetContext = vi.fn((session?: { userId: string }) => ({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        db: mockPrisma as any,
        session: session || null,
        ormHandle: mockPrisma,
      }))

      mockPrisma.post.findMany.mockResolvedValue([])

      const handlers = createMcpHandlers({
        config,
        getSession: sessionProvider,
        getContext: mockGetContext,
      })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'list_post_query',
            arguments: {},
          },
        }),
      })

      await handlers.POST(request)

      expect(mockGetContext).toHaveBeenCalledWith({ userId: 'user-456' })
    })
  })
})

// Coverage for issue #851 / ADR-0033: the `query` tool's `fields` projection
// argument, its generated per-session schema, and `tools/list` becoming
// per-session. Uses the same lightweight mocked-`context.db` harness as the
// suite above — these tests exercise the MCP-layer translation (schema
// shape, `fields` → `include` translation, response projection) rather than
// the real access-control engine, which is covered separately in
// `mcp-fields-projection-access.test.ts` against a real `getContext`.
describe('MCP Handler — fields projection (#851)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockPrisma: any
  let config: OpenSaasConfig
  let getContext: (session?: { userId: string }) => AccessContext
  let mockGetSession: McpSessionProvider

  beforeEach(() => {
    mockPrisma = {
      user: { findMany: vi.fn() },
      comment: { findMany: vi.fn() },
      post: { findMany: vi.fn() },
      secret: { findMany: vi.fn() },
      draft: { findMany: vi.fn() },
      category: { findMany: vi.fn() },
    }

    config = {
      db: { provider: 'postgresql', url: 'postgresql://localhost:5432/test' },
      mcp: { enabled: true, basePath: '/api/mcp' },
      lists: {
        User: {
          fields: {
            name: { type: 'text' },
            email: { type: 'text' },
          },
          access: { operation: { query: () => true } },
        },
        Comment: {
          fields: {
            text: { type: 'text' },
            approved: { type: 'checkbox' },
            // Field-level read denied — used to prove a nested `where`/
            // `orderBy` can't name a field this session cannot read.
            internalNote: { type: 'text', access: { read: () => false } },
            post: { type: 'relationship', ref: 'Post.comments' },
          },
          access: { operation: { query: () => true } },
        },
        Post: {
          fields: {
            title: { type: 'text' },
            content: { type: 'text' },
            author: { type: 'relationship', ref: 'User' },
            comments: { type: 'relationship', ref: 'Comment.post', many: true },
            // Field-level read denied on the RELATIONSHIP FIELD ITSELF —
            // distinct from a related list's operation-level access — used
            // to prove `count` can't bypass it.
            restrictedComments: {
              type: 'relationship',
              ref: 'Comment',
              many: true,
              access: { read: () => false },
            },
            secretInfo: { type: 'relationship', ref: 'Secret' },
            draftRef: { type: 'relationship', ref: 'Draft' },
          },
          access: { operation: { query: () => true } },
        },
        // Denies query access outright — must vanish from `tools/list` as a
        // tool owner AND from `Post`'s `fields` schema as a relation target.
        Secret: {
          fields: { value: { type: 'text' } },
          access: { operation: { query: () => false } },
        },
        // MCP-disabled — same double omission as `Secret`, different cause.
        Draft: {
          fields: { title: { type: 'text' } },
          access: { operation: { query: () => true } },
          mcp: { enabled: false },
        },
        // Self-referential — the schema must terminate at depth 2 rather
        // than recursing forever.
        Category: {
          fields: {
            name: { type: 'text' },
            parent: { type: 'relationship', ref: 'Category.children' },
            children: { type: 'relationship', ref: 'Category.parent', many: true },
          },
          access: { operation: { query: () => true } },
        },
      },
    }

    getContext = vi.fn((session?: { userId: string }) => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: mockPrisma as any,
      session: session || null,
      ormHandle: mockPrisma,
    }))

    mockGetSession = vi.fn(async () => ({ userId: 'user-123' }))
  })

  async function listTools() {
    const handlers = createMcpHandlers({ config, getSession: mockGetSession, getContext })
    const request = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    const response = await handlers.POST(request)
    const data = await response.json()
    return data.result.tools as Array<{ name: string; inputSchema: Record<string, unknown> }>
  }

  async function callQuery(
    name: string,
    args: Record<string, unknown>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    const handlers = createMcpHandlers({ config, getSession: mockGetSession, getContext })
    const request = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    })
    const response = await handlers.POST(request)
    return response.json()
  }

  describe('generated `fields` schema on tools/list', () => {
    it('advertises scalars as booleans and relations as nested selectors', async () => {
      const tools = await listTools()
      const postQuery = tools.find((t) => t.name === 'list_post_query')!
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fieldsSchema = (postQuery.inputSchema.properties as any).fields

      expect(fieldsSchema.properties.title).toMatchObject({ type: 'boolean' })
      expect(fieldsSchema.properties.content).toMatchObject({ type: 'boolean' })

      // To-one: nested `fields` only, required, no where/orderBy/take/skip/count.
      expect(fieldsSchema.properties.author.required).toEqual(['fields'])
      const authorFields = fieldsSchema.properties.author.properties.fields.properties
      expect(authorFields.name).toMatchObject({ type: 'boolean' })
      expect(authorFields.email).toMatchObject({ type: 'boolean' })
      expect(fieldsSchema.properties.author.properties.where).toBeUndefined()

      // To-many: fields optional, plus where/orderBy/take/skip/count.
      expect(fieldsSchema.properties.comments.required).toBeUndefined()
      const commentFields = fieldsSchema.properties.comments.properties.fields.properties
      expect(commentFields.text).toMatchObject({ type: 'boolean' })
      expect(commentFields.approved).toMatchObject({ type: 'boolean' })
      expect(fieldsSchema.properties.comments.properties.where).toBeDefined()
      expect(fieldsSchema.properties.comments.properties.orderBy).toBeDefined()
      expect(fieldsSchema.properties.comments.properties.take).toBeDefined()
      expect(fieldsSchema.properties.comments.properties.skip).toBeDefined()
      expect(fieldsSchema.properties.comments.properties.count).toEqual({
        type: 'boolean',
        description: expect.any(String),
      })
    })

    it('omits a relation whose target list denies query access', async () => {
      const tools = await listTools()
      const postQuery = tools.find((t) => t.name === 'list_post_query')!
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fieldsSchema = (postQuery.inputSchema.properties as any).fields
      expect(fieldsSchema.properties.secretInfo).toBeUndefined()
    })

    it('omits a relation whose target list has mcp.enabled: false', async () => {
      const tools = await listTools()
      const postQuery = tools.find((t) => t.name === 'list_post_query')!
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fieldsSchema = (postQuery.inputSchema.properties as any).fields
      expect(fieldsSchema.properties.draftRef).toBeUndefined()
    })

    it('terminates a self-referential relationship at depth 2 (no relation fields at level 2)', async () => {
      const tools = await listTools()
      const categoryQuery = tools.find((t) => t.name === 'list_category_query')!
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fieldsSchema = (categoryQuery.inputSchema.properties as any).fields

      // Only scalars (plus the always-present system fields) — no `parent`/
      // `children` at this depth, which is what actually terminates the
      // self-reference.
      const parentFields = fieldsSchema.properties.parent.properties.fields.properties
      expect(Object.keys(parentFields).sort()).toEqual(['createdAt', 'id', 'name', 'updatedAt'])
      expect(parentFields.name).toMatchObject({ type: 'boolean' })

      const childrenFields = fieldsSchema.properties.children.properties.fields.properties
      expect(Object.keys(childrenFields).sort()).toEqual(['createdAt', 'id', 'name', 'updatedAt'])
      expect(childrenFields.name).toMatchObject({ type: 'boolean' })
    })
  })

  describe('tools/list is per-session', () => {
    it('omits all four CRUD tools for a list whose query access denies the session', async () => {
      const tools = await listTools()
      const toolNames = tools.map((t) => t.name)
      expect(toolNames).not.toContain('list_secret_query')
      expect(toolNames).not.toContain('list_secret_create')
      expect(toolNames).not.toContain('list_secret_update')
      expect(toolNames).not.toContain('list_secret_delete')
    })

    it('omits all four CRUD tools for a list with mcp.enabled: false', async () => {
      const tools = await listTools()
      const toolNames = tools.map((t) => t.name)
      expect(toolNames).not.toContain('list_draft_query')
    })
  })

  describe('query dispatch with `fields`', () => {
    it('selects only scalar fields, issuing no `include`', async () => {
      mockPrisma.post.findMany.mockResolvedValue([{ id: '1', title: 'Hello', content: 'World' }])

      const data = await callQuery('list_post_query', { fields: { title: true } })

      expect(mockPrisma.post.findMany).toHaveBeenCalledWith(
        expect.not.objectContaining({ include: expect.anything() }),
      )
      const result = JSON.parse(data.result.content[0].text)
      expect(result.items).toEqual([{ id: '1', title: 'Hello' }])
    })

    it('selects a to-one relation with nested fields', async () => {
      mockPrisma.post.findMany.mockResolvedValue([
        { id: '1', title: 'Hello', author: { id: 'u1', name: 'Ada', email: 'ada@example.com' } },
      ])

      const data = await callQuery('list_post_query', {
        fields: { title: true, author: { fields: { name: true } } },
      })

      expect(mockPrisma.post.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ include: { author: true } }),
      )
      const result = JSON.parse(data.result.content[0].text)
      expect(result.items).toEqual([{ id: '1', title: 'Hello', author: { id: 'u1', name: 'Ada' } }])
    })

    it('honours nested where/orderBy/take/skip on a to-many relation, applying the default take ceiling when omitted', async () => {
      mockPrisma.post.findMany.mockResolvedValue([{ id: '1', comments: [] }])

      await callQuery('list_post_query', {
        fields: {
          comments: {
            fields: { text: true },
            where: { approved: { equals: true } },
            orderBy: { text: 'asc' },
            skip: 2,
          },
        },
      })

      expect(mockPrisma.post.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            comments: {
              where: { approved: { equals: true } },
              orderBy: { text: 'asc' },
              take: 5,
              skip: 2,
            },
          },
        }),
      )
    })

    it('clamps a nested take above the hard cap', async () => {
      mockPrisma.post.findMany.mockResolvedValue([{ id: '1', comments: [] }])

      await callQuery('list_post_query', {
        fields: { comments: { fields: { text: true }, take: 9999 } },
      })

      expect(mockPrisma.post.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { comments: { take: 50 } },
        }),
      )
    })

    it('requests a to-many count in place of its rows', async () => {
      // The relation is still named in the include, fetched with the SAME
      // real rows a `fields`-and-`count` request would get (never a
      // synthetic `take: 0`, which would make field-visibility's read-access
      // check see a permanently-empty relation) — see projectMcpResult's doc
      // comment. The rows themselves are simply never added to
      // `fieldSelection`, so they never reach the projected output.
      mockPrisma.post.findMany.mockResolvedValue([
        { id: '1', comments: [{ text: 'hi' }], _count: { comments: 7 } },
      ])

      const data = await callQuery('list_post_query', {
        fields: { comments: { count: true } },
      })

      expect(mockPrisma.post.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { comments: { take: 5 }, _count: { select: { comments: true } } },
        }),
      )
      const result = JSON.parse(data.result.content[0].text)
      expect(result.items).toEqual([{ id: '1', comments: 7 }])
    })

    it('requests a to-many count alongside its rows', async () => {
      mockPrisma.post.findMany.mockResolvedValue([
        { id: '1', comments: [{ text: 'hi' }], _count: { comments: 7 } },
      ])

      const data = await callQuery('list_post_query', {
        fields: { comments: { fields: { text: true }, count: true } },
      })

      expect(mockPrisma.post.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            comments: { take: 5 },
            _count: { select: { comments: true } },
          },
        }),
      )
      const result = JSON.parse(data.result.content[0].text)
      expect(result.items).toEqual([{ id: '1', comments: { items: [{ text: 'hi' }], count: 7 } }])
    })

    it('refuses an unadvertised field name as an isError tool result', async () => {
      const data = await callQuery('list_post_query', { fields: { madeUpField: true } })

      expect(data.error).toBeUndefined()
      expect(data.result.isError).toBe(true)
      expect(data.result.content[0].text).toContain('madeUpField')
    })

    it('refuses a relation named two levels deep as an isError tool result', async () => {
      const data = await callQuery('list_post_query', {
        fields: { comments: { fields: { post: true } } },
      })

      expect(data.error).toBeUndefined()
      expect(data.result.isError).toBe(true)
      expect(data.result.content[0].text).toContain('post')
    })

    it('refuses a relation field selected with `true` instead of a selector object', async () => {
      const data = await callQuery('list_post_query', { fields: { author: true } })

      expect(data.result.isError).toBe(true)
    })

    it('refuses a scalar field selected with a non-true value', async () => {
      const data = await callQuery('list_post_query', { fields: { title: 'yes' } })

      expect(data.result.isError).toBe(true)
    })

    it('refuses a relation whose target list denies query access', async () => {
      const data = await callQuery('list_post_query', {
        fields: { secretInfo: { fields: { value: true } } },
      })

      expect(data.result.isError).toBe(true)
    })

    it('always returns id, even when the projection never names it', async () => {
      mockPrisma.post.findMany.mockResolvedValue([{ id: '1', title: 'Hello' }])

      const data = await callQuery('list_post_query', { fields: { title: true } })

      const result = JSON.parse(data.result.content[0].text)
      expect(result.items).toEqual([{ id: '1', title: 'Hello' }])
    })

    it('accepts id/createdAt/updatedAt as explicitly selectable system fields', async () => {
      mockPrisma.post.findMany.mockResolvedValue([
        { id: '1', title: 'Hello', createdAt: 't1', updatedAt: 't2' },
      ])

      const data = await callQuery('list_post_query', {
        fields: { id: true, createdAt: true, updatedAt: true },
      })

      const result = JSON.parse(data.result.content[0].text)
      expect(result.items).toEqual([{ id: '1', createdAt: 't1', updatedAt: 't2' }])
    })

    it('refuses a malformed nested where/take/orderBy/skip/count with a clear message rather than an opaque Prisma error', async () => {
      const badWhere = await callQuery('list_post_query', {
        fields: { comments: { fields: { text: true }, where: 'not-an-object' } },
      })
      expect(badWhere.result.isError).toBe(true)
      expect(badWhere.result.content[0].text).toContain('where')

      const badTake = await callQuery('list_post_query', {
        fields: { comments: { fields: { text: true }, take: 'lots' } },
      })
      expect(badTake.result.isError).toBe(true)
      expect(badTake.result.content[0].text).toContain('take')

      const badCount = await callQuery('list_post_query', {
        fields: { comments: { count: 'yes' } },
      })
      expect(badCount.result.isError).toBe(true)
      expect(badCount.result.content[0].text).toContain('count')
    })

    it('refuses a negative nested take rather than allowing reverse-pagination to bypass the row cap', async () => {
      const data = await callQuery('list_post_query', {
        fields: { comments: { fields: { text: true }, take: -100000 } },
      })

      expect(data.result.isError).toBe(true)
      expect(data.result.content[0].text).toContain('take')
      expect(mockPrisma.post.findMany).not.toHaveBeenCalled()
    })

    it('refuses a nested where naming a field-level-denied field on the related list', async () => {
      const data = await callQuery('list_post_query', {
        fields: {
          comments: { fields: { text: true }, where: { internalNote: { equals: 'x' } } },
        },
      })

      expect(data.result.isError).toBe(true)
      expect(data.result.content[0].text).toContain('internalNote')
      expect(mockPrisma.post.findMany).not.toHaveBeenCalled()
    })

    it('refuses a nested orderBy naming an undeclared field on the related list', async () => {
      const data = await callQuery('list_post_query', {
        fields: {
          comments: { fields: { text: true }, orderBy: { bogusField: 'asc' } },
        },
      })

      expect(data.result.isError).toBe(true)
      expect(data.result.content[0].text).toContain('bogusField')
    })

    it('names a count-only relation in the include with real rows (never a synthetic take: 0) so field-visibility can evaluate its own read access against the true value', async () => {
      mockPrisma.post.findMany.mockResolvedValue([
        { id: '1', restrictedComments: [{ text: 'hi' }], _count: { restrictedComments: 3 } },
      ])

      await callQuery('list_post_query', { fields: { restrictedComments: { count: true } } })

      expect(mockPrisma.post.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({ restrictedComments: { take: 5 } }),
        }),
      )
    })

    // This mocked harness bypasses the real `filterReadableFields`, so it
    // can only simulate the outcome (a denied relation key absent from the
    // row `context.db` returns) rather than exercise the real per-row
    // access check — see `mcp-fields-projection-access.test.ts`'s
    // "suppresses a relation count denied by the relationship field's own
    // access" for the end-to-end version through the real pipeline.
    it('suppresses a count whose relation key is absent from the row (what a field-visibility denial produces)', async () => {
      mockPrisma.post.findMany.mockResolvedValue([
        { id: '1', _count: { restrictedComments: 3 } }, // no `restrictedComments` key
      ])

      const data = await callQuery('list_post_query', {
        fields: { restrictedComments: { count: true } },
      })

      const result = JSON.parse(data.result.content[0].text)
      expect(result.items).toEqual([{ id: '1' }])
    })
  })
})
