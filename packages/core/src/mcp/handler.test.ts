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
import {
  generateFieldsProjectionSchema,
  McpProjectionRefusedError,
  resolveFieldsProjection,
} from './projection.js'
import { generateFieldSchemas } from './field-schema.js'
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

/**
 * The bug `tools/list` has to survive — `({ session }) => session.role === 'admin'`
 * reached by a session-less request — reduced to the TypeError it raises, since
 * that dereference does not type-check against `Session | null`.
 */
function unguardedSessionRule(): boolean {
  throw new TypeError("Cannot read properties of null (reading 'role')")
}

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
      // The field-grain fixture (ADR-0053): a constant rule beside an
      // `isAuthor` one, and a rule keyed off the session alone.
      Memo: {
        fields: {
          title: text(),
          internal: text({
            access: { read: () => false, create: () => false, update: () => false },
          }),
          adminOnly: text({
            access: {
              read: ({ session }) => session?.role === 'admin',
              create: ({ session }) => session?.role === 'admin',
              update: ({ session }) => session?.role === 'admin',
            },
          }),
          ownerNotes: text({
            access: {
              read: ({ session, item }) => item?.ownerId === session?.userId,
              update: ({ session, item }) => item?.ownerId === session?.userId,
            },
          }),
          draftedBy: text({
            access: { create: ({ inputData }) => inputData?.title !== 'forbidden' },
          }),
          ownerId: text(),
          brittle: text({
            access: {
              read: unguardedSessionRule,
              create: unguardedSessionRule,
              update: unguardedSessionRule,
            },
          }),
          notes: relationship({ ref: 'Memoed.memo', many: true }),
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
      // A required field only an admin may write: everyone else loses the
      // whole `create` tool.
      Ledger: {
        fields: {
          entry: text({
            validation: { isRequired: true },
            access: { create: ({ session }) => session?.role === 'admin' },
          }),
        },
        access: { operation: { query: () => true, create: () => true } },
      },
      // Reached only as a relation target, to pin the level-2 vocabulary.
      Memoed: {
        fields: {
          label: text(),
          hidden: text({ access: { read: () => false } }),
          brittle: text({ access: { read: unguardedSessionRule } }),
          memo: relationship({ ref: 'Memo.notes' }),
        },
        access: { operation: { query: () => true } },
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

  /**
   * ADR-0053: the advertised vocabulary is filtered at field grain, per
   * session and uncached, by the same row-independence classifier the include
   * and the predicate check already use.
   */
  describe('the field grain of the published vocabulary', () => {
    const anonymous: McpSessionProvider = async () => ({ userId: 'anon-1' })
    const author: McpSessionProvider = async () => ({ userId: 'user-123', role: 'author' })
    const admin: McpSessionProvider = async () => ({ userId: 'admin-1', role: 'admin' })

    async function toolsFor(getSession: McpSessionProvider): Promise<ToolList> {
      const { body } = await rpc('tools/list', undefined, schemaConfig(), getSession)
      return (body?.result as { tools: ToolList }).tools
    }

    async function fieldsSchemaFor(
      getSession: McpSessionProvider,
      toolName: string,
    ): Promise<Record<string, unknown>> {
      const tool = (await toolsFor(getSession)).find((entry) => entry.name === toolName)
      const properties = tool?.inputSchema.properties as Record<string, unknown>
      return (properties.fields as { properties: Record<string, unknown> }).properties
    }

    async function dataSchemaFor(
      getSession: McpSessionProvider,
      toolName: string,
    ): Promise<Record<string, unknown> | undefined> {
      const tool = (await toolsFor(getSession)).find((entry) => entry.name === toolName)
      if (!tool) return undefined
      const properties = tool.inputSchema.properties as Record<string, unknown>
      return (properties.data as { properties: Record<string, unknown> }).properties
    }

    async function refusalText(
      getSession: McpSessionProvider,
      fields: Record<string, unknown>,
      toolName = 'list_memo_query',
    ): Promise<string> {
      const { body } = await rpc(
        'tools/call',
        { name: toolName, arguments: { fields } },
        schemaConfig(),
        getSession,
      )
      const result = body?.result as { isError?: boolean; content: Array<{ text: string }> }
      expect(result.isError).toBe(true)
      return result.content[0].text
    }

    test(
      'a constantly denied field leaves the read vocabulary for every session',
      async () => {
        for (const getSession of [anonymous, author, admin]) {
          const fields = await fieldsSchemaFor(getSession, 'list_memo_query')
          expect(fields.title).toBeDefined()
          expect(fields.internal).toBeUndefined()

          // A relationship is a field here too (ADR-0053): its own `read` rule
          // drops it before the related list's `query` access is consulted.
          const posts = await fieldsSchemaFor(getSession, 'list_post_query')
          expect(posts.comments).toBeDefined()
          expect(posts.restrictedComments).toBeUndefined()
        }
      },
      BOOT,
    )

    test(
      'a session-keyed field is advertised to the admin and withheld from the others',
      async () => {
        expect((await fieldsSchemaFor(admin, 'list_memo_query')).adminOnly).toBeDefined()
        expect((await fieldsSchemaFor(author, 'list_memo_query')).adminOnly).toBeUndefined()
        expect((await fieldsSchemaFor(anonymous, 'list_memo_query')).adminOnly).toBeUndefined()
      },
      BOOT,
    )

    test(
      'a rule that reaches into the row stays advertised to every session',
      async () => {
        for (const getSession of [anonymous, author, admin]) {
          expect((await fieldsSchemaFor(getSession, 'list_memo_query')).ownerNotes).toBeDefined()
        }
      },
      BOOT,
    )

    test(
      'the second projection level is filtered by the same rule',
      async () => {
        const fields = await fieldsSchemaFor(author, 'list_memo_query')
        const nested = (fields.notes as { properties: Record<string, unknown> }).properties
        const level2 = (nested.fields as { properties: Record<string, unknown> }).properties

        expect(level2.label).toBeDefined()
        expect(level2.hidden).toBeUndefined()
      },
      BOOT,
    )

    test(
      'the create and update data schemas drop what the session can never write',
      async () => {
        const authorCreate = await dataSchemaFor(author, 'list_memo_create')
        expect(authorCreate?.title).toBeDefined()
        expect(authorCreate?.internal).toBeUndefined()
        expect(authorCreate?.adminOnly).toBeUndefined()

        const adminCreate = await dataSchemaFor(admin, 'list_memo_create')
        expect(adminCreate?.adminOnly).toBeDefined()

        const authorUpdate = await dataSchemaFor(author, 'list_memo_update')
        expect(authorUpdate?.internal).toBeUndefined()
        expect(authorUpdate?.adminOnly).toBeUndefined()
        // Row-dependent on update: it may pass on rows this session owns.
        expect(authorUpdate?.ownerNotes).toBeDefined()
      },
      BOOT,
    )

    test(
      'a write rule that reads the payload is row-dependent, not a denial',
      async () => {
        expect((await dataSchemaFor(author, 'list_memo_create'))?.draftedBy).toBeDefined()
      },
      BOOT,
    )

    test(
      'a required field the session cannot write removes the create tool entirely',
      async () => {
        const authorNames = (await toolsFor(author)).map((tool) => tool.name)
        expect(authorNames).toContain('list_ledger_query')
        expect(authorNames).not.toContain('list_ledger_create')

        const adminNames = (await toolsFor(admin)).map((tool) => tool.name)
        expect(adminNames).toContain('list_ledger_create')
      },
      BOOT,
    )

    test(
      'a dropped field is refused in the same bytes as a name that never existed',
      async () => {
        const dropped = await refusalText(author, { internal: true })
        const unknown = await refusalText(author, { neverExisted: true })

        expect(dropped).toBe(unknown.replace('neverExisted', 'internal'))
        expect(unknown).not.toContain('internal')
        expect(unknown).not.toContain('adminOnly')

        const adminDropped = await refusalText(admin, { internal: true })
        expect(adminDropped).toBe(
          (await refusalText(admin, { neverExisted: true })).replace('neverExisted', 'internal'),
        )
      },
      BOOT,
    )

    test(
      'a relation the schema withheld is refused in the same bytes as a name that never existed',
      async () => {
        const unknown = await refusalText(author, { neverExisted: true }, 'list_post_query')

        // The target list denies `query` outright; this one has MCP disabled.
        expect(
          await refusalText(author, { secretInfo: { fields: { value: true } } }, 'list_post_query'),
        ).toBe(unknown.replace('neverExisted', 'secretInfo'))
        expect(
          await refusalText(author, { draftRef: { fields: { title: true } } }, 'list_post_query'),
        ).toBe(unknown.replace('neverExisted', 'draftRef'))
        expect(unknown).not.toContain('secretInfo')
        expect(unknown).not.toContain('draftRef')
        expect(unknown).not.toContain('restrictedComments')
      },
      BOOT,
    )

    test(
      'the available-fields tail names exactly what the schema advertises',
      async () => {
        const advertised = Object.keys(await fieldsSchemaFor(author, 'list_post_query')).filter(
          (name) => !['id', 'createdAt', 'updatedAt'].includes(name),
        )
        const refusal = await refusalText(author, { neverExisted: true }, 'list_post_query')
        const tail = refusal.slice(refusal.indexOf('Available fields: ') + 18, -1)

        expect(tail.split(', ')).toEqual(advertised)
      },
      BOOT,
    )

    test(
      'the second level refuses a relation in the same bytes as a name that never existed',
      async () => {
        const relationNamed = await refusalText(author, { notes: { fields: { memo: true } } })
        const unknown = await refusalText(author, { notes: { fields: { neverExisted: true } } })

        expect(relationNamed).toBe(unknown.replace('neverExisted', 'memo'))
        expect(unknown).not.toContain('memo"')

        const fields = await fieldsSchemaFor(author, 'list_memo_query')
        const nested = (fields.notes as { properties: Record<string, unknown> }).properties
        const level2 = (nested.fields as { properties: Record<string, unknown> }).properties
        expect(level2.memo).toBeUndefined()
      },
      BOOT,
    )

    test(
      'a field rule that throws costs that field its advertisement, not the whole listing',
      async () => {
        const names = (await toolsFor(anonymous)).map((tool) => tool.name)
        expect(names).toContain('list_memo_query')
        expect(names).toContain('list_post_query')

        const fields = await fieldsSchemaFor(anonymous, 'list_memo_query')
        expect(fields.title).toBeDefined()
        expect(fields.brittle).toBeUndefined()

        const nested = (fields.notes as { properties: Record<string, unknown> }).properties
        const level2 = (nested.fields as { properties: Record<string, unknown> }).properties
        expect(level2.label).toBeDefined()
        expect(level2.brittle).toBeUndefined()

        const data = await dataSchemaFor(anonymous, 'list_memo_update')
        expect(data?.title).toBeDefined()
        expect(data?.brittle).toBeUndefined()
      },
      BOOT,
    )

    test(
      'the same holds with no session at all, which the transport never lets past its 401',
      async () => {
        const config = schemaConfig()
        const context = await contextFor(config)()

        const projection = await generateFieldsProjectionSchema(
          config.lists.Memo,
          config,
          null,
          context,
        )
        const properties = (projection as { properties: Record<string, unknown> }).properties
        expect(properties.title).toBeDefined()
        expect(properties.brittle).toBeUndefined()
        expect(properties.adminOnly).toBeUndefined()

        const data = await generateFieldSchemas(
          'Memo',
          config.lists.Memo.fields,
          config,
          'update',
          null,
          context,
        )
        expect(data.properties.title).toBeDefined()
        expect(data.properties.brittle).toBeUndefined()
      },
      BOOT,
    )

    test(
      'the vocabulary is recomputed per session rather than cached across them',
      async () => {
        const first = await fieldsSchemaFor(author, 'list_memo_query')
        const second = await fieldsSchemaFor(admin, 'list_memo_query')
        const third = await fieldsSchemaFor(author, 'list_memo_query')

        expect(first.adminOnly).toBeUndefined()
        expect(second.adminOnly).toBeDefined()
        expect(third.adminOnly).toBeUndefined()
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
      'a count-only relation fetches the same rows as a count-alongside one, never a zero-row placeholder',
      async () => {
        const selector = { where: { approved: true }, orderBy: { body: 'asc' } }
        const only = await resolve({ comments: { ...selector, count: true } })
        const alongside = await resolve({
          comments: { ...selector, count: true, fields: { body: true } },
        })

        // Field-visibility evaluates the relationship field's own `access.read`
        // against whatever the include fetched. Under `take: 0` a rule reading
        // the relation's value (`item.comments.length === 0`) would see an
        // empty array whatever the rows really are, and wrongly GRANT — so the
        // count-only entry must fetch identically, not cheaply.
        expect(only.include?.comments).toEqual(alongside.include?.comments)
        expect(only.include?.comments).toMatchObject({ take: MCP_NESTED_TAKE_DEFAULT })
        expect(only.fieldSelection.comments).toBeUndefined()
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
