/**
 * Runtime MCP route handler
 * Creates MCP API handlers from OpenSaaS config at runtime
 */

import type { OpenSaasConfig, AccessContext } from '@opensaas/stack-core'
import { getDbKey } from '@opensaas/stack-core'
import type { BetterAuthInstance, McpSession } from '../auth/index.js'

/**
 * Create MCP route handlers
 *
 * @example
 * ```typescript
 * // app/api/mcp/[[...transport]]/route.ts
 * import { createMcpHandlers } from '@opensaas/stack-mcp'
 * import config from '@/opensaas.config'
 * import { auth } from '@/lib/auth'
 * import { getContext } from '@/.opensaas/context'
 *
 * const { GET, POST, DELETE } = createMcpHandlers({
 *   config,
 *   auth,
 *   getContext
 * })
 *
 * export { GET, POST, DELETE }
 * ```
 */
export function createMcpHandlers(options: {
  config: OpenSaasConfig
  auth: BetterAuthInstance
  getContext: (session?: { userId: string }) => AccessContext
}): {
  GET: (req: Request) => Promise<Response>
  POST: (req: Request) => Promise<Response>
  DELETE: (req: Request) => Promise<Response>
} {
  const { config, auth, getContext } = options

  // Validate MCP is enabled
  if (!config.mcp?.enabled) {
    const notEnabledHandler = async () =>
      new Response(JSON.stringify({ error: 'MCP not enabled' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    return { GET: notEnabledHandler, POST: notEnabledHandler, DELETE: notEnabledHandler }
  }

  const basePath = config.mcp.basePath || '/api/mcp'

  /**
   * Main MCP request handler
   */
  const handler = async (req: Request): Promise<Response> => {
    // Authenticate with Better Auth
    const session = await auth.api.getMcpSession({
      headers: req.headers,
    })

    if (!session) {
      return new Response(null, {
        status: 401,
        headers: {
          'WWW-Authenticate': `Bearer realm="${basePath}", error="invalid_token"`,
        },
      })
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- MCP protocol params are dynamic and depend on tool being called
      const body = (await req.json()) as { method: string; params?: any }

      // Handle tools/list
      if (body.method === 'tools/list') {
        return handleToolsList(config)
      }

      // Handle tools/call
      if (body.method === 'tools/call') {
        return await handleToolsCall(body.params, session, config, getContext)
      }

      return new Response(JSON.stringify({ error: 'Unknown method' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: 'Request handling failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }
  }

  return {
    GET: handler,
    POST: handler,
    DELETE: handler,
  }
}

/**
 * MCP tool definition following Model Context Protocol specification
 */
type McpTool = {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

/**
 * Handle tools/list request - list all available tools
 */
function handleToolsList(config: OpenSaasConfig): Response {
  const tools: McpTool[] = []

  // Generate CRUD tools for each list
  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    // Check if MCP is enabled for this list
    if (listConfig.mcp?.enabled === false) continue

    const dbKey = getDbKey(listKey)
    const defaultTools = config.mcp?.defaultTools || {
      read: true,
      create: true,
      update: true,
      delete: true,
    }

    const enabledTools = {
      read: listConfig.mcp?.tools?.read ?? defaultTools.read ?? true,
      create: listConfig.mcp?.tools?.create ?? defaultTools.create ?? true,
      update: listConfig.mcp?.tools?.update ?? defaultTools.update ?? true,
      delete: listConfig.mcp?.tools?.delete ?? defaultTools.delete ?? true,
    }

    // Read tool
    if (enabledTools.read) {
      tools.push({
        name: `list_${dbKey}_query`,
        description: `Query ${listKey} records with optional filters`,
        inputSchema: {
          type: 'object',
          properties: {
            where: { type: 'object', description: 'Prisma where clause' },
            take: { type: 'number', description: 'Number of records to return (max 100)' },
            skip: { type: 'number', description: 'Number of records to skip' },
            orderBy: { type: 'object', description: 'Sort order' },
          },
        },
      })
    }

    // Create tool
    if (enabledTools.create) {
      tools.push({
        name: `list_${dbKey}_create`,
        description: `Create a new ${listKey} record`,
        inputSchema: {
          type: 'object',
          properties: {
            data: {
              type: 'object',
              description: 'Record data',
            },
          },
          required: ['data'],
        },
      })
    }

    // Update tool
    if (enabledTools.update) {
      tools.push({
        name: `list_${dbKey}_update`,
        description: `Update an existing ${listKey} record`,
        inputSchema: {
          type: 'object',
          properties: {
            where: {
              type: 'object',
              description: 'Record identifier',
              properties: {
                id: { type: 'string' },
              },
              required: ['id'],
            },
            data: {
              type: 'object',
              description: 'Fields to update',
            },
          },
          required: ['where', 'data'],
        },
      })
    }

    // Delete tool
    if (enabledTools.delete) {
      tools.push({
        name: `list_${dbKey}_delete`,
        description: `Delete a ${listKey} record`,
        inputSchema: {
          type: 'object',
          properties: {
            where: {
              type: 'object',
              description: 'Record identifier',
              properties: {
                id: { type: 'string' },
              },
              required: ['id'],
            },
          },
          required: ['where'],
        },
      })
    }

    // Custom tools
    if (listConfig.mcp?.customTools) {
      for (const customTool of listConfig.mcp.customTools) {
        tools.push({
          name: customTool.name,
          description: customTool.description,
          inputSchema: customTool.inputSchema,
        })
      }
    }
  }

  return new Response(JSON.stringify({ tools }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Handle tools/call request - execute a tool
 */
async function handleToolsCall(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- MCP tool params vary by tool
  params: any,
  session: McpSession,
  config: OpenSaasConfig,
  getContext: (session?: { userId: string }) => AccessContext,
): Promise<Response> {
  const toolName = params?.name
  const toolArgs = params?.arguments || {}

  if (!toolName) {
    return new Response(
      JSON.stringify({
        content: [{ type: 'text', text: JSON.stringify({ error: 'Tool name required' }, null, 2) }],
        isError: true,
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  // Parse tool name: list_{dbKey}_{operation}
  const match = toolName.match(/^list_([a-z][a-zA-Z0-9]*)_(query|create|update|delete)$/)

  if (match) {
    const [, dbKey, operation] = match
    return await handleCrudTool(dbKey, operation, toolArgs, session, config, getContext)
  }

  // Handle custom tools
  return await handleCustomTool(toolName, toolArgs, session, config, getContext)
}

/**
 * Handle CRUD tool execution
 */
async function handleCrudTool(
  dbKey: string,
  operation: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool arguments vary by operation
  args: any,
  session: McpSession,
  config: OpenSaasConfig,
  getContext: (session?: { userId: string }) => AccessContext,
): Promise<Response> {
  // Create context with user session
  const context = getContext({ userId: session.userId })

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Result type varies by Prisma operation
    let result: any

    switch (operation) {
      case 'query':
        result = await context.db[dbKey].findMany({
          where: args.where,
          take: Math.min(args.take || 10, 100),
          skip: args.skip,
          orderBy: args.orderBy,
        })
        return createSuccessResponse({
          items: result,
          count: result.length,
        })

      case 'create':
        result = await context.db[dbKey].create({
          data: args.data,
        })
        if (!result) {
          return createErrorResponse('Failed to create record. Access denied or validation failed.')
        }
        return createSuccessResponse({ success: true, item: result })

      case 'update':
        result = await context.db[dbKey].update({
          where: args.where,
          data: args.data,
        })
        if (!result) {
          return createErrorResponse('Failed to update record. Access denied or record not found.')
        }
        return createSuccessResponse({ success: true, item: result })

      case 'delete':
        result = await context.db[dbKey].delete({
          where: args.where,
        })
        if (!result) {
          return createErrorResponse('Failed to delete record. Access denied or record not found.')
        }
        return createSuccessResponse({ success: true, deletedId: args.where.id })

      default:
        return createErrorResponse(`Unknown operation: ${operation}`)
    }
  } catch (error) {
    return createErrorResponse(
      'Operation failed',
      error instanceof Error ? error.message : 'Unknown error',
    )
  }
}

/**
 * Handle custom tool execution
 */
async function handleCustomTool(
  toolName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Custom tool arguments are user-defined
  args: any,
  session: McpSession,
  config: OpenSaasConfig,
  getContext: (session?: { userId: string }) => AccessContext,
): Promise<Response> {
  // Find custom tool in config
  for (const [_listKey, listConfig] of Object.entries(config.lists)) {
    const customTool = listConfig.mcp?.customTools?.find((t) => t.name === toolName)

    if (customTool) {
      const context = getContext({ userId: session.userId })

      try {
        const result = await customTool.handler({
          input: args,
          context,
        })

        return new Response(
          JSON.stringify({
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          }),
          {
            headers: { 'Content-Type': 'application/json' },
          },
        )
      } catch (error) {
        return createErrorResponse(
          'Custom tool execution failed',
          error instanceof Error ? error.message : 'Unknown error',
        )
      }
    }
  }

  return createErrorResponse(`Unknown tool: ${toolName}`)
}

/**
 * Helper to create success response
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Response data structure is flexible per MCP protocol
function createSuccessResponse(data: any): Response {
  return new Response(
    JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

/**
 * Helper to create error response
 */
function createErrorResponse(error: string, details?: string): Response {
  return new Response(
    JSON.stringify({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error, ...(details && { details }) }, null, 2),
        },
      ],
      isError: true,
    }),
    {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    },
  )
}
