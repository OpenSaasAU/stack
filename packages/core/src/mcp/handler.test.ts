import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import * as z from 'zod'
import type { AccessContext, Session } from '../access/types.js'
import type { OpenSaasConfig } from '../config/types.js'
import { checkbox, relationship, text } from '../fields/index.js'
import { createTestDatabase, ormClientFor, type TestDatabase } from '../testing/context.js'
import { getContext } from '../context/index.js'
import { ValidationError } from '../hooks/index.js'
import type { McpSessionProvider } from './types.js'
import { createMcpHandlers } from './handler.js'
import { McpProjectionRefusedError, resolveFieldsProjection } from './projection.js'
import { MCP_NESTED_TAKE_DEFAULT, MCP_NESTED_TAKE_MAX } from './constants.js'

/**
 * The MCP surface over a real context (ADR-0037, ADR-0053, ADR-0057).
 *
 * The handler already takes `getContext` as an option, so the harness's own
 * context goes straight in — the vocabulary it advertises and the writes it
 * dispatches are decided by the real access engine rather than by a stand-in.
 *
 * The `query` operation dispatches through `context.db[list].findMany`, the
 * Prisma 7 method surface no rc.8 client serves; what it does today is pinned
 * once, below, and the tool comes back with that surface (#1255).
 */

const BOOT = 120_000

/** The schema every test in this file shares. */
function schemaConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql', timestamps: true },
    mcp: { enabled: true, basePath: '/api/mcp' },
    lists: {
      User: {
        fields: { name: text(), email: text() },
        access: { operation: { query: () => true, create: () => true } },
      },
      Comment: {
        fields: {
          body: text(),
          approved: checkbox(),
          internalNote: text({ access: { read: () => false } }),
          post: relationship({ ref: 'Post.comments' }),
          restrictedPost: relationship({ ref: 'Post.restrictedComments' }),
        },
        access: { operation: { query: () => true, create: () => true } },
      },
      Post: {
        fields: {
          title: text(),
          content: text(),
          author: relationship({ ref: 'User' }),
          comments: relationship({ ref: 'Comment.post', many: true }),
          restrictedComments: relationship({
            ref: 'Comment.restrictedPost',
            many: true,
            access: { read: () => false },
          }),
          secretInfo: relationship({ ref: 'Secret' }),
          draftRef: relationship({ ref: 'Draft' }),
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
      // Denies query outright: it must vanish from tools/list AND from Post's
      // own `fields` schema as a relation target.
      Secret: {
        fields: { value: text() },
        access: { operation: { query: () => false } },
      },
      // MCP-disabled: the same double omission, a different cause.
      Draft: {
        fields: { title: text() },
        access: { operation: { query: () => true } },
        mcp: { enabled: false },
      },
      // Self-referential: the advertised schema has to terminate.
      Category: {
        fields: {
          name: text(),
          parent: relationship({ ref: 'Category.children' }),
          children: relationship({ ref: 'Category.parent', many: true }),
        },
        access: { operation: { query: () => true } },
      },
    },
  }
}

type ToolList = Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>

describe('the MCP surface', () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase(schemaConfig())
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(async () => {
    await database.truncate()
  })

  const session: McpSessionProvider = async () => ({
    userId: 'user-123',
    scopes: ['read', 'write'],
  })

  function contextFor(config: OpenSaasConfig): (session?: Session) => Promise<AccessContext> {
    const orm = ormClientFor(database.data, database.client.orm)
    return async (given?: Session) => ({
      ...getContext(
        config,
        orm,
        given ?? null,
        undefined,
        false,
        undefined,
        undefined,
        database.client,
      ),
      ormHandle: orm,
      _resolveOutputChain: [],
    })
  }

  function handlersFor(
    config: OpenSaasConfig = schemaConfig(),
    getSession: McpSessionProvider = session,
  ) {
    return createMcpHandlers({ config, getSession, getContext: contextFor(config) })
  }

  async function rpc(
    method: string,
    params?: unknown,
    config?: OpenSaasConfig,
    getSession?: McpSessionProvider,
  ): Promise<{ status: number; body: Record<string, unknown> | null }> {
    const handlers = handlersFor(config, getSession)
    const response = await handlers.POST(
      new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      }),
    )
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }

  async function listTools(config?: OpenSaasConfig): Promise<ToolList> {
    const { body } = await rpc('tools/list', undefined, config)
    return (body?.result as { tools: ToolList }).tools
  }

  async function callTool(name: string, args: Record<string, unknown>, config?: OpenSaasConfig) {
    return rpc('tools/call', { name, arguments: args }, config)
  }

  describe('the handlers themselves', () => {
    test('all three verbs are handled', () => {
      const handlers = handlersFor()
      for (const verb of ['GET', 'POST', 'DELETE'] as const) {
        expect(typeof handlers[verb]).toBe('function')
      }
    })

    test(
      'a config with MCP disabled answers 404 on every verb',
      async () => {
        const disabled = { ...schemaConfig(), mcp: { enabled: false } }
        const { status, body } = await rpc('tools/list', undefined, disabled)

        expect(status).toBe(404)
        expect(body).toEqual({ error: 'MCP not enabled' })
      },
      BOOT,
    )

    test(
      'no session is a 401 carrying the realm',
      async () => {
        const handlers = handlersFor(schemaConfig(), async () => null)
        const response = await handlers.POST(
          new Request('http://localhost/api/mcp', { method: 'POST' }),
        )

        expect(response.status).toBe(401)
        expect(response.headers.get('WWW-Authenticate')).toContain('realm="/api/mcp"')
      },
      BOOT,
    )

    test(
      'an unknown method is a JSON-RPC method-not-found',
      async () => {
        const { status, body } = await rpc('nope/nope')

        expect(status).toBe(400)
        expect(body?.error).toMatchObject({ code: -32601 })
      },
      BOOT,
    )

    test(
      'initialize answers with the protocol version, and the notification is a bare 204',
      async () => {
        const { body } = await rpc('initialize', { protocolVersion: '2024-11-05' })
        expect(body?.result).toMatchObject({ protocolVersion: expect.any(String) })

        const handlers = handlersFor()
        const response = await handlers.POST(
          new Request('http://localhost/api/mcp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
          }),
        )
        expect(response.status).toBe(204)
      },
      BOOT,
    )

    test(
      'the session the provider returns reaches getContext',
      async () => {
        const config = schemaConfig()
        const build = contextFor(config)
        const spy = vi.fn(build)
        const handlers = createMcpHandlers({ config, getSession: session, getContext: spy })

        await handlers.POST(
          new Request('http://localhost/api/mcp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
          }),
        )

        expect(spy).toHaveBeenCalledTimes(1)
        expect(spy.mock.calls[0][0]).toMatchObject({ userId: 'user-123' })
      },
      BOOT,
    )
  })

  describe('the vocabulary tools/list publishes', () => {
    test(
      'a readable list gets its four CRUD tools',
      async () => {
        const names = (await listTools()).map((tool) => tool.name)

        for (const operation of ['query', 'create', 'update', 'delete']) {
          expect(names).toContain(`list_post_${operation}`)
        }
      },
      BOOT,
    )

    /**
     * ADR-0053: a rule the session alone decides omits the list rather than
     * advertising a tool that can only ever refuse.
     */
    test(
      'a list the session cannot query, and an MCP-disabled list, carry no tools at all',
      async () => {
        const names = (await listTools()).map((tool) => tool.name)

        expect(names.filter((name) => name.startsWith('list_secret_'))).toEqual([])
        expect(names.filter((name) => name.startsWith('list_draft_'))).toEqual([])
      },
      BOOT,
    )

    test(
      'a per-operation mcp.tools entry drops just that tool',
      async () => {
        const config = schemaConfig()
        config.lists.User.mcp = { tools: { delete: false } }
        const names = (await listTools(config)).map((tool) => tool.name)

        expect(names).toContain('list_user_query')
        expect(names).not.toContain('list_user_delete')
      },
      BOOT,
    )

    test(
      'a custom tool is advertised beside the derived ones',
      async () => {
        const config = schemaConfig()
        config.lists.Post.mcp = {
          customTools: [
            {
              name: 'publish',
              description: 'Publish a post',
              inputSchema: z.object({ id: z.string() }),
              handler: async () => ({ published: true }),
            },
          ],
        }

        const tool = (await listTools(config)).find((entry) => entry.name === 'publish')
        expect(tool?.description).toBe('Publish a post')
      },
      BOOT,
    )

    test(
      'the fields schema advertises scalars as booleans and relations as nested selectors',
      async () => {
        const tools = await listTools()
        const query = tools.find((tool) => tool.name === 'list_post_query')
        const properties = query?.inputSchema.properties as Record<string, unknown>
        const fields = properties.fields as { properties: Record<string, unknown> }

        expect(fields.properties.title).toMatchObject({ type: 'boolean' })
        expect(fields.properties.author).toHaveProperty('properties')
        // The relation targets that are out of reach are absent, not empty.
        expect(fields.properties.secretInfo).toBeUndefined()
        expect(fields.properties.draftRef).toBeUndefined()
      },
      BOOT,
    )

    test(
      'a self-referential relation terminates rather than recursing',
      async () => {
        const tools = await listTools()
        const query = tools.find((tool) => tool.name === 'list_category_query')
        const properties = query?.inputSchema.properties as Record<string, unknown>
        const serialised = JSON.stringify(properties.fields)

        expect(serialised.length).toBeLessThan(20_000)
        expect(properties.fields).toBeDefined()
      },
      BOOT,
    )

    /**
     * ADR-0050: `connect` is offered on the end that owns the foreign key and
     * nowhere else, so a write can never be spelled as N hidden ones.
     */
    test(
      'connect is advertised on the owning end alone, beside null',
      async () => {
        const tools = await listTools()
        const create = tools.find((tool) => tool.name === 'list_comment_create')
        const properties = create?.inputSchema.properties as Record<string, unknown>
        const data = properties.data as { properties: Record<string, unknown> }
        const post = JSON.stringify(data.properties.post)

        expect(post).toContain('connect')
        expect(post).toContain('null')

        const postCreate = tools.find((tool) => tool.name === 'list_post_create')
        const postData = (postCreate?.inputSchema.properties as Record<string, unknown>).data as {
          properties: Record<string, unknown>
        }
        expect(postData.properties.comments).toBeUndefined()
      },
      BOOT,
    )
  })

  describe('the writes tools/call dispatches', () => {
    async function seedPost(): Promise<string> {
      const context = await contextFor(schemaConfig())()
      const created = await context.db.Post.create({ data: { title: 'seed' } })
      return String(created?.id)
    }

    test(
      'create returns the row it wrote',
      async () => {
        const { body } = await callTool('list_post_create', { data: { title: 'from mcp' } })
        const payload = JSON.parse(
          ((body?.result as { content: Array<{ text: string }> }).content[0] as { text: string })
            .text,
        )

        expect(payload).toMatchObject({ success: true, item: { title: 'from mcp' } })

        const context = await contextFor(schemaConfig())()
        expect(await context.db.Post.all()).toMatchObject([{ title: 'from mcp' }])
      },
      BOOT,
    )

    test(
      'update and delete round-trip the same row',
      async () => {
        const id = await seedPost()

        await callTool('list_post_update', { where: { id }, data: { title: 'renamed' } })
        const context = await contextFor(schemaConfig())()
        expect(await context.db.Post.all()).toMatchObject([{ title: 'renamed' }])

        await callTool('list_post_delete', { where: { id } })
        expect(await context.db.Post.all()).toEqual([])
      },
      BOOT,
    )

    /**
     * A Silent failure has to reach the client as a tool error rather than as
     * a success carrying `null` — the caller is an assistant, not a form.
     */
    test(
      'a denied create comes back as an error result, not a null success',
      async () => {
        const denied = schemaConfig()
        denied.lists.Post.access = { operation: { query: () => true, create: () => false } }

        const { body } = await callTool('list_post_create', { data: { title: 'x' } }, denied)
        const result = body?.result as { isError?: boolean; content: Array<{ text: string }> }

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('Access denied')
      },
      BOOT,
    )

    test(
      'an unknown tool name, and a call with no name, are both errors',
      async () => {
        expect((await callTool('list_post_nope', {})).body?.error).toBeDefined()
        expect((await rpc('tools/call', { arguments: {} })).body?.error).toBeDefined()
      },
      BOOT,
    )

    test(
      'a custom tool runs, and its own refusals come back as tool results',
      async () => {
        const config = schemaConfig()
        config.lists.Post.mcp = {
          customTools: [
            {
              name: 'echo',
              description: 'Echo',
              inputSchema: z.object({ word: z.string() }),
              handler: async ({ input }: { input: { word: string } }) => ({ echoed: input.word }),
            },
            {
              name: 'boom',
              description: 'Throws',
              inputSchema: z.object({}),
              handler: async () => {
                throw new Error('handler exploded')
              },
            },
          ],
        }

        const ok = await callTool('echo', { word: 'hi' }, config)
        expect(
          JSON.parse((ok.body?.result as { content: Array<{ text: string }> }).content[0].text),
        ).toMatchObject({ echoed: 'hi' })

        const badInput = await callTool('echo', { word: 7 }, config)
        expect((badInput.body?.result as { isError?: boolean }).isError).toBe(true)

        const threw = await callTool('boom', {}, config)
        expect((threw.body?.result as { isError?: boolean }).isError).toBe(true)
      },
      BOOT,
    )

    /**
     * The read half of the tool set dispatches through the Prisma 7 method
     * surface, so it currently reports a failure rather than rows. Pinned here
     * so the tool's return coming back is a visible change, not a silent one
     * (#1255).
     */
    test(
      'query reports a failure while it still dispatches through the Prisma 7 surface',
      async () => {
        await seedPost()

        const { body } = await callTool('list_post_query', {})
        const result = body?.result as { isError?: boolean; content: Array<{ text: string }> }

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('findMany is not a function')
      },
      BOOT,
    )
  })

  /**
   * The projection the `query` tool would apply, taken at its own layer: it is
   * decided entirely by the config, the session and the access engine, so it
   * is observable without the terminal that dispatches it.
   */
  describe('the fields projection', () => {
    const config = schemaConfig()

    async function resolve(fields: unknown) {
      const context = await contextFor(config)({ userId: 'user-123' })
      return resolveFieldsProjection(
        fields,
        'Post',
        config.lists.Post,
        config,
        context.session,
        context,
      )
    }

    test(
      'scalars alone ask for no include',
      async () => {
        const projection = await resolve({ title: true })

        expect(projection.include).toBeUndefined()
        expect(projection.fieldSelection).toEqual({ id: true, title: true })
      },
      BOOT,
    )

    test(
      'id comes back whether or not the caller named it',
      async () => {
        expect((await resolve({ title: true })).fieldSelection.id).toBe(true)
      },
      BOOT,
    )

    test(
      'a to-one relation becomes an include with its own selection',
      async () => {
        const projection = await resolve({ author: { fields: { name: true } } })

        expect(projection.include).toMatchObject({ author: true })
        expect(projection.fieldSelection.author).toEqual({ _fields: { id: true, name: true } })
      },
      BOOT,
    )

    test(
      'a to-many relation carries the default take, and a larger one is clamped',
      async () => {
        expect(
          (await resolve({ comments: { fields: { body: true } } })).include?.comments,
        ).toMatchObject({ take: MCP_NESTED_TAKE_DEFAULT })

        expect(
          (await resolve({ comments: { fields: { body: true }, take: 5_000 } })).include?.comments,
        ).toMatchObject({ take: MCP_NESTED_TAKE_MAX })
      },
      BOOT,
    )

    test(
      'a negative take is refused rather than read as reverse pagination',
      async () => {
        await expect(
          resolve({ comments: { fields: { body: true }, take: -1 } }),
        ).rejects.toBeInstanceOf(McpProjectionRefusedError)
      },
      BOOT,
    )

    test(
      'a count can be asked for on its own or alongside the rows',
      async () => {
        expect((await resolve({ comments: { count: true } })).countRequests.get('comments')).toBe(
          'only',
        )
        expect(
          (await resolve({ comments: { count: true, fields: { body: true } } })).countRequests.get(
            'comments',
          ),
        ).toBe('alongside')
      },
      BOOT,
    )

    test(
      'what is refused: an unadvertised name, a wrong selector shape, and an unreachable relation',
      async () => {
        await expect(resolve({ nope: true })).rejects.toBeInstanceOf(McpProjectionRefusedError)
        await expect(resolve({ author: true })).rejects.toBeInstanceOf(McpProjectionRefusedError)
        await expect(resolve({ title: 'yes' })).rejects.toBeInstanceOf(McpProjectionRefusedError)
        await expect(resolve({ secretInfo: { fields: { value: true } } })).rejects.toBeInstanceOf(
          McpProjectionRefusedError,
        )
      },
      BOOT,
    )

    test(
      'a nested where or orderBy naming a field the session cannot read is refused',
      async () => {
        await expect(
          resolve({ comments: { fields: { body: true }, where: { internalNote: 'x' } } }),
        ).rejects.toBeInstanceOf(ValidationError)
        await expect(
          resolve({ comments: { fields: { body: true }, orderBy: { internalNote: 'asc' } } }),
        ).rejects.toBeInstanceOf(ValidationError)
      },
      BOOT,
    )
  })
})
