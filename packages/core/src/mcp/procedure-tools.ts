import * as z from 'zod'
import type { OpenSaasConfig } from '../config/types.js'
import {
  isProcedure,
  type Procedure,
  type ProcedureHostContext,
  type ProcedureRegistry,
} from '../procedures/procedure.js'
import { failure, type ProcedureResult } from '../procedures/result.js'
import { guardReporter, runProcedure, type UnexpectedErrorReporter } from '../procedures/run.js'
import { assertProcedureRegistry, ProcedureHostError } from '../procedures/validate.js'

/** The JSON Schema a tool advertises for its arguments, which MCP requires to be an object. */
export interface McpToolInputSchema {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
  [keyword: string]: unknown
}

export interface McpProcedureTool<C extends ProcedureHostContext> {
  name: string
  procedure: Procedure<C>
  description: string
  inputSchema: McpToolInputSchema
}

export interface McpToolResult {
  content: { type: 'text'; text: string }[]
  isError?: true
}

function inputSchemaOf<C extends ProcedureHostContext>(
  name: string,
  procedure: Procedure<C>,
): McpToolInputSchema {
  const { $schema: _schema, ...schema } = z.toJSONSchema(procedure.input, { io: 'input' })
  if (schema.type !== 'object') {
    throw new ProcedureHostError(
      `Procedure "${name}" is exposed to 'mcp', but its input is not an object. MCP passes a tool's arguments as one JSON object, so declare the input as \`z.object({ … })\`; for no input use \`z.object({})\`.`,
    )
  }
  return { ...schema, type: 'object', properties: schema.properties ?? {} }
}

/**
 * The procedures an MCP handler serves as tools: every one exposing `'mcp'`,
 * keyed by its name. The whole registry is checked first, as every host
 * checks it, so a name any procedure carries is refused for a generated,
 * custom or plugin tool.
 *
 * @throws {ProcedureHostError} for a registry a host cannot serve, or an
 *   MCP-exposed procedure whose input is not an object.
 */
export function mcpProcedureTools<C extends ProcedureHostContext>(
  procedures: ProcedureRegistry<C>,
  config: OpenSaasConfig,
): ReadonlyMap<string, McpProcedureTool<C>> {
  assertProcedureRegistry(procedures, { config })
  const tools = new Map<string, McpProcedureTool<C>>()
  for (const name of Object.keys(procedures)) {
    const procedure = procedures[name]
    if (!isProcedure<C>(procedure) || !procedure.expose.includes('mcp')) continue
    tools.set(name, {
      name,
      procedure,
      description: procedure.description,
      inputSchema: inputSchemaOf(name, procedure),
    })
  }
  return tools
}

function asScopeList(value: string | string[] | undefined): readonly string[] {
  return value === undefined ? [] : typeof value === 'string' ? [value] : value
}

/** The scopes a procedure's tool requires: its own, or the config's `mcp.scopes.write`. */
export function missingProcedureScopes<C extends ProcedureHostContext>(
  tool: McpProcedureTool<C>,
  config: OpenSaasConfig,
  held: readonly string[],
): string[] {
  const required = tool.procedure.scopes ?? asScopeList(config.mcp?.scopes?.write)
  return required.filter((scope) => !held.includes(scope))
}

function defaultUnexpectedError(error: unknown, procedureName: string): void {
  console.error(`Procedure "${procedureName}" failed:`, error)
}

/** The reporter an MCP handler tells of a procedure's unexpected failures. */
export function procedureErrorReporter(
  report: UnexpectedErrorReporter | undefined,
): UnexpectedErrorReporter {
  return guardReporter(report ?? defaultUnexpectedError)
}

/**
 * The procedure tools this session is shown: each one whose scopes the token
 * holds and whose access rule admits the session. Access never sees the
 * input, so a listed tool is one the session may call. A rule that throws
 * leaves its tool out and is reported.
 */
export async function listedProcedureTools<C extends ProcedureHostContext>(
  tools: ReadonlyMap<string, McpProcedureTool<C>>,
  context: C,
  config: OpenSaasConfig,
  held: readonly string[],
  report: UnexpectedErrorReporter,
): Promise<{ name: string; description: string; inputSchema: McpToolInputSchema }[]> {
  const listed: { name: string; description: string; inputSchema: McpToolInputSchema }[] = []
  for (const tool of tools.values()) {
    if (missingProcedureScopes(tool, config, held).length > 0) continue
    let admitted: boolean
    try {
      admitted = (await tool.procedure.access({ context })) === true
    } catch (error) {
      report(error, tool.name)
      continue
    }
    if (admitted) {
      listed.push({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })
    }
  }
  return listed
}

function toolResultOf(
  result: ProcedureResult<unknown, string>,
  name: string,
  report: UnexpectedErrorReporter,
): McpToolResult {
  let text: string
  try {
    text = JSON.stringify(result)
  } catch (error) {
    report(error, name)
    return toolResultOf(failure('INTERNAL'), name, report)
  }
  const content: McpToolResult['content'] = [{ type: 'text', text }]
  return result.success ? { content } : { content, isError: true }
}

/**
 * Call a procedure as an MCP tool: the scopes the token must hold, then the
 * shared pipeline (access, input, run, output) under the agent's context.
 * The tool result's text is the result envelope as JSON, the same body the
 * HTTP host answers with, and a failure sets `isError`.
 */
export async function callProcedureTool<C extends ProcedureHostContext>(
  tool: McpProcedureTool<C>,
  args: unknown,
  options: {
    config: OpenSaasConfig
    held: readonly string[]
    context: () => Promise<C>
    report: UnexpectedErrorReporter
  },
): Promise<McpToolResult> {
  const missing = missingProcedureScopes(tool, options.config, options.held)
  if (missing.length > 0) {
    return toolResultOf(
      failure('DENIED', {
        message: `Tool "${tool.name}" requires the OAuth scope(s): ${missing.join(', ')}.`,
      }),
      tool.name,
      options.report,
    )
  }
  const result = await runProcedure<C>({
    name: tool.name,
    procedure: tool.procedure,
    context: options.context,
    readInput: () => ({ ok: true, value: args === undefined ? {} : args }),
    onUnexpectedError: options.report,
  })
  return toolResultOf(result, tool.name, options.report)
}
