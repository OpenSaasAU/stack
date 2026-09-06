import * as z from 'zod'
import type { OpenSaasConfig, McpCustomTool } from '../config/types.js'
import type { AccessContext } from '../access/types.js'
import { checkAccess } from '../access/engine.js'
import { pascalToCamel } from '../lib/case-utils.js'
import { AccessScopeDepthExceededError, RelationFilterAccessDeniedError } from '../access/errors.js'
import { ValidationError } from '../hooks/index.js'
import type { McpSession, McpSessionProvider } from './types.js'
import { generateFieldSchemas } from './field-schema.js'
import {
  McpProjectionRefusedError,
  generateFieldsProjectionSchema,
  projectMcpResult,
  resolveFieldsProjection,
} from './projection.js'

/**
 * Context session type accepted by the generated getContext factory.
 * userId is always present; auth adapters may pass additional session fields
 * (email, role, ...) through for access control.
 */
type ContextSession = { userId: string; [key: string]: unknown }

/** Strips transport-level fields; userId and any custom session fields flow through to access control. */
function toContextSession(session: McpSession): ContextSession {
  const { accessToken: _accessToken, expiresAt: _expiresAt, scopes: _scopes, ...rest } = session
  return rest as ContextSession
}

/**
 * MCP tools registered globally by plugins via `registerMcpTool`
 * (stored by the plugin engine under `_pluginData.__mcpTools`).
 */
function getPluginMcpTools(config: OpenSaasConfig): McpCustomTool[] {
  return (config._pluginData?.__mcpTools as McpCustomTool[] | undefined) ?? []
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- duck-typing across zod instances
function isZodSchema(schema: any): schema is z.ZodType {
  return !!schema && typeof schema.safeParse === 'function'
}

/** Zod schemas are converted to JSON Schema (the MCP wire format); plain objects pass through as-is. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- inputSchema is user-supplied
function toolInputSchemaToJson(inputSchema: any): McpTool['inputSchema'] {
  if (isZodSchema(inputSchema)) {
    try {
      const { $schema: _$schema, ...jsonSchema } = z.toJSONSchema(inputSchema)
      return jsonSchema as McpTool['inputSchema']
    } catch {
      // Unconvertible schema (transforms, custom types) — advertise a
      // permissive object schema; runtime validation still applies.
      return { type: 'object', properties: {} }
    }
  }
  return inputSchema as McpTool['inputSchema']
}

/**
 * Create MCP route handlers
 *
 * @example
 * ```typescript
 * // app/api/mcp/[[...transport]]/route.ts
 * import { createMcpHandlers } from '@opensaas/stack-core/mcp'
 * import { createBetterAuthMcpAdapter } from '@opensaas/stack-auth/mcp'
 * import config from '@/opensaas.config'
 * import { auth } from '@/lib/auth'
 * import { getContext } from '@/.opensaas/context'
 *
 * const { GET, POST, DELETE } = createMcpHandlers({
 *   config,
 *   getSession: createBetterAuthMcpAdapter(auth),
 *   getContext
 * })
 *
 * export { GET, POST, DELETE }
 * ```
 */
export function createMcpHandlers(options: {
  config: OpenSaasConfig
  getSession: McpSessionProvider
  getContext: (session?: ContextSession) => Promise<AccessContext>
}): {
  GET: (req: Request) => Promise<Response>
  POST: (req: Request) => Promise<Response>
  DELETE: (req: Request) => Promise<Response>
} {
  const { config, getSession, getContext } = options

  if (!config.mcp?.enabled) {
    const notEnabledHandler = async () =>
      new Response(JSON.stringify({ error: 'MCP not enabled' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    return { GET: notEnabledHandler, POST: notEnabledHandler, DELETE: notEnabledHandler }
  }

  const basePath = config.mcp.basePath || '/api/mcp'

  const handler = async (req: Request): Promise<Response> => {
    const session = await getSession(req.headers)
    if (!session) {
      return new Response(null, {
        status: 401,
        headers: {
          'WWW-Authenticate': `Bearer realm="${basePath}", error="invalid_token"`,
        },
      })
    }

    try {
      const body = (await req.json()) as {
        jsonrpc?: string
        id?: number | string
        method: string
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- MCP protocol params are dynamic and depend on tool being called
        params?: any
      }

      if (body.method === 'initialize') {
        return handleInitialize(body.params, body.id)
      }

      if (body.method === 'notifications/initialized') {
        // Notifications don't require a response in JSON-RPC 2.0
        return new Response(null, { status: 204 })
      }

      if (body.method === 'tools/list') {
        const context = await getContext(toContextSession(session))
        return await handleToolsList(config, context, body.id)
      }

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

async function handleToolsList(
  config: OpenSaasConfig,
  context: AccessContext,
  id?: number | string,
): Promise<Response> {
  const tools: McpTool[] = []

  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    // The tool name stays camelCase: it is the identifier an assistant has
    // already bound to, and renaming it would break every registered client.
    const toolKey = pascalToCamel(listKey)
    if (listConfig.mcp?.enabled === false) continue

    // A session denied operation-level `query` outright sees none of this
    // list's tools, nor any relation entry elsewhere pointing at it as a
    // target (`relatedListIfVisible` in projection.ts applies the identical
    // check there) — ADR-0033.
    const queryAccess = listConfig.access?.operation?.query
    const accessResult = await checkAccess(queryAccess, { session: context.session, context })
    if (accessResult === false) continue

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

    if (enabledTools.read) {
      const fieldsSchema = await generateFieldsProjectionSchema(
        listConfig,
        config,
        context.session,
        context,
      )
      tools.push({
        name: `list_${toolKey}_query`,
        description: `Query ${listKey} records with optional filters`,
        inputSchema: {
          type: 'object',
          properties: {
            where: { type: 'object', description: 'Prisma where clause' },
            take: { type: 'number', description: 'Number of records to return (max 100)' },
            skip: { type: 'number', description: 'Number of records to skip' },
            orderBy: { type: 'object', description: 'Sort order' },
            fields: fieldsSchema,
          },
        },
      })
    }

    if (enabledTools.create) {
      const fieldSchemas = generateFieldSchemas(listConfig.fields, 'create')
      tools.push({
        name: `list_${toolKey}_create`,
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

    if (enabledTools.update) {
      const fieldSchemas = generateFieldSchemas(listConfig.fields, 'update')
      tools.push({
        name: `list_${toolKey}_update`,
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

    if (enabledTools.delete) {
      tools.push({
        name: `list_${toolKey}_delete`,
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

    if (listConfig.mcp?.customTools) {
      for (const customTool of listConfig.mcp.customTools) {
        tools.push({
          name: customTool.name,
          description: customTool.description,
          inputSchema: toolInputSchemaToJson(customTool.inputSchema),
        })
      }
    }
  }

  // Tools registered globally by plugins (e.g. the RAG plugin's semantic search)
  for (const pluginTool of getPluginMcpTools(config)) {
    tools.push({
      name: pluginTool.name,
      description: pluginTool.description,
      inputSchema: toolInputSchemaToJson(pluginTool.inputSchema),
    })
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

async function handleToolsCall(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- MCP tool params vary by tool
  params: any,
  session: McpSession,
  config: OpenSaasConfig,
  getContext: (session?: ContextSession) => Promise<AccessContext>,
  id?: number | string,
): Promise<Response> {
  const toolName = params?.name
  const toolArgs = params?.arguments || {}

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

  const match = toolName.match(/^list_([a-z][a-zA-Z0-9]*)_(query|create|update|delete)$/)

  if (match) {
    const [, toolKey, operation] = match
    return await handleCrudTool(toolKey, operation, toolArgs, session, config, getContext, id)
  }

  return await handleCustomTool(toolName, toolArgs, session, config, getContext, id)
}

async function handleCrudTool(
  toolKey: string,
  operation: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool arguments vary by operation
  args: any,
  session: McpSession,
  config: OpenSaasConfig,
  getContext: (session?: ContextSession) => Promise<AccessContext>,
  id?: number | string,
): Promise<Response> {
  const context = await getContext(toContextSession(session))

  const listEntry = Object.entries(config.lists).find(
    ([candidate]) => pascalToCamel(candidate) === toolKey,
  )
  if (!listEntry) {
    return createErrorResponse(`Unknown list for tool: ${toolKey}`, id)
  }
  const [listKey, listConfig] = listEntry

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Result type varies by Prisma operation
    let result: any

    switch (operation) {
      case 'query': {
        let projection: Awaited<ReturnType<typeof resolveFieldsProjection>> | undefined
        if (args.fields !== undefined) {
          try {
            projection = await resolveFieldsProjection(
              args.fields,
              listKey,
              listConfig,
              config,
              context.session,
              context,
            )
          } catch (error) {
            if (error instanceof McpProjectionRefusedError || error instanceof ValidationError) {
              return createErrorResultResponse(error.message, id)
            }
            throw error
          }
        }

        result = await context.db[listKey].findMany({
          where: args.where,
          take: Math.min(args.take || 10, 100),
          skip: args.skip,
          orderBy: args.orderBy,
          ...(projection?.include ? { include: projection.include } : {}),
        })

        const items = projection
          ? result.map((item: Record<string, unknown>) => projectMcpResult(item, projection))
          : result

        return createSuccessResponse(
          {
            items,
            count: items.length,
          },
          id,
        )
      }

      case 'create':
        result = await context.db[listKey].create({
          data: args.data,
        })
        if (!result) {
          return createErrorResultResponse(
            'Failed to create record. Access denied or validation failed.',
            id,
          )
        }
        return createSuccessResponse({ success: true, item: result }, id)

      case 'update':
        result = await context.db[listKey].update({
          where: args.where,
          data: args.data,
        })
        if (!result) {
          return createErrorResultResponse(
            'Failed to update record. Access denied or record not found.',
            id,
          )
        }
        return createSuccessResponse({ success: true, item: result }, id)

      case 'delete':
        result = await context.db[listKey].delete({
          where: args.where,
        })
        if (!result) {
          return createErrorResultResponse(
            'Failed to delete record. Access denied or record not found.',
            id,
          )
        }
        return createSuccessResponse({ success: true, deletedId: args.where.id }, id)

      default:
        return createErrorResponse(`Unknown operation: ${operation}`, id)
    }
  } catch (error) {
    if (
      error instanceof AccessScopeDepthExceededError ||
      error instanceof RelationFilterAccessDeniedError
    ) {
      return createErrorResultResponse(error.message, id)
    }
    return createErrorResultResponse(
      'Operation failed: ' + (error instanceof Error ? error.message : 'Unknown error'),
      id,
    )
  }
}

async function handleCustomTool(
  toolName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Custom tool arguments are user-defined
  args: any,
  session: McpSession,
  config: OpenSaasConfig,
  getContext: (session?: ContextSession) => Promise<AccessContext>,
  id?: number | string,
): Promise<Response> {
  // Find the tool: list-level custom tools first, then plugin-registered tools
  let customTool: McpCustomTool | undefined
  for (const listConfig of Object.values(config.lists)) {
    customTool = listConfig.mcp?.customTools?.find((t) => t.name === toolName)
    if (customTool) break
  }
  customTool ??= getPluginMcpTools(config).find((t) => t.name === toolName)

  if (!customTool) {
    return createErrorResponse(`Unknown tool: ${toolName}`, id)
  }

  let input = args
  if (isZodSchema(customTool.inputSchema)) {
    const parsed = customTool.inputSchema.safeParse(args)
    if (!parsed.success) {
      return createErrorResultResponse(`Invalid params: ${parsed.error.message}`, id)
    }
    input = parsed.data
  }

  const context = await getContext(toContextSession(session))

  try {
    const result = await customTool.handler({
      input,
      context,
    })

    return createSuccessResponse(result, id)
  } catch (error) {
    return createErrorResultResponse(
      'Custom tool execution failed: ' + (error instanceof Error ? error.message : 'Unknown error'),
      id,
    )
  }
}

/**
 * `JSON.stringify` replacer rendering a `bigint` (e.g. a `bigInt()` field's
 * value) as a decimal string instead of throwing
 * (`TypeError: Do not know how to serialize a BigInt`). A decimal string is
 * the conventional JSON encoding of a 64-bit integer and is what an MCP
 * client can consume — the field's TypeScript type stays `bigint` in
 * application code (ADR-0029).
 */
function mcpJsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}

function toToolContent(data: unknown): { type: 'text'; text: string }[] {
  const text = typeof data === 'string' ? data : JSON.stringify(data, mcpJsonReplacer, 2)
  return [{ type: 'text', text }]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Response data structure is flexible per MCP protocol
function createSuccessResponse(data: any, id?: number | string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: id ?? null,
      result: { content: toToolContent(data) },
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

/**
 * A dispatched tool that failed — access denial, a thrown engine/database
 * error, or custom-tool input validation. This is a successful JSON-RPC
 * response (HTTP 200, no `error` member): the model that called the tool
 * needs to see the failure in `result` to have any chance of correcting its
 * request, whereas a JSON-RPC `error` object is a protocol-level failure a
 * host may never surface back to it.
 */
function createErrorResultResponse(message: string, id?: number | string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: id ?? null,
      result: { content: toToolContent(message), isError: true },
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

/** Genuine JSON-RPC protocol failures — unknown method, malformed request, unknown tool name. */
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
