import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMcpHandlers } from '../src/mcp/handler.js'
import type { OpenSaasConfig } from '../src/config/types.js'
import type { AccessContext } from '../src/access/types.js'
import type { McpSession, McpSessionProvider } from '../src/mcp/types.js'

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
      prisma: mockPrisma,
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
      expect(response.status).toBe(400)

      const data = await response.json()
      expect(data.error.message).toContain('Access denied')
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
      expect(response.status).toBe(400)

      const data = await response.json()
      expect(data.error.message).toContain('Database error')
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
        prisma: mockPrisma,
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
