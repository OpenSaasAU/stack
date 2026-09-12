// The secured read surface: `context.db.<List>` as an opaque wrapper over a
// Prisma 8 collection, its `where`/`orderBy` composition, and the
// `all()`/`first()`/`nearest()`/`aggregate()` terminals the engine owns. See ADR-0041,
// ADR-0044, ADR-0045, ADR-0046, ADR-0055 and ADR-0058.

import type { AnyExpression, OrderByItem } from '@prisma/orm-postgres/relational-core'
import type { OpenSaasConfig, ListConfig, TypeInfo } from '../config/types.js'
import type { AccessContext, OrmClient, OrmRow, PrismaFilter, Session } from '../access/types.js'
import {
  checkAccess,
  checkFieldAccess,
  emptyCountAccessDenialTree,
  emptyToOneAccessVisibilityTree,
  filterReadableFields,
  getRelatedListConfig,
} from '../access/index.js'
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
  resolveRelatedAccessPlan,
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
  DECLARED_COUNT_BRANCH_KEY,
  DECLARED_ROWS_BRANCH_KEY,
  foreignKeyOwningRelations,
  orderList,
  resolveIncludes,
  type CombineBranchPlan,
  type IncludePlan,
  type IncludeRequest,
  type ReducePlan,
  type Refinement,
} from './include.js'
import {
  dependencyAdditions,
  reducedDeclaredKeys,
  resolveProjection,
  selectionScope,
  type ProjectionPlan,
} from './select.js'
import type {
  DependencyAdditions,
  FieldSelectionScope,
  ReducedDeclaredKeys,
} from '../access/declared-dependencies.js'
import { aggregations, checkSpec, specKeys, zeroed, type AggregateBuild } from './aggregate.js'
import { distanceToScore, requireVector, vectorDistance } from './vector.js'
import {
  ROW_LOCK_MAX_KEYS,
  RowLockIdentityError,
  RowLockKeyLimitExceededError,
  RowLockUnavailableError,
  type RowLockIdentity,
  type RowLockKey,
  type RowLockLane,
} from './lock.js'
import { ValidationError } from '../hooks/index.js'

export { AccessFilterRecursionError, ACCESS_FILTER_MAX_DEPTH } from './vocabulary.js'
export { NEAREST_DEFAULT_LIMIT } from './vocabulary.js'
export {
  DuplicateIncludeError,
  InvalidCombineBranchError,
  InvalidRefinementError,
  MultipleCombineRowBranchesError,
  ReducedToOneIncludeError,
  ReservedCombineKeyError,
  UnreducibleRefinementError,
} from './include.js'
export type {
  Refinement,
  RefinementResult,
  SecuredRefinement,
  SecuredReduction,
} from './include.js'
export { RelationSelectError } from './select.js'
export {
  ROW_LOCK_MAX_KEYS,
  RowLockIdentityError,
  RowLockKeyLimitExceededError,
  RowLockLaneUnavailableError,
  RowLockUnavailableError,
} from './lock.js'
export type { RowLockIdentity, RowLockKey, RowLockLane } from './lock.js'
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
  /**
   * Return exactly these of the list's own fields — including a computed one,
   * which is produced whether or not the columns it reads were named.
   *
   * Replaces any previous call rather than accumulating, and leaves relations
   * this read includes on the row: `select()` narrows this list's columns and
   * `include()` reaches the next list, so the two compose. The engine widens
   * the query behind it — for the declared dependency sets of the computed
   * fields it will return, and for a `read` rule that has to see a row to
   * answer — and strips the difference back out, so the result matches what
   * was named here exactly (ADR-0041, ADR-0051).
   */
  select(...fields: readonly string[]): SecuredQuery<TRow>
  /**
   * At most this many rows. Replaces any previous call rather than
   * accumulating. `first()` is bounded by its own terminal and `nearest()`
   * takes its bound from `options.limit`, so this shapes `all()` alone.
   */
  limit(count: number): SecuredQuery<TRow>
  /**
   * Skip this many rows. Replaces any previous call rather than accumulating.
   * `all()` and `first()` both honour it — `first()` has no offset of its own,
   * so `.offset(10).first()` is the eleventh row. `aggregate()` and
   * `nearest()` refuse it rather than answer a different question.
   */
  offset(count: number): SecuredQuery<TRow>
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
  /**
   * Take a row lock on everything `first()` or `all()` is about to return.
   *
   * Two statements: the scoped read resolves operation access, the Access
   * Filter and Field Visibility exactly as any read does, and the engine then
   * locks the identity rows it returned. So the locked set is provably a
   * subset of the readable set, and a row deleted in between locks nothing —
   * `first()` yields `null` and `all()` the surviving subset. `null` therefore
   * means denied-or-vanished, which extends a conflation Silent failure
   * already makes deliberately (ADR-0047).
   *
   * Because the read is the FIRST of the two statements, the row it hands back
   * carries its columns as of BEFORE the lock: each statement takes its own
   * snapshot under Read Committed, so a column another transaction committed
   * in between arrives stale. Only the identity is post-lock — the lock is a
   * mutex token on the row, not protection for the row's own data, and this
   * differs from a single-statement `SELECT … FOR UPDATE`, which Postgres
   * re-evaluates after acquiring. A gate's threshold is therefore read in its
   * own statement AFTER this one, exactly as its count is.
   *
   * `aggregate()` and `nearest()` do not carry it: an aggregate returns no
   * primary keys to lock, and a ranking is not a gate.
   *
   * A transaction is required — a lock taken outside one is released at the
   * end of the statement that took it. On the generated surface this is a
   * compile error rather than a throw: `forUpdate()` is on the
   * transaction-bound builder alone.
   */
  forUpdate(): SecuredQuery<TRow>
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
  select(...fields: readonly string[]): RefinableCollection
  where(predicate: (model: PredicateAccessor) => AnyExpression): RefinableCollection
  orderBy(selection: readonly ((model: PredicateAccessor) => OrderByItem)[]): RefinableCollection
  limit(count: number): RefinableCollection
  offset(count: number): RefinableCollection
  include(name: string, refine: (child: RefinableCollection) => IncludeBranch): RefinableCollection
  /** The relation reads as how many rows matched, rather than as the rows. */
  count(): IncludeReduction
  /** Several named reductions over the same relation, each its own subquery. */
  combine(spec: Record<string, IncludeBranch>): IncludeReduction
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
  select(...fields: readonly string[]): ReadableCollection
  where(predicate: (model: PredicateAccessor) => AnyExpression): ReadableCollection
  orderBy(selection: readonly ((model: PredicateAccessor) => OrderByItem)[]): ReadableCollection
  include(name: string, refine: (child: RefinableCollection) => IncludeBranch): ReadableCollection
  limit(rows: number): ReadableCollection
  offset(rows: number): ReadableCollection
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
  /**
   * Present only on a context bound to a transaction, which is what makes
   * `forUpdate()` answerable there and a refusal everywhere else (ADR-0047).
   */
  lock?: RowLockLane
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
  readonly fields?: readonly string[]
  readonly limit?: number
  readonly offset?: number
  readonly distincts: readonly DistinctRequest[]
  readonly cursor?: Record<string, unknown>
  /** Whether `.forUpdate()` composed onto this read (ADR-0047). */
  readonly lock: boolean
}

/** A resolved read: the predicates to AND, the sort to apply, the tree to reach. */
interface ReadPlan {
  readonly predicates: readonly WherePlan[]
  readonly orders: readonly OrderPlan[]
  readonly includes: readonly IncludePlan[]
  /** The top level's projection, already widened (ADR-0041). */
  readonly projection: ProjectionPlan
  /** What the caller may keep, level by level — `undefined` when nothing was projected. */
  readonly selection: FieldSelectionScope | undefined
  /** The relation branches only the widening asked for, level by level (ADR-0051). */
  readonly additions: DependencyAdditions
  /**
   * Relation keys, level by level, that are both reduced and a live declared
   * dependency (#1357) — `IncludePlan.declaredRows` on {@link includes}, in
   * the shape Field Visibility consumes it in. See `maskReductions` and
   * `restoreReductions` below.
   */
  readonly reducedDeclared: ReducedDeclaredKeys
  /** The caller's own row bound. */
  readonly limit?: number
  /** The caller's own row offset. */
  readonly offset?: number
  readonly distinct?: { readonly kind: 'all' | 'on'; readonly columns: readonly ColumnPlan[] }
  readonly cursor?: Record<string, unknown>
  /**
   * Present only when `.forUpdate()` composed. `true` rather than a boolean so
   * an uncomposed read carries nothing: {@link carried} reads absence, and a
   * `false` would read as a member every terminal has to refuse.
   */
  readonly forUpdate?: true
}

/**
 * What one terminal does with one member of a resolved plan.
 *
 * - `applied` — carried into the query (or, for `selection`/`additions`, into
 *   {@link visible}).
 * - `refused` — the terminal cannot honour it and says so, at the cost of a
 *   `ValidationError` rather than a wrong answer.
 * - `inapplicable` — the terminal owns this axis itself, so there is nothing
 *   for the caller's value to change. `first()`'s own row bound and
 *   `nearest()`'s `options.limit` are the two.
 */
type PlanDisposition = 'applied' | 'refused' | 'inapplicable'

/**
 * Every {@link ReadPlan} member, and what a terminal does with it.
 *
 * The `Record<keyof ReadPlan, …>` is the whole point: a member added to
 * `ReadPlan` is a compile error in each terminal until that terminal says what
 * it does with it, and {@link scope} is the only way to the collection — so a
 * terminal cannot drop a plan member without writing the word down.
 *
 * That is a rule with three counterexamples behind it. `runNearest` once
 * bypassed the include tree, `runAggregate` rebuilt the plan as a hand-written
 * literal, and `offset` reached `all()` alone; each was a member ignored in
 * silence, and each was found by review rather than by a test.
 */
type PlanDispositions = Record<keyof ReadPlan, PlanDisposition>

/** Whether the plan actually carries this member — an empty one refuses nothing. */
function carried(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  return value !== undefined
}

/**
 * Refuse every member this terminal marked `refused` that the plan carries,
 * naming all of them at once.
 *
 * It takes the resolved plan rather than the composed state, so it runs after
 * the operation-access check for the reason {@link resolvePlan} orders its own
 * work that way: a denied caller gets the Silent failure and never learns
 * which members the read composed (#912, #915).
 */
function refuseCarried(
  plan: ReadPlan,
  dispositions: PlanDispositions,
  refuse: (members: readonly string[]) => never,
): void {
  const table: Record<string, PlanDisposition> = dispositions
  const refused = Object.entries(plan)
    .filter(([member, value]) => table[member] === 'refused' && carried(value))
    .map(([member]) => member)
  if (refused.length > 0) refuse(refused.sort())
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
  const projection = await resolveProjection(
    state.fields,
    state.includes.map((request) => request.name),
    ctx,
  )
  const includes = await resolveIncludes(state.includes, ctx, 0, projection.caller)
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
    projection,
    selection: selectionScope(projection, includes),
    additions: dependencyAdditions(includes),
    reducedDeclared: reducedDeclaredKeys(includes),
    limit: state.limit,
    offset: state.offset,
    ...(distinct ? { distinct } : {}),
    ...(cursor ? { cursor } : {}),
    ...(state.lock ? { forUpdate: true as const } : {}),
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
    if (plan.declaredRows === undefined) {
      if (plan.reduce.kind === 'count') return refined.count()
      return refined.combine(combineSpec(refined, plan, plan.reduce.branches, ops))
    }
    // Both the caller's own reduce AND the declared dependency's rows ride in
    // this one query, under keys the caller cannot reach (#1357) —
    // `maskReductions`/`restoreReductions` are where the two get split apart
    // again on the way out.
    const spec: Record<string, IncludeBranch> = {
      [DECLARED_ROWS_BRANCH_KEY]: declaredRowsBranch(collection, plan, ops),
      ...(plan.reduce.kind === 'count'
        ? { [DECLARED_COUNT_BRANCH_KEY]: refined.count() }
        : combineSpec(refined, plan, plan.reduce.branches, ops)),
    }
    return refined.combine(spec)
  }
  return shape(refined, plan, plan, ops)
}

function combineSpec(
  refined: RefinableCollection,
  plan: IncludePlan,
  branches: readonly CombineBranchPlan[],
  ops: WhereCombinators,
): Record<string, IncludeBranch> {
  const spec: Record<string, IncludeBranch> = {}
  for (const branch of branches) {
    let branched = refined
    for (const predicate of branch.predicates) {
      branched = branched.where((model) => lowerWhere(predicate, model, ops))
    }
    spec[branch.key] =
      branch.kind === 'count' ? branched.count() : shape(branched, plan, branch, ops)
  }
  return spec
}

/**
 * The internal, caller-invisible rows branch a reduced-and-declared relation
 * rides alongside its own reduction (`IncludePlan.declaredRows`). Built off
 * the UNFILTERED `collection` rather than `refined` — it is scoped by the
 * Access Filter alone, never by the caller's own `where()` on the reduce,
 * because it stands in for an ordinary declared branch (full stored width,
 * one hop), not for the caller's own view of the relation.
 */
function declaredRowsBranch(
  collection: RefinableCollection,
  plan: IncludePlan,
  ops: WhereCombinators,
): RefinableCollection {
  let branched = collection
  for (const predicate of plan.declaredRows ?? []) {
    branched = branched.where((model) => lowerWhere(predicate, model, ops))
  }
  return shape(branched, plan, { orders: [], limit: undefined, offset: undefined }, ops)
}

/** What a relation's rows look like: its projection, its sort and its page. */
interface RowShape {
  readonly orders: readonly OrderPlan[]
  readonly limit?: number
  readonly offset?: number
}

/**
 * Apply the projection, the sort, the page and the next level to a relation's
 * rows. The projection and the nested includes come from the plan, which for a
 * `combine` already carries its rows branch's own (`rowsBranchOf`); the sort
 * and the page come from whichever branch is being built, so the count branch
 * beside it is never chained after this one's bound.
 */
function shape(
  collection: RefinableCollection,
  plan: IncludePlan,
  rows: RowShape,
  ops: WhereCombinators,
): RefinableCollection {
  let shaped = collection
  if (plan.projection.columns !== undefined) {
    shaped = shaped.select(...plan.projection.columns)
  }
  if (rows.orders.length > 0) {
    shaped = shaped.orderBy(
      rows.orders.map((order) => (model: PredicateAccessor) => lowerOrder(order, model)),
    )
  }
  if (rows.offset !== undefined) shaped = shaped.offset(rows.offset)
  if (rows.limit !== undefined) shaped = shaped.limit(rows.limit)
  for (const nested of plan.includes) {
    shaped = shaped.include(nested.relation, (child) => refine(child, nested, ops))
  }
  return shaped
}

/**
 * Build the scoped collection, member by member, under this terminal's
 * {@link PlanDispositions}.
 *
 * Every terminal reaches the database through here, so the dispositions are
 * not advice: a member the terminal did not mark `applied` is either refused
 * out loud or declared `inapplicable` beside the reason.
 */
function scope(
  binding: ReadBinding,
  plan: ReadPlan,
  ops: WhereCombinators,
  dispositions: PlanDispositions,
  refuse: (members: readonly string[]) => never,
): ReadableCollection {
  refuseCarried(plan, dispositions, refuse)
  const applies = (member: keyof ReadPlan): boolean => dispositions[member] === 'applied'
  let collection = collectionFor(binding.ormHandle, binding.listName)
  if (applies('predicates')) {
    for (const predicate of plan.predicates) {
      collection = collection.where((model) => lowerWhere(predicate, model, ops))
    }
  }
  if (applies('projection') && plan.projection.columns !== undefined) {
    collection = collection.select(...plan.projection.columns)
  }
  if (applies('orders') && plan.orders.length > 0) {
    collection = collection.orderBy(
      plan.orders.map((order) => (model: PredicateAccessor) => lowerOrder(order, model)),
    )
  }
  if (applies('distinct') && plan.distinct !== undefined) {
    const fields = plan.distinct.columns.map((column) => column.column)
    collection =
      plan.distinct.kind === 'on'
        ? collection.distinctOn(...fields)
        : collection.distinct(...fields)
  }
  if (applies('cursor') && plan.cursor !== undefined) collection = collection.cursor(plan.cursor)
  if (applies('includes')) {
    for (const include of plan.includes) {
      collection = collection.include(include.relation, (child) => refine(child, include, ops))
    }
  }
  if (applies('offset') && plan.offset !== undefined) collection = collection.offset(plan.offset)
  if (applies('limit') && plan.limit !== undefined) collection = collection.limit(plan.limit)
  return collection
}

function isRow(value: unknown): value is OrmRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The rows one include plan contributed to a row, whichever shape the key
 * holds them in: a to-many's array, a to-one's single row, and a reduction's
 * envelope before {@link maskReductions} substitutes its rows back out. Both
 * foreign-key passes walk a row through here, so neither can be reading a
 * shape the other is not.
 */
function relatedRowsOf(row: OrmRow, plan: IncludePlan): OrmRow[] {
  const value = row[plan.relation]
  if (Array.isArray(value)) return value.filter(isRow)
  if (plan.reduce !== undefined) return combinedRows(value, rowsKeyOf(plan))
  return isRow(value) ? [value] : []
}

/**
 * Narrow the foreign-key column of every included to-one to what the caller
 * may see.
 *
 * The foreign key is a second name for the related row's identity, so a
 * relation the Access Filter scoped away or Field Visibility stripped would
 * otherwise survive under it as the invisible row's id.
 *
 * The pass is driven by the contract's own foreign-key member
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
    if (plan.arity === 'one' && plan.foreignKey !== undefined && plan.foreignKey in row) {
      const value = row[plan.relation]
      row[plan.foreignKey] = isRow(value) ? value.id : null
    }
    if (plan.includes.length === 0) continue
    for (const related of relatedRowsOf(row, plan)) applyForeignKeys(related, plan.includes)
  }
}

/** The `id IN (...)` predicate a batched existence check narrows its scan to. */
function identityIn(
  model: PredicateAccessor,
  listName: string,
  keys: readonly RowLockKey[],
): AnyExpression {
  const expression = model['id']?.in?.(keys)
  if (expression === undefined) throw unqueryableKey(listName, 'id')
  return expression
}

/**
 * Resolve the read-time context `foreignKeyOwningRelations` and
 * `resolveRelatedAccessPlan` need for one list, mirroring what `resolveInclude`
 * builds for a relation it actually resolves.
 */
function relatedResolveContext(
  binding: ReadBinding,
  listName: string,
  listConfig: ListConfig<TypeInfo>,
): ResolveContext {
  return {
    listName,
    listConfig,
    config: binding.config,
    session: binding.context.session,
    context: binding.context,
    checkFieldRead: false,
    applyRelationAccess: true,
    accessFilterPath: [],
  }
}

/**
 * Narrow the foreign-key column of every to-one relationship this read did
 * NOT include or declare — the gap {@link applyForeignKeys} cannot close,
 * because a relation nobody named has no {@link IncludePlan} entry for it to
 * walk (issue #1243).
 *
 * The column is on the row regardless of `include` (ADR-0043), so it needs
 * its own visibility decision: the owning relationship field's own `read`
 * rule, evaluated per row against the RAW row (before Field Visibility
 * strips anything else), and the related list's own `query` access — `true`
 * leaves the column as the plain pass-through value it already is, `false`
 * nulls it outright, and a filter is resolved with one batched existence
 * check per relation across the whole page, keyed off the column's own value
 * rather than a fetched related row (there is no fetched related row here to
 * key off).
 *
 * Runs AFTER {@link applyForeignKeys}, on its output — mutated in place —
 * and recurses into every relation THAT pass over its results the same way
 * {@link applyForeignKeys} does, so a related list reached only through an
 * include gets its own un-included to-ones narrowed too.
 */
async function narrowUnincludedForeignKeys(
  binding: ReadBinding,
  filteredRows: readonly OrmRow[],
  rawRows: readonly OrmRow[],
  listName: string,
  listConfig: ListConfig<TypeInfo>,
  resolvedIncludes: readonly IncludePlan[],
): Promise<void> {
  const ctx = relatedResolveContext(binding, listName, listConfig)
  const alreadyIncluded = new Set(resolvedIncludes.map((plan) => plan.relation))

  for (const owner of foreignKeyOwningRelations(ctx)) {
    if (alreadyIncluded.has(owner.relation)) continue
    if (!rawRows.some((row) => owner.foreignKey in row)) continue

    const related = getRelatedListConfig(owner.ref, binding.config)
    if (!related) continue

    const access = await resolveRelatedAccessPlan(
      { listName: related.listName, listConfig: related.listConfig },
      ctx,
    )

    for (let i = 0; i < filteredRows.length; i++) {
      const raw = rawRows[i]
      if (!(owner.foreignKey in raw)) continue
      const canReadField = await checkFieldAccess(owner.fieldConfig.access, 'read', {
        session: binding.context.session,
        context: binding.context,
        item: raw,
      })
      if (!canReadField || access.kind === 'false') filteredRows[i][owner.foreignKey] = null
    }

    if (access.kind === 'true' || access.kind === 'false') continue

    const idsByRow = rawRows.map((row) => row[owner.foreignKey])
    const idMap = new Map<string, unknown>()
    for (let i = 0; i < filteredRows.length; i++) {
      if (filteredRows[i][owner.foreignKey] === null) continue
      const value = idsByRow[i]
      if (value !== null && value !== undefined) idMap.set(String(value), value)
    }
    if (idMap.size === 0) continue

    const ops = await whereCombinators()
    const visible = await withOrigin('engine', () =>
      collectionFor(binding.ormHandle, related.listName)
        .where((model) => lowerWhere(access, model, ops))
        .where((model) => identityIn(model, related.listName, [...idMap.values()] as RowLockKey[]))
        .select('id')
        .all(),
    )
    const visibleIds = new Set(visible.map((row) => String(row.id)))

    for (let i = 0; i < filteredRows.length; i++) {
      if (filteredRows[i][owner.foreignKey] === null) continue
      const value = idsByRow[i]
      if (value === null || value === undefined) continue
      if (!visibleIds.has(String(value))) filteredRows[i][owner.foreignKey] = null
    }
  }

  for (const plan of resolvedIncludes) {
    const relatedListConfig = binding.config.lists[plan.relatedListName]
    if (relatedListConfig === undefined) continue

    const nestedFiltered: OrmRow[] = []
    const nestedRaw: OrmRow[] = []
    for (let i = 0; i < filteredRows.length; i++) {
      const filteredValue = filteredRows[i][plan.relation]
      const rawValue = rawRows[i][plan.relation]
      if (Array.isArray(filteredValue) && Array.isArray(rawValue)) {
        for (let j = 0; j < filteredValue.length; j++) {
          if (isRow(filteredValue[j]) && isRow(rawValue[j])) {
            nestedFiltered.push(filteredValue[j])
            nestedRaw.push(rawValue[j])
          }
        }
      } else if (isRow(filteredValue) && isRow(rawValue)) {
        nestedFiltered.push(filteredValue)
        nestedRaw.push(rawValue)
      }
    }
    if (nestedFiltered.length === 0) continue
    await narrowUnincludedForeignKeys(
      binding,
      nestedFiltered,
      nestedRaw,
      plan.relatedListName,
      relatedListConfig,
      plan.includes,
    )
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
 * A `combine` that named the relation's rows under one key stands in that
 * array instead of `[]`, so those rows reach Field Visibility exactly as an
 * unreduced relation's do and {@link restoreReductions} writes them back
 * beside the counts.
 *
 * A relation that is both reduced and a live declared dependency of a
 * computed field returned alongside it (#1357) is the third case: its
 * `IncludePlan.declaredRows` fetched real rows purely for that declaration,
 * under {@link DECLARED_ROWS_BRANCH_KEY}, and those are what stand in here —
 * never `[]` — so the declaring hook's `needs` sees them via its own `item`,
 * and a relationship `read` rule that inspects `item.<reducedRelation>`
 * decides against real rows rather than an empty array. Field Visibility
 * still must not compute over them as though they were an ordinary relation
 * (ADR-0051): `ReducedDeclaredKeys` (`select.ts`) is what tells it to treat
 * this key as a raw pass-through, and {@link restoreReductions} overwrites it
 * with the reduction's own value regardless of what Field Visibility computed
 * for it.
 *
 * Known limits: a relation reduced with NEITHER a rows branch of its own NOR
 * a live declared dependency still stands in `[]`, so a relationship `read`
 * rule inspecting `item.<reducedRelation>` without declaring it via `needs`
 * decides on an empty array rather than on what the count counted — the
 * common `item.posts.length > 0` shape fails closed there, and an inverted
 * `item.posts.length === 0` fails open. A rule that reaches into a relation
 * must declare it, the same requirement `needs` already states for a computed
 * field's `resolveOutput`.
 */
function maskReductions(row: OrmRow, plans: readonly IncludePlan[]): OrmRow {
  if (!reduces(plans)) return row
  const masked: OrmRow = { ...row }
  for (const plan of plans) {
    if (plan.reduce !== undefined) {
      const rows =
        plan.declaredRows !== undefined
          ? declaredRowsOf(row[plan.relation])
          : combinedRows(row[plan.relation], rowsKeyOf(plan))
      masked[plan.relation] = reduces(plan.includes)
        ? rows.map((related) => maskReductions(related, plan.includes))
        : rows
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

/** The key a `combine` returned the relation's own rows under, if it named one. */
function rowsKeyOf(plan: IncludePlan): string | undefined {
  if (plan.reduce?.kind !== 'combine') return undefined
  for (const branch of plan.reduce.branches) {
    if (branch.kind === 'rows') return branch.key
  }
  return undefined
}

/** The rows an internal declared-dependency branch fetched (`IncludePlan.declaredRows`). */
function declaredRowsOf(value: unknown): OrmRow[] {
  return combinedRows(value, DECLARED_ROWS_BRANCH_KEY)
}

/** The rows a `combine` returned under {@link rowsKeyOf}, or `[]` for a bare count. */
function combinedRows(value: unknown, key: string | undefined): OrmRow[] {
  if (key === undefined || !isRow(value)) return []
  const rows = value[key]
  return Array.isArray(rows) ? rows.filter(isRow) : []
}

/**
 * The reduction's own value, once {@link declaredRowsBranch}'s internal
 * branch is spliced back out: a bare count unwrapped from
 * {@link DECLARED_COUNT_BRANCH_KEY}, or a caller's own combine object with
 * {@link DECLARED_ROWS_BRANCH_KEY} removed. The caller never sees either
 * reserved key.
 */
function publicReductionValue(raw: unknown, reduce: ReducePlan): unknown {
  if (!isRow(raw)) return raw
  if (reduce.kind === 'count') return raw[DECLARED_COUNT_BRANCH_KEY] ?? 0
  const publicValue: Record<string, unknown> = { ...raw }
  delete publicValue[DECLARED_ROWS_BRANCH_KEY]
  return publicValue
}

/** Write each reduced relation back, under the keys Field Visibility kept. */
function restoreReductions(shown: OrmRow, source: OrmRow, plans: readonly IncludePlan[]): void {
  for (const plan of plans) {
    if (plan.reduce !== undefined) {
      if (!(plan.relation in shown)) continue
      const raw = source[plan.relation]
      if (plan.declaredRows !== undefined) {
        shown[plan.relation] = publicReductionValue(raw, plan.reduce)
        continue
      }
      const key = rowsKeyOf(plan)
      if (key === undefined || !isRow(raw)) {
        shown[plan.relation] = raw
        continue
      }
      const kept = shown[plan.relation]
      if (reduces(plan.includes) && Array.isArray(kept)) {
        const rows = combinedRows(raw, key)
        kept.forEach((related, index) => {
          const original = rows[index]
          if (isRow(related) && isRow(original)) restoreReductions(related, original, plan.includes)
        })
      }
      shown[plan.relation] = { ...raw, [key]: kept }
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

/**
 * What every terminal returns rows through — the one place a row this engine
 * read becomes a row a caller may see, and the only place any foreign-key
 * pass runs. `all()`, `first()`, the `forUpdate()` lane and `nearest()` all
 * come through here, so none of them can drift apart on what a column reads
 * as, and neither can a hook or a `read` rule.
 *
 * The batch is what lets {@link narrowUnincludedForeignKeys} resolve a
 * to-one this read never named at all for a whole page in one query per
 * relation rather than one per row.
 */
async function visibleRows(
  binding: ReadBinding,
  rows: readonly OrmRow[],
  plan: ReadPlan,
): Promise<OrmRow[]> {
  const { listConfig, context, config, listName } = binding
  const results = await Promise.all(
    rows.map(async (row) => {
      const filtered = await filterReadableFields(
        maskReductions(row, plan.includes),
        listConfig.fields,
        { session: context.session, context },
        config,
        0,
        listName,
        plan.additions,
        plan.selection,
        emptyToOneAccessVisibilityTree(),
        emptyCountAccessDenialTree(),
        plan.reducedDeclared,
      )
      applyForeignKeys(filtered, plan.includes)
      restoreReductions(filtered, row, plan.includes)
      return filtered
    }),
  )
  await narrowUnincludedForeignKeys(binding, results, rows, listName, listConfig, plan.includes)
  return results
}

/** `all()` is the terminal every plan member was designed for. */
const ALL_DISPOSITIONS: PlanDispositions = {
  predicates: 'applied',
  orders: 'applied',
  includes: 'applied',
  projection: 'applied',
  selection: 'applied',
  additions: 'applied',
  reducedDeclared: 'applied',
  limit: 'applied',
  offset: 'applied',
  distinct: 'applied',
  cursor: 'applied',
  forUpdate: 'applied',
}

/**
 * `first()` differs from `all()` in one member: the terminal is its own row
 * bound, so a `limit` beside it changes nothing.
 *
 * `offset` is NOT that — `first()` has no offset of its own, so
 * `.orderBy(…).offset(10).first()` is `LIMIT 1 OFFSET 10` and answers with the
 * eleventh row rather than the first.
 */
const FIRST_DISPOSITIONS: PlanDispositions = { ...ALL_DISPOSITIONS, limit: 'inapplicable' }

/**
 * What `all()` and `first()` pass, which mark no member `refused` — reached
 * only if one of their dispositions above ever becomes one.
 */
function unreachableRefusal(members: readonly string[]): never {
  throw new ValidationError([`Nothing is refused here, yet ${quoted(members)} was.`])
}

/**
 * The lane this read locks through, and where its rows' identity lives —
 * resolved before the scoped read runs, so a list the contract cannot lock and
 * a bound the terminal will not honour are both refused before any statement
 * is issued (ADR-0062).
 */
function lockLane(
  binding: ReadBinding,
  plan: ReadPlan,
  member: string,
  bound: number | undefined,
): { lane: RowLockLane; identity: RowLockIdentity } | undefined {
  if (plan.forUpdate !== true) return undefined
  if (binding.lock === undefined) throw new RowLockUnavailableError(member)
  if (bound !== undefined && bound > ROW_LOCK_MAX_KEYS) {
    throw new RowLockKeyLimitExceededError(binding.listName, bound)
  }
  return { lane: binding.lock, identity: binding.lock.identity(binding.listName) }
}

/**
 * Lock the rows the scoped read returned, and keep the ones that were still
 * there.
 *
 * No keys, no statement: an empty scoped read — unmatched, or scoped away —
 * has nothing to lock, and `IN ()` is a Postgres syntax error rather than an
 * empty result (ADR-0062). A row whose key the lock did not come back with
 * vanished between the two statements and is dropped (ADR-0047).
 */
async function locked(
  taken: { lane: RowLockLane; identity: RowLockIdentity },
  listName: string,
  rows: readonly OrmRow[],
): Promise<OrmRow[]> {
  const column = taken.identity.column
  const keys: RowLockKey[] = []
  for (const row of rows) {
    const value = row[column]
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new RowLockIdentityError(
        listName,
        `the read returned a row with no "${column}" to lock it by`,
      )
    }
    keys.push(value)
  }
  if (keys.length === 0) return []
  const held = new Set<RowLockKey>(await taken.lane.lock(listName, taken.identity, keys))
  return rows.filter((row) => {
    const value = row[column]
    return (typeof value === 'string' || typeof value === 'number') && held.has(value)
  })
}

async function runAll(binding: ReadBinding, state: QueryState): Promise<OrmRow[]> {
  const plan = await resolvePlan(binding, state)
  if (plan === null) return []
  const taken = lockLane(binding, plan, 'all().forUpdate()', plan.limit)
  const collection = scope(
    binding,
    plan,
    await whereCombinators(),
    ALL_DISPOSITIONS,
    unreachableRefusal,
  )
  const read = await withOrigin('engine', () => collection.all())
  const rows = taken === undefined ? read : await locked(taken, binding.listName, read)
  return await visibleRows(binding, rows, plan)
}

async function runFirst(binding: ReadBinding, state: QueryState): Promise<OrmRow | null> {
  const plan = await resolvePlan(binding, state)
  if (plan === null) return null
  const taken = lockLane(binding, plan, 'first().forUpdate()', 1)
  const collection = scope(
    binding,
    plan,
    await whereCombinators(),
    FIRST_DISPOSITIONS,
    unreachableRefusal,
  )
  const read = await withOrigin('engine', () => collection.first())
  if (read === null) return null
  const rows = taken === undefined ? [read] : await locked(taken, binding.listName, [read])
  if (rows.length === 0) return null
  return (await visibleRows(binding, rows, plan))[0]
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
 * An aggregate counts the rows the predicates match.
 *
 * A sort, an include and a projection cannot change that count — an include is
 * an eager load, a sort is over rows this terminal returns none of (and
 * Postgres refuses an `ORDER BY` beside a bare aggregate outright), and a count
 * materialises no rows for a projection to narrow or for Field Visibility to
 * strip. `distinct`, `cursor`, `limit` and `offset` all WOULD change the
 * answer, and none of them can be expressed beside a bare aggregate — SQL's
 * `LIMIT`/`OFFSET` bound the aggregate's own single result row, not the rows
 * it counts — so each is refused rather than dropped.
 */
const AGGREGATE_DISPOSITIONS: PlanDispositions = {
  predicates: 'applied',
  orders: 'inapplicable',
  includes: 'inapplicable',
  projection: 'inapplicable',
  selection: 'inapplicable',
  additions: 'inapplicable',
  reducedDeclared: 'inapplicable',
  limit: 'refused',
  offset: 'refused',
  distinct: 'refused',
  cursor: 'refused',
  forUpdate: 'refused',
}

function refuseUncountable(listName: string): (members: readonly string[]) => never {
  return (members) => {
    throw new ValidationError([
      `Cannot aggregate "${listName}" over a read that composed ${quoted(members)} — an ` +
        `aggregate counts the rows the predicates match, so it returns no rows to bound, page, ` +
        `collapse or lock. Aggregate the predicates alone, or read the rows.`,
    ])
  }
}

/**
 * Run an aggregate: the same scoped read every other terminal runs, counted in
 * the database instead of materialised.
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
  const spec = build(aggregations)
  const keys = specKeys(spec)

  const plan = await resolvePlan(binding, state)
  if (plan === null) return zeroed(keys)
  checkSpec(binding.listName, spec)

  const collection = scope(
    binding,
    plan,
    await whereCombinators(),
    AGGREGATE_DISPOSITIONS,
    refuseUncountable(binding.listName),
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
 * A search ranks by distance, and the ranking is this query's leading order.
 *
 * So a cursor has no axis left to resume along and a `distinctOn` can never be
 * the leading sort; a plain `distinct` would collapse rows the top-K has
 * already been computed over, which makes `limit` inexact; and an `offset`
 * would page a ranking whose scores are recomputed here in float64 over a
 * float4 column, so the page boundary is exactly where the two can disagree.
 * `options.limit` is this terminal's own bound (ADR-0045), and `orders` is
 * rebuilt distance-first below so a caller's own sort becomes the tiebreak
 * rather than competing with the ranking.
 */
const NEAREST_DISPOSITIONS: PlanDispositions = {
  predicates: 'applied',
  orders: 'inapplicable',
  includes: 'applied',
  projection: 'applied',
  selection: 'applied',
  additions: 'applied',
  reducedDeclared: 'applied',
  limit: 'inapplicable',
  offset: 'refused',
  distinct: 'refused',
  cursor: 'refused',
  forUpdate: 'refused',
}

function refuseUnrankable(listName: string): (members: readonly string[]) => never {
  return (members) => {
    throw new ValidationError([
      `Cannot search "${listName}" over a read that composed ${quoted(members)} — the ranking is ` +
        `this query's leading order, so a cursor has no axis to resume along, an offset pages a ` +
        `ranking whose scores this engine recomputes, and a distinct would collapse rows the ` +
        `nearest limit is already counted over. A ranking is not a gate, so it takes no row lock ` +
        `either. Search the predicates alone.`,
    ])
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

  // Derived from the resolved plan rather than rebuilt beside it, so a member
  // added to `ReadPlan` reaches this query too.
  let collection = scope(
    binding,
    {
      ...plan,
      predicates: [...plan.predicates, present(near)],
      // The score is recomputed from the row's own vector, so the column has
      // to survive the projection even when the caller did not name it. It is
      // outside `projection.caller`, so Field Visibility strips it back out.
      projection:
        plan.projection.columns === undefined || plan.projection.columns.includes(near.column)
          ? plan.projection
          : { ...plan.projection, columns: [...plan.projection.columns, near.column] },
    },
    ops,
    NEAREST_DISPOSITIONS,
    refuseUnrankable(binding.listName),
  ).orderBy([
    (model) => vectors.order(near, model),
    ...plan.orders.map((order) => (model: PredicateAccessor) => lowerOrder(order, model)),
  ])
  if (bound !== null) {
    collection = collection.where((model) => vectors.bound(near, model, bound))
  }

  const rows = await withOrigin('engine', () => collection.limit(near.limit).all())
  const scores = rows.map((row) => score(near, row))
  const items = await visibleRows(binding, rows, plan)
  return items.map((item, index) => ({ item, score: scores[index] }))
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
    select: (...fields: readonly string[]) => query(binding, { ...state, fields }),
    limit: (count: number) => query(binding, { ...state, limit: count }),
    offset: (count: number) => query(binding, { ...state, offset: count }),
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
    forUpdate: () => query(binding, { ...state, lock: true }),
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
  return query(binding, {
    predicates: [],
    orders: [],
    includes: [],
    distincts: [],
    lock: false,
  })
}
