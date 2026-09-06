// The secured read surface: `context.db.<List>` as an opaque wrapper over a
// Prisma 8 collection, its `where`/`orderBy` composition, and the
// `all()`/`first()`/`nearest()`/`aggregate()` terminals the engine owns. See ADR-0041,
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
  resolveColumns,
  resolveNearest,
  resolveOrderBy,
  resolveWhere,
  unqueryableKey,
  type ColumnPlan,
  type NearestOptions,
  type NearestPlan,
  type OrderBy,
  type OrderPlan,
  type ResolveContext,
  type Where,
  type WherePlan,
} from './vocabulary.js'
import {
  buildIncludeRequest,
  orderList,
  resolveIncludes,
  type IncludePlan,
  type IncludeRequest,
  type Refinement,
} from './include.js'
import { aggregations, checkSpec, specKeys, zeroed, type AggregateBuild } from './aggregate.js'
import { distanceToScore, requireVector, vectorDistance } from './vector.js'
import { ValidationError } from '../hooks/index.js'

export { AccessFilterRecursionError, ACCESS_FILTER_MAX_DEPTH } from './vocabulary.js'
export { NEAREST_DEFAULT_LIMIT } from './vocabulary.js'
export {
  DuplicateIncludeError,
  InvalidCombineBranchError,
  InvalidRefinementError,
  NestedToOneIncludeError,
  ReducedToOneIncludeError,
  UnreducibleRefinementError,
} from './include.js'
export type {
  Refinement,
  RefinementResult,
  SecuredRefinement,
  SecuredReduction,
} from './include.js'
export type { AggregateBuild, AggregateSpec, Aggregations, CountReduction } from './aggregate.js'
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
  /**
   * Reach one hop into a relation, optionally refining the related read. The
   * related list's `query` access rides in as a refinement `where`, so a
   * scoped-away to-one comes back `null` and a to-many `[]` with the key
   * present and the parent row kept.
   */
  include(name: string, refine?: Refinement): SecuredQuery<TRow>
  /** Collapse rows that agree on every named column. */
  distinct(...fields: string[]): SecuredQuery<TRow>
  /**
   * Keep the first row per distinct key, in the order `orderBy` established —
   * so it requires one.
   */
  distinctOn(...fields: string[]): SecuredQuery<TRow>
  /**
   * Resume from a known position. Every key must name a column the active
   * `orderBy` sorts by, so a cursor cannot seek on an axis the read has no
   * order along — nor on one this session may not read.
   */
  cursor(values: Record<string, unknown>): SecuredQuery<TRow>
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
  /**
   * Reduce the read to named aggregates over the rows this session may see:
   * `aggregate((a) => ({ total: a.count() }))`.
   *
   * A count is a Session-relative value, not a property of the table — it is
   * the same scoped read `all()` runs, counted in the database instead of
   * materialised, so it always equals the length of that `all()`. A denied
   * read answers `0` under every key rather than throwing: zero is the empty
   * value of a count's type, and it is indistinguishable from a genuinely
   * empty scoped set (ADR-0041, Silent failure).
   */
  aggregate(build: AggregateBuild): Promise<Record<string, number>>
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
interface RefinableCollection {
  where(predicate: (model: PredicateAccessor) => AnyExpression): RefinableCollection
  orderBy(selection: readonly ((model: PredicateAccessor) => OrderByItem)[]): RefinableCollection
  limit(count: number): RefinableCollection
  offset(count: number): RefinableCollection
  include(name: string, refine: (child: RefinableCollection) => IncludeBranch): RefinableCollection
  /** The relation reads as how many rows matched, rather than as the rows. */
  count(): IncludeReduction
  /** Several named reductions over the same relation, each its own subquery. */
  combine(spec: Record<string, IncludeReduction>): IncludeReduction
}

/**
 * What an include's refinement callback may hand back to the ORM: a composed
 * child collection, or the reduction that replaces it.
 */
type IncludeBranch = RefinableCollection | IncludeReduction

/** The ORM's reduced-relation value. Opaque here; only the ORM reads it. */
interface IncludeReduction {
  readonly reduced?: never
}

/** What a bare aggregate spec names on the ORM's aggregate accessor. */
interface AggregateAccessor {
  count(): AggregateReduction
}

interface AggregateReduction {
  readonly aggregated?: never
}

interface ReadableCollection extends RefinableCollection {
  where(predicate: (model: PredicateAccessor) => AnyExpression): ReadableCollection
  orderBy(selection: readonly ((model: PredicateAccessor) => OrderByItem)[]): ReadableCollection
  include(name: string, refine: (child: RefinableCollection) => IncludeBranch): ReadableCollection
  limit(rows: number): ReadableCollection
  distinct(...fields: string[]): ReadableCollection
  distinctOn(...fields: string[]): ReadableCollection
  cursor(values: Record<string, unknown>): ReadableCollection
  all(): PromiseLike<OrmRow[]>
  first(): Promise<OrmRow | null>
  aggregate(
    build: (aggregate: AggregateAccessor) => Record<string, AggregateReduction>,
  ): Promise<Record<string, unknown>>
}

/**
 * Presence, not completeness — the same rule `isDelegate` states in
 * `access/orm-client.ts`, and for the same reason. A test double implements
 * only the operations its test reaches, so requiring the full set would refuse
 * a client the engine can drive, and would refuse it with advice ("re-run
 * `opensaas generate`") that does not describe what is actually wrong. A
 * member that is genuinely absent surfaces at its own call site.
 */
function isReadableCollection(value: unknown): value is ReadableCollection {
  return typeof value === 'object' && value !== null
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

/** How rows that agree on the named columns are collapsed. */
interface DistinctRequest {
  readonly kind: 'all' | 'on'
  readonly fields: readonly string[]
}

interface QueryState {
  readonly predicates: readonly Where[]
  readonly orders: readonly OrderBy[]
  readonly includes: readonly IncludeRequest[]
  readonly distincts: readonly DistinctRequest[]
  readonly cursor?: Record<string, unknown>
}

/** A resolved read: the predicates to AND, the sort to apply, the tree to reach. */
interface ReadPlan {
  readonly predicates: readonly WherePlan[]
  readonly orders: readonly OrderPlan[]
  readonly includes: readonly IncludePlan[]
  readonly distinct?: { readonly kind: 'all' | 'on'; readonly columns: readonly ColumnPlan[] }
  readonly cursor?: Record<string, unknown>
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
  const includes = await resolveIncludes(state.includes, ctx, 0)
  const request = onlyDistinct(binding.listName, state.distincts)
  const distinct =
    request === undefined
      ? undefined
      : {
          kind: request.kind,
          columns: await resolveColumns(
            request.fields,
            ctx,
            request.kind === 'on' ? 'distinctOn' : 'distinct',
          ),
        }
  if (distinct?.kind === 'on') {
    requireDistinctOnOrder(binding.listName, distinct.columns, orders)
  }
  const cursor =
    state.cursor === undefined ? undefined : resolveCursor(binding.listName, state.cursor, orders)

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

  return {
    predicates,
    orders,
    includes,
    ...(distinct ? { distinct } : {}),
    ...(cursor ? { cursor } : {}),
  }
}

function requireOrder(listName: string, orders: readonly OrderPlan[], member: string): void {
  if (orders.length > 0) return
  throw new ValidationError([
    `Cannot ${member} "${listName}" without an orderBy — it has no order to resume or keep the ` +
      `first row of.`,
  ])
}

function quoted(names: Iterable<string>): string {
  return [...names].map((name) => `"${name}"`).join(', ')
}

/**
 * The one `distinct` a read may carry.
 *
 * `where`, `orderBy` and `include` accumulate because each composes with what
 * came before. Two distincts do not: `distinct` and `distinctOn` collapse rows
 * by different rules, and the variadic form already spells "on both columns"
 * in a single call. So a second one is refused at the terminal — where every
 * other refusal on this surface is made — rather than replacing the first.
 */
function onlyDistinct(
  listName: string,
  requests: readonly DistinctRequest[],
): DistinctRequest | undefined {
  if (requests.length <= 1) return requests[0]
  const composed = requests
    .map(
      (request) =>
        `${request.kind === 'on' ? 'distinctOn' : 'distinct'}(${quoted(request.fields)})`,
    )
    .join(' and ')
  throw new ValidationError([
    `Cannot read "${listName}" through more than one distinct — it composed ${composed}. Name ` +
      `every column in one call instead.`,
  ])
}

/**
 * Refuse a `distinctOn` the read's sort does not lead with.
 *
 * Postgres requires the `DISTINCT ON` expressions to match the leftmost
 * `ORDER BY` expressions and raises `42P10` otherwise
 * (https://www.postgresql.org/docs/current/sql-select.html#SQL-DISTINCT), so
 * a merely-present order is not enough. Position within the leading group does
 * not matter to Postgres, which is why this compares the group as a set.
 */
function requireDistinctOnOrder(
  listName: string,
  columns: readonly ColumnPlan[],
  orders: readonly OrderPlan[],
): void {
  requireOrder(listName, orders, 'distinctOn')
  const named = new Set(columns.map((column) => column.column))
  const leading = orders.slice(0, named.size).map((order) => order.column)
  if (leading.length === named.size && leading.every((column) => named.has(column))) return
  throw new ValidationError([
    `Cannot distinctOn "${listName}" by ${quoted(named)} — it keeps the first row per key in the ` +
      `order the read established, so the orderBy has to lead with those columns and this one ` +
      `leads with ${quoted(orders.map((order) => order.column))}.`,
  ])
}

/**
 * Resolve a cursor's keys against the sort the read already established.
 *
 * A key the active `orderBy` does not name is refused with the message an
 * undeclared key gets. That is what makes the refusal indistinguishable: a
 * read-denied column never reaches a resolved order in the first place
 * (`resolveOrderBy` refuses it there), so an undeclared column, a denied one
 * and one the caller simply did not sort by all answer the same way
 * (ADR-0031).
 */
function resolveCursor(
  listName: string,
  values: Record<string, unknown>,
  orders: readonly OrderPlan[],
): Record<string, unknown> {
  requireOrder(listName, orders, 'cursor')
  const sorted = new Set(orders.map((order) => order.column))
  for (const key of Object.keys(values)) {
    if (!sorted.has(key)) throw unqueryableKey(listName, key)
  }
  return values
}

/**
 * Apply one resolved include to the refinement collection Prisma hands the
 * callback. Every predicate is a separate `where` for the same reason the
 * top-level ones are: the ORM ANDs them natively, so the Access Filter stays
 * a filter entry beside the caller's rather than something hand-merged into
 * it (ADR-0044).
 */
function refine(
  collection: RefinableCollection,
  plan: IncludePlan,
  ops: WhereCombinators,
): IncludeBranch {
  let refined = collection
  for (const predicate of plan.predicates) {
    refined = refined.where((model) => lowerWhere(predicate, model, ops))
  }
  // A reduction replaces the rows, so nothing below it applies: `resolveReduce`
  // refuses a refinement that composed anything a count cannot honour.
  if (plan.reduce !== undefined) {
    if (plan.reduce.kind === 'count') return refined.count()
    const spec: Record<string, IncludeReduction> = {}
    for (const branch of plan.reduce.branches) {
      let branched = refined
      for (const predicate of branch.predicates) {
        branched = branched.where((model) => lowerWhere(predicate, model, ops))
      }
      spec[branch.key] = branched.count()
    }
    return refined.combine(spec)
  }
  if (plan.orders.length > 0) {
    refined = refined.orderBy(
      plan.orders.map((order) => (model: PredicateAccessor) => lowerOrder(order, model)),
    )
  }
  if (plan.offset !== undefined) refined = refined.offset(plan.offset)
  if (plan.limit !== undefined) refined = refined.limit(plan.limit)
  for (const nested of plan.includes) {
    refined = refined.include(nested.relation, (child) => refine(child, nested, ops))
  }
  return refined
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
  if (plan.distinct !== undefined) {
    const fields = plan.distinct.columns.map((column) => column.column)
    collection =
      plan.distinct.kind === 'on'
        ? collection.distinctOn(...fields)
        : collection.distinct(...fields)
  }
  if (plan.cursor !== undefined) collection = collection.cursor(plan.cursor)
  for (const include of plan.includes) {
    collection = collection.include(include.relation, (child) => refine(child, include, ops))
  }
  return collection
}

function isRow(value: unknown): value is OrmRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Rewrite the foreign-key column of every included to-one to the value the
 * relation itself came back as.
 *
 * Two things make this necessary, and each on its own would be enough. Prisma
 * 8 aliases an include by the relation's name and a scalar column by its
 * physical name, and the contract maps a to-one's foreign key onto the
 * relation's own name (`contract/derive.ts`), so the two aliases collide and
 * the decoder writes the include's payload into the foreign-key key. And
 * independently of any collision, the foreign key is a second name for the
 * related row's identity: a relation the Access Filter scoped away or Field
 * Visibility stripped would otherwise survive under it as the invisible row's
 * id.
 *
 * So the pass is driven by the contract's own foreign-key member
 * (`IncludePlan.foreignKey`) rather than by the shape of whatever is stored,
 * which makes it independent of `db: { foreignKey: { map } }`; and it runs
 * AFTER Field Visibility, which makes visibility authoritative over the
 * column. The value written is the one the caller may see: the related row's
 * id when the relation is visible, `null` when it is not — denied, scoped away
 * and stripped alike, which is what a to-one the caller may not see means
 * everywhere else (ADR-0058).
 */
function applyForeignKeys(row: OrmRow, plans: readonly IncludePlan[]): void {
  for (const plan of plans) {
    const value = row[plan.relation]
    if (plan.arity === 'one' && plan.foreignKey !== undefined && plan.foreignKey in row) {
      row[plan.foreignKey] = isRow(value) ? value.id : null
    }
    if (plan.includes.length === 0) continue
    for (const related of Array.isArray(value) ? value : [value]) {
      if (isRow(related)) applyForeignKeys(related, plan.includes)
    }
  }
}

function reduces(plans: readonly IncludePlan[]): boolean {
  return plans.some((plan) => plan.reduce !== undefined || reduces(plan.includes))
}

/**
 * Stand an empty to-many in for every relation the read reduced.
 *
 * Field Visibility decides whether a relation key survives by evaluating the
 * relationship field's own `read` rule, and it reaches that decision on the
 * path it takes for a relation's ROWS. A count is not rows, so handing it the
 * reduced value would take it down neither path and the key would fall out of
 * the result whether or not the session may read it. Substituting `[]` puts
 * the decision back on the one path that makes it — Field Visibility runs the
 * same rule over the same parent row — and {@link restoreReductions} then
 * writes the count back under exactly the keys that survived. A reduction is
 * to-many only ({@link ReducedToOneIncludeError}), so `[]` is the shape the
 * relation would otherwise have had.
 *
 * Known limits: the `[]` is a stand-in, not the reduced relation's rows, so a
 * relationship `read` rule that inspects `item.<reducedRelation>` decides on
 * an empty array rather than on what the count counted. The common
 * `item.posts.length > 0` shape therefore fails closed (the key is dropped
 * even where the count is non-zero); an inverted `item.posts.length === 0`
 * fails open (the key is kept, carrying the count). Reduce a relation whose
 * own rule reads its rows only where that is acceptable.
 */
function maskReductions(row: OrmRow, plans: readonly IncludePlan[]): OrmRow {
  if (!reduces(plans)) return row
  const masked: OrmRow = { ...row }
  for (const plan of plans) {
    if (plan.reduce !== undefined) {
      masked[plan.relation] = []
      continue
    }
    if (!reduces(plan.includes)) continue
    const value = masked[plan.relation]
    if (Array.isArray(value)) {
      masked[plan.relation] = value.map((related) =>
        isRow(related) ? maskReductions(related, plan.includes) : related,
      )
    } else if (isRow(value)) {
      masked[plan.relation] = maskReductions(value, plan.includes)
    }
  }
  return masked
}

/** Write each reduced relation back, under the keys Field Visibility kept. */
function restoreReductions(shown: OrmRow, source: OrmRow, plans: readonly IncludePlan[]): void {
  for (const plan of plans) {
    if (plan.reduce !== undefined) {
      if (plan.relation in shown) shown[plan.relation] = source[plan.relation]
      continue
    }
    if (!reduces(plan.includes)) continue
    const kept = shown[plan.relation]
    const raw = source[plan.relation]
    if (Array.isArray(kept) && Array.isArray(raw)) {
      kept.forEach((related, index) => {
        const original = raw[index]
        if (isRow(related) && isRow(original)) restoreReductions(related, original, plan.includes)
      })
    } else if (isRow(kept) && isRow(raw)) {
      restoreReductions(kept, raw, plan.includes)
    }
  }
}

async function visible(binding: ReadBinding, row: OrmRow, plan: ReadPlan): Promise<OrmRow> {
  const { listConfig, context, config, listName } = binding
  const filtered = await filterReadableFields(
    maskReductions(row, plan.includes),
    listConfig.fields,
    { session: context.session, context },
    config,
    0,
    listName,
  )
  applyForeignKeys(filtered, plan.includes)
  restoreReductions(filtered, row, plan.includes)
  return filtered
}

async function runAll(binding: ReadBinding, state: QueryState): Promise<OrmRow[]> {
  const plan = await resolvePlan(binding, state)
  if (plan === null) return []
  const collection = scope(binding, plan, await whereCombinators())
  const rows = await withOrigin('engine', () => collection.all())
  return await Promise.all(rows.map((row) => visible(binding, row, plan)))
}

async function runFirst(binding: ReadBinding, state: QueryState): Promise<OrmRow | null> {
  const plan = await resolvePlan(binding, state)
  if (plan === null) return null
  const collection = scope(binding, plan, await whereCombinators())
  const row = await withOrigin('engine', () => collection.first())
  return row === null ? null : await visible(binding, row, plan)
}

function countOf(result: Record<string, unknown>, listName: string, key: string): number {
  const value = result[key]
  if (typeof value !== 'number') {
    throw new ValidationError([
      `The database answered "${key}" for "${listName}" with something other than a count. ` +
        `Re-run \`opensaas generate\` so the emitted contract matches the config.`,
    ])
  }
  return value
}

/**
 * Run an aggregate: the same scoped read every other terminal runs, counted in
 * the database instead of materialised.
 *
 * The read's own `orderBy`, `include`, `distinct` and `cursor` are not carried
 * across. An include is an eager load and a sort is over rows this terminal
 * returns none of, so neither can change how many rows match — and Postgres
 * refuses an `ORDER BY` beside a bare aggregate outright. `distinct` and a
 * cursor WOULD change the answer, so they are refused rather than dropped.
 *
 * Known limits: `count()` throws rather than rounding beyond
 * ±(2^53 − 1) — the guarded integer codec the ORM decodes it through
 * (`RUNTIME.DECODE_FAILED`). A lossless `countBigInt` is on the ORM's
 * aggregate accessor and not on this vocabulary; re-check at GA (ADR-0041).
 */
async function runAggregate(
  binding: ReadBinding,
  state: QueryState,
  build: AggregateBuild,
): Promise<Record<string, number>> {
  if (state.distincts.length > 0 || state.cursor !== undefined) {
    throw new ValidationError([
      `Cannot aggregate "${binding.listName}" over a read that composed distinct or cursor — ` +
        `an aggregate counts the rows the predicates match, which is not what either would ` +
        `return. Aggregate the predicates alone, or read the rows.`,
    ])
  }
  const spec = build(aggregations)
  const keys = specKeys(spec)

  const plan = await resolvePlan(binding, state)
  if (plan === null) return zeroed(keys)
  checkSpec(binding.listName, spec)

  const collection = scope(
    binding,
    { predicates: plan.predicates, orders: [], includes: [] },
    await whereCombinators(),
  )
  const result = await withOrigin('engine', () =>
    collection.aggregate((aggregate) =>
      Object.fromEntries(keys.map((key) => [key, aggregate.count()])),
    ),
  )
  return Object.fromEntries(keys.map((key) => [key, countOf(result, binding.listName, key)]))
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
 * Refuse a search over a read that composed `distinct` or a cursor.
 *
 * Both are refused rather than carried for the reason `runAggregate` refuses
 * them: neither can be honoured here, and dropping them would answer a
 * different question in silence. The ranking is this query's leading order, so
 * a cursor has no axis left to resume along and a `distinctOn` can never be
 * the leading sort; a plain `distinct` would collapse rows the top-K has
 * already been computed over, which makes `limit` inexact.
 */
function refuseUnrankable(listName: string, plan: ReadPlan): void {
  if (plan.distinct === undefined && plan.cursor === undefined) return
  throw new ValidationError([
    `Cannot search "${listName}" over a read that composed distinct or cursor — the ranking is ` +
      `this query's leading order, so a cursor has no axis to resume along and a distinct would ` +
      `collapse rows the nearest limit is already counted over. Search the predicates alone.`,
  ])
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
  refuseUnrankable(binding.listName, plan)

  const near = await resolveNearest(
    field,
    vector,
    options,
    resolveContext(binding, binding.context._isSudo !== true),
  )

  const ops = await whereCombinators()
  const vectors = await vectorLowering()
  const bound = near.distanceBound

  // Derived from the resolved plan rather than rebuilt beside it, so a member
  // added to `ReadPlan` reaches this query too. `orders` is the one deliberate
  // difference: the sort is rebuilt in one call below, distance first, so a
  // caller's own `orderBy` becomes the tiebreak rather than competing with the
  // ranking.
  let collection = scope(
    binding,
    { ...plan, predicates: [...plan.predicates, present(near)], orders: [] },
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
      item: await visible(binding, row, plan),
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

function query(binding: ReadBinding, state: QueryState): SecuredQuery {
  return {
    where: (predicate: Where) =>
      query(binding, { ...state, predicates: [...state.predicates, predicate] }),
    orderBy: (order: OrderBy | readonly OrderBy[]) =>
      query(binding, { ...state, orders: [...state.orders, ...orderList(order)] }),
    include: (name: string, refinement?: Refinement) =>
      query(binding, {
        ...state,
        includes: [...state.includes, buildIncludeRequest(name, refinement)],
      }),
    distinct: (...fields: string[]) =>
      query(binding, { ...state, distincts: [...state.distincts, { kind: 'all', fields }] }),
    distinctOn: (...fields: string[]) =>
      query(binding, { ...state, distincts: [...state.distincts, { kind: 'on', fields }] }),
    cursor: (values: Record<string, unknown>) => query(binding, { ...state, cursor: values }),
    all: () => runAll(binding, state),
    first: () => runFirst(binding, state),
    nearest: (field: string, vector: readonly number[], options: NearestOptions = {}) =>
      runNearest(binding, state, field, vector, options),
    aggregate: (build: AggregateBuild) => runAggregate(binding, state, build),
  }
}

/**
 * The read members of one list's secured surface, bound to `ormHandle` and
 * `context`. The collection is held by the closure and never handed out: no
 * `Collection` and no `CollectionState` is reachable from the returned value
 * or its type (ADR-0041, ADR-0057).
 */
export function createSecuredRead(binding: ReadBinding): SecuredQuery {
  return query(binding, { predicates: [], orders: [], includes: [], distincts: [] })
}
