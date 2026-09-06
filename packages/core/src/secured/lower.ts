// Lowering a resolved Where plan onto Prisma's predicate lambda — the one
// place the vocabulary meets the ORM (ADR-0055).

import type { AnyExpression, OrderByItem } from '@prisma/orm-postgres/relational-core'
import type { OrderPlan, ScalarStep, WherePlan } from './vocabulary.js'
import { unsupportedOperator, unqueryableKey } from './vocabulary.js'

/**
 * The comparison methods a column carries on Prisma's model accessor. Each is
 * optional because the ORM gates them by the column's codec traits: `ilike`
 * reaches a textual column only, and the ordering comparisons an orderable
 * one, so an absent member is the ORM saying this operator does not apply to
 * this column.
 */
interface ComparisonMember {
  eq(value: unknown): AnyExpression
  neq(value: unknown): AnyExpression
  lt(value: unknown): AnyExpression
  lte(value: unknown): AnyExpression
  gt(value: unknown): AnyExpression
  gte(value: unknown): AnyExpression
  in(values: readonly unknown[]): AnyExpression
  notIn(values: readonly unknown[]): AnyExpression
  isNull(): AnyExpression
  isNotNull(): AnyExpression
  ilike(pattern: string): AnyExpression
  asc(): OrderByItem
  desc(): OrderByItem
}

type RelationPredicate = (model: PredicateAccessor) => AnyExpression

interface RelationMember {
  some(predicate: RelationPredicate): AnyExpression
  every(predicate: RelationPredicate): AnyExpression
  none(predicate: RelationPredicate): AnyExpression
}

type AccessorMember = Partial<ComparisonMember & RelationMember>

/** Prisma's model accessor, as the lowering drives it. */
export interface PredicateAccessor {
  [member: string]: AccessorMember | undefined
}

/**
 * The combinators the lowering builds `AND` and `OR` from. Prisma renders an
 * empty `AND` as `TRUE` and an empty `OR` as `FALSE`, which is where the two
 * constants come from.
 */
export interface WhereCombinators {
  and(...exprs: AnyExpression[]): AnyExpression
  or(...exprs: AnyExpression[]): AnyExpression
  all(): AnyExpression
}

let pending: Promise<WhereCombinators> | undefined

/**
 * Load Prisma's expression combinators. Imported lazily so the package root
 * keeps its static module graph free of `@prisma/orm-postgres`; a secured read
 * cannot run without the ORM anyway, and the terminals that lower a predicate
 * are already async.
 */
export function whereCombinators(): Promise<WhereCombinators> {
  pending ??= import('@prisma/orm-postgres/orm-client').then(({ and, or, all }) => ({
    and,
    or,
    all,
  }))
  return pending
}

function memberOf(accessor: PredicateAccessor, listName: string, name: string): AccessorMember {
  const member = accessor[name]
  if (member === undefined) throw unqueryableKey(listName, name)
  return member
}

function stepExpression(
  step: ScalarStep,
  member: AccessorMember,
  listName: string,
  column: string,
): AnyExpression {
  const refuse = (operator: string): never => {
    throw unsupportedOperator(listName, column, operator)
  }
  switch (step.op) {
    case 'eq':
      return member.eq?.(step.value) ?? refuse('equals')
    case 'neq':
      return member.neq?.(step.value) ?? refuse('not')
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
      return member[step.op]?.(step.value) ?? refuse(step.op)
    case 'in':
      return member.in?.(step.values) ?? refuse('in')
    case 'notIn':
      return member.notIn?.(step.values) ?? refuse('notIn')
    case 'contains':
      return member.ilike?.(step.pattern) ?? refuse('contains')
    case 'isNull':
      return member.isNull?.() ?? refuse('equals')
    case 'isNotNull':
      return member.isNotNull?.() ?? refuse('not')
  }
}

function combine(
  nodes: readonly AnyExpression[],
  empty: () => AnyExpression,
  join: (...exprs: AnyExpression[]) => AnyExpression,
): AnyExpression {
  if (nodes.length === 0) return empty()
  if (nodes.length === 1) return nodes[0]
  return join(...nodes)
}

/**
 * Build the ORM expression for a resolved plan. Synchronous by construction —
 * every access decision was made during resolution — which is what lets a
 * relation quantifier's predicate be a plain lambda.
 */
export function lowerWhere(
  plan: WherePlan,
  accessor: PredicateAccessor,
  ops: WhereCombinators,
): AnyExpression {
  switch (plan.kind) {
    case 'true':
      return ops.all()
    case 'false':
      return ops.or()
    case 'and':
      return combine(
        plan.nodes.map((node) => lowerWhere(node, accessor, ops)),
        () => ops.all(),
        ops.and,
      )
    case 'or':
      return combine(
        plan.nodes.map((node) => lowerWhere(node, accessor, ops)),
        () => ops.or(),
        ops.or,
      )
    case 'not':
      return lowerWhere(plan.node, accessor, ops).not()
    case 'scalar': {
      const member = memberOf(accessor, plan.listName, plan.column)
      return combine(
        plan.steps.map((step) => stepExpression(step, member, plan.listName, plan.column)),
        () => ops.all(),
        ops.and,
      )
    }
    case 'relation': {
      const member = memberOf(accessor, plan.listName, plan.relation)
      const quantifier = member[plan.quantifier]
      if (quantifier === undefined) {
        throw unsupportedOperator(plan.listName, plan.relation, plan.quantifier)
      }
      return quantifier((related) => lowerWhere(plan.node, related, ops))
    }
  }
}

/** Build one `ORDER BY` item for a resolved sort. */
export function lowerOrder(plan: OrderPlan, accessor: PredicateAccessor): OrderByItem {
  const member = memberOf(accessor, plan.listName, plan.column)
  const item = plan.direction === 'asc' ? member.asc?.() : member.desc?.()
  if (item === undefined) throw unsupportedOperator(plan.listName, plan.column, plan.direction)
  return item
}
