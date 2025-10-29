/**
 * Runtime MCP route handler
 * Creates MCP API handlers from OpenSaaS config at runtime
 */

import type { OpenSaasConfig, AccessContext, FieldConfig } from '@opensaas/stack-core'
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
      const body = (await req.json()) as {
        jsonrpc?: string
        id?: number | string
        method: string
        params?: any
      }

      console.log('MCP session:', session)
      console.log(' MCP method', body.method)
      // Handle initialize
      if (body.method === 'initialize') {
        return handleInitialize(body.params, body.id)
      }

      // Handle notifications/initialized (sent by client after initialize response)
      if (body.method === 'notifications/initialized') {
        // Notifications don't require a response in JSON-RPC 2.0
        return new Response(null, { status: 204 })
      }

      // Handle tools/list
      if (body.method === 'tools/list') {
        return handleToolsList(config, body.id)
      }

      // Handle tools/call
      if (body.method === 'tools/call') {
        return await handleToolsCall(body.params, session, config, getContext, body.id)
      }

      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id ?? null,
          error: { code: -32601, message: 'Method not found' },
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      )
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
 * Handle initialize request - respond with server capabilities
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Initialize params are from the client
function handleInitialize(_params?: any, id?: number | string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: id ?? null,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'opensaas-mcp-server',
          version: '1.0.0',
        },
      },
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

/**
 * Convert field config to JSON schema property
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Field configs have varying structures
function fieldToJsonSchema(fieldName: string, fieldConfig: any): Record<string, unknown> {
  const baseSchema: Record<string, unknown> = {}

  switch (fieldConfig.type) {
    case 'text':
    case 'password':
      baseSchema.type = 'string'
      if (fieldConfig.validation?.length) {
        if (fieldConfig.validation.length.min) baseSchema.minLength = fieldConfig.validation.length.min
        if (fieldConfig.validation.length.max) baseSchema.maxLength = fieldConfig.validation.length.max
      }
      break
    case 'integer':
      baseSchema.type = 'number'
      if (fieldConfig.validation?.min !== undefined) baseSchema.minimum = fieldConfig.validation.min
      if (fieldConfig.validation?.max !== undefined) baseSchema.maximum = fieldConfig.validation.max
      break
    case 'checkbox':
      baseSchema.type = 'boolean'
      break
    case 'timestamp':
      baseSchema.type = 'string'
      baseSchema.format = 'date-time'
      break
    case 'select':
      baseSchema.type = 'string'
      if (fieldConfig.options) {
        baseSchema.enum = fieldConfig.options.map((opt: { value: string }) => opt.value)
      }
      break
    case 'relationship':
      // For relationships, expect an ID or connect object
      baseSchema.type = 'object'
      baseSchema.properties = {
        connect: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
        },
      }
      break
    default:
      // For custom field types, default to string
      baseSchema.type = 'string'
  }

  return baseSchema
}

/**
 * Generate field schemas for create/update operations
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Field configs have varying structures
function generateFieldSchemas(
  fields: Record<string, any>,
  operation: 'create' | 'update',
): {
  properties: Record<string, unknown>
  required: string[]
} {
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    // Skip system fields
    if (['id', 'createdAt', 'updatedAt'].includes(fieldName)) continue

    properties[fieldName] = fieldToJsonSchema(fieldName, fieldConfig)

    // Add to required array if field is required for this operation
    if (operation === 'create' && fieldConfig.validation?.isRequired) {
      required.push(fieldName)
    }
  }

  return { properties, required }
}

/**
 * Handle tools/list request - list all available tools
 */
function handleToolsList(config: OpenSaasConfig, id?: number | string): Response {
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
      const fieldSchemas = generateFieldSchemas(listConfig.fields, 'create')
      tools.push({
        name: `list_${dbKey}_create`,
        description: `Create a new ${listKey} record`,
        inputSchema: {
          type: 'object',
          properties: {
            data: {
              type: 'object',
              description: 'Record data with the following fields',
              properties: fieldSchemas.properties,
              required: fieldSchemas.required,
            },
          },
          required: ['data'],
        },
      })
    }

    // Update tool
    if (enabledTools.update) {
      const fieldSchemas = generateFieldSchemas(listConfig.fields, 'update')
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
              properties: fieldSchemas.properties,
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

  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: id ?? null,
      result: { tools },
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  )
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
  id?: number | string,
): Promise<Response> {
  const toolName = params?.name
  const toolArgs = params?.arguments || {}

  console.log('Handling tool call:', toolName, toolArgs)

  if (!toolName) {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: id ?? null,
        error: { code: -32602, message: 'Invalid params: Tool name required' },
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
    return await handleCrudTool(dbKey, operation, toolArgs, session, config, getContext, id)
  }

  // Handle custom tools
  return await handleCustomTool(toolName, toolArgs, session, config, getContext, id)
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
  id?: number | string,
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
        return createSuccessResponse(
          {
            items: result,
            count: result.length,
          },
          id,
        )

      case 'create':
        result = await context.db[dbKey].create({
          data: args.data,
        })
        if (!result) {
          return createErrorResponse(
            'Failed to create record. Access denied or validation failed.',
            id,
          )
        }
        return createSuccessResponse({ success: true, item: result }, id)

      case 'update':
        result = await context.db[dbKey].update({
          where: args.where,
          data: args.data,
        })
        if (!result) {
          return createErrorResponse(
            'Failed to update record. Access denied or record not found.',
            id,
          )
        }
        return createSuccessResponse({ success: true, item: result }, id)

      case 'delete':
        result = await context.db[dbKey].delete({
          where: args.where,
        })
        if (!result) {
          return createErrorResponse(
            'Failed to delete record. Access denied or record not found.',
            id,
          )
        }
        return createSuccessResponse({ success: true, deletedId: args.where.id }, id)

      default:
        return createErrorResponse(`Unknown operation: ${operation}`, id)
    }
  } catch (error) {
    return createErrorResponse(
      'Operation failed: ' + (error instanceof Error ? error.message : 'Unknown error'),
      id,
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
  id?: number | string,
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

        return createSuccessResponse(result, id)
      } catch (error) {
        return createErrorResponse(
          'Custom tool execution failed: ' +
            (error instanceof Error ? error.message : 'Unknown error'),
          id,
        )
      }
    }
  }

  return createErrorResponse(`Unknown tool: ${toolName}`, id)
}

/**
 * Helper to create success response
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Response data structure is flexible per MCP protocol
function createSuccessResponse(data: any, id?: number | string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: id ?? null,
      result: {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      },
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

/**
 * Helper to create error response
 */
function createErrorResponse(message: string, id?: number | string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: id ?? null,
      error: {
        code: -32603,
        message,
      },
    }),
    {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    },
  )
}
