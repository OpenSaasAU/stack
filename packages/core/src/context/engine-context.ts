import type { AccessContext, Session } from '../access/types.js'
import type { StackBaseContext } from '../types/context.js'

/**
 * A context of either face. The generated `Context`, `BaseContext` and
 * `TransactionContext` all satisfy the first member whatever their `db` and
 * plugin services were instantiated as; the second is the engine's own view,
 * which a hook or an access rule already holds.
 *
 * A framework component or a plugin that takes a context from the app types its
 * parameter as this, and narrows with {@link engineContextOf} where it needs the
 * engine's face.
 */
export type AnyStackContext = StackBaseContext<object, Session, unknown> | AccessContext

/**
 * The key under which an app-facing context carries its engine face.
 *
 * `getContext` builds two objects: the engine's, which every hook and access
 * rule receives and which threads the ORM handle and the resolve chain, and
 * the app's, which exposes the secured `db`, the session and the deriving
 * operations and nothing of the plumbing. The link between them is this
 * property rather than a structural overlap, so the app-facing type stays free
 * of engine members and the narrowing has one thing to check.
 */
export const ENGINE_FACE: unique symbol = Symbol('opensaas.engineContext')

/** An object carrying its engine face — what `getContext` returns. */
export interface EngineFaced {
  readonly [ENGINE_FACE]: AccessContext
}

/**
 * Thrown by {@link engineContextOf} for a value the engine did not build — a
 * hand-assembled object carrying `db` and `session` and no engine face.
 */
export class EngineContextUnavailableError extends Error {
  constructor() {
    super(
      'The context is not one the engine built: it carries no engine face. Build it through ' +
        'the generated `getContext()`, or through `createTestContext` from ' +
        '@opensaas/stack-core/testing.',
    )
    this.name = 'EngineContextUnavailableError'
  }
}

const ENGINE_MEMBERS = ['ormHandle', 'db', 'session', '_resolveOutputChain'] as const

function isAccessContext(value: object): value is AccessContext {
  return ENGINE_MEMBERS.every((member) => member in value)
}

function isEngineFaced(value: object): value is EngineFaced {
  return ENGINE_FACE in value
}

/**
 * The engine's face of an app-facing context.
 *
 * The generated `Context` and the engine's `AccessContext` describe one request
 * from two sides: the app sees a `db` keyed and typed per list, the engine sees
 * the same `db` as an index signature it walks by list key, beside the ORM
 * handle and the resolve chain it threads through hooks. Neither type is
 * assignable to the other — a generated interface has no index signature
 * (ADR-0032), and the app-facing type deliberately omits engine plumbing — so a
 * component that holds the app's context and needs the engine's, to evaluate
 * an access rule or reach `db` by a key it computed, narrows through here. A
 * value already on the engine face is returned as it is.
 *
 * @throws {EngineContextUnavailableError} for a value the engine did not build.
 *
 * @example
 * ```typescript
 * export async function Dashboard({ context }: { context: AnyStackContext }) {
 *   const { db } = engineContextOf(context)
 *   const { total } = await db[listKey].aggregate((aggregate) => ({ total: aggregate.count() }))
 * }
 * ```
 */
export function engineContextOf(context: AnyStackContext): AccessContext {
  if (isEngineFaced(context)) return context[ENGINE_FACE]
  if (isAccessContext(context)) return context
  throw new EngineContextUnavailableError()
}
