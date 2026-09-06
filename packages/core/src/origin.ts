// The Engine stamp: the ambient origin a declared surface enters around the
// query it executes, the tripwire that refuses any plan compiled without one,
// and the refusal error. One module, installed identically by the generated
// context and by the test harness. See ADR-0059.

import { AsyncLocalStorage } from 'node:async_hooks'
import type { SqlMiddleware } from '@prisma/orm-postgres/family-runtime'

/**
 * Which declared surface is executing. The store carries this and nothing
 * else — no session, no list key, no operation. Scoping a query to a session
 * stays an ordinary rebind of the secured context (ADR-0012); the tripwire
 * holds no policy (ADR-0038).
 */
export type QueryOrigin = 'engine' | 'unsafe'

/**
 * The async-context store the executing surface enters and the tripwire
 * reads. Exported for surfaces that need the store directly — the Unsafe
 * surface's ORM proxy and the recording middleware — but a surface that only
 * needs to mark an execution should use {@link withOrigin} or
 * {@link preserveOrigin}, which enter it correctly.
 */
export const originStore = new AsyncLocalStorage<QueryOrigin>()

/** The origin of the current async context, or `undefined` outside any scope. */
export function currentOrigin(): QueryOrigin | undefined {
  return originStore.getStore()
}

/**
 * Thrown by {@link originTripwire} when a plan reaches `beforeCompile` with
 * no origin in scope — a query issued through neither the secured surface nor
 * the Unsafe surface.
 *
 * Fails closed in every environment: there is no warn mode and no dev-only
 * mode (ADR-0022, ADR-0038, ADR-0059). Thrown from `beforeCompile`, so a
 * refusal on a follow-up statement rolls back the ORM's implicit transaction,
 * and the error reaches the caller unwrapped — handle it like any other
 * engine error.
 */
export class UnmarkedQueryError extends Error {
  /** The plan's lane (`orm`, `dsl`, `raw`), as Prisma reports it. */
  public lane: string
  /** The AST kind of the refused plan (`select`, `insert`, …). */
  public kind: string

  constructor(lane: string, kind: string) {
    super(
      `Refused to execute an unmarked ${lane}/${kind} query: it reached the database through ` +
        `neither the secured surface (context.db) nor the Unsafe surface. Every query the stack ` +
        `executes is marked with its origin; a query bearing no mark belongs to no declared ` +
        `surface and cannot be shown to have passed access control, so it is refused rather ` +
        `than run unscoped. Route the query through context.db, or through the Unsafe surface ` +
        `if the bypass is intended.`,
    )
    this.name = 'UnmarkedQueryError'
    this.lane = lane
    this.kind = kind
  }
}

/**
 * Run `execute` inside `origin`, awaiting it in scope.
 *
 * The `await` is inside the scope on purpose: a terminal that returned a lazy
 * result from here would close the scope before the query ran (ADR-0059).
 * This is the helper for a surface that materialises — every engine terminal.
 * A surface that hands a lazy result back uses {@link preserveOrigin}.
 *
 * The scope must wrap the ORM call and nothing else. Hooks run outside it by
 * construction, so a hook's own read has to reach a declared surface and mark
 * itself; running a hook inside the engine's scope would silently bless it.
 *
 * `execute` returns a `PromiseLike<T>`, not a `Promise<T>`: an ORM read
 * terminal returns `AsyncIterableResult`, which has `then` but no `catch`,
 * `finally` or `Symbol.toStringTag`. `withOrigin` still returns a real
 * `Promise<T>`.
 */
export function withOrigin<T>(origin: QueryOrigin, execute: () => PromiseLike<T>): Promise<T> {
  return originStore.run(origin, async () => await execute())
}

/**
 * The consumed surface of Prisma's `AsyncIterableResult` — what a lazy result
 * offers a caller, and everything {@link preserveOrigin} re-enters the scope
 * around.
 */
export interface LazyQueryResult<Row> extends AsyncIterable<Row>, PromiseLike<Row[]> {
  [Symbol.asyncIterator](): AsyncIterator<Row>
  toArray(): Promise<Row[]>
  first(): Promise<Row | null>
  firstOrThrow(): Promise<Row>
  then<TResult1 = Row[], TResult2 = never>(
    onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null,
  ): PromiseLike<TResult1 | TResult2>
}

function inCallerScope<Args extends unknown[], Result>(
  caller: QueryOrigin | undefined,
  callback: ((...args: Args) => Result) | undefined | null,
): ((...args: Args) => Result) | undefined | null {
  if (callback === undefined || callback === null) return callback
  return (...args: Args): Result =>
    caller === undefined
      ? originStore.exit(() => callback(...args))
      : originStore.run(caller, () => callback(...args))
}

/**
 * Wrap a lazy result so every way of consuming it re-enters `origin`.
 *
 * The four terminals that return Prisma's `AsyncIterableResult` execute at the
 * first `then`/`next` rather than at the call, so a surface that must hand the
 * result back — the Unsafe surface's `query()`, the ORM-lane proxy — cannot
 * simply return it from inside a scope: the scope closes first and the query
 * is refused. Each of `then`, `toArray`, `first`, `firstOrThrow` and the async
 * iterator's `next` therefore enters the scope around the underlying call, so
 * the query executes marked whenever and wherever the caller consumes it.
 * Laziness and streaming are unchanged (ADR-0056, ADR-0059).
 *
 * The scope covers the underlying execution only. Callbacks the caller passes
 * to `then` run under the caller's own origin — `undefined` when the caller is
 * outside any scope — so a continuation is never blessed by the wrapper.
 *
 * Known limits: {@link LazyQueryResult} mirrors `AsyncIterableResult` as
 * published in Prisma `8.0.0-rc.8`, whose whole public surface is the five
 * members declared here. The wrapper returns an object literal, so
 * `instanceof AsyncIterableResult` is false downstream, and a member added in
 * a later release is dropped silently rather than flagged by the compiler —
 * re-check this shape when the pinned ORM version moves.
 */
export function preserveOrigin<Row>(
  origin: QueryOrigin,
  result: LazyQueryResult<Row>,
): LazyQueryResult<Row> {
  const enter = <T>(call: () => T): T => originStore.run(origin, call)

  return {
    [Symbol.asyncIterator](): AsyncIterator<Row> {
      const iterator = enter(() => result[Symbol.asyncIterator]())
      const scoped: AsyncIterator<Row> = {
        next: (...args) => enter(() => iterator.next(...args)),
      }
      const onReturn = iterator.return
      if (onReturn) scoped.return = (value) => enter(() => onReturn.call(iterator, value))
      const onThrow = iterator.throw
      if (onThrow) scoped.throw = (reason) => enter(() => onThrow.call(iterator, reason))
      return scoped
    },
    toArray: () => enter(() => result.toArray()),
    first: () => enter(() => result.first()),
    firstOrThrow: () => enter(() => result.firstOrThrow()),
    then: (onfulfilled, onrejected) => {
      const caller = originStore.getStore()
      return enter(() =>
        result.then(inCallerScope(caller, onfulfilled), inCallerScope(caller, onrejected)),
      )
    },
  }
}

/**
 * The part of a draft plan the tripwire reads: its lane and its AST kind,
 * both only to name what was refused. Prisma's `DraftPlan` satisfies this
 * structurally; the narrower shape is what makes the decision callable — and
 * testable — without a whole middleware context.
 */
export interface DraftPlanIdentity {
  readonly meta: { readonly lane: string }
  readonly ast: { readonly kind: string }
}

/**
 * The tripwire's whole decision: throw {@link UnmarkedQueryError} when no
 * origin is in scope, and otherwise do nothing. Either present value passes —
 * only an absent mark is rejected (ADR-0038) — and there is no warn mode and
 * no dev-only mode (ADR-0022, ADR-0059).
 */
export function refuseUnmarkedQuery(draft: DraftPlanIdentity): void {
  if (originStore.getStore() === undefined) {
    throw new UnmarkedQueryError(draft.meta.lane, draft.ast.kind)
  }
}

/**
 * The stack-owned tripwire: refuses any plan compiled with no origin in scope.
 *
 * Registered as the client's `beforeCompile` middleware by the generated
 * context and by the test harness, both of which install this same value.
 * It reads the origin and nothing else — it carries no policy and no session
 * (ADR-0038). It never rewrites the plan.
 *
 * Known limits, against Prisma `8.0.0-rc.8`: a prepared statement runs
 * `beforeCompile` once at `prepare()` and zero times per execution, so neither
 * surface exposes `prepare()` or `runtime()`; an already-compiled
 * `ExecutionPlan` handed to `runtime()` bypasses the middleware chain
 * entirely. Both are closed by keeping those entry points unreachable, not
 * here (ADR-0059).
 *
 * `beforeCompile` declares only the part of the draft it reads and ignores the
 * middleware context, which is what lets a test drive the installed value
 * itself rather than the decision it delegates to.
 */
export const originTripwire = {
  name: 'opensaas-origin-tripwire',
  familyId: 'sql',
  async beforeCompile(draft: DraftPlanIdentity): Promise<undefined> {
    refuseUnmarkedQuery(draft)
    return undefined
  },
} satisfies SqlMiddleware
