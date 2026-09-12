import * as z from 'zod'
import type { OpenSaasConfig, McpCustomTool } from '../config/types.js'
import type { AccessContext } from '../access/types.js'
import { engineContextOf, type AnyStackContext } from '../context/engine-context.js'
import { checkAccess } from '../access/engine.js'
import { pascalToCamel } from '../lib/case-utils.js'
import { AccessScopeDepthExceededError, RelationFilterAccessDeniedError } from '../access/errors.js'
import { ValidationError } from '../hooks/index.js'
import type { McpSession, McpSessionProvider } from './types.js'
import { generateFieldSchemas } from './field-schema.js'
import { listIdColumn, parseListId, type ListIdValue } from '../contract/id-boundary.js'
import { RELATION_QUANTIFIERS, SCALAR_OPERATORS } from '../secured/operators.js'
import type { SecuredQuery } from '../secured/read.js'
import { orderByArgument, whereArgument } from './arguments.js'
import {
  McpProjectionRefusedError,
  generateFieldsProjectionSchema,
  resolveFieldsProjection,
  type ResolvedFieldsProjection,
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
 *   config: await config,
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
  /**
   * The app's context factory — the generated `getContext` — whose return the
   * handlers narrow to the engine's face with {@link engineContextOf}. Neither
   * face is assignable to the other, so the boundary takes both and narrows
   * once, the way `AdminUI` and `createAuth` do.
   */
  getContext: (session?: ContextSession) => Promise<AnyStackContext>
}): {
  GET: (req: Request) => Promise<Response>
  POST: (req: Request) => Promise<Response>
  DELETE: (req: Request) => Promise<Response>
} {
  const { config, getSession } = options
  const getContext = async (session?: ContextSession): Promise<AccessContext> =>
    engineContextOf(await options.getContext(session))

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

/**
 * The `where` argument's own description. The predicate is the Where
 * vocabulary — the same grammar every other producer compiles to (ADR-0055) —
 * so the schema says which operators that is rather than naming an ORM.
 */
function whereDescription(listKey: string): string {
  return (
    `Which ${listKey} rows to return, in the Where vocabulary: a field name against a value or ` +
    `an operator object (${SCALAR_OPERATORS.join(', ')}), a relation against ` +
    `${RELATION_QUANTIFIERS.join('/')}, and AND, OR, NOT`
  )
}

/**
 * The `where.id` schema for the `update`/`delete` tools, at the type this
 * list's primary key actually carries (ADR-0048) — an `int autoincrement` list
 * validates an integer rather than being told every id is a string.
 */
function idSchema(config: OpenSaasConfig, listKey: string): Record<string, unknown> {
  const strategy = listIdColumn(config, listKey)?.strategy
  const integer = strategy === 'int autoincrement' || strategy === 'singleton'
  return { type: integer ? 'integer' : 'string' }
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
        listKey,
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
            where: { type: 'object', description: whereDescription(listKey) },
            take: { type: 'number', description: 'Number of records to return (max 100)' },
            skip: { type: 'number', description: 'Number of records to skip' },
            orderBy: {
              type: 'object',
              description: `Sort order: ${listKey} column names against "asc" or "desc"`,
            },
            fields: fieldsSchema,
          },
        },
      })
    }

    if (enabledTools.create) {
      const fieldSchemas = await generateFieldSchemas(
        listKey,
        listConfig.fields,
        config,
        'create',
        context.session,
        context,
      )
      if (fieldSchemas.deniedRequiredField === null) {
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
    }

    if (enabledTools.update) {
      const fieldSchemas = await generateFieldSchemas(
        listKey,
        listConfig.fields,
        config,
        'update',
        context.session,
        context,
      )
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
                id: idSchema(config, listKey),
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
                id: idSchema(config, listKey),
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

function isWhereObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A `where.id` at the type its list's primary key actually carries, the way
 * `update`/`delete` already take one (ADR-0048). The Where vocabulary carries
 * a caller's JSON through unchanged, so a list keyed on an `int` column would
 * otherwise reach the driver with `"3"` against it. Only such a list needs
 * this: a string-keyed list's wire value is already the column's type, and
 * coercing there would refuse the partial values `contains` is for.
 *
 * `null` means the caller named an id this column cannot hold, so the read
 * matches nothing — the answer a missing row gets everywhere else.
 */
function parseWhereIds(
  where: Record<string, unknown>,
  config: OpenSaasConfig,
  listKey: string,
): Record<string, unknown> | null {
  const strategy = listIdColumn(config, listKey)?.strategy
  if (strategy !== 'int autoincrement' && strategy !== 'singleton') return where
  if (!Object.hasOwn(where, 'id')) return where

  const parse = (raw: unknown): ListIdValue | null => {
    const parsed = parseListId(config, listKey, raw)
    return parsed.ok ? parsed.value : null
  }

  const raw = where.id
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    const value = parse(raw)
    return value === null ? null : { ...where, id: value }
  }

  const operators: Record<string, unknown> = {}
  for (const [operator, value] of Object.entries(raw)) {
    if (operator === 'in' || operator === 'notIn') {
      if (!Array.isArray(value)) return null
      const ids: ListIdValue[] = []
      for (const entry of value) {
        const id = parse(entry)
        if (id === null) return null
        ids.push(id)
      }
      operators[operator] = ids
      continue
    }
    if (operator === 'contains') {
      operators[operator] = value
      continue
    }
    const id = parse(value)
    if (id === null) return null
    operators[operator] = id
  }
  return { ...where, id: operators }
}

/**
 * Framework-authored errors safe to hand an MCP client verbatim — everything
 * else is an application rule's own internal detail (#1361, #1456).
 */
function isSafeMcpError(error: unknown): error is Error {
  return (
    error instanceof McpProjectionRefusedError ||
    error instanceof ValidationError ||
    error instanceof AccessScopeDepthExceededError ||
    error instanceof RelationFilterAccessDeniedError
  )
}

/**
 * Redacts an error raised while serving a CRUD tool behind a generic refusal,
 * logging the real error server-side, unless it's one of the known-safe
 * types. Shared by `query` (whose caller-named `fields` can throw while
 * resolving the projection) and `create`/`update`/`delete` (whose own result
 * runs Field Visibility over the full row exactly like a read does, so the
 * same throwing rule reaches the same code path there too).
 */
function redactMcpError(
  error: unknown,
  listKey: string,
  operationLabel: string,
  id?: number | string,
): Response {
  if (isSafeMcpError(error)) {
    return createErrorResultResponse(error.message, id)
  }
  console.error(`[opensaas] MCP ${operationLabel} "${listKey}" failed:`, error)
  return createErrorResultResponse(
    `${operationLabel} on "${listKey}" failed due to an internal error.`,
    id,
  )
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
        if (typeof args.take === 'number' && args.take < 0) {
          return createErrorResultResponse(
            `"${listKey}.take" must not be negative (reverse pagination isn't supported).`,
            id,
          )
        }
        if (typeof args.skip === 'number' && args.skip < 0) {
          return createErrorResultResponse(`"${listKey}.skip" must not be negative.`, id)
        }

        let query: SecuredQuery = context.db[listKey]
        let projection: ResolvedFieldsProjection | undefined
        try {
          if (isWhereObject(args.where)) {
            const parsedWhere = parseWhereIds(args.where, config, listKey)
            if (parsedWhere === null) return createSuccessResponse({ items: [], count: 0 }, id)
            query = query.where(whereArgument(parsedWhere, listKey))
          } else if (args.where !== undefined) {
            query = query.where(whereArgument(args.where, listKey))
          }
          if (args.orderBy !== undefined) {
            query = query.orderBy(orderByArgument(args.orderBy, listKey))
          }
          if (args.fields !== undefined) {
            projection = await resolveFieldsProjection(
              args.fields,
              listKey,
              listConfig,
              config,
              context.session,
              context,
            )
            query = projection.apply(query)
          }

          if (args.skip !== undefined) query = query.offset(args.skip)
          const rows = await query.limit(Math.min(args.take || 10, 100)).all()
          const items = projection ? projection.toWire(rows) : rows

          return createSuccessResponse({ items, count: items.length }, id)
        } catch (error) {
          // A caller-named field's access rule can still throw here — a
          // row-dependent rule cannot be classified ahead of the read
          // (`resolveFieldsProjection` only contains rules for fields the
          // caller did NOT ask for) — and whatever it threw is an internal
          // detail of the application's own rule, not something to hand an
          // external MCP client (#1361).
          return redactMcpError(error, listKey, 'Query', id)
        }
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

      case 'update': {
        // A malformed id answers exactly as a missing row does: shape is all
        // the boundary can check, and "no such id" and "not yours" are the
        // same answer everywhere else (ADR-0048, Silent failure).
        const parsed = parseListId(config, listKey, args.where?.id)
        if (!parsed.ok) {
          return createErrorResultResponse(
            'Failed to update record. Access denied or record not found.',
            id,
          )
        }
        result = await context.db[listKey].update({
          where: { id: parsed.value },
          data: args.data,
        })
        if (!result) {
          return createErrorResultResponse(
            'Failed to update record. Access denied or record not found.',
            id,
          )
        }
        return createSuccessResponse({ success: true, item: result }, id)
      }

      case 'delete': {
        const parsed = parseListId(config, listKey, args.where?.id)
        if (!parsed.ok) {
          return createErrorResultResponse(
            'Failed to delete record. Access denied or record not found.',
            id,
          )
        }
        result = await context.db[listKey].delete({ where: { id: parsed.value } })
        if (!result) {
          return createErrorResultResponse(
            'Failed to delete record. Access denied or record not found.',
            id,
          )
        }
        return createSuccessResponse({ success: true, deletedId: parsed.value }, id)
      }

      default:
        return createErrorResponse(`Unknown operation: ${operation}`, id)
    }
  } catch (error) {
    // A create/update's own returned row runs through Field Visibility
    // exactly like a read does (no `fields`/`.select()` narrows a write's
    // result), so a field whose `read` rule throws reaches here the same way
    // it reaches the query path's own catch above (#1456).
    const operationLabel = operation.charAt(0).toUpperCase() + operation.slice(1)
    return redactMcpError(error, listKey, operationLabel, id)
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
