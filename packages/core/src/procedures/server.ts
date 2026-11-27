import type * as z from 'zod'
import { rethrowControlFlow } from '../access/decide-advertisement.js'
import type { OpenSaasConfig } from '../config/types.js'
import type { SessionOf } from './http.js'
import type { Procedure, ProcedureHostContext, ProcedureRegistry } from './procedure.js'
import { failure, isReservedFailureCode, type ProcedureResult } from './result.js'
import { guardReporter, runProcedure, type UnexpectedErrorReporter } from './run.js'
import { assertProcedureRegistry, ProcedureHostError } from './validate.js'
import { webProcedureOf, webSessionOf } from './web-session.js'

/** The application context the procedures of `TRegistry` are typed to. */
export type RegistryContextOf<TRegistry> =
  TRegistry[keyof TRegistry] extends Procedure<
    infer C extends ProcedureHostContext,
    infer _TIn,
    infer _TOut,
    infer _TCode
  >
    ? C
    : never

type InputOf<TProcedure> =
  TProcedure extends Procedure<infer _C, infer TIn, infer _TOut, infer _TCode>
    ? z.input<TIn>
    : never

type DataOf<TProcedure> =
  TProcedure extends Procedure<infer _C, infer _TIn, infer TOut, infer _TCode>
    ? z.output<TOut>
    : never

type CodeOf<TProcedure> =
  TProcedure extends Procedure<infer _C, infer _TIn, infer _TOut, infer TCode> ? TCode : never

type IsUnion<T, TAll = T> = T extends unknown ? ([TAll] extends [T] ? false : true) : never

type CallArgs<TProcedure> =
  undefined extends InputOf<TProcedure>
    ? [input?: InputOf<TProcedure>]
    : [input: InputOf<TProcedure>]

/**
 * The arguments after the name: the input, which may be left out only when
 * the procedure's input schema accepts `undefined`. A name typed as a union of
 * names takes no input that type-checks; narrow it to one procedure first.
 */
export type ServerCallArgs<TRegistry, TName extends keyof TRegistry> =
  true extends IsUnion<TName> ? [input: never] : CallArgs<TRegistry[TName]>

/**
 * The names the in-process caller of `TRegistry` accepts. A registry type that
 * admits any string as a name, as one annotated `ProcedureRegistry<Context>`
 * does, admits none: declare it with `satisfies` instead.
 */
export type ServerProcedureName<TRegistry> = string extends keyof TRegistry
  ? never
  : keyof TRegistry & string

/**
 * What an in-process call of `TProcedure` resolves to: its parsed output, or a
 * failure whose code is a reserved code or one the procedure declares. The
 * same result `ProcedureResultOf` names, with no transport failure.
 */
export type ServerCallResultOf<TProcedure> = ProcedureResult<DataOf<TProcedure>, CodeOf<TProcedure>>

/** Options for {@link createServerCaller}. */
export interface ServerCallerOptions<TRegistry extends ProcedureRegistry<ProcedureHostContext>> {
  /** The application's procedure registry. Only procedures exposing `'web'` are callable. */
  procedures: TRegistry
  /**
   * The resolved config, checked against the registry as `createProcedureHandler`
   * checks it. Pass `await config` from `.opensaas/context.ts`: its
   * `isFrameworkControlFlow` is what lets a framework's control flow the
   * built-in check does not know reach the framework.
   */
  config?: OpenSaasConfig
  /** The generated `getContext`: called with the resolved session, or with nothing when anonymous. */
  getContext: (
    session?: SessionOf<RegistryContextOf<TRegistry>>,
  ) => Promise<RegistryContextOf<TRegistry>>
  /**
   * Resolve the current request's session from the server, as from the
   * request's cookies, and never from anything a caller passes. Called once
   * per call and once per `context()`, and never cached, so two requests
   * never share a session. Resolving `null` or `undefined` means anonymous.
   *
   * The caller sets `session.actor` to a human actor carrying the session's
   * own `userId`, exactly as `createProcedureHandler` does: `userId` must be
   * an own property holding a non-empty string or a finite number.
   */
  getSession: () => Promise<SessionOf<RegistryContextOf<TRegistry>> | null | undefined>
  /**
   * Told of every failure the operator should see, with the procedure's name,
   * as `createProcedureHandler`'s option of the same name is. Default
   * `console.error`.
   */
  onUnexpectedError?: UnexpectedErrorReporter
}

/** The in-process caller {@link createServerCaller} returns. */
export interface ServerCaller<TRegistry extends ProcedureRegistry<ProcedureHostContext>> {
  /**
   * Call a procedure exposed to `'web'` by name, as the session `getSession`
   * resolves for the current request. Never throws for an outcome of the
   * pipeline: it resolves to `{ success: true, data }` or
   * `{ success: false, error: { code, message, fieldErrors? } }`. A
   * framework's control flow (`redirect()`, `notFound()`) thrown from the
   * session resolver, the access rule or `run` is rethrown, so the framework
   * acts on it; a transaction it leaves is rolled back first.
   */
  call: <TName extends ServerProcedureName<TRegistry>>(
    name: TName,
    ...args: ServerCallArgs<TRegistry, TName>
  ) => Promise<ServerCallResultOf<TRegistry[TName]>>
  /**
   * The context for the current request's session, for a server component's
   * reads through `context.db`. The session carries the same human actor a
   * call does. Rejects with what resolving the session threw, a
   * `ProcedureHostError` for a session with no usable `userId`, or the
   * `InvalidSessionError` `getContext` throws.
   */
  context: () => Promise<RegistryContextOf<TRegistry>>
}

function defaultUnexpectedError(error: unknown, procedureName: string): void {
  console.error(`Procedure "${procedureName}" failed:`, error)
}

function isOutcomeOf<TData, TCode extends string>(
  procedure: Procedure<ProcedureHostContext>,
  result: ProcedureResult<unknown, string>,
): result is ProcedureResult<TData, TCode> {
  if (result.success) return true
  const { code } = result.error
  return isReservedFailureCode(code) || Object.hasOwn(procedure.failures, code)
}

/**
 * The in-process host for server code: a server action, a route handler or a
 * job that runs inside a request. `call` runs a procedure through the same
 * pipeline as `createProcedureHandler`, with the same exposure, access rule,
 * input and output parsing, declared failures, result and redaction, and
 * `context` gives a server component the context for the same session.
 *
 * Neither takes a session. Each resolves it with `getSession` on every call,
 * and the session carries a human actor the caller sets itself. A procedure
 * not exposed to `'web'` answers exactly as an unknown name does: `INTERNAL`,
 * reported to `onUnexpectedError`. Unlike the HTTP host, a framework's control
 * flow propagates, so a procedure may `redirect()`; over HTTP it is `INTERNAL`.
 *
 * Keep the module that creates the caller the one place that imports the
 * generated `getContext`, and export `call` and `context` from it.
 *
 * @typeParam TRegistry - the registry's own type. Declare the registry with
 *   `satisfies ProcedureRegistry<Context>` rather than annotating it, so each
 *   name keeps its own procedure type.
 *
 * @throws {ProcedureHostError} for a registry a host refuses. See {@link assertProcedureRegistry}.
 *
 * @example
 * ```typescript
 * // lib/server.ts
 * import { createServerCaller } from '@opensaas/stack-core/procedures'
 * import { config, getContext } from '@/.opensaas/context'
 * import { procedures } from '@/lib/procedures'
 * import { getSession } from '@/lib/auth'
 *
 * const server = createServerCaller({
 *   procedures,
 *   config: await config,
 *   getContext,
 *   getSession,
 * })
 *
 * export const callProcedure = server.call
 * export const getServerContext = server.context
 * ```
 */
export function createServerCaller<TRegistry extends ProcedureRegistry<ProcedureHostContext>>(
  options: ServerCallerOptions<TRegistry>,
): ServerCaller<TRegistry> {
  const { procedures, getContext, getSession } = options
  const onUnexpectedError = guardReporter(options.onUnexpectedError ?? defaultUnexpectedError)
  const isFrameworkControlFlow = options.config?.isFrameworkControlFlow
  assertProcedureRegistry(procedures, { config: options.config })

  const context = async (): Promise<RegistryContextOf<TRegistry>> => {
    const session = webSessionOf(await getSession())
    return session === null ? getContext() : getContext(session)
  }

  async function invoke<TData, TCode extends string>(
    name: string,
    input: unknown,
  ): Promise<ProcedureResult<TData, TCode>> {
    const procedure = webProcedureOf(procedures, name)
    if (procedure === undefined) {
      onUnexpectedError(
        new ProcedureHostError(`No procedure named "${name}" is exposed to 'web'.`),
        name,
      )
      return failure('INTERNAL')
    }
    const result = await runProcedure({
      name,
      procedure,
      context,
      readInput: () => ({ ok: true, value: input }),
      onUnexpectedError,
      propagate: (error) => rethrowControlFlow(error, isFrameworkControlFlow),
    })
    if (isOutcomeOf<TData, TCode>(procedure, result)) return result
    onUnexpectedError(
      new ProcedureHostError(`Procedure "${name}" failed with a code it does not declare.`),
      name,
    )
    return failure('INTERNAL')
  }

  return {
    call: <TName extends ServerProcedureName<TRegistry>>(
      name: TName,
      ...args: ServerCallArgs<TRegistry, TName>
    ) => invoke<DataOf<TRegistry[TName]>, CodeOf<TRegistry[TName]>>(name, args[0]),
    context,
  }
}
