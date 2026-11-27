import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import * as z from 'zod'
import type { AccessControlledDB, Session } from '../access/types.js'
import type { OpenSaasConfig } from '../config/types.js'
import { text } from '../fields/index.js'
import { ValidationError } from '../hooks/index.js'
import { classifyDriverError } from '../lib/database-errors.js'
import { createProcedureHandler } from '../procedures/http.js'
import {
  createProcedureBuilder,
  ProcedureDefinitionError,
  type ProcedureRegistry,
} from '../procedures/procedure.js'
import { ProcedureHostError } from '../procedures/validate.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import type { StackContext } from '../types/context.js'
import { createMcpHandlers } from './handler.js'
import type { McpSessionProvider } from './types.js'

const BOOT = 120_000
const ORIGIN = 'http://app.test'

type Ctx = StackContext<AccessControlledDB>

const owned = ({ session }: { session: Session | null }) =>
  session === null ? false : { authorId: { equals: String(session.userId) } }

function schemaConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    mcp: { enabled: true, basePath: '/api/mcp', scopes: { read: 'read', write: 'write' } },
    lists: {
      Post: {
        fields: {
          title: text({ validation: { isRequired: true } }),
          authorId: text(),
          secret: text(),
        },
        access: {
          operation: { query: owned, create: () => true, update: owned, delete: owned },
        },
        hooks: {
          validate: async (args) => {
            if (args.operation !== 'delete' && String(args.resolvedData.title).includes('spam')) {
              args.addValidationError('Title cannot contain spam')
            }
          },
        },
      },
    },
  }
}

const procedure = createProcedureBuilder<Ctx>()

const postOutput = z.object({ id: z.string(), title: z.string() })

function rowOf(value: unknown): z.infer<typeof postOutput> & { secret?: unknown } {
  return postOutput.extend({ secret: z.unknown() }).parse(value)
}

function userIdOf(session: Session | null): string {
  return session === null ? '' : String(session.userId)
}

const createPost = procedure({
  description: 'Create a post authored by the caller',
  input: z.object({ title: z.string().min(1) }),
  output: postOutput,
  access: ({ session }) => session !== null,
  expose: ['web', 'mcp'],
  run: async ({ input, context }) => {
    const row = await context.db.Post.create({
      data: { title: input.title, authorId: userIdOf(context.session), secret: 'hidden' },
    })
    if (row === null) throw new Error('create denied')
    return rowOf(row)
  },
})

const renamePost = procedure({
  description: 'Rename a post by id',
  input: z.object({ id: z.string(), title: z.string() }),
  output: z.object({ renamed: z.boolean() }),
  access: ({ session }) => session !== null,
  expose: ['mcp'],
  run: async ({ input, context }) => {
    const row = await context.db.Post.update({
      where: { id: input.id },
      data: { title: input.title },
    })
    return { renamed: row !== null }
  },
})

const publishBatch = procedure({
  description: 'Create two posts, then fail as declared',
  input: z.object({}),
  output: z.object({}),
  failures: { BATCH_FULL: 'The batch is full' },
  access: () => true,
  expose: ['web', 'mcp'],
  run: async ({ context, fail }) =>
    context.transaction(async (tx) => {
      await tx.db.Post.create({ data: { title: 'first', authorId: userIdOf(tx.session) } })
      await tx.db.Post.create({ data: { title: 'second', authorId: userIdOf(tx.session) } })
      throw fail('BATCH_FULL')
    }),
})

const whoAmI = procedure({
  description: 'Say who is calling',
  input: z.object({}),
  output: z.object({ kind: z.string(), clientId: z.string(), userId: z.string() }),
  access: () => true,
  expose: ['mcp'],
  scopes: [],
  run: ({ context }) => {
    const actor = context.session?.actor
    return {
      kind: actor?.kind ?? 'none',
      clientId: actor?.kind === 'agent' ? actor.clientId : '',
      userId: userIdOf(context.session),
    }
  },
})

const humansOnly = procedure({
  description: 'Only a person may call this',
  input: z.object({}),
  output: z.object({}),
  access: ({ session }) => session?.actor?.kind === 'human',
  expose: ['web', 'mcp'],
  run: () => ({}),
})

const webOnly = procedure({
  description: 'Reachable by people only',
  input: z.object({}),
  output: z.object({ ran: z.boolean() }),
  access: () => true,
  expose: ['web'],
  run: () => ({ ran: true }),
})

const publishScoped = procedure({
  description: 'Needs a scope of its own',
  input: z.object({}),
  output: z.object({}),
  access: () => true,
  expose: ['mcp'],
  scopes: ['posts:publish'],
  run: () => ({}),
})

const explode = procedure({
  description: 'Fail with an internal detail',
  input: z.object({}),
  output: z.object({}),
  access: () => true,
  expose: ['mcp'],
  run: () => {
    throw new Error('connection string postgres://admin:hunter2@db')
  },
})

const validateExplicitly = procedure({
  description: 'Throw a validation error',
  input: z.object({}),
  output: z.object({}),
  access: () => true,
  expose: ['mcp'],
  run: () => {
    throw new ValidationError(['Name is taken'], { name: 'Name is taken' })
  },
})

const loseRace = procedure({
  description: 'Lose a race the database rolled back',
  input: z.object({}),
  output: z.object({}),
  access: () => true,
  expose: ['mcp'],
  run: () => {
    const driverError = Object.assign(new Error('could not serialize access'), {
      kind: 'sql_query',
      sqlState: '40001',
    })
    throw classifyDriverError(driverError) ?? driverError
  },
})

const accessThrows = procedure({
  description: 'An access rule with a bug',
  input: z.object({}),
  output: z.object({}),
  access: () => {
    throw new Error('rule bug')
  },
  expose: ['mcp'],
  run: () => ({}),
})

function filterRule(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    Reflect.apply(resolve, undefined, [{ authorId: { equals: 'alice' } }])
  })
}

const TreeNode = z
  .object({
    name: z.string(),
    get children() {
      return z.array(TreeNode)
    },
  })
  .meta({ id: 'McpToolTreeNode' })

const RegisteredAuthor = z.object({ name: z.string() }).meta({ id: 'McpToolRegisteredAuthor' })

function unresolvedRefs(schema: Record<string, unknown>): string[] {
  const defs = z.record(z.string(), z.unknown()).optional().parse(schema.$defs) ?? {}
  const refs: string[] = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (typeof value !== 'object' || value === null) return
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string') refs.push(child)
      visit(child)
    }
  }
  visit(schema)
  return refs.filter((ref) => {
    const id = /^#\/\$defs\/(.+)$/.exec(ref)?.[1]
    return id === undefined || !Object.hasOwn(defs, id)
  })
}

const filterAccess = procedure({
  description: 'An access rule that returns a filter instead of a boolean',
  input: z.object({}),
  output: z.object({}),
  access: filterRule,
  expose: ['mcp'],
  run: () => ({}),
})

const registry = {
  filterAccess,
  createPost,
  renamePost,
  publishBatch,
  whoAmI,
  humansOnly,
  webOnly,
  publishScoped,
  explode,
  validateExplicitly,
  loseRace,
  accessThrows,
} satisfies ProcedureRegistry<Ctx>

const envelope = z.object({
  success: z.boolean(),
  data: z.record(z.string(), z.unknown()).optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      fieldErrors: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
})

const toolResult = z.object({
  content: z.tuple([z.object({ type: z.literal('text'), text: z.string() })]),
  isError: z.literal(true).optional(),
})

const toolList = z.array(
  z.object({
    name: z.string(),
    description: z.string(),
    inputSchema: z.record(z.string(), z.unknown()),
  }),
)

const rpcBody = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.number(), z.string(), z.null()]),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
})

function bearer(userId: string, scopes: readonly string[] = ['read', 'write']): string {
  return `Bearer ${userId}:client-1:${scopes.join(',')}`
}

describe('procedures as MCP tools', () => {
  let database: TestDatabase
  const onUnexpectedProcedureError = vi.fn()

  const getSession: McpSessionProvider = async (request) => {
    const match = /^Bearer ([a-z]+):([a-z0-9-]+):(.*)$/.exec(
      request.headers.get('authorization') ?? '',
    )
    if (match === null) return null
    const [, userId = '', clientId = '', scopes = ''] = match
    return { userId, clientId, scopes: scopes === '' ? [] : scopes.split(',') }
  }

  function handlers(
    procedures: ProcedureRegistry<Ctx> = registry,
    config: OpenSaasConfig = schemaConfig(),
    getContext: (session?: Session) => Promise<Ctx> = async (session) => database.context(session),
  ) {
    return createMcpHandlers({
      config,
      getSession,
      getContext,
      procedures,
      onUnexpectedProcedureError,
    })
  }

  async function rpc(
    method: string,
    params: unknown,
    init: {
      authorization?: string
      procedures?: ProcedureRegistry<Ctx>
      getContext?: (session?: Session) => Promise<Ctx>
    } = {},
  ): Promise<{ status: number; body: z.infer<typeof rpcBody> }> {
    const response = await handlers(init.procedures, undefined, init.getContext).POST(
      new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: init.authorization ?? bearer('alice'),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 7, method, params }),
      }),
    )
    return { status: response.status, body: rpcBody.parse(await response.json()) }
  }

  async function listNames(authorization?: string): Promise<string[]> {
    const { body } = await rpc('tools/list', undefined, { authorization })
    return toolList
      .parse(z.object({ tools: z.unknown() }).parse(body.result).tools)
      .map((tool) => tool.name)
  }

  async function call(
    name: string,
    args: unknown,
    authorization?: string,
  ): Promise<{ result: z.infer<typeof toolResult>; envelope: z.infer<typeof envelope> }> {
    const { body } = await rpc('tools/call', { name, arguments: args }, { authorization })
    const result = toolResult.parse(body.result)
    return { result, envelope: envelope.parse(JSON.parse(result.content[0].text)) }
  }

  async function rows(): Promise<{ title: string; authorId: string }[]> {
    const all = await database.context().sudo().db.Post.all()
    return all
      .map((row) => ({ title: String(row.title), authorId: String(row.authorId) }))
      .sort((left, right) => left.title.localeCompare(right.title))
  }

  beforeAll(async () => {
    database = await createTestDatabase(schemaConfig())
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(async () => {
    await database.truncate()
    onUnexpectedProcedureError.mockClear()
  })

  describe('tools/list', () => {
    test('lists each MCP-exposed procedure with its description and input schema', async () => {
      const { body } = await rpc('tools/list', undefined)
      const tools = toolList.parse(z.object({ tools: z.unknown() }).parse(body.result).tools)
      const tool = tools.find((candidate) => candidate.name === 'createPost')
      expect(tool).toEqual({
        name: 'createPost',
        description: 'Create a post authored by the caller',
        inputSchema: expect.objectContaining({
          type: 'object',
          properties: { title: { type: 'string', minLength: 1 } },
          required: ['title'],
        }),
      })
      expect(tool?.inputSchema).not.toHaveProperty('$schema')
    })

    test('leaves out a procedure not exposed to MCP', async () => {
      const names = await listNames()
      expect(names).toContain('renamePost')
      expect(names).not.toContain('webOnly')
    })

    test("leaves out a procedure whose access rule denies this session's agent", async () => {
      const names = await listNames()
      expect(names).toContain('whoAmI')
      expect(names).not.toContain('humansOnly')
    })

    test('leaves out a procedure whose access rule returns anything but true', async () => {
      expect(await listNames()).not.toContain('filterAccess')
      const { result, envelope: answer } = await call('filterAccess', {})
      expect(result.isError).toBe(true)
      expect(answer.error?.code).toBe('DENIED')
    })

    test('leaves out a procedure whose access rule throws, and reports it by name', async () => {
      expect(await listNames()).not.toContain('accessThrows')
      expect(onUnexpectedProcedureError).toHaveBeenCalledWith(expect.any(Error), 'accessThrows')
    })

    test('requires the configured write scope when a procedure names none', async () => {
      const names = await listNames(bearer('alice', ['read']))
      expect(names).not.toContain('createPost')
      expect(names).toContain('whoAmI')
    })

    test("requires a procedure's own scopes when it names them", async () => {
      expect(await listNames()).not.toContain('publishScoped')
      expect(await listNames(bearer('alice', ['read', 'write', 'posts:publish']))).toContain(
        'publishScoped',
      )
    })
  })

  describe('tools/call', () => {
    test('runs the procedure under the agent actor and returns the envelope', async () => {
      const { result, envelope: answer } = await call('whoAmI', {})
      expect(result.isError).toBeUndefined()
      expect(answer).toEqual({
        success: true,
        data: { kind: 'agent', clientId: 'client-1', userId: 'alice' },
      })
    })

    test('writes through context.db and removes undeclared output keys', async () => {
      const { envelope: answer } = await call('createPost', { title: 'Hello' })
      expect(answer.success).toBe(true)
      expect(answer.data).toEqual({ id: expect.any(String), title: 'Hello' })
      expect(await rows()).toEqual([{ title: 'Hello', authorId: 'alice' }])
    })

    test('a procedure not exposed to MCP answers exactly as an unknown tool', async () => {
      const unexposed = await rpc('tools/call', { name: 'webOnly', arguments: {} })
      const unknown = await rpc('tools/call', { name: 'noSuchTool', arguments: {} })
      expect(unexposed.status).toBe(unknown.status)
      expect(unexposed.body).toEqual({
        ...unknown.body,
        error: { code: -32603, message: 'Unknown tool: webOnly' },
      })
      expect(unknown.body.error?.message).toBe('Unknown tool: noSuchTool')
    })

    test('an access rule that denies the agent is DENIED', async () => {
      const { result, envelope: answer } = await call('humansOnly', {})
      expect(result.isError).toBe(true)
      expect(answer.error?.code).toBe('DENIED')
    })

    test('a missing scope is DENIED, naming the scope, and runs nothing', async () => {
      const { result, envelope: answer } = await call(
        'createPost',
        { title: 'Nope' },
        bearer('alice', ['read']),
      )
      expect(result.isError).toBe(true)
      expect(answer.error).toEqual({
        code: 'DENIED',
        message: 'Tool "createPost" requires the OAuth scope(s): write.',
      })
      expect(await rows()).toEqual([])
    })

    test("a procedure's own scopes are checked on the call", async () => {
      expect((await call('publishScoped', {})).envelope.error?.message).toBe(
        'Tool "publishScoped" requires the OAuth scope(s): posts:publish.',
      )
      expect(
        (await call('publishScoped', {}, bearer('alice', ['read', 'write', 'posts:publish'])))
          .envelope.success,
      ).toBe(true)
    })

    test('invalid input is INVALID_INPUT with field errors', async () => {
      const { result, envelope: answer } = await call('createPost', { title: '' })
      expect(result.isError).toBe(true)
      expect(answer.error?.code).toBe('INVALID_INPUT')
      expect(Object.keys(answer.error?.fieldErrors ?? {})).toEqual(['title'])
    })

    test('missing arguments are parsed as an empty object', async () => {
      const { body } = await rpc('tools/call', { name: 'whoAmI' })
      expect(
        envelope.parse(JSON.parse(toolResult.parse(body.result).content[0].text)).success,
      ).toBe(true)
    })

    test('a hook validation error is VALIDATION with field errors', async () => {
      expect((await call('createPost', { title: 'spam' })).envelope.error?.code).toBe('VALIDATION')
      expect((await call('validateExplicitly', {})).envelope.error).toEqual({
        code: 'VALIDATION',
        message: 'Validation failed: Name is taken',
        fieldErrors: { name: 'Name is taken' },
      })
    })

    test('a serialization failure is RETRY', async () => {
      expect((await call('loseRace', {})).envelope.error?.code).toBe('RETRY')
    })

    test('a declared failure is a tool error carrying its code and rolls its transaction back', async () => {
      const { result, envelope: answer } = await call('publishBatch', {})
      expect(result.isError).toBe(true)
      expect(answer).toEqual({
        success: false,
        error: { code: 'BATCH_FULL', message: 'The batch is full' },
      })
      expect(await rows()).toEqual([])
    })

    test('an unexpected error is INTERNAL, redacted, and reported by name', async () => {
      const { result } = await call('explode', {})
      expect(result.isError).toBe(true)
      expect(result.content[0].text).not.toContain('hunter2')
      expect(JSON.parse(result.content[0].text)).toEqual({
        success: false,
        error: { code: 'INTERNAL', message: 'Internal error' },
      })
      expect(onUnexpectedProcedureError).toHaveBeenCalledWith(expect.any(Error), 'explode')
    })

    test("list access still denies a row the procedure's access admitted", async () => {
      const { envelope: created } = await call('createPost', { title: 'Bob' }, bearer('bob'))
      const id = z.object({ id: z.string() }).parse(created.data).id
      expect((await call('renamePost', { id, title: 'Stolen' })).envelope).toEqual({
        success: true,
        data: { renamed: false },
      })
      expect(await rows()).toEqual([{ title: 'Bob', authorId: 'bob' }])
    })
  })

  describe('a context procedures cannot run in', () => {
    const notEngineBuilt = async (session?: Session): Promise<Ctx> =>
      new Proxy(database.context(session), {
        has: (target, key) => typeof key !== 'symbol' && Reflect.has(target, key),
        get: (target, key) => (typeof key === 'symbol' ? undefined : Reflect.get(target, key)),
      })
    const withNull =
      (member: string) =>
      async (session?: Session): Promise<Ctx> =>
        new Proxy(database.context(session), {
          get: (target, key) => (key === member ? null : Reflect.get(target, key)),
        })

    test.each([
      ['one the engine did not build', notEngineBuilt],
      ['one with a null db', withNull('db')],
      ['one with null plugins', withNull('plugins')],
    ])('answers 500 on tools/list and tools/call: %s', async (_label, getContext) => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const listed = await handlers(registry, schemaConfig(), getContext).POST(
          new Request('http://localhost/api/mcp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', authorization: bearer('alice') },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
          }),
        )
        const called = await handlers(registry, schemaConfig(), getContext).POST(
          new Request('http://localhost/api/mcp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', authorization: bearer('alice') },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/call',
              params: { name: 'createPost', arguments: { title: 'Never' } },
            }),
          }),
        )
        expect(listed.status).toBe(500)
        expect(called.status).toBe(500)
        expect(await called.json()).toEqual(await listed.json())
        expect(logged).toHaveBeenCalledTimes(2)
        expect(await rows()).toEqual([])
      } finally {
        logged.mockRestore()
      }
    })
  })

  test('a call refused for a missing scope never builds a context', async () => {
    const getContext = vi.fn(async (): Promise<Ctx> => {
      throw new Error('getContext must not be called')
    })
    const response = await handlers(registry, schemaConfig(), getContext).POST(
      new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: bearer('alice', ['read']) },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'createPost', arguments: { title: 'Nope' } },
        }),
      }),
    )
    expect(response.status).toBe(200)
    const result = toolResult.parse(rpcBody.parse(await response.json()).result)
    expect(envelope.parse(JSON.parse(result.content[0].text)).error?.code).toBe('DENIED')
    expect(getContext).not.toHaveBeenCalled()
  })

  describe('with no list opting in to a generated write tool', () => {
    test('a procedure is still the agent’s way to write', async () => {
      const names = await listNames()
      expect(names).not.toContain('list_post_create')
      const generated = await rpc('tools/call', {
        name: 'list_post_create',
        arguments: { data: { title: 'Generated' } },
      })
      expect(generated.body.error?.message).toBe('Unknown tool: list_post_create')

      expect((await call('createPost', { title: 'Through a procedure' })).envelope.success).toBe(
        true,
      )
      expect(await rows()).toEqual([{ title: 'Through a procedure', authorId: 'alice' }])
    })
  })

  describe('beside the HTTP host', () => {
    function web(name: string, body: unknown, headers: Record<string, string>): Promise<Response> {
      return createProcedureHandler<Ctx>({
        procedures: registry,
        config: schemaConfig(),
        getContext: async (session) => database.context(session),
        getSession: async (request) => {
          const match = /session=([a-z]+)/.exec(request.headers.get('cookie') ?? '')
          return match === null ? null : { userId: match[1] }
        },
        allowedOrigins: [ORIGIN],
      })(
        new Request(`${ORIGIN}/api/procedures/${name}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
          body: JSON.stringify(body),
        }),
      )
    }

    test('web and MCP give equivalent results for the same user', async () => {
      const viaWeb = envelope.parse(
        await (await web('createPost', { title: 'Web' }, { cookie: 'session=alice' })).json(),
      )
      const { envelope: viaMcp } = await call('createPost', { title: 'Mcp' })
      expect(Object.keys(viaWeb.data ?? {})).toEqual(Object.keys(viaMcp.data ?? {}))
      expect({ ...viaWeb, data: { ...viaWeb.data, id: '', title: '' } }).toEqual({
        ...viaMcp,
        data: { ...viaMcp.data, id: '', title: '' },
      })

      const failedWeb = await (await web('publishBatch', {}, { cookie: 'session=alice' })).json()
      const { envelope: failedMcp } = await call('publishBatch', {})
      expect(failedWeb).toEqual(failedMcp)

      const invalidWeb = await (
        await web('createPost', { title: '' }, { cookie: 'session=alice' })
      ).json()
      const { envelope: invalidMcp } = await call('createPost', { title: '' })
      expect(invalidWeb).toEqual(invalidMcp)

      expect(await rows()).toEqual([
        { title: 'Mcp', authorId: 'alice' },
        { title: 'Web', authorId: 'alice' },
      ])
    })

    test('an MCP token is refused by the HTTP handler', async () => {
      const token = bearer('alice')
      expect((await call('createPost', { title: 'Agent' }, token)).envelope.success).toBe(true)

      const attempts: Record<string, string>[] = [
        { authorization: token },
        { authorization: token, cookie: 'session=alice' },
      ]
      for (const headers of attempts) {
        const response = await web('createPost', { title: 'Replayed' }, headers)
        expect(response.status).toBe(401)
        expect(envelope.parse(await response.json()).error?.code).toBe('UNAUTHENTICATED')
      }
      const anonymous = await web('publishBatch', {}, { authorization: token })
      expect(anonymous.status).toBe(401)
      expect(await rows()).toEqual([{ title: 'Agent', authorId: 'alice' }])
    })
  })

  describe('when the handlers are created', () => {
    test('a procedure named like a custom tool is refused', () => {
      const config = schemaConfig()
      const post = config.lists.Post
      if (post === undefined) throw new Error('Post list missing')
      post.mcp = {
        customTools: [
          {
            name: 'createPost',
            description: 'A custom tool',
            inputSchema: z.object({}),
            handler: async () => ({}),
          },
        ],
      }
      expect(() => handlers(registry, config)).toThrow(ProcedureHostError)
      expect(() => handlers(registry, config)).toThrow('custom tool on list "Post"')
    })

    test('a procedure whose scopes are not scope names is refused when defined', () => {
      const define = (scopes: readonly string[]) =>
        procedure({
          description: 'Name a bad scope',
          input: z.object({}),
          output: z.object({}),
          access: () => true,
          expose: ['mcp'],
          scopes,
          run: () => ({}),
        })
      expect(() => define([''])).toThrow(ProcedureDefinitionError)
      expect(() => define(['posts publish'])).toThrow(ProcedureDefinitionError)
      expect(() => define(['posts:publish'])).not.toThrow()
    })

    test('a procedure named like a generated tool is refused', () => {
      expect(() => handlers({ list_post_create: webOnly })).toThrow('reserved')
    })

    test('an MCP-exposed procedure whose input is not an object is refused', () => {
      const scalar = procedure({
        description: 'Take a bare string',
        input: z.string(),
        output: z.object({}),
        access: () => true,
        expose: ['mcp'],
        run: () => ({}),
      })
      expect(() => handlers({ scalar })).toThrow("exposed to 'mcp', but its input schema")
      const webScalar = procedure({
        description: 'Take a bare string over the web',
        input: z.string(),
        output: z.object({}),
        access: () => true,
        expose: ['web'],
        run: () => ({}),
      })
      expect(() => handlers({ webScalar })).not.toThrow()
    })

    test('a registered object input is accepted and advertised as its object schema', async () => {
      const registered = procedure({
        description: 'Take an input registered under an id',
        input: z.object({ postId: z.string() }).meta({ id: 'RegisteredPublishInput' }),
        output: z.object({}),
        access: () => true,
        expose: ['mcp'],
        scopes: [],
        run: () => ({}),
      })
      const { body } = await rpc('tools/list', undefined, { procedures: { registered } })
      const tools = toolList.parse(z.object({ tools: z.unknown() }).parse(body.result).tools)
      const schema = tools.find((tool) => tool.name === 'registered')?.inputSchema
      expect(schema).toMatchObject({
        type: 'object',
        properties: { postId: { type: 'string' } },
        required: ['postId'],
      })
      expect(schema).not.toHaveProperty('$ref')
    })

    test.each([
      [
        'a registered root with a registered child',
        z.object({ author: RegisteredAuthor }).meta({ id: 'McpToolRegisteredRoot' }),
      ],
      ['a recursive registered root', TreeNode],
      ['a registered recursive child', z.object({ tree: TreeNode })],
    ])('every $ref in the advertised schema of %s resolves within it', async (_label, input) => {
      const registered = procedure({
        description: 'Take an input with registered parts',
        input,
        output: z.object({}),
        access: () => true,
        expose: ['mcp'],
        scopes: [],
        run: () => ({}),
      })
      const { body } = await rpc('tools/list', undefined, { procedures: { registered } })
      const tools = toolList.parse(z.object({ tools: z.unknown() }).parse(body.result).tools)
      const schema = tools.find((tool) => tool.name === 'registered')?.inputSchema
      expect(schema).toMatchObject({ type: 'object' })
      expect(JSON.stringify(schema)).toContain('$ref')
      expect(unresolvedRefs(schema ?? {})).toEqual([])
    })

    test.each([
      ['a union', z.union([z.object({ a: z.string() }), z.object({ b: z.string() })])],
      [
        'a union',
        z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('a') }),
          z.object({ kind: z.literal('b') }),
        ]),
      ],
      ['a union', z.object({ a: z.string() }).nullable()],
      ['a JSON string', z.string()],
    ])('an MCP-exposed input whose top level is %s is refused', (described, input) => {
      const topLevel = procedure({
        description: 'Take an input that is not one object',
        input,
        output: z.object({}),
        access: () => true,
        expose: ['mcp'],
        run: () => ({}),
      })
      expect(() => handlers({ topLevel })).toThrow(`input schema's top level is ${described}`)
      expect(() => handlers({ topLevel })).not.toThrow('declare the input as')
    })

    test('an unrepresentable schema is refused', () => {
      const dated = procedure({
        description: 'Return a date',
        input: z.object({}),
        output: z.object({ at: z.date() }),
        access: () => true,
        expose: ['mcp'],
        run: () => ({ at: new Date() }),
      })
      expect(() => handlers({ dated })).toThrow(ProcedureHostError)
    })
  })
})
