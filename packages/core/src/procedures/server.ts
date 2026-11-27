import { controlFlowPredicateOf, rethrowControlFlow } from '../access/decide-advertisement.js'
import type { OpenSaasConfig } from '../config/types.js'
import { engineFaceOf } from '../context/engine-context.js'
import type {
  ProcedureArgsFor,
  ProcedureCodeOf,
  ProcedureDataOf,
  ProcedureNameOf,
} from './client.js'
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

/** Options for {@link createServerCaller}. */
export interface ServerCallerOptions<TRegistry extends ProcedureRegistry<ProcedureHostContext>> {
  /** The application's procedure registry. Only procedures exposing `'web'` are callable. */
  procedures: TRegistry
  /**
   * The resolved config, checked against the registry as `createProcedureHandler`
   * checks it. Pass `await config` from `.opensaas/context.ts`. A framework's
   * control flow is recognised by the built-in check and by the
   * `isFrameworkControlFlow` of the config the context carries; this config's
   * is the fallback, and the only one consulted for a throw from `getSession`,
   * which happens before there is a context.
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
   * never share a session; wrapping it in React's `cache()` to share one
   * lookup across a render is safe, since that cache is per request.
   * Resolving `null` or `undefined` means anonymous.
   *
   * The caller sets `session.actor` to a human actor carrying the session's
   * own `userId`, exactly as `createProcedureHandler` does: `userId` must be
   * an own property holding a non-empty string or a finite number.
   *
   * **The caller performs no cookie or `Origin` check.** Whatever this
   * resolves is acted on as the signed-in person. In a Next.js server action
   * the cross-site protection is Next's own server-action `Origin` check, and
   * only there; widening `serverActions.allowedOrigins` widens this caller's
   * exposure too. A route handler that calls `call` for a mutation must not
   * answer `GET` and must check the request's origin itself, or serve the
   * procedure through `createProcedureHandler` instead. Outside a request (a
   * job, a script) there is no person to act for: this must resolve `null`,
   * because any session it resolves there still gets
   * `{ kind: 'human', userId, via: 'web' }`.
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
   *
   * The name's type is every key of the registry and does not reflect
   * exposure: a procedure exposed only to `'mcp'` type-checks here, and at
   * runtime answers `INTERNAL`, reported, as an unknown name does.
   */
  call: <TName extends ProcedureNameOf<TRegistry>>(
    name: TName,
    ...args: ProcedureArgsFor<TRegistry, TName>
  ) => Promise<
    ProcedureResult<ProcedureDataOf<TRegistry[TName]>, ProcedureCodeOf<TRegistry[TName]>>
  >
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
 * The in-process host for server code running inside a request: a Next.js
 * server action, and a server component through `context`. `call` runs a procedure through the same
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
 * **It performs no cookie or `Origin` check of its own.** A server action is
 * protected by Next's server-action `Origin` check and nothing else, and
 * widening `serverActions.allowedOrigins` widens this caller too. A route
 * handler calling `call` for a mutation must answer only non-`GET` methods
 * and check the origin itself, or serve the procedure through
 * `createProcedureHandler`. A job or script outside a request must have
 * `getSession` resolve `null`: any session it resolves there is acted on as
 * a human on the web.
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

  const contextFor = (
    session: SessionOf<RegistryContextOf<TRegistry>> | null,
  ): Promise<RegistryContextOf<TRegistry>> =>
    session === null ? getContext() : getContext(session)

  const context = async (): Promise<RegistryContextOf<TRegistry>> =>
    contextFor(webSessionOf(await getSession()))

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

    let session: SessionOf<RegistryContextOf<TRegistry>> | null
    try {
      session = webSessionOf(await getSession())
    } catch (error) {
      rethrowControlFlow(error, isFrameworkControlFlow)
      onUnexpectedError(error, name)
      return failure('INTERNAL')
    }

    let resolved: RegistryContextOf<TRegistry> | undefined
    const result = await runProcedure({
      name,
      procedure,
      context: async () => {
        resolved = await contextFor(session)
        return resolved
      },
      readInput: () => ({ ok: true, value: input }),
      onUnexpectedError,
      propagate: (error) => {
        const engine = resolved === undefined ? undefined : engineFaceOf(resolved)
        rethrowControlFlow(
          error,
          engine === undefined
            ? isFrameworkControlFlow
            : controlFlowPredicateOf(engine, options.config),
        )
      },
    })
    if (isOutcomeOf<TData, TCode>(procedure, result)) return result
    onUnexpectedError(
      new ProcedureHostError(`Procedure "${name}" failed with a code it does not declare.`),
      name,
    )
    return failure('INTERNAL')
  }

  return {
    call: <TName extends ProcedureNameOf<TRegistry>>(
      name: TName,
      ...args: ProcedureArgsFor<TRegistry, TName>
    ) =>
      invoke<ProcedureDataOf<TRegistry[TName]>, ProcedureCodeOf<TRegistry[TName]>>(name, args[0]),
    context,
  }
}
