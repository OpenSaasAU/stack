// The Where vocabulary (ADR-0055): the closed predicate grammar the secured
// surface accepts, and the resolution pass that turns a vocabulary value into
// a plan the lowering can build without asking another question. Nothing here
// imports the ORM — the same property that keeps `../filter/` unit-testable.

import type { ListConfig, OpenSaasConfig, TypeInfo } from '../config/types.js'
import type { AccessContext, PrismaFilter, Session } from '../access/types.js'
import { checkAccess, getRelatedListConfig } from '../access/engine.js'
import { isFieldReadableForPredicate } from '../access/field-access.js'
import { resolveQueryField } from '../access/query-validation.js'
import { ValidationError } from '../hooks/index.js'
import { likeContainsPattern } from '../where/like.js'
import {
  RELATION_QUANTIFIERS,
  RELATION_QUANTIFIER_SET,
  SCALAR_OPERATORS,
  SCALAR_OPERATOR_SET,
  type RelationQuantifier,
} from './operators.js'

export { RELATION_QUANTIFIERS, SCALAR_OPERATORS } from './operators.js'
export type { RelationQuantifier, ScalarOperator } from './operators.js'

/** A value a predicate compares a column against. */
export type WhereValue = string | number | boolean | bigint | Date | null

/**
 * The scalar operators, in the spelling a predicate uses. Several may appear
 * on one column and are ANDed. `equals: null` is `IS NULL` and `not: null` is
 * `IS NOT NULL`; `contains` is case-insensitive and matches its value
 * literally, per-cent signs and underscores included.
 */
export interface ScalarOperators {
  equals?: WhereValue
  not?: WhereValue
  in?: readonly WhereValue[]
  notIn?: readonly WhereValue[]
  lt?: WhereValue
  lte?: WhereValue
  gt?: WhereValue
  gte?: WhereValue
  contains?: string
}

/** One column's condition: a bare value (equality) or the operator object. */
export type WhereCondition = WhereValue | ScalarOperators

/** A relation's condition. Every relation takes the same three quantifiers. */
export interface RelationCondition {
  some?: Where
  every?: Where
  none?: Where
}

/**
 * A predicate over one list, as the engine sees it. Keys are the list's own
 * fields, `AND`/`OR`/`NOT`, or a relation carrying its quantifiers; several
 * keys in one object are ANDed.
 *
 * Loose here on purpose: the per-list shapes live in the generated bundle,
 * which instantiates `ListPredicate` from the emitted contract (ADR-0052).
 */
export interface Where {
  [key: string]: WhereCondition | RelationCondition | Where | readonly Where[] | undefined
}

/** A sort direction, as `orderBy` spells it. */
export type OrderDirection = 'asc' | 'desc'

/** What `orderBy` takes: the list's own scalar columns and a direction. */
export interface OrderBy {
  [column: string]: OrderDirection
}

const LOGICAL_OPERATORS: ReadonlySet<string> = new Set(['AND', 'OR', 'NOT'])

/**
 * A key a caller may not query, for either of the two reasons that must be
 * indistinguishable: the list does not declare it, or the session cannot read
 * it. One message for both, so the refusal is not an existence oracle
 * (ADR-0031).
 */
export function unqueryableKey(listName: string, key: string): ValidationError {
  return new ValidationError([
    `Cannot query "${listName}" — "${key}" is not a queryable field of this list.`,
  ])
}

export function unsupportedOperator(
  listName: string,
  key: string,
  operator: string,
): ValidationError {
  return new ValidationError([
    `Cannot query "${listName}" — "${key}" was given "${operator}", which is not part of the ` +
      `Where vocabulary (${SCALAR_OPERATORS.join(', ')}; ${RELATION_QUANTIFIERS.join(', ')} on a ` +
      `relation; AND, OR, NOT).`,
  ])
}

function malformedCondition(listName: string, key: string, detail: string): ValidationError {
  return new ValidationError([`Cannot query "${listName}" — the predicate on "${key}" ${detail}.`])
}

/**
 * How many Access Filters deep the engine will expand before refusing. A
 * relation key inside an Access Filter re-enters access resolution, so this
 * recursion is the engine's own and ADR-0043's caller-facing depth cap does
 * not bound it. Cycles are caught by name; this is the second bound, for an
 * acyclic chain long enough that it is a configuration mistake rather than a
 * design. Ten is well past any real ownership chain and far short of a stack
 * the process cannot hold.
 */
export const ACCESS_FILTER_MAX_DEPTH = 10

/**
 * An Access Filter that expands into itself, directly or through another
 * list's filter. Refused loudly rather than truncated: a truncated Access
 * Filter is a widened read, so failing closed is the only safe answer.
 */
export class AccessFilterRecursionError extends Error {
  constructor(
    readonly listPath: readonly string[],
    reason: 'cycle' | 'depth',
  ) {
    const chain = listPath.join(' → ')
    super(
      reason === 'cycle'
        ? `The Access Filter on "${listPath[listPath.length - 1]}" is cyclic: expanding it ` +
            `re-enters the same list (${chain}). A relation key inside an Access Filter is ` +
            `expanded into the related list's own filter, so a cycle has no fixed point and the ` +
            `read is refused rather than resolved with a truncated filter. Scope the rule by a ` +
            `column, or break the cycle by returning \`true\`/\`false\` on one side.`
        : `The Access Filter on "${listPath[0]}" expands more than ${ACCESS_FILTER_MAX_DEPTH} ` +
            `lists deep (${chain}). The read is refused rather than resolved with a truncated ` +
            `filter; flatten the chain of relation-scoped access rules.`,
    )
    this.name = 'AccessFilterRecursionError'
  }
}

/**
 * An `undefined` condition is refused rather than dropped. Dropping it widens
 * the read, and the Access Filter is lowered through this same seam: a rule
 * spelled `({ session }) => ({ authorId: session?.userId })` would otherwise
 * match every row for an anonymous caller, which is fail-open (ADR-0022,
 * ADR-0055).
 */
function undefinedCondition(listName: string, key: string): ValidationError {
  return new ValidationError([
    `Cannot query "${listName}" — the predicate on "${key}" is undefined. The Where vocabulary ` +
      `is total: a predicate may only narrow, so a condition that resolved to undefined is ` +
      `refused rather than dropped. An access rule that has nothing to scope by must return ` +
      `\`false\` (deny) or \`true\` (allow) explicitly.`,
  ])
}

/** One resolved comparison on one column. */
export type ScalarStep =
  | { op: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte'; value: Exclude<WhereValue, null> }
  | { op: 'in' | 'notIn'; values: readonly WhereValue[] }
  | { op: 'contains'; pattern: string }
  | { op: 'isNull' | 'isNotNull' }

/**
 * A resolved predicate: every key checked, every relation's `query` access
 * already decided. Building the ORM expression from one asks no further
 * questions, which is what lets a relation quantifier's lambda stay
 * synchronous.
 */
export type WherePlan =
  | { kind: 'true' }
  | { kind: 'false' }
  | { kind: 'and'; nodes: readonly WherePlan[] }
  | { kind: 'or'; nodes: readonly WherePlan[] }
  | { kind: 'not'; node: WherePlan }
  | { kind: 'scalar'; listName: string; column: string; steps: readonly ScalarStep[] }
  | {
      kind: 'relation'
      listName: string
      relation: string
      relatedListName: string
      quantifier: RelationQuantifier
      node: WherePlan
    }

/** A resolved sort: one scalar column and a direction. */
export interface OrderPlan {
  listName: string
  column: string
  direction: OrderDirection
}

/** What the resolution pass needs to decide a key. */
export interface ResolveContext {
  listName: string
  listConfig: ListConfig<TypeInfo>
  config: OpenSaasConfig
  session: Session | null
  context: AccessContext
  /**
   * Whether field-level `read` access gates a key. False for the Access
   * Filter — trusted config, authored by the same person who declares the
   * fields — and false under `sudo`, which bypasses access but not the
   * vocabulary.
   */
  checkFieldRead: boolean
  /** Whether a relation quantifier carries the related list's `query` access. */
  applyRelationAccess: boolean
  /**
   * The lists whose Access Filter is currently being expanded, outermost
   * first. Bounds the engine's own recursion — see
   * {@link AccessFilterRecursionError}.
   */
  accessFilterPath: readonly string[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isWhereValue(value: unknown): value is WhereValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    value instanceof Date
  )
}

function comparison(
  listName: string,
  key: string,
  operator: 'lt' | 'lte' | 'gt' | 'gte',
  raw: unknown,
): ScalarStep {
  if (!isWhereValue(raw) || raw === null) {
    throw malformedCondition(listName, key, `takes a value for "${operator}"`)
  }
  return { op: operator, value: raw }
}

function values(
  listName: string,
  key: string,
  operator: string,
  raw: unknown,
): readonly WhereValue[] {
  if (!Array.isArray(raw) || !raw.every(isWhereValue)) {
    throw malformedCondition(listName, key, `takes a list of values for "${operator}"`)
  }
  return raw
}

function resolveScalar(listName: string, key: string, condition: unknown): ScalarStep[] {
  if (isWhereValue(condition)) {
    return condition === null ? [{ op: 'isNull' }] : [{ op: 'eq', value: condition }]
  }
  if (!isPlainObject(condition)) {
    throw malformedCondition(listName, key, 'is neither a value nor an operator object')
  }

  const steps: ScalarStep[] = []
  for (const [operator, raw] of Object.entries(condition)) {
    if (!SCALAR_OPERATOR_SET.has(operator)) throw unsupportedOperator(listName, key, operator)
    if (raw === undefined) throw undefinedCondition(listName, `${key}.${operator}`)
    switch (operator) {
      case 'equals':
        if (raw === null) steps.push({ op: 'isNull' })
        else if (isWhereValue(raw)) steps.push({ op: 'eq', value: raw })
        else throw malformedCondition(listName, key, 'takes a value for "equals"')
        break
      case 'not':
        if (raw === null) steps.push({ op: 'isNotNull' })
        else if (isWhereValue(raw)) steps.push({ op: 'neq', value: raw })
        else throw malformedCondition(listName, key, 'takes a value for "not"')
        break
      case 'in':
        steps.push({ op: 'in', values: values(listName, key, 'in', raw) })
        break
      case 'notIn':
        steps.push({ op: 'notIn', values: values(listName, key, 'notIn', raw) })
        break
      case 'lt':
      case 'lte':
      case 'gt':
      case 'gte':
        steps.push(comparison(listName, key, operator, raw))
        break
      case 'contains':
        if (typeof raw !== 'string') {
          throw malformedCondition(listName, key, 'takes a string for "contains"')
        }
        steps.push({ op: 'contains', pattern: likeContainsPattern(raw) })
        break
    }
  }

  if (steps.length === 0) {
    throw malformedCondition(listName, key, 'names no operator, so it would constrain nothing')
  }
  return steps
}

function branches(listName: string, key: string, value: unknown): readonly unknown[] {
  if (value === undefined) throw undefinedCondition(listName, key)
  if (Array.isArray(value)) return value
  if (isPlainObject(value)) return [value]
  throw malformedCondition(listName, key, 'takes a predicate or a list of predicates')
}

async function resolveBranches(
  listName: string,
  key: string,
  value: unknown,
  ctx: ResolveContext,
): Promise<WherePlan[]> {
  const plans: WherePlan[] = []
  for (const branch of branches(listName, key, value)) {
    if (!isPlainObject(branch)) {
      throw malformedCondition(listName, key, 'takes a predicate or a list of predicates')
    }
    plans.push(await resolveWhere(branch, ctx))
  }
  return plans
}

async function relatedAccessPlan(
  related: { listName: string; listConfig: ListConfig<TypeInfo> },
  ctx: ResolveContext,
): Promise<WherePlan> {
  if (!ctx.applyRelationAccess) return { kind: 'true' }
  const access = await checkAccess(related.listConfig.access?.operation?.query, {
    session: ctx.session,
    context: ctx.context,
  })
  if (access === false) return { kind: 'false' }
  if (access === true) return { kind: 'true' }
  const filter: PrismaFilter = access
  const path = ctx.accessFilterPath
  if (path.includes(related.listName)) {
    throw new AccessFilterRecursionError([...path, related.listName], 'cycle')
  }
  if (path.length >= ACCESS_FILTER_MAX_DEPTH) {
    throw new AccessFilterRecursionError([...path, related.listName], 'depth')
  }
  return await resolveWhere(filter, {
    ...ctx,
    listName: related.listName,
    listConfig: related.listConfig,
    checkFieldRead: false,
    accessFilterPath: [...path, related.listName],
  })
}

async function resolveRelation(
  key: string,
  ref: string,
  condition: unknown,
  ctx: ResolveContext,
): Promise<WherePlan> {
  const related = getRelatedListConfig(ref, ctx.config)
  if (!related) throw unqueryableKey(ctx.listName, key)
  if (!isPlainObject(condition)) {
    throw malformedCondition(ctx.listName, key, 'takes some, every or none')
  }

  const entries = Object.entries(condition)
  if (entries.length === 0) {
    throw malformedCondition(
      ctx.listName,
      key,
      'names no quantifier, so it would constrain nothing',
    )
  }

  const access = await relatedAccessPlan(related, ctx)
  const nodes: WherePlan[] = []
  for (const [quantifier, nested] of entries) {
    if (!RELATION_QUANTIFIER_SET.has(quantifier))
      throw unsupportedOperator(ctx.listName, key, quantifier)
    if (nested === undefined) throw undefinedCondition(ctx.listName, `${key}.${quantifier}`)
    if (!isPlainObject(nested)) {
      throw malformedCondition(ctx.listName, `${key}.${quantifier}`, 'takes a predicate')
    }

    // Resolved before the denied-list short circuit below, so a malformed
    // nested predicate is refused whether or not the session may query the
    // related list — otherwise the refusal itself says which lists it may.
    const caller = await resolveWhere(nested, {
      ...ctx,
      listName: related.listName,
      listConfig: related.listConfig,
    })

    // A related list the session cannot query is an empty set, not an error:
    // `some` is false, `none` and `every` are true. That keeps a relation
    // token from distinguishing parent rows by a list the session cannot see.
    if (access.kind === 'false') {
      nodes.push(quantifier === 'some' ? { kind: 'false' } : { kind: 'true' })
      continue
    }

    const scoped = (node: WherePlan): WherePlan =>
      access.kind === 'true' ? node : { kind: 'and', nodes: [node, access] }

    if (quantifier === 'every') {
      // "Every row the caller may SEE also matches", lowered as "no visible
      // row fails the predicate". ANDing the access filter into an `every`
      // body would instead mean "every related row is visible AND matches",
      // which drops a parent for owning a row the caller cannot see — a
      // positive signal about an invisible row (spec #1123, story 10).
      nodes.push({
        kind: 'relation',
        listName: ctx.listName,
        relation: key,
        relatedListName: related.listName,
        quantifier: 'none',
        node: scoped({ kind: 'not', node: caller }),
      })
      continue
    }

    nodes.push({
      kind: 'relation',
      listName: ctx.listName,
      relation: key,
      relatedListName: related.listName,
      quantifier: quantifier === 'some' ? 'some' : 'none',
      node: scoped(caller),
    })
  }
  return nodes.length === 1 ? nodes[0] : { kind: 'and', nodes }
}

async function resolveKey(key: string, value: unknown, ctx: ResolveContext): Promise<WherePlan> {
  if (value === undefined) throw undefinedCondition(ctx.listName, key)

  const resolved = resolveQueryField(key, ctx.listConfig.fields)
  if (!resolved) throw unqueryableKey(ctx.listName, key)

  if (ctx.checkFieldRead && resolved.fieldConfig !== undefined) {
    const readable = await isFieldReadableForPredicate(resolved.fieldConfig.access, {
      session: ctx.session,
      context: ctx.context,
    })
    if (!readable) throw unqueryableKey(ctx.listName, key)
  }

  if (resolved.isRelationship) {
    return await resolveRelation(key, resolved.fieldConfig.ref, value, ctx)
  }
  return {
    kind: 'scalar',
    listName: ctx.listName,
    column: key,
    steps: resolveScalar(ctx.listName, key, value),
  }
}

/**
 * Resolve one predicate against a list: every key checked against the config
 * and the session, every operator checked against the vocabulary, every
 * relation's `query` access decided. Total or throwing — nothing is dropped,
 * `sudo` included.
 */
export async function resolveWhere(
  where: Record<string, unknown>,
  ctx: ResolveContext,
): Promise<WherePlan> {
  const nodes: WherePlan[] = []
  for (const [key, value] of Object.entries(where)) {
    if (LOGICAL_OPERATORS.has(key)) {
      const resolved = await resolveBranches(ctx.listName, key, value, ctx)
      if (key === 'AND') nodes.push({ kind: 'and', nodes: resolved })
      else if (key === 'OR') nodes.push({ kind: 'or', nodes: resolved })
      else nodes.push({ kind: 'not', node: { kind: 'and', nodes: resolved } })
      continue
    }
    nodes.push(await resolveKey(key, value, ctx))
  }
  if (nodes.length === 1) return nodes[0]
  return { kind: 'and', nodes }
}

/**
 * Resolve `orderBy`. Scalar-only: Prisma 8's `orderBy` takes columns, so a
 * relation — and the to-many count that used to be sortable — is refused
 * rather than silently ignored (ADR-0055).
 */
export async function resolveOrderBy(
  orders: readonly OrderBy[],
  ctx: ResolveContext,
): Promise<OrderPlan[]> {
  const plans: OrderPlan[] = []
  for (const order of orders) {
    for (const [key, direction] of Object.entries(order)) {
      if (direction !== 'asc' && direction !== 'desc') {
        throw malformedCondition(ctx.listName, key, 'takes the direction "asc" or "desc"')
      }
      const resolved = resolveQueryField(key, ctx.listConfig.fields)
      if (!resolved) throw unqueryableKey(ctx.listName, key)
      // The read gate runs before the relationship refusal, as `resolveKey`
      // does: a read-denied key must be indistinguishable from one the list
      // does not declare, and "orderBy takes scalar columns only" would
      // otherwise confirm that a read-denied relationship exists (ADR-0031).
      if (ctx.checkFieldRead && resolved.fieldConfig !== undefined) {
        const readable = await isFieldReadableForPredicate(resolved.fieldConfig.access, {
          session: ctx.session,
          context: ctx.context,
        })
        if (!readable) throw unqueryableKey(ctx.listName, key)
      }
      if (resolved.isRelationship) {
        throw new ValidationError([
          `Cannot order "${ctx.listName}" by "${key}" — orderBy takes scalar columns only.`,
        ])
      }
      plans.push({ listName: ctx.listName, column: key, direction })
    }
  }
  return plans
}
