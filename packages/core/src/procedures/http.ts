import type { OpenSaasConfig } from '../config/types.js'
import {
  isProcedure,
  type Procedure,
  type ProcedureHostContext,
  type ProcedureRegistry,
} from './procedure.js'
import { FAILURE_STATUS, failure, isReservedFailureCode, type ProcedureResult } from './result.js'
import { guardReporter, runProcedure, type RawInput } from './run.js'
import { assertProcedureRegistry, ProcedureHostError } from './validate.js'

/** The session type an application context carries, without its `null`. */
export type SessionOf<C extends ProcedureHostContext> = Exclude<C['session'], null>

/** Options for {@link createProcedureHandler}. */
export interface ProcedureHandlerOptions<C extends ProcedureHostContext> {
  /** The application's procedure registry. Only procedures exposing `'web'` are reachable. */
  procedures: ProcedureRegistry<C>
  /**
   * The resolved config. Procedure names share one namespace with MCP tools,
   * and with the config the host refuses a procedure named like one of its
   * list custom tools or plugin-registered tools. A config with plugins is a
   * promise, so pass `await config`. Without it only the reserved
   * `list_<list>_<operation>` pattern is refused.
   */
  config?: OpenSaasConfig
  /** The generated `getContext`: called with the resolved session, or with nothing when anonymous. */
  getContext: (session?: SessionOf<C>) => Promise<C>
  /**
   * Resolve the cookie session for a request. Called only when the request
   * carries a `Cookie` header from an allowed origin, with a body-less `GET`
   * copy of the request carrying its URL and headers; a request with no
   * credential is anonymous without asking. Resolving `null` or `undefined`
   * means no session; resolving anything else that is not an object fails
   * the call with `INTERNAL` and is reported to `onUnexpectedError`.
   */
  getSession: (request: Request) => Promise<SessionOf<C> | null | undefined>
  /**
   * The origins a cookie-authenticated request may come from, as absolute
   * URLs (`https://app.example.com`). A request carrying a cookie from any
   * other origin, or from none, is refused.
   */
  allowedOrigins: readonly string[]
  /** The path the routes are mounted under; each procedure is `POST <basePath>/<name>`. Default `/api/procedures`. */
  basePath?: string
  /**
   * The largest request body accepted, in bytes. Default 1 MiB. The body is
   * read only once the access rule has admitted the call.
   */
  maxBodyBytes?: number
  /**
   * Told of every failure the operator should see, with the procedure's name:
   * every error whose message is withheld from the caller, every database
   * failure other than a unique-constraint violation or a serialization
   * failure (the driver's detail is on `error.cause`), and every engine
   * refusal of a payload the procedure itself wrote. Default `console.error`,
   * which is also the fallback when this function throws or returns a promise
   * that rejects.
   */
  onUnexpectedError?: (error: unknown, procedureName: string) => void
}

const DEFAULT_BASE_PATH = '/api/procedures'
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024
const RESPONSE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
}

function json(status: number, body: object, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...RESPONSE_HEADERS, ...headers },
  })
}

const notFound = (): Response => json(404, { error: 'Not found' })

function statusOf(result: ProcedureResult<unknown, string>): number {
  if (result.success) return 200
  const { code } = result.error
  return isReservedFailureCode(code) ? FAILURE_STATUS[code] : 200
}

function resultResponse(result: ProcedureResult<unknown, string>): Response {
  return json(statusOf(result), result)
}

function defaultUnexpectedError(error: unknown, procedureName: string): void {
  console.error(`Procedure "${procedureName}" failed:`, error)
}

function normaliseBasePath(basePath: string): string {
  if (!basePath.startsWith('/')) {
    throw new ProcedureHostError(
      `createProcedureHandler: basePath "${basePath}" must start with "/".`,
    )
  }
  return basePath.replace(/\/+$/, '')
}

function normaliseOrigins(origins: readonly string[]): ReadonlySet<string> {
  const normalised = new Set<string>()
  for (const origin of origins) {
    let parsed: URL
    try {
      parsed = new URL(origin)
    } catch {
      throw new ProcedureHostError(
        `createProcedureHandler: allowed origin "${origin}" is not an absolute URL.`,
      )
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new ProcedureHostError(
        `createProcedureHandler: allowed origin "${origin}" must be an http(s) origin.`,
      )
    }
    normalised.add(parsed.origin)
  }
  return normalised
}

function lookup<C extends ProcedureHostContext>(
  procedures: ProcedureRegistry<C>,
  name: string,
): Procedure<C> | undefined {
  if (!Object.hasOwn(procedures, name)) return undefined
  const found = procedures[name]
  if (!isProcedure<C>(found) || !found.expose.includes('web')) return undefined
  return found
}

function isJsonContentType(header: string | null): boolean {
  if (header === null) return false
  const mediaType = header.split(';', 1)[0]?.trim().toLowerCase()
  return mediaType === 'application/json'
}

async function readBodyWithin(request: Request, limit: number): Promise<string | null> {
  if (request.body === null) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > limit) {
      void reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function parseJson(text: string): RawInput {
  if (text === '') return { ok: true, value: undefined }
  try {
    const value: unknown = JSON.parse(text)
    return { ok: true, value }
  } catch {
    return { ok: false }
  }
}

/**
 * A web-standard `Request` → `Response` handler that serves an application's
 * procedures over HTTP: `POST <basePath>/<name>`, JSON in and JSON out. It
 * runs under any framework that speaks the Fetch API.
 *
 * Identity comes from the host alone. A request with no credential is
 * anonymous and the procedure's access rule decides; a request with a cookie
 * must come from an allowed origin and is resolved by `getSession`; a request
 * carrying an `Authorization` header is refused, with or without a cookie.
 * Nothing in the body can supply a session.
 *
 * A call that reaches the pipeline answers with the result envelope:
 * `{ success: true, data }`, or `{ success: false, error: { code, message,
 * fieldErrors? } }` with `UNAUTHENTICATED` 401, `DENIED` 403,
 * `INVALID_INPUT`/`VALIDATION` 400, `RETRY`/`CONFLICT` 409 and `INTERNAL` 500.
 * A failure the procedure declares is an expected outcome and answers 200
 * with its own code. The host never retries a call: `RETRY` reports that the
 * transaction rolled back and leaves running it again to the caller.
 * An unexpected error's message is passed to `onUnexpectedError` and never to
 * the client. An empty or missing body is `undefined` input, which the input
 * schema accepts or refuses; a body that is not JSON is `INVALID_INPUT`.
 *
 * A transport failure does not use the envelope. It answers
 * `{ error: "<message>" }`, where `error` is a string: 404 for an unknown name
 * or a procedure not exposed to `'web'` (the two are indistinguishable), 405
 * for a method other than `POST`, 415 for a content type other than
 * `application/json`, and 413 for a body over `maxBodyBytes`. A client should
 * branch on the status before reading `success`.
 *
 * The host refuses, when it is created, a registry it cannot serve safely: a
 * schema that cannot be carried on the wire or accepts open-ended values, a
 * name that clashes with an MCP tool, and a procedure declaring a reserved
 * failure code. See {@link assertProcedureRegistry}.
 *
 * @throws {ProcedureHostError} for an invalid option, name, schema or registry entry,
 *   or a procedure declaring a reserved failure code.
 *
 * @example
 * ```typescript
 * // app/api/procedures/[name]/route.ts
 * import { createProcedureHandler } from '@opensaas/stack-core/procedures'
 * import { getContext } from '@/.opensaas/context'
 * import { procedures } from '@/lib/procedures'
 * import { getSession } from '@/lib/auth'
 *
 * export const POST = createProcedureHandler({
 *   procedures,
 *   getContext,
 *   getSession: (request) => getSession(request.headers),
 *   allowedOrigins: [process.env.APP_ORIGIN ?? 'http://localhost:3000'],
 * })
 * ```
 */
export function createProcedureHandler<C extends ProcedureHostContext>(
  options: ProcedureHandlerOptions<C>,
): (request: Request) => Promise<Response> {
  const { procedures, getContext, getSession } = options
  const basePath = normaliseBasePath(options.basePath ?? DEFAULT_BASE_PATH)
  const allowedOrigins = normaliseOrigins(options.allowedOrigins)
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const onUnexpectedError = guardReporter(options.onUnexpectedError ?? defaultUnexpectedError)
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) {
    throw new ProcedureHostError('createProcedureHandler: maxBodyBytes must be a positive integer.')
  }
  assertProcedureRegistry(procedures, { config: options.config })

  return async (request: Request): Promise<Response> => {
    const prefix = `${basePath}/`
    const { pathname } = new URL(request.url)
    if (!pathname.startsWith(prefix)) return notFound()
    const name = pathname.slice(prefix.length, pathname.endsWith('/') ? -1 : undefined)
    const procedure = lookup(procedures, name)
    if (procedure === undefined) return notFound()

    if (request.method !== 'POST')
      return json(405, { error: 'Method not allowed' }, { allow: 'POST' })

    if (request.headers.has('authorization')) return resultResponse(failure('UNAUTHENTICATED'))

    if (!isJsonContentType(request.headers.get('content-type'))) {
      return json(415, { error: 'Content-Type must be application/json' })
    }

    const declaredLength = Number(request.headers.get('content-length') ?? '0')
    if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
      return json(413, { error: 'Request body too large' })
    }

    let session: SessionOf<C> | null = null
    if (request.headers.has('cookie')) {
      const origin = request.headers.get('origin')
      if (origin === null || !allowedOrigins.has(origin)) {
        return resultResponse(failure('DENIED'))
      }
      try {
        const resolved = await getSession(new Request(request.url, { headers: request.headers }))
        if (resolved === null || resolved === undefined) {
          session = null
        } else if (typeof resolved === 'object') {
          session = resolved
        } else {
          throw new ProcedureHostError(
            `getSession resolved a ${typeof resolved}; it must resolve a session object, null or undefined.`,
          )
        }
      } catch (error) {
        onUnexpectedError(error, name)
        return resultResponse(failure('INTERNAL'))
      }
    }

    const transport: { bodyTooLarge?: true } = {}
    const result = await runProcedure<C>({
      name,
      procedure,
      context: () => (session === null ? getContext() : getContext(session)),
      readInput: async () => {
        const body = await readBodyWithin(request, maxBodyBytes)
        if (body === null) {
          transport.bodyTooLarge = true
          return { ok: false }
        }
        return parseJson(body)
      },
      onUnexpectedError,
    })
    if (transport.bodyTooLarge === true) return json(413, { error: 'Request body too large' })

    try {
      return resultResponse(result)
    } catch (error) {
      onUnexpectedError(error, name)
      return resultResponse(failure('INTERNAL'))
    }
  }
}
