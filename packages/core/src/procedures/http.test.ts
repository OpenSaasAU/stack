import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import * as z from 'zod'
import type { AccessControlledDB, Session } from '../access/types.js'
import type { OpenSaasConfig } from '../config/types.js'
import { EngineContextUnavailableError, engineContextOf } from '../context/engine-context.js'
import { relationship, text } from '../fields/index.js'
import { ValidationError } from '../hooks/index.js'
import { classifyDriverError, DatabaseError } from '../lib/database-errors.js'
import { MalformedRelationInputError } from '../context/relationship-input.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import type { StackContext } from '../types/context.js'
import { createProcedureHandler, ProcedureHostError } from './http.js'
import {
  createProcedureBuilder,
  ProcedureDefinitionError,
  type ProcedureContext,
  type ProcedureRegistry,
} from './procedure.js'

const BOOT = 120_000
const ORIGIN = 'http://app.test'

type Ctx = StackContext<AccessControlledDB>

const owned = ({ session }: { session: Session | null }) =>
  session === null ? false : { authorId: { equals: String(session.userId) } }

const open = { query: () => true, create: () => true, update: () => true, delete: () => true }

function schemaConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Post: {
        fields: {
          title: text({ validation: { isRequired: true } }),
          authorId: text(),
          secret: text(),
          slug: text({ isIndexed: 'unique' }),
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
      Note: {
        fields: { body: text(), post: relationship({ ref: 'Post' }) },
        access: { operation: open },
      },
      Strict: {
        fields: { label: text(), code: text({ db: { isNullable: false } }) },
        access: { operation: open },
      },
    },
  }
}

const procedure = createProcedureBuilder<Ctx>()

const postOutput = z.object({ id: z.string(), title: z.string() })

function rowOf(value: unknown): { id: string; title: string; secret?: unknown } {
  return postOutput.extend({ secret: z.unknown() }).parse(value)
}

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

async function bodyOf(response: Response): Promise<z.infer<typeof envelope>> {
  return envelope.parse(await response.json())
}

let seenContext: ProcedureContext<Ctx> | undefined
let seenAccessArgs: string[] = []

const createPost = procedure({
  description: 'Create a post authored by the caller',
  input: z.object({ title: z.string().min(1) }),
  output: postOutput,
  access: (args) => {
    seenAccessArgs = Object.keys(args)
    return args.session !== null
  },
  expose: ['web'],
  run: async ({ input, context }) => {
    seenContext = context
    const authorId = context.session === null ? '' : String(context.session.userId)
    const row = await context.db.Post.create({
      data: { title: input.title, authorId, secret: 'hidden' },
    })
    if (row === null) throw new Error('create denied')
    return rowOf(row)
  },
})

const ping = procedure({
  description: 'Answer anyone, signed in or not',
  input: z.object({}),
  output: z.object({ signedIn: z.boolean() }),
  access: () => true,
  expose: ['web'],
  run: ({ context }) => ({ signedIn: context.session !== null }),
})

const renamePost = procedure({
  description: 'Rename a post by id',
  input: z.object({ id: z.string(), title: z.string() }),
  output: z.object({ renamed: z.boolean() }),
  access: ({ session }) => session !== null,
  expose: ['web'],
  run: async ({ input, context }) => {
    const row = await context.db.Post.update({
      where: { id: input.id },
      data: { title: input.title },
    })
    return { renamed: row !== null }
  },
})

const agentOnly = procedure({
  description: 'Reachable by agents only',
  input: z.object({}),
  output: z.object({}),
  access: () => true,
  expose: ['mcp'],
  run: () => ({}),
})

const explode = procedure({
  description: 'Fail with an internal detail',
  input: z.object({}),
  output: z.object({}),
  access: () => true,
  expose: ['web'],
  run: () => {
    throw new Error('connection string postgres://admin:hunter2@db')
  },
})

const misreport = procedure({
  description: 'Return output its schema rejects',
  input: z.object({}),
  output: z.object({ count: z.number() }),
  access: () => true,
  expose: ['web'],
  run: () => ({ count: Number.NaN }),
})

const validateExplicitly = procedure({
  description: 'Throw a validation error',
  input: z.object({}),
  output: z.object({}),
  access: () => true,
  expose: ['web'],
  run: () => {
    throw new ValidationError(['Name is taken'], { name: 'Name is taken' })
  },
})

const claimSlug = procedure({
  description: 'Create a post under a unique slug',
  input: z.object({ slug: z.string() }),
  output: postOutput,
  access: ({ session }) => session !== null,
  expose: ['web'],
  run: async ({ input, context }) => {
    const authorId = context.session === null ? '' : String(context.session.userId)
    const row = await context.db.Post.create({
      data: { title: 'Claimed', authorId, slug: input.slug },
    })
    if (row === null) throw new Error('create denied')
    return rowOf(row)
  },
})

const oddlyNamed = procedure({
  description: 'Take fields named after Object.prototype members',
  input: z.object({ constructor: z.string(), toString: z.string(), valueOf: z.string() }),
  output: z.object({}),
  access: () => true,
  expose: ['web'],
  run: () => ({}),
})

const asyncSchemas = procedure({
  description: 'Check input and output with async refinements',
  input: z.object({
    title: z.string().refine(async (title) => title !== 'taken', 'Title is taken'),
  }),
  output: z.object({
    title: z.string().refine(async (title) => title.length > 0),
  }),
  access: () => true,
  expose: ['web'],
  run: ({ input }) => ({ title: input.title }),
})

const omitRequiredColumn = procedure({
  description: 'Write a value the database refuses',
  input: z.object({}),
  output: z.object({}),
  access: () => true,
  expose: ['web'],
  run: async ({ context }) => {
    await context.db.Strict.create({ data: { label: 'no code' } })
    return {}
  },
})

const loseRace = procedure({
  description: 'Lose a race the database rolled back',
  input: z.object({}),
  output: z.object({}),
  access: () => true,
  expose: ['web'],
  run: () => {
    const driverError = Object.assign(new Error('could not serialize access'), {
      kind: 'sql_query',
      sqlState: '40001',
    })
    throw classifyDriverError(driverError) ?? driverError
  },
})

const linkBadly = procedure({
  description: 'Write a relation payload the engine refuses',
  input: z.object({}),
  output: z.object({}),
  access: () => true,
  expose: ['web'],
  run: async ({ context }) => {
    await context.db.Note.create({ data: { body: 'note', post: {} } })
    return {}
  },
})

const noInput = procedure({
  description: 'Take no input at all',
  input: z.undefined(),
  output: z.object({ ran: z.boolean() }),
  access: () => true,
  expose: ['web'],
  run: () => ({ ran: true }),
})

const registry: ProcedureRegistry<Ctx> = {
  omitRequiredColumn,
  loseRace,
  linkBadly,
  noInput,
  claimSlug,
  oddlyNamed,
  asyncSchemas,
  createPost,
  ping,
  renamePost,
  agentOnly,
  explode,
  misreport,
  validateExplicitly,
}

describe('createProcedureHandler', () => {
  let database: TestDatabase
  const getSession = vi.fn(async (request: Request): Promise<Session | null> => {
    const cookie = request.headers.get('cookie') ?? ''
    const match = /session=([a-z]+)/.exec(cookie)
    return match === null ? null : { userId: match[1] }
  })
  const onUnexpectedError = vi.fn()

  function handler(procedures: ProcedureRegistry<Ctx> = registry) {
    return createProcedureHandler<Ctx>({
      procedures,
      getContext: async (session) => database.context(session),
      getSession,
      allowedOrigins: [ORIGIN],
      maxBodyBytes: 512,
      onUnexpectedError,
    })
  }

  function call(
    name: string,
    body: unknown,
    init: { cookie?: string; origin?: string | null; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (init.cookie !== undefined) headers.cookie = init.cookie
    const origin = init.origin === undefined ? ORIGIN : init.origin
    if (origin !== null) headers.origin = origin
    return handler()(
      new Request(`${ORIGIN}/api/procedures/${name}`, {
        method: 'POST',
        headers: { ...headers, ...init.headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    )
  }

  async function titles(): Promise<string[]> {
    const rows = await database.context().sudo().db.Post.all()
    return rows.map((row) => String(row.title)).sort()
  }

  beforeAll(async () => {
    database = await createTestDatabase(schemaConfig())
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(async () => {
    await database.truncate()
    getSession.mockClear()
    onUnexpectedError.mockClear()
    seenContext = undefined
    seenAccessArgs = []
  })

  test('a signed-in caller runs a procedure and gets its typed result', async () => {
    const response = await call('createPost', { title: 'Hello' }, { cookie: 'session=ada' })
    expect(response.status).toBe(200)
    const body = await bodyOf(response)
    expect(body).toEqual({ success: true, data: { id: expect.any(String), title: 'Hello' } })
    const rows = await database.context().sudo().db.Post.all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ title: 'Hello', authorId: 'ada' })
  })

  test('undeclared output keys are removed', async () => {
    const response = await call('createPost', { title: 'Hello' }, { cookie: 'session=ada' })
    const body = await bodyOf(response)
    expect(Object.keys(body.data ?? {}).sort()).toEqual(['id', 'title'])
    expect(JSON.stringify(body)).not.toContain('hidden')
  })

  test('a request without a credential is anonymous and the access rule decides', async () => {
    const allowed = await call('ping', {})
    expect(allowed.status).toBe(200)
    expect(await bodyOf(allowed)).toEqual({ success: true, data: { signedIn: false } })

    const refused = await call('createPost', { title: 'Hello' })
    expect(refused.status).toBe(401)
    expect(await bodyOf(refused)).toEqual({
      success: false,
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    })
    expect(getSession).not.toHaveBeenCalled()
    expect(await titles()).toEqual([])
  })

  test('nothing in the body can supply a session', async () => {
    const response = await call('createPost', {
      title: 'Hello',
      session: { userId: 'ada' },
      userId: 'ada',
    })
    expect(response.status).toBe(401)
    expect(await titles()).toEqual([])

    const signedIn = await call(
      'createPost',
      { title: 'Mine', session: { userId: 'bob' } },
      { cookie: 'session=ada' },
    )
    expect(signedIn.status).toBe(200)
    const rows = await database.context().sudo().db.Post.all()
    expect(rows.map((row) => row.authorId)).toEqual(['ada'])
  })

  test('unknown, unexposed and inherited names are answered identically with 404', async () => {
    const inherited: ProcedureRegistry<Ctx> = Object.create({ inheritedPing: ping })
    const viaInheritance = await createProcedureHandler<Ctx>({
      procedures: inherited,
      getContext: async (session) => database.context(session),
      getSession,
      allowedOrigins: [ORIGIN],
    })(
      new Request(`${ORIGIN}/api/procedures/inheritedPing`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    )
    const responses = [
      await call('doesNotExist', {}),
      await call('agentOnly', {}),
      await call('toString', {}),
      await call('__proto__', {}),
      await call('constructor', {}),
      viaInheritance,
    ]
    const bodies = await Promise.all(responses.map((response) => response.text()))
    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404, 404])
    expect(new Set(bodies).size).toBe(1)
  })

  test('a cookie request from another origin, or with no origin, is refused before the session is resolved', async () => {
    for (const origin of ['http://evil.test', 'http://app.test:8080', null, 'null']) {
      const response = await call(
        'createPost',
        { title: 'Forged' },
        { cookie: 'session=ada', origin },
      )
      expect(response.status).toBe(403)
      expect((await bodyOf(response)).error?.code).toBe('DENIED')
    }
    expect(getSession).not.toHaveBeenCalled()
    expect(await titles()).toEqual([])
  })

  test('a request with an Authorization header is refused with or without a cookie', async () => {
    const bare = await call('ping', {}, { headers: { authorization: 'Bearer token' } })
    const withCookie = await call(
      'createPost',
      { title: 'Mixed' },
      { cookie: 'session=ada', headers: { authorization: 'Bearer token' } },
    )
    for (const response of [bare, withCookie]) {
      expect(response.status).toBe(401)
      expect((await bodyOf(response)).error?.code).toBe('UNAUTHENTICATED')
    }
    expect(getSession).not.toHaveBeenCalled()
    expect(await titles()).toEqual([])
  })

  test('access runs before input parsing and does not receive the input', async () => {
    const response = await call('createPost', { title: 42 })
    expect(response.status).toBe(401)
    expect(seenAccessArgs.sort()).toEqual(['context', 'session'])
  })

  test('input that fails its schema is INVALID_INPUT with field errors', async () => {
    const response = await call('createPost', { title: '' }, { cookie: 'session=ada' })
    expect(response.status).toBe(400)
    const body = await bodyOf(response)
    expect(body.error?.code).toBe('INVALID_INPUT')
    expect(Object.keys(body.error?.fieldErrors ?? {})).toEqual(['title'])

    const malformed = await call('createPost', '{not json', { cookie: 'session=ada' })
    expect(malformed.status).toBe(400)
    expect((await bodyOf(malformed)).error?.code).toBe('INVALID_INPUT')
    expect(await titles()).toEqual([])
  })

  test('a validation failure is VALIDATION with its field errors', async () => {
    const hook = await call('createPost', { title: 'spam' }, { cookie: 'session=ada' })
    expect(hook.status).toBe(400)
    expect((await bodyOf(hook)).error?.code).toBe('VALIDATION')

    const thrown = await call('validateExplicitly', {})
    expect(thrown.status).toBe(400)
    expect((await bodyOf(thrown)).error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { name: 'Name is taken' },
    })
    expect(await titles()).toEqual([])
  })

  test('an unexpected error is INTERNAL, its message reaches no client, and it is logged with the name', async () => {
    const response = await call('explode', {})
    expect(response.status).toBe(500)
    const text = await response.text()
    expect(text).not.toContain('hunter2')
    expect(JSON.parse(text)).toEqual({
      success: false,
      error: { code: 'INTERNAL', message: 'Internal error' },
    })
    expect(onUnexpectedError).toHaveBeenCalledOnce()
    const [error, name] = onUnexpectedError.mock.calls[0]
    expect(name).toBe('explode')
    expect(String(error)).toContain('hunter2')
  })

  test('a unique violation is CONFLICT and names the field that collided', async () => {
    const first = await call('claimSlug', { slug: 'hello' }, { cookie: 'session=ada' })
    expect(first.status).toBe(200)

    const second = await call('claimSlug', { slug: 'hello' }, { cookie: 'session=bob' })
    expect(second.status).toBe(409)
    const body = await bodyOf(second)
    expect(body.error?.code).toBe('CONFLICT')
    expect(Object.keys(body.error?.fieldErrors ?? {})).toEqual(['slug'])
    expect(await titles()).toEqual(['Claimed'])
  })

  describe('what getSession resolves decides the identity, and only an object is a session', () => {
    function lax(resolved: unknown) {
      const resolveSession = vi.fn()
      resolveSession.mockResolvedValue(resolved)
      const serve = createProcedureHandler<Ctx>({
        procedures: registry,
        getContext: async (session) => database.context(session),
        getSession: resolveSession,
        allowedOrigins: [ORIGIN],
        onUnexpectedError,
      })
      return (name: string, body: unknown) =>
        serve(
          new Request(`${ORIGIN}/api/procedures/${name}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie: 'session=ada', origin: ORIGIN },
            body: JSON.stringify(body),
          }),
        )
    }

    test.each([
      ['undefined', undefined],
      ['null', null],
    ])('%s is anonymous to the access rule as well as to run', async (_label, resolved) => {
      const post = lax(resolved)

      const refused = await post('createPost', { title: 'Hello' })
      expect(refused.status).toBe(401)
      expect((await bodyOf(refused)).error?.code).toBe('UNAUTHENTICATED')
      expect(seenAccessArgs.sort()).toEqual(['context', 'session'])
      expect(await titles()).toEqual([])
      expect(onUnexpectedError).not.toHaveBeenCalled()

      const open = await post('ping', {})
      expect(await bodyOf(open)).toEqual({ success: true, data: { signedIn: false } })
    })

    test.each([
      ['false', false, 'boolean'],
      ['0', 0, 'number'],
      ['an empty string', '', 'string'],
      ['a string', 'user-ada-secret', 'string'],
    ])('%s fails closed as INTERNAL and is reported', async (_label, resolved, type) => {
      const response = await lax(resolved)('createPost', { title: 'Hello' })

      expect(response.status).toBe(500)
      expect(await bodyOf(response)).toEqual({
        success: false,
        error: { code: 'INTERNAL', message: 'Internal error' },
      })
      expect(seenAccessArgs).toEqual([])
      expect(seenContext).toBeUndefined()
      expect(await titles()).toEqual([])
      expect(onUnexpectedError).toHaveBeenCalledOnce()
      const [error, name] = onUnexpectedError.mock.calls[0]
      expect(name).toBe('createPost')
      expect(String(error)).toContain(`getSession resolved a ${type}`)
      expect(String(error)).not.toContain('user-ada-secret')
    })
  })

  test('a trailing slash on the path reaches the same procedure and discloses no other name', async () => {
    const post = (path: string) =>
      handler()(
        new Request(`${ORIGIN}/api/procedures/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        }),
      )
    const slashed = await post('ping/')
    expect(slashed.status).toBe(200)
    expect(await bodyOf(slashed)).toEqual({ success: true, data: { signedIn: false } })

    const responses = [
      await post('doesNotExist'),
      await post('doesNotExist/'),
      await post('agentOnly/'),
      await post('ping//'),
      await post(''),
    ]
    const bodies = await Promise.all(responses.map((response) => response.text()))
    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404])
    expect(new Set(bodies).size).toBe(1)
  })

  test('a database failure that is not a unique violation is CONFLICT and reported with the name', async () => {
    const response = await call('omitRequiredColumn', {})
    expect(response.status).toBe(409)
    expect(await bodyOf(response)).toEqual({
      success: false,
      error: { code: 'CONFLICT', message: 'The database refused this operation' },
    })
    expect(onUnexpectedError).toHaveBeenCalledOnce()
    const [error, name] = onUnexpectedError.mock.calls[0]
    expect(name).toBe('omitRequiredColumn')
    expect(error).toBeInstanceOf(DatabaseError)
    expect(error instanceof Error ? error.cause : undefined).toBeDefined()
  })

  test('a serialization failure is RETRY and is not reported', async () => {
    const response = await call('loseRace', {})
    expect(response.status).toBe(409)
    expect(await bodyOf(response)).toEqual({
      success: false,
      error: {
        code: 'RETRY',
        message: 'The operation conflicted with a concurrent change and was rolled back',
      },
    })
    expect(onUnexpectedError).not.toHaveBeenCalled()
  })

  test('a unique violation is not reported as unexpected', async () => {
    await call('claimSlug', { slug: 'hello' }, { cookie: 'session=ada' })
    const second = await call('claimSlug', { slug: 'hello' }, { cookie: 'session=bob' })
    expect(second.status).toBe(409)
    expect(onUnexpectedError).not.toHaveBeenCalled()
  })

  test("an engine refusal of the procedure's own payload is INVALID_INPUT and reported with the name", async () => {
    const response = await call('linkBadly', {})
    expect(response.status).toBe(400)
    expect((await bodyOf(response)).error?.code).toBe('INVALID_INPUT')
    expect(onUnexpectedError).toHaveBeenCalledOnce()
    const [error, name] = onUnexpectedError.mock.calls[0]
    expect(name).toBe('linkBadly')
    expect(error).toBeInstanceOf(MalformedRelationInputError)

    onUnexpectedError.mockClear()
    const schemaFailure = await call('createPost', { title: '' }, { cookie: 'session=ada' })
    expect(schemaFailure.status).toBe(400)
    expect(onUnexpectedError).not.toHaveBeenCalled()
  })

  test('a reporter that throws falls back to console.error and the caller still gets INTERNAL', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const fragile = createProcedureHandler<Ctx>({
        procedures: registry,
        getContext: async (session) => database.context(session),
        getSession: async () => {
          throw new Error('session store down')
        },
        allowedOrigins: [ORIGIN],
        onUnexpectedError: () => {
          throw new Error('logger down')
        },
      })
      const post = (name: string, headers: Record<string, string> = {}) =>
        fragile(
          new Request(`${ORIGIN}/api/procedures/${name}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body: '{}',
          }),
        )
      const internal = { success: false, error: { code: 'INTERNAL', message: 'Internal error' } }

      const fromRun = await post('explode')
      expect(fromRun.status).toBe(500)
      expect(await bodyOf(fromRun)).toEqual(internal)

      const fromSession = await post('ping', { cookie: 'session=ada', origin: ORIGIN })
      expect(fromSession.status).toBe(500)
      expect(await bodyOf(fromSession)).toEqual(internal)

      const logged = consoleError.mock.calls.map((args) => args.map(String).join(' '))
      expect(logged.some((line) => line.includes('logger down') && line.includes('hunter2'))).toBe(
        true,
      )
      expect(logged.some((line) => line.includes('session store down'))).toBe(true)
    } finally {
      consoleError.mockRestore()
    }
  })

  test('an async reporter that rejects falls back to console.error with no unhandled rejection', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const fragile = createProcedureHandler<Ctx>({
        procedures: registry,
        getContext: async (session) => database.context(session),
        getSession,
        allowedOrigins: [ORIGIN],
        onUnexpectedError: async () => {
          throw new Error('async logger down')
        },
      })
      const response = await fragile(
        new Request(`${ORIGIN}/api/procedures/explode`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        }),
      )
      expect(response.status).toBe(500)
      expect(await bodyOf(response)).toEqual({
        success: false,
        error: { code: 'INTERNAL', message: 'Internal error' },
      })

      await new Promise((resolve) => setImmediate(resolve))
      expect(unhandled).not.toHaveBeenCalled()
      const logged = consoleError.mock.calls.map((args) => args.map(String).join(' '))
      expect(
        logged.some((line) => line.includes('async logger down') && line.includes('hunter2')),
      ).toBe(true)
    } finally {
      process.off('unhandledRejection', unhandled)
      consoleError.mockRestore()
    }
  })

  test('an empty body is undefined input and the input schema decides', async () => {
    const post = (name: string, body?: string) =>
      handler()(
        new Request(`${ORIGIN}/api/procedures/${name}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body }),
        }),
      )
    const none = await post('noInput')
    expect(none.status).toBe(200)
    expect(await bodyOf(none)).toEqual({ success: true, data: { ran: true } })
    expect((await post('noInput', '')).status).toBe(200)

    const required = await post('ping')
    expect(required.status).toBe(400)
    const body = await bodyOf(required)
    expect(body.error?.code).toBe('INVALID_INPUT')
    expect(Object.keys(body.error?.fieldErrors ?? {})).toEqual(['(root)'])

    const malformed = await post('ping', '{not json')
    expect(malformed.status).toBe(400)
    expect(await bodyOf(malformed)).toEqual({
      success: false,
      error: { code: 'INVALID_INPUT', message: 'Invalid input' },
    })
  })

  test('a field named after an Object.prototype member keeps its error', async () => {
    const response = await call('oddlyNamed', { constructor: 1, toString: 2, valueOf: 3 })
    expect(response.status).toBe(400)
    const body = await bodyOf(response)
    expect(body.error?.code).toBe('INVALID_INPUT')
    expect(Object.keys(body.error?.fieldErrors ?? {}).sort()).toEqual([
      'constructor',
      'toString',
      'valueOf',
    ])
  })

  test('input and output schemas with async refinements are awaited', async () => {
    const admitted = await call('asyncSchemas', { title: 'free' })
    expect(admitted.status).toBe(200)
    expect(await bodyOf(admitted)).toEqual({ success: true, data: { title: 'free' } })

    const refused = await call('asyncSchemas', { title: 'taken' })
    expect(refused.status).toBe(400)
    expect((await bodyOf(refused)).error).toEqual({
      code: 'INVALID_INPUT',
      message: 'Invalid input',
      fieldErrors: { title: 'Title is taken' },
    })
    expect(onUnexpectedError).not.toHaveBeenCalled()
  })

  test('a body stream that errors is INTERNAL and reported with the name', async () => {
    const response = await handler()(
      new Request(`${ORIGIN}/api/procedures/ping`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.error(new Error('client went away'))
          },
        }),
        duplex: 'half',
      }),
    )
    expect(response.status).toBe(500)
    const text = await response.text()
    expect(text).not.toContain('client went away')
    expect(JSON.parse(text)).toEqual({
      success: false,
      error: { code: 'INTERNAL', message: 'Internal error' },
    })
    expect(onUnexpectedError).toHaveBeenCalledOnce()
    const [error, name] = onUnexpectedError.mock.calls[0]
    expect(name).toBe('ping')
    expect(String(error)).toContain('client went away')
  })

  test('a refused call never consumes the body', async () => {
    const request = new Request(`${ORIGIN}/api/procedures/createPost`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x'.repeat(2048) }),
    })
    const response = await handler()(request)
    expect(response.status).toBe(401)
    expect(request.bodyUsed).toBe(false)
    expect(await titles()).toEqual([])
  })

  test('a Content-Length that understates the body does not get it past the limit', async () => {
    const understated = { 'content-length': '2' }
    const admitted = await call('ping', { padding: 'x'.repeat(2048) }, { headers: understated })
    expect(admitted.status).toBe(413)
    expect(await admitted.json()).toEqual({ error: 'Request body too large' })

    const refused = await call('createPost', { title: 'x'.repeat(2048) }, { headers: understated })
    expect(refused.status).toBe(401)
    expect(await titles()).toEqual([])
  })

  test('output that fails its own schema is INTERNAL', async () => {
    const response = await call('misreport', {})
    expect(response.status).toBe(500)
    expect((await bodyOf(response)).error?.code).toBe('INTERNAL')
    expect(onUnexpectedError.mock.calls[0]?.[1]).toBe('misreport')
  })

  test('list access still denies a row the procedure admitted', async () => {
    const created = await call('createPost', { title: 'Ada' }, { cookie: 'session=ada' })
    const { data } = await bodyOf(created)

    const response = await call(
      'renamePost',
      { id: data?.id, title: 'Taken over' },
      { cookie: 'session=bob' },
    )
    expect(response.status).toBe(200)
    expect(await bodyOf(response)).toEqual({ success: true, data: { renamed: false } })
    expect(await titles()).toEqual(['Ada'])
  })

  test('the context carries the secured surface, session, storage and plugins only', async () => {
    await call('createPost', { title: 'Hello' }, { cookie: 'session=ada' })
    const context = seenContext
    expect(context).toBeDefined()
    if (context === undefined) return
    expect(Object.keys(context).sort()).toEqual(['db', 'plugins', 'session', 'storage'])
    for (const member of ['sudo', 'unsafe', 'withSession', 'serverAction', 'transaction']) {
      expect(member in context).toBe(false)
      expect(Reflect.get(context, member)).toBeUndefined()
    }
    expect(Object.getOwnPropertySymbols(context)).toEqual([])
    expect(() => Reflect.apply(engineContextOf, undefined, [context])).toThrow(
      EngineContextUnavailableError,
    )
    expect(Object.isFrozen(context)).toBe(true)
  })

  test('transport: POST only, JSON only, and a body-size limit', async () => {
    const get = await handler()(new Request(`${ORIGIN}/api/procedures/ping`, { method: 'GET' }))
    expect(get.status).toBe(405)
    expect(get.headers.get('allow')).toBe('POST')

    const form = await call('ping', 'a=1', {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
    expect(form.status).toBe(415)
    const plain = await call('ping', '{}', { headers: { 'content-type': 'text/plain' } })
    expect(plain.status).toBe(415)

    const declared = await call('ping', '{}', { headers: { 'content-length': '4096' } })
    expect(declared.status).toBe(413)

    const streamed = await call(
      'createPost',
      { title: 'x'.repeat(2048) },
      { cookie: 'session=ada' },
    )
    expect(streamed.status).toBe(413)
    expect(await titles()).toEqual([])

    const nested = await call('ping/extra', {})
    expect(nested.status).toBe(404)
  })

  test('a registry the host cannot serve is refused when the host is created', () => {
    const create = (procedures: ProcedureRegistry<Ctx>, allowedOrigins: string[] = [ORIGIN]) =>
      createProcedureHandler<Ctx>({
        procedures,
        getContext: async (session) => database.context(session),
        getSession,
        allowedOrigins,
      })
    expect(() => create({ 'bad name': ping })).toThrow(ProcedureHostError)
    expect(() => create({ ping }, ['*'])).toThrow(ProcedureHostError)
    const forged = { ...ping }
    expect(() => create({ forged })).toThrow(ProcedureHostError)
  })

  test('a procedure missing a required member is refused when it is defined', () => {
    const complete = {
      description: 'A procedure',
      input: z.object({}),
      output: z.object({}),
      access: () => true,
      expose: ['web'] as const,
      run: () => ({}),
    }
    expect(() => procedure(complete)).not.toThrow()
    expect(() => procedure({ ...complete, description: ' ' })).toThrow(ProcedureDefinitionError)
    expect(() => Reflect.apply(procedure, undefined, [{ ...complete, expose: [] }])).toThrow(
      ProcedureDefinitionError,
    )
    expect(() =>
      Reflect.apply(procedure, undefined, [{ ...complete, expose: ['web', 'web'] }]),
    ).toThrow(ProcedureDefinitionError)
    for (const member of ['input', 'output', 'access', 'run', 'description', 'expose']) {
      const incomplete = Object.fromEntries(
        Object.entries(complete).filter(([key]) => key !== member),
      )
      expect(() => Reflect.apply(procedure, undefined, [incomplete])).toThrow(
        ProcedureDefinitionError,
      )
    }
  })
})
