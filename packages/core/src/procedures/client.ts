// @opensaas/stack-core/procedures/client
//
// The browser client for procedures, importable from a `'use client'` module.
// Its only runtime import is `codes.ts`, which imports nothing. See ADR-0086.

import type * as z from 'zod'
import { FAILURE_STATUS, isReservedFailureCode } from './codes.js'
import type { Procedure, ProcedureHostContext, ProcedureRegistry } from './procedure.js'
import type { ProcedureFailure } from './result.js'

/**
 * A call that produced no result from the procedure pipeline. Its `code` is
 * the lower-case `'transport'`, which no procedure failure code can be: those
 * are upper-case.
 *
 * - `'network'`: the request was not answered, or its answer could not be
 *   read. The call may or may not have run.
 * - `'refused'`: the host refused the request before the pipeline ran, and
 *   `message` is its own: an unknown or unexposed name (404), a method other
 *   than `POST` (405), a body over the host's limit (413) or a content type
 *   it does not take (415).
 * - `'malformed'`: an answer arrived that is not the host's: not JSON, or
 *   JSON in neither of its shapes, as a proxy's error page is.
 */
export interface ProcedureTransportFailure {
  code: 'transport'
  reason: 'network' | 'refused' | 'malformed'
  /** The HTTP status, when a response arrived. */
  status?: number
  message: string
}

/**
 * What a call through the client resolves to: the procedure's data, a failure
 * from the pipeline, or a {@link ProcedureTransportFailure}. Switching on
 * `error.code` is exhaustive over the reserved codes, the codes the procedure
 * declares and `'transport'`.
 *
 * @typeParam TData - the procedure's parsed output.
 * @typeParam TCode - the failure codes the procedure declares.
 */
export type ProcedureClientResult<TData, TCode extends string = never> =
  | { success: true; data: TData }
  | { success: false; error: ProcedureFailure<TCode> | ProcedureTransportFailure }

/** The input a caller of `TProcedure` sends: what its input schema accepts. */
export type ProcedureInputOf<TProcedure> =
  TProcedure extends Procedure<infer _C, infer TIn, infer _TOut, infer _TCode>
    ? z.input<TIn>
    : never

/** The data a successful call of `TProcedure` carries. */
export type ProcedureDataOf<TProcedure> =
  TProcedure extends Procedure<infer _C, infer _TIn, infer TOut, infer _TCode>
    ? z.output<TOut>
    : never

/** The failure codes `TProcedure` declares. */
export type ProcedureCodeOf<TProcedure> =
  TProcedure extends Procedure<infer _C, infer _TIn, infer _TOut, infer TCode> ? TCode : never

/** What the client resolves a call of `TProcedure` to. */
export type ProcedureClientResultOf<TProcedure> = ProcedureClientResult<
  ProcedureDataOf<TProcedure>,
  ProcedureCodeOf<TProcedure>
>

/**
 * The arguments after the name: the input, which may be left out only when
 * the procedure's input schema accepts `undefined`.
 */
export type ProcedureCallArgs<TProcedure> =
  undefined extends ProcedureInputOf<TProcedure>
    ? [input?: ProcedureInputOf<TProcedure>]
    : [input: ProcedureInputOf<TProcedure>]

/**
 * Calls a procedure of `TRegistry` by name. The name, the input and the result
 * are typed from the registry, so an unknown name or a renamed input field is
 * a compile error.
 */
export type ProcedureClient<TRegistry extends ProcedureRegistry<ProcedureHostContext>> = <
  TName extends keyof TRegistry & string,
>(
  name: TName,
  ...args: ProcedureCallArgs<TRegistry[TName]>
) => Promise<ProcedureClientResultOf<TRegistry[TName]>>

/** Options for {@link createProcedureClient}. */
export interface ProcedureClientOptions {
  /**
   * Where the host is mounted; each call is `POST <baseUrl>/<name>`. Default
   * `/api/procedures`, the host's own default. An absolute URL reaches a host
   * on another origin, which must list this page's origin in its
   * `allowedOrigins` and needs `credentials: 'include'`.
   */
  baseUrl?: string
  /** Whether the session cookie is sent. Default `'same-origin'`. */
  credentials?: 'same-origin' | 'include'
  /** Sends the request. Default the global `fetch`. */
  fetch?: (request: Request) => Promise<Response>
}

const DEFAULT_BASE_URL = '/api/procedures'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFieldErrors(value: unknown): boolean {
  if (value === undefined) return true
  return isRecord(value) && Object.values(value).every((message) => typeof message === 'string')
}

function isSuccess<TData>(status: number, body: unknown): body is { success: true; data: TData } {
  return status === 200 && isRecord(body) && body.success === true
}

function isFailure<TCode extends string>(
  status: number,
  body: unknown,
): body is { success: false; error: ProcedureFailure<TCode> } {
  if (!isRecord(body) || body.success !== false) return false
  const { error } = body
  if (!isRecord(error) || typeof error.code !== 'string' || typeof error.message !== 'string') {
    return false
  }
  if (!isFieldErrors(error.fieldErrors)) return false
  return status === (isReservedFailureCode(error.code) ? FAILURE_STATUS[error.code] : 200)
}

function isRefusal(status: number, body: unknown): body is { error: string } {
  return status >= 400 && isRecord(body) && typeof body.error === 'string'
}

function transport(
  reason: ProcedureTransportFailure['reason'],
  message: string,
  status?: number,
): { success: false; error: ProcedureTransportFailure } {
  const error: ProcedureTransportFailure = { code: 'transport', reason, message }
  if (status !== undefined) error.status = status
  return { success: false, error }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== '' ? error.message : fallback
}

async function exchange<TData, TCode extends string>(
  send: (request: Request) => Promise<Response>,
  url: string,
  credentials: 'same-origin' | 'include',
  input: unknown,
): Promise<ProcedureClientResult<TData, TCode>> {
  const body = input === undefined ? undefined : JSON.stringify(input)

  let response: Response
  try {
    response = await send(
      new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials,
        body,
      }),
    )
  } catch (error) {
    return transport('network', messageOf(error, 'The request was not answered'))
  }

  const { status } = response
  let text: string
  try {
    text = await response.text()
  } catch (error) {
    return transport('network', messageOf(error, 'The response could not be read'), status)
  }

  let answer: unknown
  try {
    answer = JSON.parse(text)
  } catch {
    return transport('malformed', 'The response is not JSON', status)
  }

  if (isSuccess<TData>(status, answer)) return { success: true, data: answer.data }
  if (isFailure<TCode>(status, answer)) return { success: false, error: answer.error }
  if (isRefusal(status, answer)) return transport('refused', answer.error, status)
  return transport('malformed', 'The response is not a procedure result', status)
}

/**
 * A typed client for an application's procedures, for browser code. Give it
 * the **type** of the registry: the import is erased, so the registry, its
 * schemas and everything `run` reaches stay on the server.
 *
 * A call POSTs JSON to the HTTP host and resolves, without throwing, to one of
 * three outcomes: `{ success: true, data }`, a failure from the pipeline
 * (`error.code` a reserved code or one the procedure declares), or a
 * {@link ProcedureTransportFailure} (`error.code` `'transport'`) when the
 * request was not answered, the host refused it before the pipeline ran, or
 * the answer is not the host's. The status and the shape are checked together:
 * an answer is read as a result only when it has the result's shape under the
 * status the host gives that result.
 *
 * Identity is the session cookie alone. The client sends no `Authorization`
 * header, which the host refuses, and takes no session argument. It sends the
 * input exactly as given: no input is an empty body, which the host reads as
 * `undefined`, so a procedure whose schema requires an object is called with
 * `{}`.
 *
 * The client never retries, `RETRY` included: that code says the transaction
 * rolled back, not that work outside it was undone, and after a `'network'`
 * failure the call may have run. Whether running it again is safe is the
 * caller's decision.
 *
 * The data is typed from the output schema and is not parsed again in the
 * browser; the host has already parsed it. A procedure not exposed to `'web'`
 * is callable in the type and answers as a `'refused'` 404.
 *
 * @typeParam TRegistry - `typeof` the registry object. Declare the registry
 *   with `satisfies ProcedureRegistry<Context>` rather than annotating it, so
 *   each name keeps its own procedure type.
 *
 * @example
 * ```typescript
 * 'use client'
 *
 * import { createProcedureClient } from '@opensaas/stack-core/procedures/client'
 * import type { procedures } from '@/lib/procedures'
 *
 * const call = createProcedureClient<typeof procedures>()
 *
 * export async function createPost(title: string): Promise<string> {
 *   const result = await call('createPost', { title })
 *   if (result.success) return result.data.id
 *   if (result.error.code === 'transport') throw new Error('Could not reach the server')
 *   throw new Error(result.error.message)
 * }
 * ```
 */
export function createProcedureClient<TRegistry extends ProcedureRegistry<ProcedureHostContext>>(
  options: ProcedureClientOptions = {},
): ProcedureClient<TRegistry> {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const credentials = options.credentials ?? 'same-origin'
  const send = options.fetch ?? ((request: Request) => globalThis.fetch(request))

  return <TName extends keyof TRegistry & string>(
    name: TName,
    ...args: ProcedureCallArgs<TRegistry[TName]>
  ) =>
    exchange<ProcedureDataOf<TRegistry[TName]>, ProcedureCodeOf<TRegistry[TName]>>(
      send,
      `${baseUrl}/${name}`,
      credentials,
      args[0],
    )
}
