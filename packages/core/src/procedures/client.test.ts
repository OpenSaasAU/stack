import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import * as z from 'zod'
import type { AccessControlledDB, Session } from '../access/types.js'
import type { OpenSaasConfig } from '../config/types.js'
import { text } from '../fields/index.js'
import { classifyDriverError } from '../lib/database-errors.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import type { StackContext } from '../types/context.js'
import { createProcedureClient, type ProcedureClientOptions } from './client.js'
import { createProcedureHandler } from './http.js'
import { createProcedureBuilder, type ProcedureRegistry } from './procedure.js'
import { FAILURE_STATUS, RESERVED_FAILURE_CODES } from './result.js'

const BOOT = 120_000
const ORIGIN = 'http://app.test'

type Ctx = StackContext<AccessControlledDB>

function schemaConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Post: {
        fields: { title: text({ validation: { isRequired: true } }), authorId: text() },
        access: {
          operation: {
            query: () => true,
            create: () => true,
            update: () => true,
            delete: () => true,
          },
        },
      },
    },
  }
}

const procedure = createProcedureBuilder<Ctx>()

const createPost = procedure({
  description: 'Create a post authored by the caller',
  input: z.object({ title: z.string().min(1) }),
  output: z.object({ id: z.string(), title: z.string() }),
  access: ({ session }) => session !== null,
  expose: ['web'],
  run: async ({ input, context }) => {
    const authorId = context.session === null ? '' : String(context.session.userId)
    const row = await context.db.Post.create({ data: { title: input.title, authorId } })
    if (row === null) throw new Error('create denied')
    return { id: String(row.id), title: String(row.title) }
  },
})

const book = procedure({
  description: 'Book a place in a slot',
  input: z.object({ slotId: z.string() }),
  output: z.object({ bookingId: z.string() }),
  failures: { SLOT_FULL: 'The slot is full', CLOSED: 'Bookings have closed' },
  access: () => true,
  expose: ['web'],
  run: ({ input, fail }) => {
    if (input.slotId === 'full') throw fail('SLOT_FULL')
    return { bookingId: `booking-${input.slotId}` }
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

const noInput = procedure({
  description: 'Take no input at all',
  input: z.object({ loud: z.boolean().optional() }).optional(),
  output: z.object({ received: z.string() }),
  access: () => true,
  expose: ['web'],
  run: ({ input }) => ({ received: input === undefined ? 'nothing' : 'object' }),
})

let raceAttempts = 0

const loseRace = procedure({
  description: 'Lose a race the database rolled back',
  input: z.object({}),
  output: z.object({}),
  access: () => true,
  expose: ['web'],
  run: () => {
    raceAttempts += 1
    const driverError = Object.assign(new Error('could not serialize access'), {
      kind: 'sql_query',
      sqlState: '40001',
    })
    throw classifyDriverError(driverError) ?? driverError
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

const nothing = procedure({
  description: 'Return nothing at all',
  input: z.object({}),
  output: z.object({ count: z.number() }).optional(),
  access: () => true,
  expose: ['web'],
  run: () => undefined,
})

const registry = {
  nothing,
  createPost,
  book,
  ping,
  noInput,
  loseRace,
  agentOnly,
} satisfies ProcedureRegistry<Ctx>

type Registry = typeof registry

interface Sent {
  url: string
  method: string
  headers: Record<string, string>
  credentials: string
  body: string
}

describe('createProcedureClient', () => {
  let database: TestDatabase
  let sent: Sent[] = []

  async function record(request: Request): Promise<void> {
    sent.push({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers),
      credentials: request.credentials,
      body: await request.clone().text(),
    })
  }

  function host(basePath?: string): (request: Request) => Promise<Response> {
    return createProcedureHandler<Ctx>({
      procedures: registry,
      getContext: async (session) => database.context(session),
      getSession: async (request): Promise<Session | null> => {
        const match = /session=([a-z]+)/.exec(request.headers.get('cookie') ?? '')
        return match === null ? null : { userId: match[1] }
      },
      allowedOrigins: [ORIGIN],
      maxBodyBytes: 512,
      basePath,
      onUnexpectedError: () => {},
    })
  }

  /** What the browser adds to a same-origin request: the page's origin and its cookie. */
  function browser(
    cookie?: string,
    handler: (request: Request) => Promise<Response> = host(),
  ): (request: Request) => Promise<Response> {
    return async (request) => {
      await record(request)
      const headers = new Headers(request.headers)
      headers.set('origin', ORIGIN)
      if (cookie !== undefined) headers.set('cookie', cookie)
      const body = await request.text()
      return handler(
        new Request(request.url, {
          method: request.method,
          headers,
          body: body === '' ? undefined : body,
        }),
      )
    }
  }

  function client(cookie?: string, options: ProcedureClientOptions = {}) {
    return createProcedureClient<Registry>({
      baseUrl: `${ORIGIN}/api/procedures`,
      fetch: browser(cookie),
      ...options,
    })
  }

  function answering(response: () => Response): (request: Request) => Promise<Response> {
    return async (request) => {
      await record(request)
      return response()
    }
  }

  beforeAll(async () => {
    database = await createTestDatabase(schemaConfig())
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(async () => {
    await database.truncate()
    sent = []
    raceAttempts = 0
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('a signed-in caller gets the typed data and the row exists', async () => {
    const result = await client('session=ada')('createPost', { title: 'Hello' })
    expect(result).toEqual({ success: true, data: { id: expect.any(String), title: 'Hello' } })
    const rows = await database.context().sudo().db.Post.all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ title: 'Hello', authorId: 'ada' })
  })

  test('a declared failure arrives with its own code', async () => {
    const result = await client()('book', { slotId: 'full' })
    expect(result).toEqual({
      success: false,
      error: { code: 'SLOT_FULL', message: 'The slot is full' },
    })
    expect(await client()('book', { slotId: 'a' })).toEqual({
      success: true,
      data: { bookingId: 'booking-a' },
    })
  })

  test('a reserved failure arrives as a pipeline result, not a transport failure', async () => {
    const anonymous = await client()('createPost', { title: 'Hello' })
    expect(anonymous).toEqual({
      success: false,
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    })

    const invalid = await client('session=ada')('createPost', { title: '' })
    expect(invalid).toMatchObject({
      success: false,
      error: { code: 'INVALID_INPUT', fieldErrors: { title: expect.any(String) } },
    })
    expect(await database.context().sudo().db.Post.all()).toEqual([])
  })

  test('no input is an empty body the host reads as undefined, and an object is sent as given', async () => {
    const call = client()
    expect(await call('noInput')).toEqual({ success: true, data: { received: 'nothing' } })
    expect(await call('noInput', {})).toEqual({ success: true, data: { received: 'object' } })
    expect(await call('ping', {})).toEqual({ success: true, data: { signedIn: false } })
    expect(sent.map((request) => request.body)).toEqual(['', '{}', '{}'])
    expect(sent.every((request) => request.headers['content-type'] === 'application/json')).toBe(
      true,
    )
  })

  test('the request is a JSON POST carrying no Authorization header', async () => {
    await client('session=ada')('createPost', { title: 'Hello' })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      url: `${ORIGIN}/api/procedures/createPost`,
      method: 'POST',
      credentials: 'same-origin',
      body: '{"title":"Hello"}',
    })
    expect(Object.keys(sent[0]?.headers ?? {})).toEqual(['content-type'])
  })

  test('credentials and the base URL follow the options', async () => {
    const call = createProcedureClient<Registry>({
      baseUrl: `${ORIGIN}/rpc/`,
      credentials: 'include',
      fetch: browser(undefined, host('/rpc')),
    })
    expect(await call('ping', {})).toEqual({ success: true, data: { signedIn: false } })
    expect(sent[0]).toMatchObject({ url: `${ORIGIN}/rpc/ping`, credentials: 'include' })
  })

  test('the global fetch is the default sender', async () => {
    const globalFetch = vi.fn(browser())
    vi.stubGlobal('fetch', globalFetch)
    const call = createProcedureClient<Registry>({ baseUrl: `${ORIGIN}/api/procedures` })
    expect(await call('ping', {})).toEqual({ success: true, data: { signedIn: false } })
    expect(globalFetch).toHaveBeenCalledTimes(1)
  })

  test('a name the host does not serve to the web is a refused transport failure', async () => {
    const call = createProcedureClient<Registry & { retired: typeof ping }>({
      baseUrl: `${ORIGIN}/api/procedures`,
      fetch: browser(),
    })
    const refused = { code: 'transport', reason: 'refused', status: 404, message: 'Not found' }
    expect(await call('retired', {})).toEqual({ success: false, error: refused })
    expect(await call('agentOnly', {})).toEqual({ success: false, error: refused })
  })

  test('the host refusing a method or a content type is a refused transport failure', async () => {
    const rewriting =
      (init: { method?: string; contentType?: string }) =>
      async (request: Request): Promise<Response> => {
        await record(request)
        const headers = new Headers(request.headers)
        if (init.contentType !== undefined) headers.set('content-type', init.contentType)
        const method = init.method ?? request.method
        const body = await request.text()
        return host()(
          new Request(request.url, {
            method,
            headers,
            body: method === 'GET' || body === '' ? undefined : body,
          }),
        )
      }
    const viaGet = client(undefined, { fetch: rewriting({ method: 'GET' }) })
    expect(await viaGet('ping', {})).toEqual({
      success: false,
      error: { code: 'transport', reason: 'refused', status: 405, message: 'Method not allowed' },
    })
    const asText = client(undefined, { fetch: rewriting({ contentType: 'text/plain' }) })
    expect(await asText('ping', {})).toEqual({
      success: false,
      error: {
        code: 'transport',
        reason: 'refused',
        status: 415,
        message: 'Content-Type must be application/json',
      },
    })
  })

  test('an error body under a status the host never refuses with is malformed, not refused', async () => {
    for (const status of [401, 403, 429, 500, 502, 503, 504]) {
      const call = client(undefined, {
        fetch: answering(() => Response.json({ error: 'upstream timeout' }, { status })),
      })
      expect(await call('ping', {}), String(status)).toEqual({
        success: false,
        error: {
          code: 'transport',
          reason: 'malformed',
          status,
          message: 'The response is not a procedure result',
        },
      })
    }
  })

  test('an input JSON cannot carry resolves as unsent and sends nothing', async () => {
    const send = vi.fn(browser())
    const call = client('session=ada', { fetch: send })
    const circular: { title: string; self?: object } = { title: 'Loop' }
    circular.self = circular
    const big = { title: 'Big', count: 1n }
    const throwing = {
      title: 'Throws',
      toJSON(): never {
        throw new Error('toJSON refused')
      },
    }
    for (const input of [circular, big, throwing]) {
      const result = await call('createPost', input)
      expect(result).toMatchObject({
        success: false,
        error: { code: 'transport', reason: 'unsent', message: expect.any(String) },
      })
      expect(result.success === false && 'status' in result.error).toBe(false)
    }
    expect(send).not.toHaveBeenCalled()
    expect(await database.context().sudo().db.Post.all()).toEqual([])
  })

  test('a name a host cannot serve is never sent, so it cannot leave the base path', async () => {
    const send = vi.fn(browser())
    const call = createProcedureClient<
      Registry & {
        '..': typeof ping
        '../../admin/delete': typeof ping
        'ping?x=1': typeof ping
        'ping#x': typeof ping
        'a/b': typeof ping
        '': typeof ping
      }
    >({ baseUrl: `${ORIGIN}/api/procedures`, fetch: send })
    const results = [
      await call('..', {}),
      await call('../../admin/delete', {}),
      await call('ping?x=1', {}),
      await call('ping#x', {}),
      await call('a/b', {}),
      await call('', {}),
    ]
    for (const result of results) {
      expect(result).toMatchObject({
        success: false,
        error: { code: 'transport', reason: 'unsent' },
      })
    }
    expect(send).not.toHaveBeenCalled()
  })

  test('an output that accepts undefined is a success with no data key on the wire', async () => {
    const wire: string[] = []
    const send = async (request: Request): Promise<Response> => {
      const response = await browser()(request)
      wire.push(await response.clone().text())
      return response
    }
    const result = await client(undefined, { fetch: send })('nothing', {})
    expect(result).toStrictEqual({ success: true, data: undefined })
    expect(wire).toEqual(['{"success":true}'])
  })

  test('a body over the host limit is a refused transport failure', async () => {
    const result = await client('session=ada')('createPost', { title: 'x'.repeat(600) })
    expect(result).toEqual({
      success: false,
      error: {
        code: 'transport',
        reason: 'refused',
        status: 413,
        message: 'Request body too large',
      },
    })
  })

  test('a request that is never answered is a network transport failure, sent once', async () => {
    const send = vi.fn(async (): Promise<Response> => {
      throw new TypeError('Failed to fetch')
    })
    const call = client(undefined, { fetch: send })
    expect(await call('ping', {})).toEqual({
      success: false,
      error: { code: 'transport', reason: 'network', message: 'Failed to fetch' },
    })
    expect(send).toHaveBeenCalledTimes(1)
  })

  test('a response whose body cannot be read is a network transport failure', async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('connection reset'))
      },
    })
    const call = client(undefined, {
      fetch: answering(() => new Response(broken, { status: 200 })),
    })
    expect(await call('ping', {})).toEqual({
      success: false,
      error: { code: 'transport', reason: 'network', status: 200, message: 'connection reset' },
    })
  })

  test('a response that is not JSON is a malformed transport failure', async () => {
    for (const status of [200, 502]) {
      const call = client(undefined, {
        fetch: answering(
          () =>
            new Response('<html>Bad gateway</html>', {
              status,
              headers: { 'content-type': 'text/html' },
            }),
        ),
      })
      expect(await call('ping', {})).toEqual({
        success: false,
        error: {
          code: 'transport',
          reason: 'malformed',
          status,
          message: 'The response is not JSON',
        },
      })
    }
    expect(sent).toHaveLength(2)
  })

  test('JSON that is not a procedure result under its status is a malformed transport failure', async () => {
    const cases: { status: number; body: unknown }[] = [
      { status: 200, body: null },
      { status: 200, body: [] },
      { status: 200, body: { data: { signedIn: true } } },
      { status: 200, body: { error: 'Not found' } },
      { status: 500, body: { success: true, data: { signedIn: true } } },
      { status: 200, body: { success: false, error: 'Not found' } },
      { status: 200, body: { success: false, error: { code: 'SLOT_FULL' } } },
      { status: 200, body: { success: false, error: { code: 7, message: 'Seven' } } },
      { status: 200, body: { success: false, error: { code: 'INTERNAL', message: 'Hidden' } } },
      { status: 500, body: { success: false, error: { code: 'SLOT_FULL', message: 'Full' } } },
      { status: 200, body: { success: false, error: { code: 'transport', message: 'Lies' } } },
      { status: 200, body: { success: false, error: { code: 'slot_full', message: 'Full' } } },
      { status: 200, body: { success: false, error: { code: '', message: 'Empty' } } },
      {
        status: 400,
        body: {
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Invalid input', fieldErrors: { title: 3 } },
        },
      },
    ]
    for (const { status, body } of cases) {
      const call = client(undefined, {
        fetch: answering(() => Response.json(body, { status })),
      })
      expect(await call('ping', {}), JSON.stringify({ status, body })).toEqual({
        success: false,
        error: {
          code: 'transport',
          reason: 'malformed',
          status,
          message: 'The response is not a procedure result',
        },
      })
    }
  })

  test('every reserved code is read under the status the host gives it, and under no other', async () => {
    for (const code of RESERVED_FAILURE_CODES) {
      const body = { success: false, error: { code, message: 'Reserved' } }
      const expected = client(undefined, {
        fetch: answering(() => Response.json(body, { status: FAILURE_STATUS[code] })),
      })
      expect(await expected('ping', {}), code).toEqual(body)

      const mismatched = client(undefined, {
        fetch: answering(() => Response.json(body, { status: 200 })),
      })
      expect(await mismatched('ping', {}), code).toMatchObject({
        error: { code: 'transport', reason: 'malformed' },
      })
    }
  })

  test('RETRY is returned to the caller and the call is not sent again', async () => {
    const result = await client()('loseRace', {})
    expect(result).toMatchObject({ success: false, error: { code: 'RETRY' } })
    expect(sent).toHaveLength(1)
    expect(raceAttempts).toBe(1)
  })
})
