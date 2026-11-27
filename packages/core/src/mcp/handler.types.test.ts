import { describe, expect, expectTypeOf, test } from 'vitest'
import * as z from 'zod'
import type { AccessContext, AccessControlledDB, Session } from '../access/types.js'
import type { OpenSaasConfig } from '../config/types.js'
import { createProcedureBuilder, type ProcedureRegistry } from '../procedures/procedure.js'
import type { StackContext } from '../types/context.js'
import { createMcpHandlers, type McpHandlers } from './handler.js'
import type { McpSessionProvider } from './types.js'

type Context<TSession extends Session = Session> = StackContext<AccessControlledDB, TSession>

async function getContext<TSession extends Session = Session>(
  _session?: TSession,
): Promise<Context<TSession>> {
  throw new Error('never called: MCP is not enabled in this config')
}

async function getEngineContext(_session?: Session): Promise<AccessContext> {
  throw new Error('never called: MCP is not enabled in this config')
}

const procedure = createProcedureBuilder<Context>()

const publishPost = procedure({
  description: 'Publish one of your draft posts',
  input: z.object({ postId: z.string() }),
  output: z.object({ id: z.string() }),
  failures: { NOT_FOUND: 'No draft post with that id' },
  access: ({ session }) => session !== null,
  expose: ['web', 'mcp'],
  scopes: ['posts:publish'],
  run: ({ input }) => ({ id: input.postId }),
})

const procedures = { publishPost } satisfies ProcedureRegistry<Context>

const config: OpenSaasConfig = { db: { provider: 'postgresql' }, lists: {} }
const getSession: McpSessionProvider = async () => null

describe('createMcpHandlers types', () => {
  test('takes a registry beside a getContext shaped like the generated one', () => {
    const handlers = createMcpHandlers({ config, getSession, getContext, procedures })
    expectTypeOf(handlers).toEqualTypeOf<McpHandlers>()
    expect(typeof handlers.POST).toBe('function')
  })

  test('takes the generated getContext, or an engine one, without procedures', () => {
    expectTypeOf(createMcpHandlers({ config, getSession, getContext })).toEqualTypeOf<McpHandlers>()
    expectTypeOf(
      createMcpHandlers({ config, getSession, getContext: getEngineContext }),
    ).toEqualTypeOf<McpHandlers>()
  })

  test('refuses procedures with a getContext that cannot run them', () => {
    // @ts-expect-error an engine context is not one procedures can run in
    createMcpHandlers({ config, getSession, getContext: getEngineContext, procedures })
    // @ts-expect-error a registry entry must be a procedure
    createMcpHandlers({ config, getSession, getContext, procedures: { publishPost: 1 } })
    // @ts-expect-error onUnexpectedProcedureError comes with procedures
    createMcpHandlers({ config, getSession, getContext, onUnexpectedProcedureError: () => {} })
  })
})
