// The secured read surface: `context.db.<List>` as an opaque wrapper over a
// Prisma 8 collection, its `where`/`orderBy` composition, and the
// `all()`/`first()` terminals the engine owns. See ADR-0041, ADR-0044,
// ADR-0046, ADR-0055 and ADR-0058.

import type { AnyExpression, OrderByItem } from '@prisma/orm-postgres/relational-core'
import type { OpenSaasConfig, ListConfig, TypeInfo } from '../config/types.js'
import type { AccessContext, OrmClient, OrmRow, PrismaFilter, Session } from '../access/types.js'
import { checkAccess, filterReadableFields } from '../access/index.js'
import { withOrigin } from '../origin.js'
import {
  lowerOrder,
  lowerWhere,
  whereCombinators,
  type PredicateAccessor,
  type WhereCombinators,
} from './lower.js'
import {
  resolveOrderBy,
  resolveWhere,
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

export { AccessFilterRecursionError, ACCESS_FILTER_MAX_DEPTH } from './vocabulary.js'
export { InvalidRefinementError } from './include.js'
export type { Refinement, SecuredRefinement } from './include.js'
export type {
  OrderBy,
  OrderDirection,
  RelationCondition,
  ScalarOperators,
  Where,
  WhereCondition,
  WhereValue,
} from './vocabulary.js'

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
  /** Every row this session may see. `[]` when the read is denied. */
  all(): Promise<TRow[]>
  /** The first row this session may see, or `null` — denied or absent alike. */
  first(): Promise<TRow | null>
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
  include(
    name: string,
    refine: (child: RefinableCollection) => RefinableCollection,
  ): RefinableCollection
}

interface ReadableCollection extends RefinableCollection {
  where(predicate: (model: PredicateAccessor) => AnyExpression): ReadableCollection
  orderBy(selection: readonly ((model: PredicateAccessor) => OrderByItem)[]): ReadableCollection
  include(
    name: string,
    refine: (child: RefinableCollection) => RefinableCollection,
  ): ReadableCollection
  all(): PromiseLike<OrmRow[]>
  first(): Promise<OrmRow | null>
}

function isReadableCollection(value: unknown): value is ReadableCollection {
  if (typeof value !== 'object' || value === null) return false
  for (const member of ['where', 'orderBy', 'include', 'all', 'first']) {
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
  readonly includes: readonly IncludeRequest[]
}

/** A resolved read: the predicates to AND, the sort to apply, the tree to reach. */
interface ReadPlan {
  readonly predicates: readonly WherePlan[]
  readonly orders: readonly OrderPlan[]
  readonly includes: readonly IncludePlan[]
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

  return { predicates, orders, includes }
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
): RefinableCollection {
  let refined = collection
  for (const predicate of plan.predicates) {
    refined = refined.where((model) => lowerWhere(predicate, model, ops))
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
  for (const include of plan.includes) {
    collection = collection.include(include.relation, (child) => refine(child, include, ops))
  }
  return collection
}

function isRow(value: unknown): value is OrmRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Undo the foreign-key column an include overwrites.
 *
 * Prisma 8 aliases an include by the relation's name and a scalar column by
 * its physical name, and the contract maps a to-one's foreign key onto the
 * relation's own name (`contract/derive.ts`), so the two aliases collide and
 * the decoder writes the include's payload into the foreign-key key as well.
 * Left alone that is a leak, not a cosmetic defect: a relation Field
 * Visibility strips survives under its foreign key.
 *
 * The value written back is the one the caller may see — the related row's id
 * when the relation is visible, `null` when the Access Filter scoped it away,
 * which is what a denied to-one means everywhere else (ADR-0058).
 */
function repairForeignKeys(row: OrmRow, plans: readonly IncludePlan[]): void {
  for (const plan of plans) {
    const value = row[plan.relation]
    if (plan.arity === 'one') {
      const key = `${plan.relation}Id`
      const stored = row[key]
      if (stored !== undefined && typeof stored === 'object' && stored !== null) {
        row[key] = isRow(value) ? value.id : null
      }
    }
    if (plan.includes.length === 0) continue
    for (const related of Array.isArray(value) ? value : [value]) {
      if (isRow(related)) repairForeignKeys(related, plan.includes)
    }
  }
}

function visible(binding: ReadBinding, row: OrmRow, plan: ReadPlan): Promise<OrmRow> {
  const { listConfig, context, config, listName } = binding
  repairForeignKeys(row, plan.includes)
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
  return await Promise.all(rows.map((row) => visible(binding, row, plan)))
}

async function runFirst(binding: ReadBinding, state: QueryState): Promise<OrmRow | null> {
  const plan = await resolvePlan(binding, state)
  if (plan === null) return null
  const collection = scope(binding, plan, await whereCombinators())
  const row = await withOrigin('engine', () => collection.first())
  return row === null ? null : await visible(binding, row, plan)
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
    all: () => runAll(binding, state),
    first: () => runFirst(binding, state),
  }
}

/**
 * The read members of one list's secured surface, bound to `ormHandle` and
 * `context`. The collection is held by the closure and never handed out: no
 * `Collection` and no `CollectionState` is reachable from the returned value
 * or its type (ADR-0041, ADR-0057).
 */
export function createSecuredRead(binding: ReadBinding): SecuredQuery {
  return query(binding, { predicates: [], orders: [], includes: [] })
}
