import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMcpHandlers } from '../src/runtime/handler.js'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import type { BetterAuthInstance } from '../src/auth/better-auth.js'

describe('createMcpHandlers', () => {
  let mockAuth: BetterAuthInstance
  let mockGetContext: ReturnType<typeof vi.fn>
  let mockContext: unknown
  let config: OpenSaasConfig

  beforeEach(() => {
    // Mock Better Auth instance
    mockAuth = {
      api: {
        getMcpSession: vi.fn(),
      },
    }

    // Mock context with db operations
    mockContext = {
      db: {
        post: {
          findMany: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        },
        user: {
          findMany: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        },
      },
      session: null,
      prisma: {},
    }

    // Mock getContext function
    mockGetContext = vi.fn(() => mockContext)

    // Sample config
    config = {
      db: {
        provider: 'postgresql',
        url: 'postgresql://localhost:5432/test',
      },
      mcp: {
        enabled: true,
        basePath: '/api/mcp',
        defaultTools: {
          read: true,
          create: true,
          update: true,
          delete: true,
        },
      },
      lists: {
        Post: {
          fields: {
            title: {
              type: 'text',
              validation: { isRequired: true, length: { min: 1, max: 100 } },
            },
            content: { type: 'text' },
            published: { type: 'checkbox' },
            views: { type: 'integer', validation: { min: 0, max: 1000000 } },
          },
          access: {
            operation: {
              query: () => true,
              create: () => true,
              update: () => true,
              delete: () => true,
            },
          },
        },
        User: {
          fields: {
            name: { type: 'text', validation: { isRequired: true } },
            email: { type: 'text', validation: { isRequired: true } },
          },
          access: {
            operation: {
              query: () => true,
              create: () => true,
              update: () => true,
              delete: () => true,
            },
          },
          mcp: {
            enabled: false, // Disable MCP for this list
          },
        },
      },
    }
  })

  describe('MCP not enabled', () => {
    it('should return 404 handlers when MCP is not enabled', async () => {
      const disabledConfig = { ...config, mcp: { enabled: false } }
      const handlers = createMcpHandlers({
        config: disabledConfig,
        auth: mockAuth,
        getContext: mockGetContext,
      })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(404)

      const body = await response.json()
      expect(body).toEqual({ error: 'MCP not enabled' })
    })
  })

  describe('Authentication', () => {
    it('should return 401 when no session is provided', async () => {
      mockAuth.api.getMcpSession.mockResolvedValue(null)

      const handlers = createMcpHandlers({
        config,
        auth: mockAuth,
        getContext: mockGetContext,
      })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'tools/list' }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(401)
      expect(response.headers.get('WWW-Authenticate')).toContain('Bearer')
    })

    it('should authenticate with Better Auth and proceed', async () => {
      mockAuth.api.getMcpSession.mockResolvedValue({
        userId: 'user-123',
        scopes: ['read', 'write'],
      })

      const handlers = createMcpHandlers({
        config,
        auth: mockAuth,
        getContext: mockGetContext,
      })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(200)
      expect(mockAuth.api.getMcpSession).toHaveBeenCalled()
    })
  })

  describe('Initialize method', () => {
    beforeEach(() => {
      mockAuth.api.getMcpSession.mockResolvedValue({ userId: 'user-123' })
    })

    it('should handle initialize request', async () => {
      const handlers = createMcpHandlers({
        config,
        auth: mockAuth,
        getContext: mockGetContext,
      })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05' },
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.jsonrpc).toBe('2.0')
      expect(body.id).toBe(1)
      expect(body.result.protocolVersion).toBe('2024-11-05')
      expect(body.result.capabilities).toEqual({ tools: {} })
      expect(body.result.serverInfo.name).toBe('opensaas-mcp-server')
    })
  })

  describe('Notifications/initialized method', () => {
    beforeEach(() => {
      mockAuth.api.getMcpSession.mockResolvedValue({ userId: 'user-123' })
    })

    it('should handle notifications/initialized with 204 No Content', async () => {
      const handlers = createMcpHandlers({
        config,
        auth: mockAuth,
        getContext: mockGetContext,
      })

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

  describe('Tools/list method', () => {
    beforeEach(() => {
      mockAuth.api.getMcpSession.mockResolvedValue({ userId: 'user-123' })
    })

    it('should list all available tools for enabled lists', async () => {
      const handlers = createMcpHandlers({
        config,
        auth: mockAuth,
        getContext: mockGetContext,
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
      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.jsonrpc).toBe('2.0')
      expect(body.id).toBe(1)
      expect(body.result.tools).toBeDefined()

      const tools = body.result.tools
      // Should have Post tools (User is disabled)
      expect(tools.some((t: { name: string }) => t.name === 'list_post_query')).toBe(true)
      expect(tools.some((t: { name: string }) => t.name === 'list_post_create')).toBe(true)
      expect(tools.some((t: { name: string }) => t.name === 'list_post_update')).toBe(true)
      expect(tools.some((t: { name: string }) => t.name === 'list_post_delete')).toBe(true)

      // Should NOT have User tools (disabled)
      expect(tools.some((t: { name: string }) => t.name === 'list_user_query')).toBe(false)
    })

    it('should include field schemas in create tool', async () => {
      const handlers = createMcpHandlers({
        config,
        auth: mockAuth,
        getContext: mockGetContext,
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
      const body = await response.json()

      const createTool = body.result.tools.find(
        (t: { name: string }) => t.name === 'list_post_create',
      )
      expect(createTool).toBeDefined()
      expect(createTool.inputSchema.properties.data.properties).toHaveProperty('title')
      expect(createTool.inputSchema.properties.data.properties).toHaveProperty('content')
      expect(createTool.inputSchema.properties.data.properties).toHaveProperty('published')
      expect(createTool.inputSchema.properties.data.properties).toHaveProperty('views')
      expect(createTool.inputSchema.properties.data.required).toContain('title')
    })

    it('should respect list-level tool configuration', async () => {
      const customConfig = {
        ...config,
        lists: {
          Post: {
            ...config.lists.Post,
            mcp: {
              tools: {
                read: true,
                create: true,
                update: false, // Disable update
                delete: false, // Disable delete
              },
            },
          },
        },
      }

      const handlers = createMcpHandlers({
        config: customConfig,
        auth: mockAuth,
        getContext: mockGetContext,
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
      const body = await response.json()
      const tools = body.result.tools

      expect(tools.some((t: { name: string }) => t.name === 'list_post_query')).toBe(true)
      expect(tools.some((t: { name: string }) => t.name === 'list_post_create')).toBe(true)
      expect(tools.some((t: { name: string }) => t.name === 'list_post_update')).toBe(false)
      expect(tools.some((t: { name: string }) => t.name === 'list_post_delete')).toBe(false)
    })
  })

  describe('Tools/call - Query operation', () => {
    beforeEach(() => {
      mockAuth.api.getMcpSession.mockResolvedValue({ userId: 'user-123' })
    })

    it('should execute query tool successfully', async () => {
      const mockPosts = [
        { id: '1', title: 'Post 1', content: 'Content 1' },
        { id: '2', title: 'Post 2', content: 'Content 2' },
      ]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(mockContext as any).db.post.findMany.mockResolvedValue(mockPosts)

      const handlers = createMcpHandlers({
        config,
        auth: mockAuth,
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
            arguments: {
              where: { published: true },
              take: 10,
            },
          },
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.jsonrpc).toBe('2.0')
      expect(body.id).toBe(1)
      expect(body.result.content).toBeDefined()

      const resultText = body.result.content[0].text
      const resultData = JSON.parse(resultText)
      expect(resultData.items).toEqual(mockPosts)
      expect(resultData.count).toBe(2)

      // Verify context was created with session
      expect(mockGetContext).toHaveBeenCalledWith({ userId: 'user-123' })
    })

    it('should limit query results to max 100', async () => {
      const mockPosts = Array.from({ length: 150 }, (_, i) => ({
        id: `${i}`,
        title: `Post ${i}`,
      }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(mockContext as any).db.post.findMany.mockResolvedValue(mockPosts)

      const handlers = createMcpHandlers({
        config,
        auth: mockAuth,
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
            arguments: { take: 150 },
          },
        }),
      })

      await handlers.POST(request)

      // Verify take was capped at 100
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((mockContext as any).db.post.findMany).toHaveBeenCalledWith({
        where: undefined,
        take: 100,
        skip: undefined,
        orderBy: undefined,
      })
    })
  })

  describe('Tools/call - Create operation', () => {
    beforeEach(() => {
      mockAuth.api.getMcpSession.mockResolvedValue({ userId: 'user-123' })
    })

    it('should execute create tool successfully', async () => {
      const mockCreatedPost = { id: '1', title: 'New Post', content: 'Content' }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(mockContext as any).db.post.create.mockResolvedValue(mockCreatedPost)

      const handlers = createMcpHandlers({
        config,
        auth: mockAuth,
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
            name: 'list_post_create',
            arguments: {
              data: {
                title: 'New Post',
                content: 'Content',
              },
            },
          },
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(200)

      const body = await response.json()
      const resultText = body.result.content[0].text
      const resultData = JSON.parse(resultText)
      expect(resultData.success).toBe(true)
      expect(resultData.item).toEqual(mockCreatedPost)
    })

    it('should return error when create fails (access denied)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(mockContext as any).db.post.create.mockResolvedValue(null)

      const handlers = createMcpHandlers({
        config,
        auth: mockAuth,
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
            name: 'list_post_create',
            arguments: { data: { title: 'Test' } },
          },
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(400)

      const body = await response.json()
      expect(body.error).toBeDefined()
      expect(body.error.message).toContain('Failed to create record')
    })
  })

  describe('Tools/call - Update operation', () => {
    beforeEach(() => {
      mockAuth.api.getMcpSession.mockResolvedValue({ userId: 'user-123' })
    })

    it('should execute update tool successfully', async () => {
      const mockUpdatedPost = { id: '1', title: 'Updated Post', content: 'Updated Content' }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(mockContext as any).db.post.update.mockResolvedValue(mockUpdatedPost)

      const handlers = createMcpHandlers({
        config,
        auth: mockAuth,
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

      const body = await response.json()
      const resultText = body.result.content[0].text
      const resultData = JSON.parse(resultText)
      expect(resultData.success).toBe(true)
      expect(resultData.item).toEqual(mockUpdatedPost)
    })

    it('should return error when update fails (access denied)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(mockContext as any).db.post.update.mockResolvedValue(null)

      const handlers = createMcpHandlers({
        config,
        auth: mockAuth,
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
            name: 'list_post_update',
            arguments: {
              where: { id: '1' },
              data: { title: 'Updated' },
            },
          },
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(400)

      const body = await response.json()
      expect(body.error.message).toContain('Failed to update record')
    })
  })

  describe('Tools/call - Delete operation', () => {
    beforeEach(() => {
      mockAuth.api.getMcpSession.mockResolvedValue({ userId: 'user-123' })
    })

    it('should execute delete tool successfully', async () => {
      const mockDeletedPost = { id: '1', title: 'Deleted Post' }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(mockContext as any).db.post.delete.mockResolvedValue(mockDeletedPost)

      const handlers = createMcpHandlers({
        config,
        auth: mockAuth,
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
            name: 'list_post_delete',
            arguments: { where: { id: '1' } },
          },
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(200)

      const body = await response.json()
      const resultText = body.result.content[0].text
      const resultData = JSON.parse(resultText)
      expect(resultData.success).toBe(true)
      expect(resultData.deletedId).toBe('1')
    })

    it('should return error when delete fails', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(mockContext as any).db.post.delete.mockResolvedValue(null)

      const handlers = createMcpHandlers({
        config,
        auth: mockAuth,
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
            name: 'list_post_delete',
            arguments: { where: { id: '1' } },
          },
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(400)

      const body = await response.json()
      expect(body.error.message).toContain('Failed to delete record')
    })
  })

  describe('Error handling', () => {
    beforeEach(() => {
      mockAuth.api.getMcpSession.mockResolvedValue({ userId: 'user-123' })
    })

    it('should return error for unknown method', async () => {
      const handlers = createMcpHandlers({
        config,
        auth: mockAuth,
        getContext: mockGetContext,
      })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'unknown/method',
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(400)

      const body = await response.json()
      expect(body.error.code).toBe(-32601)
      expect(body.error.message).toBe('Method not found')
    })

    it('should return error for tool call without name', async () => {
      const handlers = createMcpHandlers({
        config,
        auth: mockAuth,
        getContext: mockGetContext,
      })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { arguments: {} },
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(400)

      const body = await response.json()
      expect(body.error.code).toBe(-32602)
      expect(body.error.message).toContain('Tool name required')
    })

    it('should return error for unknown tool', async () => {
      const handlers = createMcpHandlers({
        config,
        auth: mockAuth,
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
            name: 'unknown_tool',
            arguments: {},
          },
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(400)

      const body = await response.json()
      expect(body.error.message).toContain('Unknown tool')
    })

    it('should handle malformed JSON', async () => {
      const handlers = createMcpHandlers({
        config,
        auth: mockAuth,
        getContext: mockGetContext,
      })

      const request = new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json',
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(500)

      const body = await response.json()
      expect(body.error).toBeDefined()
    })
  })

  describe('Custom tools', () => {
    beforeEach(() => {
      mockAuth.api.getMcpSession.mockResolvedValue({ userId: 'user-123' })
    })

    it('should include custom tools in tools/list', async () => {
      const customConfig = {
        ...config,
        lists: {
          Post: {
            ...config.lists.Post,
            mcp: {
              customTools: [
                {
                  name: 'publishPost',
                  description: 'Publish a draft post',
                  inputSchema: {
                    type: 'object' as const,
                    properties: { postId: { type: 'string' } },
                    required: ['postId'],
                  },
                  handler: vi.fn(async () => ({ success: true })),
                },
              ],
            },
          },
        },
      }

      const handlers = createMcpHandlers({
        config: customConfig,
        auth: mockAuth,
        getContext: mockGetContext,
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
      const body = await response.json()
      const tools = body.result.tools

      const customTool = tools.find((t: { name: string }) => t.name === 'publishPost')
      expect(customTool).toBeDefined()
      expect(customTool.description).toBe('Publish a draft post')
    })

    it('should execute custom tool', async () => {
      const customHandler = vi.fn(async () => ({ success: true, postId: '1' }))
      const customConfig = {
        ...config,
        lists: {
          Post: {
            ...config.lists.Post,
            mcp: {
              customTools: [
                {
                  name: 'publishPost',
                  description: 'Publish a draft post',
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
        config: customConfig,
        auth: mockAuth,
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
            name: 'publishPost',
            arguments: { postId: '1' },
          },
        }),
      })

      const response = await handlers.POST(request)
      expect(response.status).toBe(200)

      const body = await response.json()
      const resultText = body.result.content[0].text
      const resultData = JSON.parse(resultText)
      expect(resultData.success).toBe(true)
      expect(resultData.postId).toBe('1')

      expect(customHandler).toHaveBeenCalledWith({
        input: { postId: '1' },
        context: mockContext,
      })
    })
  })
})
