import { AsyncLocalStorage } from 'node:async_hooks'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import * as z from 'zod'
import type { Actor } from '../access/actor.js'
import type { AccessControlledDB, Session } from '../access/types.js'
import type { OpenSaasConfig } from '../config/types.js'
import { InvalidSessionError } from '../context/index.js'
import { text } from '../fields/index.js'
import { ValidationError } from '../hooks/index.js'
import { classifyDriverError } from '../lib/database-errors.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import type { StackContext } from '../types/context.js'
import { createProcedureHandler } from './http.js'
import { createProcedureBuilder, type ProcedureRegistry } from './procedure.js'
import { createServerCaller } from './server.js'
import { ProcedureHostError } from './validate.js'

const BOOT = 120_000
const ORIGIN = 'http://app.test'

type Ctx = StackContext<AccessControlledDB>

const owned = ({ session }: { session: Session | null }) =>
  session === null ? false : { authorId: { equals: String(session.userId) } }

function schemaConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    isFrameworkControlFlow: (thrown) => thrown instanceof Response,
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
        mcp: {
          customTools: [
            {
              name: 'publishPost',
              description: 'Publish a post',
              inputSchema: z.object({ id: z.string() }),
              handler: async () => ({}),
            },
          ],
        },
      },
    },
  }
}

class ControlFlow extends Error {
  readonly digest: string
  constructor(digest: string) {
    super(digest)
    this.digest = digest
  }
}

const redirectToSignIn = (): ControlFlow => new ControlFlow('NEXT_REDIRECT;replace;/sign-in;307;')

const procedure = createProcedureBuilder<Ctx>()

const postOutput = z.object({ id: z.string(), title: z.string() })

function rowOf(value: unknown): { id: string; title: string } {
  return postOutput.extend({ secret: z.unknown() }).parse(value)
}

function authorOf(context: { session: Session | null }): string {
  return context.session === null ? '' : String(context.session.userId)
}

let seenActors: Array<{ where: string; actor: Actor | undefined }> = []

const createPost = procedure({
  description: 'Create a post authored by the caller',
  input: z.object({ title: z.string().min(1) }),
  output: postOutput,
  access: ({ session }) => {
    seenActors.push({ where: 'access', actor: session?.actor })
    return session !== null
  },
  expose: ['web'],
  run: async ({ input, context }) => {
    seenActors.push({ where: 'run', actor: context.session?.actor })
    const row = await context.transaction(async (tx) => {
      seenActors.push({ where: 'transaction', actor: tx.session?.actor })
      return tx.db.Post.create({
        data: { title: input.title, authorId: authorOf(context), secret: 'hidden' },
      })
    })
    if (row === null) throw new Error('create denied')
    return rowOf(row)
  },
})

const whoAmI = procedure({
  description: 'Say who is calling',
  input: z.object({}).optional(),
  output: z.object({ userId: z.string().nullable(), actorKind: z.string().nullable() }),
  access: () => true,
  expose: ['web'],
  run: async ({ context }) => {
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 10))
    return {
      userId: context.session === null ? null : String(context.session.userId),
      actorKind: context.session?.actor?.kind ?? null,
    }
  },
})

const adminsOnly = procedure({
  description: 'Refuse everyone who is not an admin',
  input: z.object({}),
  output: z.object({}),
  access: ({ session }) => session?.role === 'admin',
  expose: ['web'],
  run: () => ({}),
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

const claimSlug = procedure({
  description: 'Create a post under a unique slug',
  input: z.object({ slug: z.string() }),
  output: postOutput,
  access: ({ session }) => session !== null,
  expose: ['web'],
  run: async ({ input, context }) => {
    const row = await context.db.Post.create({
      data: { title: 'Claimed', authorId: authorOf(context), slug: input.slug },
    })
    if (row === null) throw new Error('create denied')
    return rowOf(row)
  },
})

const bookFull = procedure({
  description: 'Write, then fail with a declared failure',
  input: z.object({}),
  output: z.object({}),
  failures: { SLOT_FULL: 'The slot is full' },
  access: () => true,
  expose: ['web'],
  run: async ({ context, fail }) => {
    await context.transaction(async (tx) => {
      await tx.db.Post.create({ data: { title: 'Rolled back', authorId: authorOf(context) } })
      throw fail('SLOT_FULL')
    })
    return {}
  },
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

const redirectFromRun = procedure({
  description: 'Write, then redirect from inside the transaction',
  input: z.object({}),
  output: z.object({}),
  access: () => true,
  expose: ['web'],
  run: async ({ context }) => {
    await context.transaction(async (tx) => {
      await tx.db.Post.create({ data: { title: 'Redirected', authorId: authorOf(context) } })
      throw redirectToSignIn()
    })
    return {}
  },
})

const redirectFromAccess = procedure({
  description: 'Redirect an anonymous caller to sign in',
  input: z.object({}),
  output: z.object({}),
  access: ({ session }) => {
    if (session === null) throw redirectToSignIn()
    return true
  },
  expose: ['web'],
  run: () => ({}),
})

const wrappedRedirect = procedure({
  description: 'Throw an error caused by a redirect',
  input: z.object({}),
  output: z.object({}),
  access: () => true,
  expose: ['web'],
  run: () => {
    throw new Error('wrapped', { cause: redirectToSignIn() })
  },
})

const customControlFlow = procedure({
  description: 'Throw what only the config recognises as control flow',
  input: z.object({}),
  output: z.object({}),
  access: () => true,
  expose: ['web'],
  run: () => {
    throw new Response(null, { status: 303 })
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

const registry = {
  createPost,
  whoAmI,
  adminsOnly,
  renamePost,
  claimSlug,
  bookFull,
  explode,
  misreport,
  validateExplicitly,
  loseRace,
  redirectFromRun,
  redirectFromAccess,
  wrappedRedirect,
  customControlFlow,
  agentOnly,
} satisfies ProcedureRegistry<Ctx>

const requestSession = new AsyncLocalStorage<Session | null>()

function asRequest<T>(session: Session | null, fn: () => Promise<T>): Promise<T> {
  return requestSession.run(session, fn)
}

const envelope = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      fieldErrors: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
})

describe('createServerCaller', () => {
  let database: TestDatabase
  const onUnexpectedError = vi.fn()
  const getSession = vi.fn(async (): Promise<Session | null | undefined> => {
    return requestSession.getStore() ?? null
  })

  function server(
    options: {
      config?: OpenSaasConfig
      getSession?: () => Promise<Session | null | undefined>
    } = {},
  ) {
    return createServerCaller({
      procedures: registry,
      getContext: async (session) => database.context(session),
      getSession,
      onUnexpectedError,
      ...options,
    })
  }

  async function overHttp(
    name: string,
    input: unknown,
    userId: string | null,
    resolver?: () => Promise<Session | null>,
  ) {
    const handler = createProcedureHandler<Ctx>({
      procedures: registry,
      getContext: async (session) => database.context(session),
      getSession: async (request) => {
        if (resolver !== undefined) return resolver()
        const match = /session=([a-z]+)/.exec(request.headers.get('cookie') ?? '')
        return match === null ? null : { userId: match[1] }
      },
      allowedOrigins: [ORIGIN],
      onUnexpectedError,
    })
    const headers: Record<string, string> = { 'content-type': 'application/json', origin: ORIGIN }
    if (userId !== null) headers.cookie = `session=${userId}`
    const response = await handler(
      new Request(`${ORIGIN}/api/procedures/${name}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
      }),
    )
    return { status: response.status, body: envelope.parse(await response.json()) }
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
    seenActors = []
  })

  describe('parity with the HTTP host', () => {
    type Caller = ReturnType<typeof server>
    const cases: Array<{
      label: string
      name: keyof typeof registry
      input: object
      signedIn: string
      anonymous: string
      call: (caller: Caller) => Promise<unknown>
    }> = [
      {
        label: 'a successful call with its output stripped',
        signedIn: 'SUCCESS',
        anonymous: 'UNAUTHENTICATED',
        name: 'createPost',
        input: { title: 'Hello' },
        call: (caller) => caller.call('createPost', { title: 'Hello' }),
      },
      {
        label: 'input its schema refuses',
        signedIn: 'INVALID_INPUT',
        anonymous: 'UNAUTHENTICATED',
        name: 'createPost',
        input: { title: '' },
        call: (caller) => caller.call('createPost', { title: '' }),
      },
      {
        label: 'a declared failure after a write',
        signedIn: 'SLOT_FULL',
        anonymous: 'SLOT_FULL',
        name: 'bookFull',
        input: {},
        call: (caller) => caller.call('bookFull', {}),
      },
      {
        label: 'a validation error',
        signedIn: 'VALIDATION',
        anonymous: 'VALIDATION',
        name: 'validateExplicitly',
        input: {},
        call: (caller) => caller.call('validateExplicitly', {}),
      },
      {
        label: 'a lost race',
        signedIn: 'RETRY',
        anonymous: 'RETRY',
        name: 'loseRace',
        input: {},
        call: (caller) => caller.call('loseRace', {}),
      },
      {
        label: 'an unexpected error',
        signedIn: 'INTERNAL',
        anonymous: 'INTERNAL',
        name: 'explode',
        input: {},
        call: (caller) => caller.call('explode', {}),
      },
      {
        label: 'output its schema refuses',
        signedIn: 'INTERNAL',
        anonymous: 'INTERNAL',
        name: 'misreport',
        input: {},
        call: (caller) => caller.call('misreport', {}),
      },
    ]

    const scrub = (body: unknown): unknown =>
      JSON.parse(JSON.stringify(body).replace(/"id":"[^"]+"/g, '"id":"<id>"'))

    for (const userId of ['ada', null]) {
      for (const { label, name, input, call, signedIn, anonymous } of cases) {
        test(`${label}, ${userId === null ? 'anonymous' : 'signed in'}`, async () => {
          const http = await overHttp(name, input, userId)
          const httpRows = await titles()
          const httpReports = onUnexpectedError.mock.calls.map(([error, procedureName]) => [
            String(error),
            procedureName,
          ])
          await database.truncate()
          onUnexpectedError.mockClear()

          const session = userId === null ? null : { userId }
          const result = await asRequest(session, () => call(server()))
          const reports = onUnexpectedError.mock.calls.map(([error, procedureName]) => [
            String(error),
            procedureName,
          ])

          const parsed = envelope.parse(result)
          expect(parsed.error?.code ?? 'SUCCESS').toBe(userId === null ? anonymous : signedIn)
          expect(scrub(parsed)).toEqual(scrub(http.body))
          expect(await titles()).toEqual(httpRows)
          expect(reports).toEqual(httpReports)
        })
      }
    }

    const failingResolvers: Array<{ label: string; resolve: () => Promise<Session | null> }> = [
      {
        label: 'a ValidationError',
        resolve: async () => {
          throw new ValidationError(['Session lookup: email secret@x.test invalid'], {
            email: 'secret@x.test is invalid',
          })
        },
      },
      {
        label: 'a serialization failure',
        resolve: async () => {
          const driverError = Object.assign(new Error('could not serialize access'), {
            kind: 'sql_query',
            sqlState: '40001',
          })
          throw classifyDriverError(driverError) ?? driverError
        },
      },
      {
        label: 'a unique violation from a write it made',
        resolve: async () => {
          await database
            .context()
            .sudo()
            .db.Post.create({
              data: { title: 'Session row', authorId: 'ada', slug: 'session-row' },
            })
          return { userId: 'ada' }
        },
      },
      {
        label: 'a plain Error',
        resolve: async () => {
          throw new Error('auth backend at postgres://admin:hunter2@db is down')
        },
      },
    ]

    for (const { label, resolve } of failingResolvers) {
      test(`a resolver that throws ${label} is INTERNAL and reported on both hosts`, async () => {
        const seed = async () => {
          await database.truncate()
          await database
            .context()
            .sudo()
            .db.Post.create({
              data: { title: 'Seed', authorId: 'ada', slug: 'session-row' },
            })
          onUnexpectedError.mockClear()
          seenActors = []
        }
        await seed()
        const http = await overHttp('createPost', { title: 'Never' }, 'ada', resolve)
        const httpRows = await titles()
        const httpReports = onUnexpectedError.mock.calls.map(([error, procedureName]) => [
          String(error),
          procedureName,
        ])

        await seed()
        const result = await server({ getSession: resolve }).call('createPost', { title: 'Never' })
        const reports = onUnexpectedError.mock.calls.map(([error, procedureName]) => [
          String(error),
          procedureName,
        ])

        const internal = { success: false, error: { code: 'INTERNAL', message: 'Internal error' } }
        expect(http.status).toBe(500)
        expect(http.body).toEqual(internal)
        expect(result).toEqual(internal)
        expect(JSON.stringify(result)).not.toMatch(/secret|hunter2|unique|serializ/i)
        expect(reports).toHaveLength(1)
        expect(reports).toEqual(httpReports)
        expect(await titles()).toEqual(httpRows)
        expect(seenActors).toEqual([])
      })
    }

    test('the access rule denies a signed-in caller as it does over HTTP', async () => {
      const http = await overHttp('adminsOnly', {}, 'ada')
      const result = await asRequest({ userId: 'ada' }, () => server().call('adminsOnly', {}))
      expect(http.status).toBe(403)
      expect(result).toEqual(http.body)
      expect(result).toEqual({
        success: false,
        error: { code: 'DENIED', message: 'Access denied' },
      })
    })

    test('a unique-constraint conflict answers CONFLICT with field errors on both', async () => {
      await asRequest({ userId: 'ada' }, () => server().call('claimSlug', { slug: 'taken' }))
      const http = await overHttp('claimSlug', { slug: 'taken' }, 'ada')
      const result = await asRequest({ userId: 'ada' }, () =>
        server().call('claimSlug', { slug: 'taken' }),
      )
      expect(http.status).toBe(409)
      expect(result).toEqual(http.body)
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.code).toBe('CONFLICT')
    })

    test('list access still denies a row the procedure admitted', async () => {
      const created = await asRequest({ userId: 'ada' }, () =>
        server().call('createPost', { title: 'Ada' }),
      )
      if (!created.success) throw new Error('setup failed')
      const result = await asRequest({ userId: 'bob' }, () =>
        server().call('renamePost', { id: created.data.id, title: 'Stolen' }),
      )
      expect(result).toEqual({ success: true, data: { renamed: false } })
      expect(await titles()).toEqual(['Ada'])
    })

    test('an unexpected error is redacted and reported with the procedure name', async () => {
      const result = await asRequest(null, () => server().call('explode', {}))
      expect(result).toEqual({
        success: false,
        error: { code: 'INTERNAL', message: 'Internal error' },
      })
      expect(JSON.stringify(result)).not.toContain('hunter2')
      expect(onUnexpectedError).toHaveBeenCalledWith(expect.any(Error), 'explode')
    })

    test('undeclared input keys reach nothing, and a session in the input is ignored', async () => {
      const input = { title: 'Mine', session: { userId: 'mallory' }, userId: 'mallory' }
      const anonymous = await asRequest(null, () => server().call('createPost', input))
      expect(anonymous.success).toBe(false)
      if (!anonymous.success) expect(anonymous.error.code).toBe('UNAUTHENTICATED')

      await asRequest({ userId: 'bob' }, () => server().call('createPost', input))
      const rows = await database.context().sudo().db.Post.all()
      expect(rows.map((row) => row.authorId)).toEqual(['bob'])
    })
  })

  describe('exposure', () => {
    test('a procedure not exposed to web is not callable and answers like an unknown name', async () => {
      const unexposed = await asRequest({ userId: 'ada' }, () => server().call('agentOnly', {}))
      const unknown: unknown = await asRequest({ userId: 'ada' }, () =>
        Reflect.apply(server().call, undefined, ['doesNotExist', {}]),
      )
      const inheritedRegistry: ProcedureRegistry<Ctx> = Object.create({ whoAmI })
      const inherited = createServerCaller({
        procedures: inheritedRegistry,
        getContext: async (session?: Session) => database.context(session),
        getSession,
        onUnexpectedError,
      })
      const viaPrototype: unknown = await asRequest({ userId: 'ada' }, () =>
        Reflect.apply(inherited.call, undefined, ['whoAmI', {}]),
      )

      const internal = { success: false, error: { code: 'INTERNAL', message: 'Internal error' } }
      expect(unexposed).toEqual(internal)
      expect(unknown).toEqual(internal)
      expect(viaPrototype).toEqual(internal)
      expect(getSession).not.toHaveBeenCalled()
      expect(onUnexpectedError).toHaveBeenCalledTimes(3)
      expect(onUnexpectedError).toHaveBeenCalledWith(expect.any(ProcedureHostError), 'agentOnly')
    })
  })

  describe('the session', () => {
    test('is resolved from the server for each call and carries a human actor', async () => {
      const result = await asRequest({ userId: 'ada' }, () =>
        server().call('createPost', { title: 'Hello' }),
      )
      expect(result.success).toBe(true)
      expect(getSession).toHaveBeenCalledTimes(1)
      expect(getSession).toHaveBeenCalledWith()
      const human = { kind: 'human', userId: 'ada', via: 'web' }
      expect(seenActors).toEqual([
        { where: 'access', actor: human },
        { where: 'run', actor: human },
        { where: 'transaction', actor: human },
      ])
      expect(new Set(seenActors.map((seen) => seen.actor)).size).toBe(1)
    })

    test('carries the same actor as the HTTP host for the same user', async () => {
      await overHttp('createPost', { title: 'Over HTTP' }, 'ada')
      const http = seenActors
      seenActors = []
      await asRequest({ userId: 'ada' }, () => server().call('createPost', { title: 'In process' }))
      expect(seenActors).toEqual(http)
    })

    test('an actor the resolved session carries is replaced', async () => {
      const forged: Session = {
        userId: 'ada',
        actor: { kind: 'agent', clientId: 'evil', onBehalfOf: 'ada', via: 'mcp' },
      }
      const result = await asRequest(forged, () => server().call('whoAmI'))
      expect(result).toEqual({ success: true, data: { userId: 'ada', actorKind: 'human' } })
    })

    test('null and undefined are anonymous, with no actor', async () => {
      for (const resolved of [null, undefined]) {
        getSession.mockResolvedValueOnce(resolved)
        const result = await server().call('whoAmI')
        expect(result).toEqual({ success: true, data: { userId: null, actorKind: null } })
      }
      expect(await asRequest(null, () => server().call('createPost', { title: 'x' }))).toEqual({
        success: false,
        error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
      })
    })

    test('a session whose user id is a getter is refused on both hosts, not run without an actor', async () => {
      const accessorSession = async (): Promise<Session | null> => {
        const session: Session = {}
        Object.defineProperty(session, 'userId', { get: () => 'ada', enumerable: true })
        return session
      }
      const internal = { success: false, error: { code: 'INTERNAL', message: 'Internal error' } }

      const http = await overHttp('whoAmI', {}, 'ada', accessorSession)
      expect(http.status).toBe(500)
      expect(http.body).toEqual(internal)
      expect(onUnexpectedError).toHaveBeenLastCalledWith(expect.any(ProcedureHostError), 'whoAmI')

      onUnexpectedError.mockClear()
      const result = await server({ getSession: accessorSession }).call('whoAmI')
      expect(result).toEqual(internal)
      expect(onUnexpectedError).toHaveBeenCalledWith(expect.any(ProcedureHostError), 'whoAmI')
      await expect(server({ getSession: accessorSession }).context()).rejects.toBeInstanceOf(
        ProcedureHostError,
      )
    })

    test('a session with no usable user id fails closed and is reported', async () => {
      const result = await asRequest({ email: 'ada@example.com' }, () => server().call('whoAmI'))
      expect(result).toEqual({
        success: false,
        error: { code: 'INTERNAL', message: 'Internal error' },
      })
      expect(onUnexpectedError).toHaveBeenCalledWith(expect.any(ProcedureHostError), 'whoAmI')
      expect(String(onUnexpectedError.mock.calls[0]?.[0])).toContain('sessionFields')
    })

    test('a session holding undefined for one of its keys fails with InvalidSessionError', async () => {
      const result = await asRequest({ userId: 'ada', email: undefined }, () =>
        server().call('whoAmI'),
      )
      expect(result).toEqual({
        success: false,
        error: { code: 'INTERNAL', message: 'Internal error' },
      })
      expect(onUnexpectedError).toHaveBeenCalledWith(expect.any(InvalidSessionError), 'whoAmI')
      await expect(
        asRequest({ userId: 'ada', email: undefined }, () => server().context()),
      ).rejects.toBeInstanceOf(InvalidSessionError)
    })

    test('a resolver that throws fails the call with INTERNAL', async () => {
      getSession.mockRejectedValueOnce(new Error('auth backend down'))
      const result = await server().call('whoAmI')
      expect(result).toEqual({
        success: false,
        error: { code: 'INTERNAL', message: 'Internal error' },
      })
      expect(onUnexpectedError).toHaveBeenCalledWith(expect.any(Error), 'whoAmI')
    })

    test('concurrent requests never share a session', async () => {
      const users = Array.from(
        { length: 24 },
        (_, index) => `user${String.fromCharCode(97 + index)}`,
      )
      const caller = server()
      const staggered = (index: number) =>
        new Promise((resolve) => setTimeout(resolve, (index % 6) * 3))

      const results = await Promise.all(
        users.map((userId, index) =>
          asRequest({ userId }, async () => {
            await staggered(index)
            return caller.call('whoAmI')
          }),
        ),
      )
      expect(results.map((result) => (result.success ? result.data.userId : null))).toEqual(users)

      const contexts = await Promise.all(
        users.map((userId, index) =>
          asRequest({ userId }, async () => {
            await staggered(index)
            const context = await caller.context()
            await new Promise((resolve) => setTimeout(resolve, Math.random() * 10))
            return context.session?.userId
          }),
        ),
      )
      expect(contexts).toEqual(users)
    })

    test('one caller resolves the session again for every later request', async () => {
      const caller = server()
      const order = ['ada', 'bob', null, 'ada']
      const seen: Array<string | null> = []
      for (const userId of order) {
        const result = await asRequest(userId === null ? null : { userId }, () =>
          caller.call('whoAmI'),
        )
        seen.push(result.success ? result.data.userId : 'failed')
        const context = await asRequest(userId === null ? null : { userId }, () => caller.context())
        expect(context.session?.userId ?? null).toBe(userId)
      }
      expect(seen).toEqual(order)
      expect(getSession).toHaveBeenCalledTimes(order.length * 2)
    })
  })

  describe('the session-resolved context', () => {
    test('takes no argument and carries the request session with its human actor', async () => {
      const caller = server()
      expect(caller.context.length).toBe(0)
      const context = await asRequest({ userId: 'ada' }, () => caller.context())
      expect(context.session).toEqual({
        userId: 'ada',
        actor: { kind: 'human', userId: 'ada', via: 'web' },
      })
      expect(Object.isFrozen(context.session)).toBe(true)
    })

    test('reads through context.db under list access', async () => {
      await asRequest({ userId: 'ada' }, () => server().call('createPost', { title: 'Ada' }))
      await asRequest({ userId: 'bob' }, () => server().call('createPost', { title: 'Bob' }))
      const asAda = await asRequest({ userId: 'ada' }, () => server().context())
      const rows = await asAda.db.Post.all()
      expect(rows.map((row) => row.title)).toEqual(['Ada'])
    })

    test('is anonymous when no session resolves', async () => {
      const context = await asRequest(null, () => server().context())
      expect(context.session).toBeNull()
      expect(await context.db.Post.all()).toEqual([])
    })

    test('rejects a session with no usable user id', async () => {
      await expect(
        asRequest({ email: 'ada@example.com' }, () => server().context()),
      ).rejects.toBeInstanceOf(ProcedureHostError)
    })
  })

  describe('framework control flow', () => {
    test('a redirect thrown inside a transaction propagates and the write rolls back', async () => {
      await expect(
        asRequest({ userId: 'ada' }, () => server().call('redirectFromRun', {})),
      ).rejects.toMatchObject({ digest: 'NEXT_REDIRECT;replace;/sign-in;307;' })
      expect(await titles()).toEqual([])
      expect(onUnexpectedError).not.toHaveBeenCalled()
    })

    test('a redirect thrown by the access rule propagates', async () => {
      await expect(
        asRequest(null, () => server().call('redirectFromAccess', {})),
      ).rejects.toBeInstanceOf(ControlFlow)
    })

    test('a redirect thrown while resolving the session propagates from call and context', async () => {
      getSession.mockRejectedValueOnce(redirectToSignIn())
      await expect(server().call('whoAmI')).rejects.toBeInstanceOf(ControlFlow)
      getSession.mockRejectedValueOnce(redirectToSignIn())
      await expect(server().context()).rejects.toBeInstanceOf(ControlFlow)
    })

    test('the redirect a cause chain reaches is the one rethrown', async () => {
      const rejection = asRequest(null, () => server().call('wrappedRedirect', {}))
      await expect(rejection).rejects.toBeInstanceOf(ControlFlow)
      await expect(rejection).rejects.not.toHaveProperty('message', 'wrapped')
    })

    test("what the app config's isFrameworkControlFlow recognises propagates without passing config", async () => {
      await expect(
        asRequest(null, () => server().call('customControlFlow', {})),
      ).rejects.toBeInstanceOf(Response)

      const http = await overHttp('customControlFlow', {}, null)
      expect(http.status).toBe(500)
      expect(onUnexpectedError).toHaveBeenCalledWith(expect.any(Response), 'customControlFlow')
    })

    test('a resolver throwing what only the config recognises needs config, as there is no context yet', async () => {
      const throwsResponse = async (): Promise<Session | null> => {
        throw new Response(null, { status: 303 })
      }
      const unconfigured = await server({ getSession: throwsResponse }).call('whoAmI')
      expect(unconfigured).toEqual({
        success: false,
        error: { code: 'INTERNAL', message: 'Internal error' },
      })
      expect(onUnexpectedError).toHaveBeenCalledWith(expect.any(Response), 'whoAmI')

      await expect(
        server({ getSession: throwsResponse, config: schemaConfig() }).call('whoAmI'),
      ).rejects.toBeInstanceOf(Response)
    })

    test('over HTTP the same redirect is INTERNAL, reported, and rolled back', async () => {
      for (const name of ['redirectFromRun', 'redirectFromAccess'] as const) {
        const http = await overHttp(name, {}, name === 'redirectFromRun' ? 'ada' : null)
        expect(http.status).toBe(500)
        expect(http.body).toEqual({
          success: false,
          error: { code: 'INTERNAL', message: 'Internal error' },
        })
        expect(onUnexpectedError).toHaveBeenCalledWith(expect.any(ControlFlow), name)
      }
      expect(await titles()).toEqual([])
    })
  })

  describe('registry checks', () => {
    test('an unsafe registry is refused when the caller is created', () => {
      const open = procedure({
        description: 'Accept anything',
        input: z.object({ value: z.unknown() }),
        output: z.object({}),
        access: () => true,
        expose: ['web'],
        run: () => ({}),
      })
      expect(() =>
        createServerCaller({
          procedures: { open } satisfies ProcedureRegistry<Ctx>,
          getContext: async (session?: Session) => database.context(session),
          getSession,
        }),
      ).toThrow(ProcedureHostError)
      expect(() =>
        createServerCaller({
          procedures: { list_post_update: whoAmI } satisfies ProcedureRegistry<Ctx>,
          getContext: async (session?: Session) => database.context(session),
          getSession,
        }),
      ).toThrow(/reserved list_<list>_<operation> pattern/)
    })

    test('with the config, a name an MCP custom tool carries is refused', () => {
      const procedures = { publishPost: whoAmI } satisfies ProcedureRegistry<Ctx>
      const create = (config?: OpenSaasConfig) =>
        createServerCaller({
          procedures,
          config,
          getContext: async (session?: Session) => database.context(session),
          getSession,
        })
      expect(() => create()).not.toThrow()
      expect(() => create(schemaConfig())).toThrow(ProcedureHostError)
      expect(getSession).not.toHaveBeenCalled()
    })
  })
})
