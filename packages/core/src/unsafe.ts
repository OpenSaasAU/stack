import type {
  RuntimeScope,
  SqlOrmPlan,
  SqlStatementStats,
} from '@prisma/orm-postgres/relational-core'
import { originStore, preserveOrigin, withOrigin, type LazyQueryResult } from './origin.js'

/**
 * The part of a Prisma 8 client the Unsafe surface is built from.
 *
 * Structural rather than `PostgresClient<TContract>` so a client typed by an
 * application's own emitted contract is accepted without a cast at the seam.
 * The lanes are declared as `object` here and re-projected through
 * {@link UnsafeSurface}, which keeps each lane's precise type for a caller
 * that constructs the surface from a concretely-typed client.
 */
export interface UnsafeCapableClient {
  readonly sql: object
  readonly raw: object
  readonly orm: object
  runtime(): RuntimeScope
  transaction<R>(fn: (tx: UnsafeTransactionScope) => PromiseLike<R>): Promise<R>
}

/**
 * Prisma's transaction context, as the Unsafe surface uses it: an executor
 * pair plus the connection-bound builders. It carries no `raw` lane — that one
 * is contract-scoped and lives on the client (ADR-0056, ADR-0062).
 */
export interface UnsafeTransactionScope<
  TClient extends UnsafeCapableClient = UnsafeCapableClient,
> extends RuntimeScope {
  readonly sql: TClient['sql']
  readonly orm: TClient['orm']
}

/**
 * The deliberately unsecured surface: Prisma's own query lanes, with every
 * execution marked as intentionally unscoped so the tripwire lets it through.
 *
 * **Everything the secured surface does, this one skips.** No Access Filter,
 * no Field Visibility, no `resolveOutput`, no computed fields, no hooks, and
 * no error normalisation — a failure here arrives as the raw driver error.
 * Scoping a query is the caller's alone. Reaching for this is a visible act;
 * say why at the call site. What it does get: codec-decoded values, Prisma's
 * streaming result, and the full builder (ADR-0056).
 *
 * - `sql` and `raw` are Prisma's typed SQL builder and raw tag, untouched.
 * - `query(plan)` returns Prisma's lazy, streaming result, so a bulk read can
 *   be consumed with a cursor; `execute(plan)` returns statement statistics.
 * - `orm` is a transparent proxy over Prisma's collections. Every call is
 *   marked, and a returned collection is re-proxied, so a chain built here and
 *   run later is still marked.
 *
 * Neither the bare client nor `prepare()`/`runtime()` is reachable: a prepared
 * statement runs `beforeCompile` once at `prepare()` and never per execution,
 * and an already-compiled plan handed to `runtime()` bypasses the middleware
 * chain entirely, so either would execute unobserved (ADR-0059).
 *
 * Known limits:
 * - Prisma's raw guardrails (`lints()`, `budgets()`) are opt-in middleware and
 *   the stack installs none, here or on the client. A statement this surface
 *   runs meets whatever an application armed, and nothing else (ADR-0062).
 * - The lanes' types are only as precise as the client the surface was built
 *   from. The context's own surface is built through {@link UnsafeCapableClient},
 *   so its lanes are structural; instantiating them over the app's emitted
 *   contract belongs to the generated bundle (ADR-0052).
 *
 * @example
 * ```typescript
 * const rows = context.unsafe.query(
 *   context.unsafe.sql.public.Post.select({ id: true }).build(),
 * )
 * for await (const row of rows) {
 *   // consumed outside any scope, still marked
 * }
 * ```
 */
export interface UnsafeSurface<TClient extends UnsafeCapableClient = UnsafeCapableClient> {
  /** Prisma's typed SQL builder, untouched. Plans are unmarked until run. */
  readonly sql: TClient['sql']
  /** Prisma's raw tag, untouched. Contract-scoped, so it is the same in a transaction. */
  readonly raw: TClient['raw']
  /** Prisma's collections behind a transparent, marking proxy. */
  readonly orm: TClient['orm']
  /** Run a plan for rows, lazily, marked wherever the result is consumed. */
  query<Row>(plan: SqlOrmPlan<Row>): LazyQueryResult<Row>
  /** Run a plan for statistics. */
  execute(plan: SqlOrmPlan): Promise<SqlStatementStats>
}

function isRecord(value: unknown): value is Record<string | symbol, unknown> {
  return typeof value === 'object' && value !== null
}

function hasMethod(value: Record<string | symbol, unknown>, key: string | symbol): boolean {
  return typeof value[key] === 'function'
}

/**
 * Prisma's `AsyncIterableResult`, recognised structurally. A `Promise` shares
 * only `then`, so all five members are required before the value is treated as
 * a lazy result rather than as something already awaited.
 */
function isLazyResult(value: unknown): value is LazyQueryResult<unknown> {
  return (
    isRecord(value) &&
    hasMethod(value, 'then') &&
    hasMethod(value, 'toArray') &&
    hasMethod(value, 'first') &&
    hasMethod(value, 'firstOrThrow') &&
    hasMethod(value, Symbol.asyncIterator)
  )
}

function isThenable(value: unknown): boolean {
  return isRecord(value) && hasMethod(value, 'then')
}

/**
 * A property the proxy must hand back untouched: a proxy whose `get` returns
 * anything other than the target's own value for a non-writable,
 * non-configurable data property is a `TypeError`.
 */
function isInvariantProperty(target: object, key: string | symbol): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(target, key)
  return (
    descriptor !== undefined &&
    descriptor.configurable === false &&
    descriptor.writable === false &&
    !('get' in descriptor)
  )
}

function markResult(value: unknown): unknown {
  if (isLazyResult(value)) return preserveOrigin('unsafe', value)
  if (isThenable(value)) return value
  if (typeof value === 'object' && value !== null) return markCalls(value)
  return value
}

/**
 * Wrap `target` so every method call it exposes runs in the unsafe origin,
 * every object it returns is wrapped the same way, and every lazy result it
 * returns is scope-preserved.
 *
 * A proxy rather than a mirrored method list: the ORM lane's surface is
 * Prisma's, and chasing it would be the "mirror the full DSL" ADR-0041
 * rejected. The proxy's type is the target's, so nothing about the caller's
 * view changes (ADR-0059).
 *
 * Reads go through `Reflect.get(target, key)` with the target as receiver, not
 * the proxy: Prisma's collections are class instances with private fields, and
 * a private read against the proxy would throw.
 */
function markCalls<T extends object>(target: T): T {
  return new Proxy(target, {
    get(receiverTarget: T, key: string | symbol): unknown {
      const value = Reflect.get(receiverTarget, key)
      if (isInvariantProperty(receiverTarget, key)) return value
      if (typeof value === 'function') {
        return (...args: unknown[]): unknown =>
          markResult(originStore.run('unsafe', () => Reflect.apply(value, receiverTarget, args)))
      }
      return markResult(value)
    },
  })
}

function executors(scope: RuntimeScope): Pick<UnsafeSurface, 'query' | 'execute'> {
  return {
    query: <Row>(plan: SqlOrmPlan<Row>): LazyQueryResult<Row> =>
      preserveOrigin('unsafe', scope.query(plan)),
    execute: (plan: SqlOrmPlan): Promise<SqlStatementStats> =>
      withOrigin('unsafe', () => scope.execute(plan)),
  }
}

/**
 * Build the {@link UnsafeSurface} over a Prisma 8 client.
 *
 * `runtime()` is resolved per execution rather than captured here, so the
 * client stays as lazy about opening its pool as it was before the surface
 * existed, and the executor is never handed out.
 */
export function createUnsafeSurface<TClient extends UnsafeCapableClient>(
  client: TClient,
): UnsafeSurface<TClient> {
  return {
    sql: client.sql,
    raw: client.raw,
    orm: markCalls(client.orm),
    query: <Row>(plan: SqlOrmPlan<Row>): LazyQueryResult<Row> =>
      executors(client.runtime()).query(plan),
    execute: (plan: SqlOrmPlan): Promise<SqlStatementStats> =>
      executors(client.runtime()).execute(plan),
  }
}

/**
 * The transaction-bound {@link UnsafeSurface}: the same builders, executing
 * through the transaction's own executor.
 *
 * The raw tag comes from the client because Prisma's transaction context
 * carries none — it is contract-scoped, built once per client, and the plans
 * it mints run wherever they are handed (ADR-0056, ADR-0062). Without this
 * shape a script inside `context.transaction` would have to close over the
 * outer client and hand plans to a `tx` it cannot reach.
 */
export function createUnsafeTransactionSurface<TClient extends UnsafeCapableClient>(
  client: TClient,
  tx: UnsafeTransactionScope<TClient>,
): UnsafeSurface<TClient> {
  return {
    sql: tx.sql,
    raw: client.raw,
    orm: markCalls(tx.orm),
    ...executors(tx),
  }
}

/**
 * Thrown by every member of the surface a context built without a Prisma 8
 * client carries.
 *
 * The context factory takes the client as an option, so a context assembled
 * without one — a unit test's hand-built double, most often — has no lanes to
 * offer. Refusing loudly is the alternative to typing `context.unsafe` as
 * possibly absent, which would push a null check onto every real caller.
 */
export class UnsafeSurfaceUnavailableError extends Error {
  constructor(readonly member: string) {
    super(
      `context.unsafe.${member} is unavailable: this context was built without a Prisma 8 client. ` +
        `The Unsafe surface is Prisma's own query lanes, so a context assembled from anything else ` +
        `has none to hand out. Build the context through the generated \`getContext()\`, or through ` +
        `\`createTestContext\` from @opensaas/stack-core/testing.`,
    )
    this.name = 'UnsafeSurfaceUnavailableError'
  }
}

function refuse(member: string): never {
  throw new UnsafeSurfaceUnavailableError(member)
}

/**
 * The surface a context built without a client carries: same shape, every
 * member a refusal.
 */
export function unavailableUnsafeSurface(): UnsafeSurface {
  return {
    get sql(): object {
      return refuse('sql')
    },
    get raw(): object {
      return refuse('raw')
    },
    get orm(): object {
      return refuse('orm')
    },
    query: () => refuse('query'),
    execute: () => refuse('execute'),
  }
}
