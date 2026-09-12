import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import * as z from 'zod'
import type { AccessContext, Session } from '../access/types.js'
import type { OpenSaasConfig } from '../config/types.js'
import { checkbox, relationship, text, virtual } from '../fields/index.js'
import { createTestDatabase, ormClientFor, type TestDatabase } from '../testing/context.js'
import { getContext } from '../context/index.js'
import type { McpSessionProvider } from './types.js'
import { createMcpHandlers } from './handler.js'
import {
  McpProjectionRefusedError,
  generateFieldsProjectionSchema,
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

/**
 * A row-dependent rule (#1361): unanswerable against `classifyRowIndependentRead`'s
 * poisoned item, so — unlike `unguardedSessionRule` — it survives advertisement
 * like any other row-dependent rule. It only throws once handed an actual
 * fetched row, the shape a rule that misbehaves on some real rows takes.
 */
function explodesOnRealRows({ item }: { item: Record<string, unknown> }): boolean {
  if (item.title) throw new TypeError(`row explosion for ${String(item.title)}`)
  return true
}

/** The `item.<relation>.length === 0` rule shape, over a value typed `unknown`. */
function hasNoRows(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0
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
          gatedPost: relationship({ ref: 'Post.gatedComments' }),
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
          // Row-dependent, and dependent on the relation's own rows: Field
          // Visibility can only answer it against the value the include
          // fetched, so a relation read as a bare count decides against the
          // `[]` stand-in and grants (`maskReductions`, `secured/read.ts`).
          gatedComments: relationship({
            ref: 'Comment.gatedPost',
            many: true,
            access: { read: ({ item }) => hasNoRows(item.gatedComments) },
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
      // A unique-constraint fixture: `UniqueConstraintViolation`'s message is
      // documented as safe to show a user (ADR-0042), so it belongs in the
      // MCP write path's allowlist alongside the engine-refusal error types.
      UniqueThing: {
        fields: { slug: text({ isIndexed: 'unique' }) },
        access: { operation: { query: () => true, create: () => true } },
      },
      // Reached only as a relation target, to pin the level-2 vocabulary.
      Memoed: {
        fields: {
          label: text(),
          hidden: text({ access: { read: () => false } }),
          memo: relationship({ ref: 'Memo.notes' }),
        },
        access: { operation: { query: () => true } },
      },
      // The throwing rule lives on its own lists: `resolveFieldsProjection`
      // evaluates every field of the list it is asked about, so a throwing
      // rule anywhere on `Memo` would turn every refusal there into the rule's
      // own error and make the byte-identity fixtures compare two copies of it.
      Brittle: {
        fields: {
          title: text(),
          brittle: text({
            access: {
              read: unguardedSessionRule,
              create: unguardedSessionRule,
              update: unguardedSessionRule,
            },
          }),
          // Row-dependent, so it survives advertisement — the throw only
          // happens once a real row reaches Field Visibility (#1361).
          landmine: text({ access: { read: explodesOnRealRows } }),
          notes: relationship({ ref: 'BrittleNote.parent', many: true }),
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
      BrittleNote: {
        fields: {
          label: text(),
          brittle: text({ access: { read: unguardedSessionRule } }),
          parent: relationship({ ref: 'Brittle.notes' }),
        },
        access: { operation: { query: () => true } },
      },
      // Two lists whose `resolveOutput` hooks read each other — a
      // `ResolveOutputCycleError` fixture, the framework-authored refusal a
      // create/update's own Field Visibility pass can raise same as a read's.
      CycleOne: {
        fields: {
          name: text(),
          echo: virtual({
            type: 'string',
            hooks: {
              resolveOutput: async ({ context }) => {
                await context.db.CycleTwo.all()
                return 'one'
              },
            },
          }),
        },
        access: { operation: { query: () => true, create: () => true } },
      },
      CycleTwo: {
        fields: {
          name: text(),
          echo: virtual({
            type: 'string',
            hooks: {
              resolveOutput: async ({ context }) => {
                await context.db.CycleOne.all()
                return 'two'
              },
            },
          }),
        },
        access: { operation: { query: () => true, create: () => true } },
      },
      // An `int autoincrement` key: the wire still carries a string, and the
      // boundary coercion is what decides what the column gets (ADR-0048).
      Counter: {
        fields: { label: text() },
        db: { idField: 'int autoincrement' },
        access: {
          operation: {
            query: () => true,
            create: () => true,
            update: () => true,
            delete: () => true,
          },
        },
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

  /**
   * The face an application actually hands in. Every other test in this file
   * builds the engine's `AccessContext`, but a route wires the generated
   * `getContext()` up, which returns the app-facing `StackContext` — a secured
   * `db` and none of the engine's plumbing. The two are not assignable to each
   * other, so a suite that only ever passes the engine face proves nothing
   * about the consumer (#1171).
   */
  describe('the context factory an application hands in', () => {
    /** What the generated `getContext()` returns: no `ormHandle`, no `_resolveOutputChain`. */
    function appFacingContextFor(config: OpenSaasConfig) {
      const orm = ormClientFor(database.data, database.client.orm)
      return async (given?: Session) =>
        getContext(
          config,
          orm,
          given ?? null,
          undefined,
          false,
          undefined,
          undefined,
          database.client,
        )
    }

    test(
      'the app-facing context carries no engine members',
      async () => {
        const context = await appFacingContextFor(schemaConfig())()

        expect('ormHandle' in context).toBe(false)
        expect('_resolveOutputChain' in context).toBe(false)
      },
      BOOT,
    )

    test(
      'tools/list and a write both work through it',
      async () => {
        const config = schemaConfig()
        const handlers = createMcpHandlers({
          config,
          getSession: session,
          getContext: appFacingContextFor(config),
        })

        const post = async (method: string, params?: unknown) => {
          const response = await handlers.POST(
            new Request('http://localhost/api/mcp', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
            }),
          )
          return { status: response.status, body: JSON.parse(await response.text()) }
        }

        const listed = await post('tools/list')
        expect(
          (listed.body.result as { tools: ToolList }).tools.map((tool) => tool.name),
        ).toContain('list_post_create')

        const called = await post('tools/call', {
          name: 'list_post_create',
          arguments: { data: { title: 'through the app-facing context' } },
        })
        expect(called.status).toBe(200)
        const payload = JSON.parse(
          (called.body.result as { content: Array<{ text: string }> }).content[0].text,
        )
        expect(payload).toMatchObject({
          success: true,
          item: { title: 'through the app-facing context' },
        })

        const context = await appFacingContextFor(config)()
        expect(await context.db.Post.all()).toMatchObject([
          { title: 'through the app-facing context' },
        ])
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
      depth: 'level-1' | 'level-2' = 'level-1',
    ): Promise<string> {
      const { body } = await rpc(
        'tools/call',
        { name: toolName, arguments: { fields } },
        schemaConfig(),
        getSession,
      )
      const result = body?.result as { isError?: boolean; content: Array<{ text: string }> }
      expect(result.isError).toBe(true)
      const text = result.content[0].text
      // Without this, any other refusal — a rule that threw, say — would
      // satisfy the byte-identity assertions below by being equally wrong on
      // both sides of the comparison.
      expect(text).toContain(depth === 'level-1' ? 'Available fields: ' : 'at this depth')
      return text
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
        const relationNamed = await refusalText(
          author,
          { notes: { fields: { memo: true } } },
          'list_memo_query',
          'level-2',
        )
        const unknown = await refusalText(
          author,
          { notes: { fields: { neverExisted: true } } },
          'list_memo_query',
          'level-2',
        )

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
        expect(names).toContain('list_brittle_query')
        expect(names).toContain('list_post_query')

        const fields = await fieldsSchemaFor(anonymous, 'list_brittle_query')
        expect(fields.title).toBeDefined()
        expect(fields.brittle).toBeUndefined()

        const nested = (fields.notes as { properties: Record<string, unknown> }).properties
        const level2 = (nested.fields as { properties: Record<string, unknown> }).properties
        expect(level2.label).toBeDefined()
        expect(level2.brittle).toBeUndefined()

        const data = await dataSchemaFor(anonymous, 'list_brittle_update')
        expect(data?.title).toBeDefined()
        expect(data?.brittle).toBeUndefined()
      },
      BOOT,
    )

    test(
      'resolveFieldsProjection contains the same rule errors the advertisement does (#1361)',
      async () => {
        const config = schemaConfig()
        const context = await contextFor(config)()

        const projection = await generateFieldsProjectionSchema(
          'Brittle',
          config.lists.Brittle,
          config,
          null,
          context,
        )
        expect(
          (projection as { properties: Record<string, unknown> }).properties.brittle,
        ).toBeUndefined()

        // A caller that never named the brittle field is unaffected by its
        // rule throwing while the vocabulary is decided — the whole point of
        // containing it the same way the advertisement does.
        await expect(
          resolveFieldsProjection(
            { title: true },
            'Brittle',
            config.lists.Brittle,
            config,
            null,
            context,
          ),
        ).resolves.toBeDefined()

        // Naming it explicitly still refuses — as an unadvertised field,
        // exactly like a name that never existed (ADR-0053) — rather than
        // raw-throwing the rule's own TypeError.
        await expect(
          resolveFieldsProjection(
            { brittle: true },
            'Brittle',
            config.lists.Brittle,
            config,
            null,
            context,
          ),
        ).rejects.toThrow(McpProjectionRefusedError)
      },
      BOOT,
    )

    test(
      'the same holds with no session at all, which the transport never lets past its 401',
      async () => {
        const config = schemaConfig()
        const context = await contextFor(config)()

        const projection = await generateFieldsProjectionSchema(
          'Memo',
          config.lists.Memo,
          config,
          null,
          context,
        )
        const properties = (projection as { properties: Record<string, unknown> }).properties
        expect(properties.title).toBeDefined()
        expect(properties.adminOnly).toBeUndefined()

        const brittle = await generateFieldsProjectionSchema(
          'Brittle',
          config.lists.Brittle,
          config,
          null,
          context,
        )
        expect(
          (brittle as { properties: Record<string, unknown> }).properties.brittle,
        ).toBeUndefined()

        const data = await generateFieldSchemas(
          'Brittle',
          config.lists.Brittle.fields,
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
     * ADR-0048: the wire carries a string, the column carries what the list's
     * id strategy says it does, and the boundary coercion is what turns one
     * into the other. A malformed id answers as a missing row does.
     */
    test(
      "an integer-keyed list's update tool takes an integer id, and 404s a malformed one",
      async () => {
        const config = schemaConfig()
        const context = await contextFor(config)()
        const created = await context.db.Counter.create({ data: { label: 'seed' } })

        const ok = await callTool(
          'list_counter_update',
          { where: { id: String(created?.id) }, data: { label: 'renamed' } },
          config,
        )
        expect((ok.body?.result as { isError?: boolean }).isError).toBeUndefined()
        expect(await context.db.Counter.all()).toMatchObject([{ label: 'renamed' }])

        const malformed = await callTool(
          'list_counter_update',
          { where: { id: 'not-a-number' }, data: { label: 'nope' } },
          config,
        )
        const result = malformed.body?.result as {
          isError?: boolean
          content: Array<{ text: string }>
        }
        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('record not found')
        expect(await context.db.Counter.all()).toMatchObject([{ label: 'renamed' }])
      },
      BOOT,
    )

    test(
      "the update and delete tools advertise the id at its own list's type",
      async () => {
        const tools = await listTools()
        const idOf = (name: string) => {
          const where = (
            tools.find((tool) => tool.name === name)?.inputSchema.properties as {
              where: { properties: { id: { type: string } } }
            }
          ).where
          return where.properties.id.type
        }

        expect(idOf('list_post_update')).toBe('string')
        expect(idOf('list_counter_update')).toBe('integer')
        expect(idOf('list_counter_delete')).toBe('integer')
      },
      BOOT,
    )
  })

  /**
   * The `fields` argument, end to end: the wire shape is unchanged (ADR-0037),
   * what it lowers to is the secured surface (ADR-0053), and the engine's own
   * exact selection is the only thing deciding what comes back.
   */
  describe('the fields the query tool returns', () => {
    async function seedBlog(): Promise<void> {
      const context = await contextFor(schemaConfig())()
      const post = await context.db.Post.create({ data: { title: 'seed', content: 'body' } })
      for (const body of ['alpha', 'beta', 'gamma']) {
        await context.db.Comment.create({
          data: { body, approved: body !== 'gamma', post: { connect: { id: post?.id } } },
        })
      }
    }

    async function query(args: Record<string, unknown>): Promise<Record<string, unknown>[]> {
      const { body } = await callTool('list_post_query', args)
      const result = body?.result as { isError?: boolean; content: Array<{ text: string }> }
      if (result.isError) throw new Error(result.content[0].text)
      return (JSON.parse(result.content[0].text) as { items: Record<string, unknown>[] }).items
    }

    async function refusal(args: Record<string, unknown>): Promise<string> {
      const { body } = await callTool('list_post_query', args)
      const result = body?.result as { isError?: boolean; content: Array<{ text: string }> }
      expect(result.isError).toBe(true)
      return result.content[0].text
    }

    test(
      'no fields argument returns the row at its stored width',
      async () => {
        await seedBlog()

        expect(await query({})).toMatchObject([{ title: 'seed', content: 'body' }])
      },
      BOOT,
    )

    test(
      'scalars come back with id, whether or not the caller named it',
      async () => {
        await seedBlog()
        const [item] = await query({ fields: { title: true } })

        expect(item).toMatchObject({ title: 'seed' })
        expect(item.id).toEqual(expect.any(String))
        expect(item).not.toHaveProperty('content')
      },
      BOOT,
    )

    test(
      'a to-one relation comes back with its own selection, id forced there too',
      async () => {
        const context = await contextFor(schemaConfig())()
        const author = await context.db.User.create({ data: { name: 'ada', email: 'a@b.c' } })
        await context.db.Post.create({
          data: { title: 'seed', author: { connect: { id: author?.id } } },
        })

        const [item] = await query({ fields: { author: { fields: { name: true } } } })

        expect(item.author).toMatchObject({ id: author?.id, name: 'ada' })
        expect(item.author).not.toHaveProperty('email')
      },
      BOOT,
    )

    test(
      'a to-many relation pages per parent, sorted and narrowed by its own where',
      async () => {
        await seedBlog()

        const [item] = await query({
          fields: {
            comments: {
              fields: { body: true },
              where: { approved: true },
              orderBy: { body: 'desc' },
              take: 1,
            },
          },
        })

        expect(item.comments).toMatchObject([{ body: 'beta' }])
      },
      BOOT,
    )

    test(
      'the nested page defaults to the standing cap, and a larger take is clamped to the ceiling',
      async () => {
        const context = await contextFor(schemaConfig())()
        const post = await context.db.Post.create({ data: { title: 'seed' } })
        for (let index = 0; index < MCP_NESTED_TAKE_DEFAULT + 2; index += 1) {
          await context.db.Comment.create({
            data: { body: `c${index}`, approved: true, post: { connect: { id: post?.id } } },
          })
        }

        const [defaulted] = await query({ fields: { comments: { fields: { body: true } } } })
        expect(defaulted.comments).toHaveLength(MCP_NESTED_TAKE_DEFAULT)

        const [clamped] = await query({
          fields: { comments: { fields: { body: true }, take: MCP_NESTED_TAKE_MAX + 500 } },
        })
        expect(clamped.comments).toHaveLength(MCP_NESTED_TAKE_DEFAULT + 2)
      },
      BOOT,
    )

    test(
      'count on its own is the number, and beside fields it is { items, count }',
      async () => {
        await seedBlog()

        const [only] = await query({ fields: { comments: { count: true } } })
        expect(only.comments).toBe(3)

        const [both] = await query({
          fields: { comments: { fields: { body: true }, count: true, take: 2 } },
        })
        expect(both.comments).toMatchObject({
          items: [{ body: 'alpha' }, { body: 'beta' }],
          count: 3,
        })
      },
      BOOT,
    )

    /**
     * The replacement for `prisma-8`'s `'a count-only relation fetches the same
     * rows as a count-alongside one, never a zero-row placeholder'`, at the
     * grain the translator left: what a count-only relation *fetches* is no
     * longer observable from MCP, but what Field Visibility decides against it
     * is. `gatedComments` grants only when the relation is empty, so a bare
     * `count()` — whose stand-in is `[]` whatever the rows are — would grant
     * for a post that has comments and hand the count back.
     */
    test(
      'a count-only relation is decided against its rows, not against an empty stand-in',
      async () => {
        const context = await contextFor(schemaConfig())()
        const withComments = await context.db.Post.create({ data: { title: 'gated' } })
        await context.db.Post.create({ data: { title: 'empty' } })
        await context.db.Comment.create({
          data: { body: 'one', approved: true, gatedPost: { connect: { id: withComments?.id } } },
        })

        const items = await query({
          orderBy: { title: 'asc' },
          fields: { title: true, gatedComments: { count: true } },
        })
        const byTitle = new Map(items.map((item) => [item.title, item]))

        expect(byTitle.get('empty')).toHaveProperty('gatedComments', 0)
        expect(byTitle.get('gated')).not.toHaveProperty('gatedComments')
      },
      BOOT,
    )

    /**
     * The `{ items, count }` pair is one `combine` on one include. Two includes
     * of the same relation is what the engine refuses outright
     * (`DuplicateIncludeError`), so a translator that emitted the rows and the
     * count as separate includes would fail here rather than quietly serve one
     * of them.
     */
    test(
      'the rows and the count of one relation are one include, not two',
      async () => {
        await seedBlog()

        const [item] = await query({
          fields: {
            comments: { fields: { body: true }, where: { approved: true }, count: true },
          },
        })

        expect(item.comments).toMatchObject({ items: [{ body: 'alpha' }, { body: 'beta' }] })
        expect((item.comments as { count: number }).count).toBe(2)
      },
      BOOT,
    )

    test(
      'the count counts the relation, not the page it was asked beside',
      async () => {
        await seedBlog()

        const [item] = await query({
          fields: { comments: { fields: { body: true }, take: 1, count: true } },
        })

        expect(item.comments).toMatchObject({ items: [{ body: 'alpha' }], count: 3 })
      },
      BOOT,
    )

    test(
      "a nested row's field the session cannot read never reaches the wire",
      async () => {
        await seedBlog()

        const [item] = await query({ fields: { comments: { fields: { body: true } } } })

        for (const comment of item.comments as Record<string, unknown>[]) {
          expect(comment).not.toHaveProperty('internalNote')
        }
      },
      BOOT,
    )

    test(
      'the root where and orderBy lower through the Where vocabulary',
      async () => {
        const context = await contextFor(schemaConfig())()
        await context.db.Post.create({ data: { title: 'alpha' } })
        await context.db.Post.create({ data: { title: 'beta' } })

        expect(await query({ where: { title: { contains: 'lph' } } })).toMatchObject([
          { title: 'alpha' },
        ])
        expect(await query({ orderBy: { title: 'desc' }, fields: { title: true } })).toMatchObject([
          { title: 'beta' },
          { title: 'alpha' },
        ])
        expect(
          await query({ where: { comments: { none: {} } }, fields: { title: true } }),
        ).toHaveLength(2)
      },
      BOOT,
    )

    test(
      'take and skip page the root read',
      async () => {
        const context = await contextFor(schemaConfig())()
        for (const title of ['alpha', 'beta', 'gamma']) {
          await context.db.Post.create({ data: { title } })
        }

        expect(
          await query({ orderBy: { title: 'asc' }, take: 1, skip: 1, fields: { title: true } }),
        ).toMatchObject([{ title: 'beta' }])
      },
      BOOT,
    )

    test(
      'a negative page bound is refused at the root as it is inside a relation',
      async () => {
        expect(await refusal({ take: -1 })).toContain('"Post.take" must not be negative')
        expect(await refusal({ skip: -5 })).toContain('"Post.skip" must not be negative')
        expect(
          await refusal({ fields: { comments: { fields: { body: true }, skip: -5 } } }),
        ).toContain('"Post.comments.skip" must not be negative')

        const context = await contextFor(schemaConfig())()
        await context.db.Post.create({ data: { title: 'alpha' } })
        await expect(query({ take: 0, skip: 0, fields: { title: true } })).resolves.toBeInstanceOf(
          Array,
        )
      },
      BOOT,
    )

    /**
     * `update`/`delete` take a wire id through `parseListId` (ADR-0048), so an
     * assistant that used `list_counter_update` with `{ id: "3" }` will reuse
     * the string form here. Without the same coercion it reaches the driver as
     * a string against an `int` column.
     */
    test(
      "a query's where.id is typed from the list's own id strategy",
      async () => {
        const context = await contextFor(schemaConfig())()
        const counter = await context.db.Counter.create({ data: { label: 'first' } })
        await context.db.Counter.create({ data: { label: 'second' } })
        const numericId = counter?.id
        expect(numericId).toEqual(expect.any(Number))

        async function counters(args: Record<string, unknown>): Promise<unknown[]> {
          const { body } = await callTool('list_counter_query', args)
          const result = body?.result as { isError?: boolean; content: Array<{ text: string }> }
          if (result.isError) throw new Error(result.content[0].text)
          return (JSON.parse(result.content[0].text) as { items: unknown[] }).items
        }

        expect(await counters({ where: { id: String(numericId) } })).toMatchObject([
          { label: 'first' },
        ])
        expect(await counters({ where: { id: { in: [String(numericId)] } } })).toMatchObject([
          { label: 'first' },
        ])
        expect(await counters({ where: { id: 'not-an-int' } })).toEqual([])
      },
      BOOT,
    )

    test(
      'what is refused: an unadvertised name, a wrong selector shape, and an unreachable relation',
      async () => {
        expect(await refusal({ fields: { nope: true } })).toContain('has no field "nope"')
        expect(await refusal({ fields: { author: true } })).toContain('is a relation')
        expect(await refusal({ fields: { title: 'yes' } })).toContain('is a scalar')
        expect(await refusal({ fields: { secretInfo: { fields: { value: true } } } })).toContain(
          'has no field "secretInfo"',
        )
        expect(
          await refusal({ fields: { comments: { fields: { body: true }, take: -1 } } }),
        ).toContain('must not be negative')
      },
      BOOT,
    )

    /**
     * The nested predicate names fields on the RELATED list, and the engine
     * gates it exactly as it gates the root's own — a field-level-denied
     * column is refused with the message an undeclared one gets (#912,
     * ADR-0031), so this module keeps no copy of that rule.
     */
    test(
      'a nested where or orderBy naming a field the session cannot read is refused',
      async () => {
        expect(
          await refusal({
            fields: { comments: { fields: { body: true }, where: { internalNote: 'x' } } },
          }),
        ).toContain('not a queryable field')
        expect(
          await refusal({
            fields: { comments: { fields: { body: true }, orderBy: { internalNote: 'asc' } } },
          }),
        ).toContain('not a queryable field')
      },
      BOOT,
    )

    test(
      'a where outside the vocabulary is refused rather than passed on',
      async () => {
        expect(await refusal({ where: { title: { startsWith: 'a' } } })).toContain('Post.title')
        expect(await refusal({ orderBy: { title: 'sideways' } })).toContain('"asc" or "desc"')
      },
      BOOT,
    )
  })

  /**
   * #1361: a throwing field-level access rule must not leak its raw error
   * text to the MCP client, and a rule on a field the caller never named
   * must not fail the whole query.
   */
  describe('a throwing access rule on the read path', () => {
    // Seeded via `sudo()`: `Brittle.brittle`'s own `read` rule throws
    // unconditionally, and a write's OWN result runs Field Visibility over
    // the full row (no `fields` projection applies to a write) — so even a
    // create that never names `brittle` in its data would surface that same
    // throw on the row it hands back. Sudo bypasses field access entirely,
    // which is the only way to seed this list's rows at all.
    async function seedBrittle(title = 'seed'): Promise<string> {
      const orm = ormClientFor(database.data, database.client.orm)
      const context = getContext(
        schemaConfig(),
        orm,
        null,
        undefined,
        false,
        undefined,
        undefined,
        database.client,
      )
      const brittle = await context.sudo().db.Brittle.create({ data: { title } })
      if (!brittle) throw new Error('seedBrittle: sudo create was denied')
      await context.sudo().db.BrittleNote.create({
        data: { label: 'note', parent: { connect: { id: brittle.id } } },
      })
      return String(brittle.id)
    }

    async function callBrittleQuery(
      args: Record<string, unknown>,
    ): Promise<{ isError?: boolean; content: Array<{ text: string }> }> {
      const { body } = await callTool('list_brittle_query', args)
      return body?.result as { isError?: boolean; content: Array<{ text: string }> }
    }

    test(
      'a query naming fields but not the brittle one succeeds, at either nesting level',
      async () => {
        await seedBrittle()

        const top = await callBrittleQuery({ fields: { title: true } })
        expect(top.isError).toBeUndefined()
        expect(JSON.parse(top.content[0].text)).toMatchObject({ items: [{ title: 'seed' }] })

        const nested = await callBrittleQuery({
          fields: { title: true, notes: { fields: { label: true } } },
        })
        expect(nested.isError).toBeUndefined()
        expect(JSON.parse(nested.content[0].text)).toMatchObject({
          items: [{ notes: [{ label: 'note' }] }],
        })
      },
      BOOT,
    )

    test(
      'naming the brittle field explicitly refuses without leaking its raw error text',
      async () => {
        const result = await callBrittleQuery({ fields: { brittle: true } })

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('has no field "brittle"')
        expect(result.content[0].text).not.toContain('Cannot read properties of null')
        expect(result.content[0].text).not.toContain('TypeError')
      },
      BOOT,
    )

    test(
      'a rule that only throws on a real row is redacted on the wire and logged server-side',
      async () => {
        await seedBrittle('boom')
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        const result = await callBrittleQuery({ fields: { title: true, landmine: true } })

        expect(result.isError).toBe(true)
        expect(result.content[0].text).not.toContain('row explosion')
        expect(result.content[0].text).not.toContain('TypeError')

        expect(errorSpy).toHaveBeenCalled()
        expect(String(errorSpy.mock.calls[0]?.[1])).toContain('row explosion')

        errorSpy.mockRestore()
      },
      BOOT,
    )

    /**
     * #1456: a create/update's own returned row runs through Field Visibility
     * exactly like a read does (no `fields`/`.select()` narrows a write's
     * result), so the same throwing rule leaks through the write path's own
     * catch unless it's redacted the same way.
     */
    test(
      'create does not leak the raw error text for a field it never wrote',
      async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        const { body } = await callTool('list_brittle_create', { data: { title: 'boom' } })
        const result = body?.result as { isError?: boolean; content: Array<{ text: string }> }

        expect(result.isError).toBe(true)
        expect(result.content[0].text).not.toContain('Cannot read properties of null')
        expect(result.content[0].text).not.toContain('TypeError')

        expect(errorSpy).toHaveBeenCalled()
        expect(String(errorSpy.mock.calls[0]?.[1])).toContain('Cannot read properties of null')

        errorSpy.mockRestore()
      },
      BOOT,
    )

    test(
      'update does not leak the raw error text for a field it never wrote',
      async () => {
        const id = await seedBrittle()
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        const { body } = await callTool('list_brittle_update', {
          where: { id },
          data: { title: 'updated' },
        })
        const result = body?.result as { isError?: boolean; content: Array<{ text: string }> }

        expect(result.isError).toBe(true)
        expect(result.content[0].text).not.toContain('Cannot read properties of null')
        expect(result.content[0].text).not.toContain('TypeError')

        expect(errorSpy).toHaveBeenCalled()
        expect(String(errorSpy.mock.calls[0]?.[1])).toContain('Cannot read properties of null')

        errorSpy.mockRestore()
      },
      BOOT,
    )
  })

  /**
   * `ResolveOutputCycleError` (#844, ADR-0023) is a loud, framework-authored
   * refusal whose message names only lists and fields on its own resolve
   * chain — no session or application data — so it belongs in the same
   * allowlist as `AccessScopeDepthExceededError`/`RelationFilterAccessDeniedError`
   * rather than behind the generic "failed due to an internal error" text.
   */
  describe('a resolveOutput cycle on query and create', () => {
    // Seeded against a config where CycleOne/CycleTwo have no `echo` field at
    // all — a virtual field has no column, so this doesn't change the
    // underlying table — so `sudo()`'s own create doesn't compute `echo` and
    // trigger the cycle while seeding (resolve-chain.test.ts's same split).
    // A hook only fires per row it has to compute a value for: an empty
    // `CycleTwo` means `context.db.CycleTwo.all()` returns `[]` without ever
    // reaching CycleTwo's own `echo` hook, so the chain needs a seeded row on
    // both sides before it can loop back into itself.
    async function seedCycle(): Promise<void> {
      const orm = ormClientFor(database.data, database.client.orm)
      const base = schemaConfig()
      const plainConfig: OpenSaasConfig = {
        ...base,
        lists: {
          ...base.lists,
          CycleOne: { fields: { name: text() }, access: base.lists.CycleOne.access },
          CycleTwo: { fields: { name: text() }, access: base.lists.CycleTwo.access },
        },
      }
      const context = getContext(
        plainConfig,
        orm,
        null,
        undefined,
        false,
        undefined,
        undefined,
        database.client,
      )
      await context.sudo().db.CycleOne.create({ data: { name: 'one' } })
      await context.sudo().db.CycleTwo.create({ data: { name: 'two' } })
    }

    test(
      'a query reaches the real cycle diagnostic rather than the generic redaction',
      async () => {
        await seedCycle()
        const { body } = await callTool('list_cycleOne_query', {})
        const result = body?.result as { isError?: boolean; content: Array<{ text: string }> }

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('resolveOutput cycle detected')
        expect(result.content[0].text).not.toContain('failed due to an internal error')
      },
      BOOT,
    )

    test(
      'a create reaches the real cycle diagnostic rather than the generic redaction',
      async () => {
        await seedCycle()
        const { body } = await callTool('list_cycleOne_create', { data: { name: 'x' } })
        const result = body?.result as { isError?: boolean; content: Array<{ text: string }> }

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('resolveOutput cycle detected')
        expect(result.content[0].text).not.toContain('failed due to an internal error')
      },
      BOOT,
    )
  })

  test(
    'a unique constraint violation on create keeps its own safe message rather than the generic redaction',
    async () => {
      await callTool('list_uniqueThing_create', { data: { slug: 'dup' } })
      const { body } = await callTool('list_uniqueThing_create', { data: { slug: 'dup' } })
      const result = body?.result as { isError?: boolean; content: Array<{ text: string }> }

      expect(result.isError).toBe(true)
      expect(result.content[0].text.toLowerCase()).toContain('unique')
      expect(result.content[0].text).not.toContain('failed due to an internal error')
    },
    BOOT,
  )
})
