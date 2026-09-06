// The secured read surface: `context.db.<List>` as an opaque wrapper over a
// Prisma 8 collection, its `where`/`orderBy` composition, and the
// `all()`/`first()`/`nearest()` terminals the engine owns. See ADR-0041,
// ADR-0044, ADR-0045, ADR-0046, ADR-0055 and ADR-0058.

import type { AnyExpression, OrderByItem } from '@prisma/orm-postgres/relational-core'
import type { OpenSaasConfig, ListConfig, TypeInfo } from '../config/types.js'
import type { AccessContext, OrmClient, OrmRow, PrismaFilter, Session } from '../access/types.js'
import { checkAccess, filterReadableFields } from '../access/index.js'
import { withOrigin } from '../origin.js'
import {
  lowerOrder,
  lowerWhere,
  vectorLowering,
  whereCombinators,
  type PredicateAccessor,
  type WhereCombinators,
} from './lower.js'
import {
  resolveNearest,
  resolveOrderBy,
  resolveWhere,
  type NearestOptions,
  type NearestPlan,
  type OrderBy,
  type OrderPlan,
  type ResolveContext,
  type Where,
  type WherePlan,
} from './vocabulary.js'
import { distanceToScore, requireVector, vectorDistance } from './vector.js'

export { AccessFilterRecursionError, ACCESS_FILTER_MAX_DEPTH } from './vocabulary.js'
export { NEAREST_DEFAULT_LIMIT } from './vocabulary.js'
export type {
  NearestOptions,
  OrderBy,
  OrderDirection,
  RelationCondition,
  ScalarOperators,
  Where,
  WhereCondition,
  WhereValue,
} from './vocabulary.js'
export type { VectorColumnDescriptor, VectorDistanceFunction } from './vector.js'
export { VectorDecodeError } from './vector.js'

/**
 * A composed read: an immutable value carrying the list, the predicates and
 * nothing that can execute unscoped. `where` and `orderBy` return a new value;
 * the terminals are the only way to reach the database.
 *
 * Rows are untyped here for the same reason the rest of the engine's own view
 * is: the per-list shapes live in the generated bundle, which instantiates
 * `SecuredList` from the emitted contract (ADR-0052).
 */
export interface SecuredQuery<TRow = OrmRow> {
  /** Narrow the read. Composes; nothing is enforced until a terminal runs. */
  where(predicate: Where): SecuredQuery<TRow>
  /** Sort the read by the list's own scalar columns. */
  orderBy(order: OrderBy | readonly OrderBy[]): SecuredQuery<TRow>
  /** Every row this session may see. `[]` when the read is denied. */
  all(): Promise<TRow[]>
  /** The first row this session may see, or `null` — denied or absent alike. */
  first(): Promise<TRow | null>
  /**
   * The rows nearest `vector` by the embedding field's own distance function,
   * scoped exactly as any other read. `[]` when the read is denied.
   *
   * The ranking, the `limit` and the `minScore` bound are all inside one
   * query, alongside the Access Filter — so the top-K is computed over the
   * rows this session may see rather than filtered down afterwards
   * (ADR-0045). Searching requires read access to `field`: ordering by a
   * vector measures its contents, so a session that cannot read it is refused
   * exactly as it would be for a field the list does not declare.
   */
  nearest(
    field: string,
    vector: readonly number[],
    options?: NearestOptions,
  ): Promise<NearestMatch<TRow>[]>
}

/**
 * One vector-search hit. A wrapper rather than a row, so `item` still matches
 * the caller's selection exactly and the score sits beside it instead of
 * arriving as a field the list does not have (ADR-0045).
 */
export interface NearestMatch<TRow = OrmRow> {
  /** The row, through Field Visibility like any other read. */
  item: TRow
  /**
   * Similarity in the field's own terms; the raw distance is not exposed.
   *
   * The database owns the ordering. This number is the same function
   * recomputed here from the row's own vector, in float64 over a float4
   * column, so at a tie two rows can arrive in an order their scores do not
   * reproduce — do not treat it as the sort key.
   */
  score: number
}

/**
 * Thrown when the ORM client carries no collection for a list the config
 * declares — a generation or wiring fault rather than an access denial, so it
 * is reported rather than silently read as an empty result.
 */
export class SecuredCollectionMissingError extends Error {
  constructor(readonly listName: string) {
    super(
      `The ORM client has no collection for list "${listName}". Re-run \`opensaas generate\` so ` +
        `the emitted contract matches the config.`,
    )
    this.name = 'SecuredCollectionMissingError'
  }
}

/**
 * The part of a Prisma 8 collection the read path drives, structurally.
 * `where` appends a predicate — repeated calls are AND-combined by the ORM,
 * which is what makes the Access Filter a second entry rather than a merge.
 */
interface ReadableCollection {
  where(predicate: (model: PredicateAccessor) => AnyExpression): ReadableCollection
  orderBy(selection: readonly ((model: PredicateAccessor) => OrderByItem)[]): ReadableCollection
  limit(rows: number): ReadableCollection
  all(): PromiseLike<OrmRow[]>
  first(): Promise<OrmRow | null>
}

function isReadableCollection(value: unknown): value is ReadableCollection {
  if (typeof value !== 'object' || value === null) return false
  for (const member of ['where', 'orderBy', 'limit', 'all', 'first']) {
    if (typeof Reflect.get(value, member) !== 'function') return false
  }
  return true
}

function collectionFor(ormHandle: OrmClient, listName: string): ReadableCollection {
  const collection = ormHandle[listName]
  if (!isReadableCollection(collection)) throw new SecuredCollectionMissingError(listName)
  return collection
}

interface ReadBinding {
  listName: string
  listConfig: ListConfig<TypeInfo>
  ormHandle: OrmClient
  context: AccessContext
  config: OpenSaasConfig
}

interface QueryState {
  readonly predicates: readonly Where[]
  readonly orders: readonly OrderBy[]
}

/** A resolved read: the predicates to AND, and the sort to apply. */
interface ReadPlan {
  readonly predicates: readonly WherePlan[]
  readonly orders: readonly OrderPlan[]
}

function resolveContext(binding: ReadBinding, secured: boolean): ResolveContext {
  return {
    listName: binding.listName,
    listConfig: binding.listConfig,
    config: binding.config,
    session: binding.context.session,
    context: binding.context,
    checkFieldRead: secured,
    applyRelationAccess: secured,
    accessFilterPath: [],
  }
}

/**
 * Resolve the read: operation access first, then the vocabulary.
 *
 * The order matters. Resolution names the offending key, so running it before
 * the access check would tell a caller with no access at all that a field
 * exists and whether it is read-gated (#912, #915). A denied caller gets the
 * Silent failure and never sees a validation error.
 *
 * `sudo` skips access but not the vocabulary: an unknown key or operator is a
 * bug rather than a permission, and letting it through would widen the read
 * with a flag on it (ADR-0022, ADR-0055).
 */
async function resolvePlan(binding: ReadBinding, state: QueryState): Promise<ReadPlan | null> {
  const { listConfig, context } = binding
  const session: Session | null = context.session
  const secured = context._isSudo !== true
  const ctx = resolveContext(binding, secured)

  const access = secured
    ? await checkAccess(listConfig.access?.operation?.query, { session, context })
    : true
  if (access === false) return null

  const predicates: WherePlan[] = []
  for (const predicate of state.predicates) {
    predicates.push(await resolveWhere(predicate, ctx))
  }
  const orders = await resolveOrderBy(state.orders, ctx)

  if (access !== true) {
    const filter: PrismaFilter = access
    // The Access Filter is trusted config, so its keys are not read-gated —
    // but it is lowered through the same total seam, which is what stops a
    // rule that resolved to `undefined` from matching every row.
    predicates.push(
      await resolveWhere(filter, {
        ...resolveContext(binding, true),
        checkFieldRead: false,
        accessFilterPath: [binding.listName],
      }),
    )
  }

  return { predicates, orders }
}

function scope(binding: ReadBinding, plan: ReadPlan, ops: WhereCombinators): ReadableCollection {
  let collection = collectionFor(binding.ormHandle, binding.listName)
  for (const predicate of plan.predicates) {
    collection = collection.where((model) => lowerWhere(predicate, model, ops))
  }
  if (plan.orders.length > 0) {
    collection = collection.orderBy(
      plan.orders.map((order) => (model: PredicateAccessor) => lowerOrder(order, model)),
    )
  }
  return collection
}

function visible(binding: ReadBinding, row: OrmRow): Promise<OrmRow> {
  const { listConfig, context, config, listName } = binding
  return filterReadableFields(
    row,
    listConfig.fields,
    { session: context.session, context },
    config,
    0,
    listName,
  )
}

async function runAll(binding: ReadBinding, state: QueryState): Promise<OrmRow[]> {
  const plan = await resolvePlan(binding, state)
  if (plan === null) return []
  const collection = scope(binding, plan, await whereCombinators())
  const rows = await withOrigin('engine', () => collection.all())
  return await Promise.all(rows.map((row) => visible(binding, row)))
}

async function runFirst(binding: ReadBinding, state: QueryState): Promise<OrmRow | null> {
  const plan = await resolvePlan(binding, state)
  if (plan === null) return null
  const collection = scope(binding, plan, await whereCombinators())
  const row = await withOrigin('engine', () => collection.first())
  return row === null ? null : await visible(binding, row)
}

/**
 * A row with no vector has no distance, so it is excluded in the query rather
 * than dropped from the result — which is what keeps `limit` exact.
 */
function present(near: NearestPlan): WherePlan {
  return {
    kind: 'scalar',
    listName: near.listName,
    column: near.column,
    steps: [{ op: 'isNotNull' }],
  }
}

/**
 * Run a vector search: one scoped query carrying the caller's predicates, the
 * Access Filter, the `minScore` distance bound, the distance ordering and the
 * limit.
 *
 * Known limits:
 * - The score is computed here from the row's own vector rather than projected.
 *   A Prisma 8 collection at `8.0.0-rc.8` projects columns only — an expression
 *   cannot be selected — so the database owns the ranking and the bound, and
 *   the number beside the row is the same function evaluated over the same
 *   values. Re-check at GA (ADR-0045).
 * - pgvector's index authoring is not on the `rc.8` pack, so a contract-managed
 *   schema carries no HNSW or IVFFlat index and every search here is an exact
 *   scan, whose top-K under the Access Filter is exact. `hnsw.iterative_scan`
 *   therefore has nothing to apply to and is not set; enabling it needs a
 *   connection-scoped statement the read binding has no seam for, and belongs
 *   with the index declaration (#1128).
 */
async function runNearest(
  binding: ReadBinding,
  state: QueryState,
  field: string,
  vector: readonly number[],
  options: NearestOptions,
): Promise<NearestMatch<OrmRow>[]> {
  const plan = await resolvePlan(binding, state)
  if (plan === null) return []

  const near = await resolveNearest(
    field,
    vector,
    options,
    resolveContext(binding, binding.context._isSudo !== true),
  )

  const ops = await whereCombinators()
  const vectors = await vectorLowering()
  const bound = near.distanceBound

  // The sort is built in one call, distance first: a caller's own `orderBy`
  // becomes the tiebreak rather than competing with the ranking.
  let collection = scope(
    binding,
    { predicates: [...plan.predicates, present(near)], orders: [] },
    ops,
  ).orderBy([
    (model) => vectors.order(near, model),
    ...plan.orders.map((order) => (model: PredicateAccessor) => lowerOrder(order, model)),
  ])
  if (bound !== null) {
    collection = collection.where((model) => vectors.bound(near, model, bound))
  }

  const rows = await withOrigin('engine', () => collection.limit(near.limit).all())
  return await Promise.all(
    rows.map(async (row) => ({
      item: await visible(binding, row),
      score: score(near, row),
    })),
  )
}

function score(near: NearestPlan, row: OrmRow): number {
  const stored = requireVector(row[near.column], near.listName, near.column)
  return distanceToScore(
    near.distanceFunction,
    vectorDistance(near.distanceFunction, stored, near.vector),
  )
}

function isOrderList(order: OrderBy | readonly OrderBy[]): order is readonly OrderBy[] {
  return Array.isArray(order)
}

function orderList(order: OrderBy | readonly OrderBy[]): readonly OrderBy[] {
  return isOrderList(order) ? order : [order]
}

function query(binding: ReadBinding, state: QueryState): SecuredQuery {
  return {
    where: (predicate: Where) =>
      query(binding, { ...state, predicates: [...state.predicates, predicate] }),
    orderBy: (order: OrderBy | readonly OrderBy[]) =>
      query(binding, { ...state, orders: [...state.orders, ...orderList(order)] }),
    all: () => runAll(binding, state),
    first: () => runFirst(binding, state),
    nearest: (field: string, vector: readonly number[], options: NearestOptions = {}) =>
      runNearest(binding, state, field, vector, options),
  }
}

/**
 * The read members of one list's secured surface, bound to `ormHandle` and
 * `context`. The collection is held by the closure and never handed out: no
 * `Collection` and no `CollectionState` is reachable from the returned value
 * or its type (ADR-0041, ADR-0057).
 */
export function createSecuredRead(binding: ReadBinding): SecuredQuery {
  return query(binding, { predicates: [], orders: [] })
}
