// Include refinements: the caller's include tree, resolved into a plan whose
// every key the config declares and whose every level carries the related
// list's Access Filter as a refinement `where`. Nothing here imports the ORM —
// the plan meets a collection in `read.ts`. See ADR-0043, ADR-0044, ADR-0051,
// ADR-0058, ADR-0061 and ADR-0064.
//
// Known limits
//
// - A nested include of a to-one whose foreign-key column is mapped onto the
//   relation's own name — the contract's default (`fields/index.ts`) — is
//   refused rather than served: the include alias and the column collide and
//   the database answers `column reference "<name>" is ambiguous`. The schema
//   change that renames the column is #1236; when it lands,
//   {@link NestedToOneIncludeError} and the test that asserts it are the
//   deletions. The same collision under a relation the WIDENING added is
//   left out instead of refused, so a computed field declaring a to-one on a
//   nested branch sees it absent — the behaviour that predated the widening,
//   and #1236's to fix.
// - The pre-query omission is observable. A relation the caller may not read
//   comes back absent while an undeclared one is refused, so relation NAMES
//   can be enumerated by a caller who can already read the list. Relation
//   names are configuration rather than data, and closing it would mean either
//   fetching every denied relation or varying the refusal by session — see
//   {@link isOmittedBeforeQuery}.

import type {
  ContractForeignKeyDescriptor,
  FieldConfig,
  ListConfig,
  TypeInfo,
} from '../config/types.js'
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
import { resolveProjection, UNPROJECTED, type ProjectionPlan } from './select.js'

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
  /**
   * Return exactly these of the related list's own fields. Replaces any
   * previous call rather than accumulating, and leaves relations this
   * refinement includes on the row.
   */
  select(...fields: readonly string[]): SecuredRefinement
  /**
   * Reach one hop further. Counts against the read-include depth cap.
   *
   * A to-one whose foreign-key column carries the relation's own name — the
   * contract's default — is refused here until #1236 renames the column; see
   * {@link NestedToOneIncludeError}.
   */
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

/**
 * Thrown when one read names the same relation twice. Neither answer the two
 * requests could be given is safe to pick silently: merging them would AND a
 * refinement the caller wrote for one branch into the other, and letting one
 * win would drop the other's `where` — an include running unscoped by
 * something the caller asked for. Refused instead, naming the relation.
 */
export class DuplicateIncludeError extends Error {
  constructor(
    readonly listName: string,
    readonly relation: string,
  ) {
    super(
      `Cannot include "${listName}.${relation}" twice in one read. Compose the two refinements ` +
        `into a single include("${relation}", …) rather than naming the relation again — the ` +
        `engine refuses the pair rather than choosing which one applies.`,
    )
    this.name = 'DuplicateIncludeError'
  }
}

/**
 * Thrown when a nested include names a to-one whose foreign-key column carries
 * the relation's own name. See the `Known limits` note at the top of this
 * module: the include alias and the column collide in the emitted SQL, so the
 * read is refused here rather than reaching the database and failing with
 * `column reference "…" is ambiguous`. Tracked as #1236.
 */
export class NestedToOneIncludeError extends Error {
  constructor(
    readonly listName: string,
    readonly relation: string,
  ) {
    super(
      `Cannot include "${listName}.${relation}" inside another include: a to-one relation whose ` +
        `foreign-key column is mapped onto the relation's own name collides with the include's ` +
        `alias one level down, and the database refuses the query as ambiguous. Read this ` +
        `relation from a separate top-level include, or rename the column with ` +
        `\`db: { foreignKey: { map: '…' } }\`. Tracked as ` +
        `https://github.com/OpenSaasAU/stack/issues/1236.`,
    )
    this.name = 'NestedToOneIncludeError'
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
  /** The related list's own `.select()`, or `undefined` for its full width. */
  readonly fields?: readonly string[]
}

/** A resolved include: every key checked, the Access Filter already folded in. */
export interface IncludePlan {
  readonly relation: string
  readonly relatedListName: string
  /** What the relation decodes to: one row (or `null`), or an array (ADR-0058). */
  readonly arity: 'one' | 'many'
  /**
   * The contract member the relation's foreign key decodes to (`<field>Id`),
   * on the to-one side that owns one. `undefined` for a to-many, for the
   * non-owning side of a one-to-one and for a synthetic back-relation, none of
   * which carry a column here. Read by the foreign-key pass in `read.ts`.
   */
  readonly foreignKey?: string
  readonly predicates: readonly WherePlan[]
  readonly orders: readonly OrderPlan[]
  readonly limit?: number
  readonly offset?: number
  readonly includes: readonly IncludePlan[]
  /** The related read's own projection, already widened (ADR-0041). */
  readonly projection: ProjectionPlan
  /**
   * Whether only the widening asked for this branch. A declared branch
   * delivers stored columns to the hooks that named it and is stripped from
   * the caller's result; nothing on it computes, so nothing on it declares
   * (ADR-0051).
   */
  readonly declared: boolean
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
    select: (...fields) => refinement({ ...request, fields }),
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
  /** The foreign key this side owns, as the contract derives it. */
  foreignKey: ContractForeignKeyDescriptor | undefined
}

/**
 * The foreign key the contract gives this relation, asked of the field itself
 * rather than re-derived here. Neither half is a function of the field's name
 * alone: `db: { foreignKey: { map } }` renames the physical column, and the
 * non-owning side of a one-to-one owns no column at all.
 */
function foreignKeyOf(
  name: string,
  fieldConfig: FieldConfig,
  ctx: ResolveContext,
): ContractForeignKeyDescriptor | undefined {
  const descriptor = fieldConfig.getContractField?.(name, ctx.listName, ctx.config)
  if (descriptor === undefined || descriptor.kind !== 'relation') return undefined
  return descriptor.foreignKey
}

/**
 * Resolve an include key against the list config. A synthetic back-relation
 * (`from_<SourceList>_<field>`, what a list-only `ref` puts on the target
 * list) resolves to the declared field it stands for, so it is scoped by the
 * source list's `query` access exactly as a declared relation would be
 * (ADR-0061). Anything else — an undeclared key, a scalar, the foreign-key
 * column a to-one implies — is refused with the message an undeclared key
 * gets, so this refusal carries no more than the key's own name back: a
 * read-gated relation resolves here exactly as a readable one does, and the
 * omission that follows is the only thing that separates them (ADR-0031, and
 * the `Known limits` note above).
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
      foreignKey: foreignKeyOf(name, resolved.fieldConfig, ctx),
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
        foreignKey: undefined,
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
 *
 * It is, however, observable — see the `Known limits` note at the top of this
 * module. ADR-0031's indistinguishable refusal covers the KEY resolution
 * above, which answers identically for a readable and a read-denied relation;
 * it does not extend to the omission, whose whole purpose is to leave the
 * relation out.
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
  declared: boolean,
): Promise<IncludePlan | null> {
  const target = resolveIncludeTarget(request.name, ctx)
  if (depth > 0 && target.arity === 'one' && target.foreignKey?.map === request.name) {
    // A refusal the caller cannot act on is not a refusal worth raising: the
    // widening is the engine's own, so a declared branch the alias collision
    // blocks is left out here rather than failing a read whose call site
    // names nothing wrong. See the `Known limits` note above.
    if (declared) return null
    throw new NestedToOneIncludeError(ctx.listName, request.name)
  }
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
  // A declared branch returns to nobody, so nothing on it computes and
  // nothing on it declares (ADR-0051) — the widening stops here rather than
  // recursing, and the branch is read at its full stored width because that
  // is what the declaring hook was promised.
  const projection = declared
    ? UNPROJECTED
    : await resolveProjection(
        request.fields,
        request.includes.map((nested) => nested.name),
        related,
      )
  const includes = declared
    ? []
    : await resolveIncludes(request.includes, related, depth + 1, projection.caller)

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
    ...(target.foreignKey ? { foreignKey: target.foreignKey.name } : {}),
    predicates,
    orders,
    limit: request.limit,
    offset: request.offset,
    includes,
    projection,
    declared,
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
 *
 * The cap is checked per branch rather than once for the level, so the error
 * names the branch whose own resolution reached it rather than whichever
 * sibling happened to be composed first.
 */
export async function resolveIncludes(
  requests: readonly IncludeRequest[],
  ctx: ResolveContext,
  depth: number,
  selected?: ReadonlySet<string>,
): Promise<IncludePlan[]> {
  const plans: IncludePlan[] = []
  const named = new Set<string>()
  for (const request of requests) {
    if (named.has(request.name)) throw new DuplicateIncludeError(ctx.listName, request.name)
    named.add(request.name)
    if (depth >= READ_INCLUDE_MAX_DEPTH) {
      throw new AccessScopeDepthExceededError(ctx.listName, request.name, depth)
    }
    const plan = await resolveInclude(request, ctx, depth, false)
    if (plan !== null) plans.push(plan)
  }
  for (const name of declaredRelations(ctx, selected)) {
    if (named.has(name)) continue
    named.add(name)
    const plan = await resolveInclude(
      { name, predicates: [], orders: [], includes: [] },
      ctx,
      depth,
      true,
    )
    if (plan !== null) plans.push(plan)
  }
  return plans
}

/**
 * The relations the computed fields this level returns declared (ADR-0025,
 * ADR-0051), minus anything that is not a relationship field of this list —
 * a `needs` entry naming a stored column is already on the row, and one
 * naming nothing is `validateNeedsDeclarations`' refusal rather than an
 * include this engine invents.
 */
function declaredRelations(ctx: ResolveContext, selected?: ReadonlySet<string>): string[] {
  return [...resolveDeclaredDependencies(ctx.config, ctx.listName, selected).relations].filter(
    (name) => {
      const fieldConfig = ctx.listConfig.fields[name]
      return fieldConfig?.type === 'relationship' && 'ref' in fieldConfig && !!fieldConfig.ref
    },
  )
}
