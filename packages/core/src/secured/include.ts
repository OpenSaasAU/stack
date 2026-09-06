// Include refinements: the caller's include tree, resolved into a plan whose
// every key the config declares and whose every level carries the related
// list's Access Filter as a refinement `where`. Nothing here imports the ORM —
// the plan meets a collection in `read.ts`. See ADR-0043, ADR-0044, ADR-0051,
// ADR-0058, ADR-0061 and ADR-0064.

import type { FieldConfig, ListConfig, TypeInfo } from '../config/types.js'
import { getRelatedListConfig, resolveSyntheticReverseRelation } from '../access/engine.js'
import { classifyRowIndependentRead } from '../access/field-access.js'
import { resolveDeclaredDependencies } from '../access/declared-dependencies.js'
import { resolveQueryField } from '../access/query-validation.js'
import { READ_INCLUDE_MAX_DEPTH } from '../access/depth-limits.js'
import { AccessScopeDepthExceededError } from '../access/errors.js'
import {
  resolveOrderBy,
  resolveRelatedAccessPlan,
  resolveWhere,
  unqueryableKey,
  type OrderBy,
  type OrderPlan,
  type ResolveContext,
  type Where,
  type WherePlan,
} from './vocabulary.js'

/**
 * A related read, composed the same way the top-level one is. Every method
 * returns a new value; there is no terminal, because the parent's terminal is
 * the only thing that runs.
 */
export interface SecuredRefinement {
  /** Narrow the related rows. Composes; the related list's `query` access is ANDed in regardless. */
  where(predicate: Where): SecuredRefinement
  /** Sort the related rows by the related list's own scalar columns. */
  orderBy(order: OrderBy | readonly OrderBy[]): SecuredRefinement
  /** At most this many related rows, per parent row. */
  limit(count: number): SecuredRefinement
  /** Skip this many related rows, per parent row. */
  offset(count: number): SecuredRefinement
  /** Reach one hop further. Counts against the read-include depth cap. */
  include(name: string, refine?: Refinement): SecuredRefinement
}

/** What `.include()`'s second argument is: a refinement in, a refinement out. */
export type Refinement = (refinement: SecuredRefinement) => SecuredRefinement

/**
 * Thrown when a refinement callback returns something this engine did not
 * hand it — most often a callback that composed a value and then forgot to
 * return it. Loud rather than silent: dropping the refinement would run the
 * include unscoped by everything the caller wrote.
 */
export class InvalidRefinementError extends Error {
  constructor(readonly relation: string) {
    super(
      `The refinement for include("${relation}") did not return a refinement. A refinement ` +
        `callback must return the value it composed — \`(rows) => rows.where(...)\` — rather ` +
        `than composing one and returning something else.`,
    )
    this.name = 'InvalidRefinementError'
  }
}

/** One relation the caller named, and everything they composed onto it. */
export interface IncludeRequest {
  readonly name: string
  readonly predicates: readonly Where[]
  readonly orders: readonly OrderBy[]
  readonly limit?: number
  readonly offset?: number
  readonly includes: readonly IncludeRequest[]
}

/** A resolved include: every key checked, the Access Filter already folded in. */
export interface IncludePlan {
  readonly relation: string
  readonly relatedListName: string
  /** What the relation decodes to: one row (or `null`), or an array (ADR-0058). */
  readonly arity: 'one' | 'many'
  readonly predicates: readonly WherePlan[]
  readonly orders: readonly OrderPlan[]
  readonly limit?: number
  readonly offset?: number
  readonly includes: readonly IncludePlan[]
}

function isOrderList(order: OrderBy | readonly OrderBy[]): order is readonly OrderBy[] {
  return Array.isArray(order)
}

/** `orderBy` takes one sort or several; both spellings compose the same list. */
export function orderList(order: OrderBy | readonly OrderBy[]): readonly OrderBy[] {
  return isOrderList(order) ? order : [order]
}

/**
 * The request behind a refinement value. A `WeakMap` rather than a property so
 * the refinement stays as opaque as the wrapper it belongs to (ADR-0041): a
 * caller holding one can reach nothing but the methods above.
 */
const requests = new WeakMap<SecuredRefinement, IncludeRequest>()

function refinement(request: IncludeRequest): SecuredRefinement {
  const value: SecuredRefinement = {
    where: (predicate) =>
      refinement({ ...request, predicates: [...request.predicates, predicate] }),
    orderBy: (order) =>
      refinement({ ...request, orders: [...request.orders, ...orderList(order)] }),
    limit: (count) => refinement({ ...request, limit: count }),
    offset: (count) => refinement({ ...request, offset: count }),
    include: (name, refine) =>
      refinement({
        ...request,
        includes: [...request.includes, buildIncludeRequest(name, refine)],
      }),
  }
  requests.set(value, request)
  return value
}

/** Run a caller's refinement callback and recover the request it composed. */
export function buildIncludeRequest(name: string, refine?: Refinement): IncludeRequest {
  const base: IncludeRequest = { name, predicates: [], orders: [], includes: [] }
  if (refine === undefined) return base
  const composed = requests.get(refine(refinement(base)))
  if (composed === undefined) throw new InvalidRefinementError(name)
  return composed
}

interface IncludeTarget {
  relatedListName: string
  relatedListConfig: ListConfig<TypeInfo>
  arity: 'one' | 'many'
  /** The relationship field this key names, or `undefined` for a synthetic back-relation. */
  fieldConfig: FieldConfig | undefined
}

/**
 * Resolve an include key against the list config. A synthetic back-relation
 * (`from_<SourceList>_<field>`, what a list-only `ref` puts on the target
 * list) resolves to the declared field it stands for, so it is scoped by the
 * source list's `query` access exactly as a declared relation would be
 * (ADR-0061). Anything else — an undeclared key, a scalar, the foreign-key
 * column a to-one implies — is refused with the message an undeclared key
 * gets, so the refusal is not an existence oracle for a read-gated relation.
 */
function resolveIncludeTarget(name: string, ctx: ResolveContext): IncludeTarget {
  const resolved = resolveQueryField(name, ctx.listConfig.fields)
  if (resolved?.isRelationship === true) {
    const related = getRelatedListConfig(resolved.fieldConfig.ref, ctx.config)
    if (!related) throw unqueryableKey(ctx.listName, name)
    return {
      relatedListName: related.listName,
      relatedListConfig: related.listConfig,
      arity: resolved.fieldConfig.many === true ? 'many' : 'one',
      fieldConfig: resolved.fieldConfig,
    }
  }
  if (resolved === undefined) {
    const synthetic = resolveSyntheticReverseRelation(name, ctx.listName, ctx.config)
    if (synthetic) {
      return {
        relatedListName: synthetic.sourceListName,
        relatedListConfig: synthetic.sourceListConfig,
        arity: 'many',
        fieldConfig: undefined,
      }
    }
  }
  throw unqueryableKey(ctx.listName, name)
}

/**
 * Whether this relation is left out of the include before the query runs
 * (ADR-0044). Only a **row-independent** denial omits: a rule that reaches
 * into `item` cannot be answered without one, so the relation is fetched and
 * Field Visibility decides. A relation in a live declared dependency set is
 * exempt — the declaring field's hook is entitled to it, and Field Visibility
 * strips it from the caller's result afterwards (ADR-0051).
 *
 * This is an optimisation that can only narrow. Field Visibility re-checks
 * every relation it is handed regardless, so a missed omission is a wasted
 * join and never a leak.
 */
async function isOmittedBeforeQuery(
  name: string,
  target: IncludeTarget,
  ctx: ResolveContext,
): Promise<boolean> {
  if (!ctx.checkFieldRead) return false
  if (target.fieldConfig?.access === undefined) return false
  const answer = await classifyRowIndependentRead(target.fieldConfig.access, {
    session: ctx.session,
    context: ctx.context,
  })
  if (answer !== 'deny') return false
  return !resolveDeclaredDependencies(ctx.config, ctx.listName).relations.has(name)
}

async function resolveInclude(
  request: IncludeRequest,
  ctx: ResolveContext,
  depth: number,
): Promise<IncludePlan | null> {
  const target = resolveIncludeTarget(request.name, ctx)
  const related: ResolveContext = {
    ...ctx,
    listName: target.relatedListName,
    listConfig: target.relatedListConfig,
  }

  // Resolved before the omission is decided, so a refinement naming a key the
  // related list does not declare is refused whether or not this session may
  // see the relation. Deciding the omission first would make the presence of
  // the refusal itself say which relations are readable (ADR-0031).
  const predicates: WherePlan[] = []
  for (const predicate of request.predicates) {
    predicates.push(await resolveWhere(predicate, related))
  }
  const orders = await resolveOrderBy(request.orders, related)
  const includes = await resolveIncludes(request.includes, related, depth + 1)

  if (await isOmittedBeforeQuery(request.name, target, ctx)) return null

  const access = await resolveRelatedAccessPlan(
    { listName: target.relatedListName, listConfig: target.relatedListConfig },
    ctx,
  )
  if (access.kind !== 'true') predicates.push(access)

  return {
    relation: request.name,
    relatedListName: target.relatedListName,
    arity: target.arity,
    predicates,
    orders,
    limit: request.limit,
    offset: request.offset,
    includes,
  }
}

/**
 * Resolve one level of the caller's include tree.
 *
 * `depth` counts the levels of that tree and nothing else. The engine's own
 * widening for a declared dependency set does not descend through here, so it
 * cannot push a legal read over the cap — a caller must never be refused for
 * field configuration they cannot see (ADR-0043, ADR-0051). This is also not
 * the Access Filter's own recursion bound: that one bounds how far a relation
 * key inside an access rule expands and lives in `vocabulary.ts`.
 */
export async function resolveIncludes(
  requests: readonly IncludeRequest[],
  ctx: ResolveContext,
  depth: number,
): Promise<IncludePlan[]> {
  if (requests.length === 0) return []
  if (depth >= READ_INCLUDE_MAX_DEPTH) {
    throw new AccessScopeDepthExceededError(ctx.listName, requests[0].name, depth)
  }
  const plans: IncludePlan[] = []
  for (const request of requests) {
    const plan = await resolveInclude(request, ctx, depth)
    if (plan !== null) plans.push(plan)
  }
  return plans
}
