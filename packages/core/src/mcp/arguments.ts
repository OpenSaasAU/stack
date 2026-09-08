// The wire decoders for the `where` and `orderBy` tool arguments: JSON in, a
// Where vocabulary value out (ADR-0053, ADR-0055). Nothing here decides what a
// predicate means — the vocabulary owns every key, operator and access check,
// and this module only puts the caller's JSON into the shape it takes.

import { ValidationError } from '../hooks/index.js'
import {
  RELATION_QUANTIFIERS,
  RELATION_QUANTIFIER_SET,
  SCALAR_OPERATORS,
  SCALAR_OPERATOR_SET,
} from '../secured/operators.js'
import type {
  OrderBy,
  OrderDirection,
  RelationCondition,
  ScalarOperators,
  Where,
  WhereCondition,
  WhereValue,
} from '../secured/vocabulary.js'

const LOGICAL_OPERATORS: ReadonlySet<string> = new Set(['AND', 'OR', 'NOT'])

function malformed(path: string, detail: string): ValidationError {
  return new ValidationError([`Cannot query "${path}" — it ${detail}.`])
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isWhereValue(value: unknown): value is WhereValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
}

function whereValues(path: string, raw: unknown): readonly WhereValue[] {
  if (!Array.isArray(raw) || !raw.every(isWhereValue)) {
    throw malformed(path, 'takes a list of values')
  }
  return raw
}

function scalarOperators(path: string, entries: Record<string, unknown>): ScalarOperators {
  const operators: ScalarOperators = {}
  for (const [operator, raw] of Object.entries(entries)) {
    const at = `${path}.${operator}`
    switch (operator) {
      case 'in':
        operators.in = whereValues(at, raw)
        break
      case 'notIn':
        operators.notIn = whereValues(at, raw)
        break
      case 'contains':
        if (typeof raw !== 'string') throw malformed(at, 'takes a string')
        operators.contains = raw
        break
      default:
        if (!isWhereValue(raw)) throw malformed(at, 'takes a value')
        if (operator === 'equals') operators.equals = raw
        else if (operator === 'not') operators.not = raw
        else if (operator === 'lt') operators.lt = raw
        else if (operator === 'lte') operators.lte = raw
        else if (operator === 'gt') operators.gt = raw
        else if (operator === 'gte') operators.gte = raw
    }
  }
  return operators
}

function relationCondition(path: string, entries: Record<string, unknown>): RelationCondition {
  const condition: RelationCondition = {}
  for (const [quantifier, nested] of Object.entries(entries)) {
    const at = `${path}.${quantifier}`
    if (!isPlainObject(nested)) throw malformed(at, 'takes a predicate')
    if (quantifier === 'some') condition.some = whereArgument(nested, at)
    else if (quantifier === 'every') condition.every = whereArgument(nested, at)
    else condition.none = whereArgument(nested, at)
  }
  return condition
}

/**
 * One key's condition. An object is a scalar's operators when every key it
 * carries is one, a relation's quantifiers when every key is one, and a
 * mixture of the two — or of neither — is refused here rather than reaching
 * the vocabulary as a shape it has no branch for. An empty object takes the
 * scalar branch, where the vocabulary already refuses it for naming no
 * operator.
 */
function condition(path: string, raw: unknown): WhereCondition | RelationCondition {
  if (isWhereValue(raw)) return raw
  if (!isPlainObject(raw)) {
    throw malformed(path, 'takes a value, an operator object, or a relation quantifier')
  }
  const keys = Object.keys(raw)
  if (keys.every((key) => SCALAR_OPERATOR_SET.has(key))) return scalarOperators(path, raw)
  if (keys.every((key) => RELATION_QUANTIFIER_SET.has(key))) return relationCondition(path, raw)
  throw malformed(
    path,
    `mixes names that are not one operator set (${SCALAR_OPERATORS.join(', ')}; ` +
      `${RELATION_QUANTIFIERS.join(', ')} on a relation)`,
  )
}

function branches(path: string, raw: unknown): readonly Where[] {
  const list = Array.isArray(raw) ? raw : [raw]
  return list.map((branch, index) => {
    if (!isPlainObject(branch)) {
      throw malformed(`${path}[${index}]`, 'takes a predicate or a list of predicates')
    }
    return whereArgument(branch, `${path}[${index}]`)
  })
}

/**
 * Decode a `where` tool argument into the Where vocabulary the secured surface
 * takes. `path` names the argument in a refusal — the tool's list, or the
 * relation entry the predicate sits under.
 */
export function whereArgument(raw: unknown, path: string): Where {
  if (!isPlainObject(raw)) throw malformed(path, 'takes a predicate object')
  const where: Where = {}
  for (const [key, value] of Object.entries(raw)) {
    where[key] = LOGICAL_OPERATORS.has(key)
      ? branches(`${path}.${key}`, value)
      : condition(`${path}.${key}`, value)
  }
  return where
}

function isDirection(value: unknown): value is OrderDirection {
  return value === 'asc' || value === 'desc'
}

/** Decode an `orderBy` tool argument: one sort object, or a list of them. */
export function orderByArgument(raw: unknown, path: string): OrderBy[] {
  const list = Array.isArray(raw) ? raw : [raw]
  return list.map((entry, index) => {
    const at = Array.isArray(raw) ? `${path}[${index}]` : path
    if (!isPlainObject(entry)) throw malformed(at, 'takes a sort object or a list of them')
    const order: OrderBy = {}
    for (const [column, direction] of Object.entries(entry)) {
      if (!isDirection(direction)) {
        throw malformed(`${at}.${column}`, 'takes the direction "asc" or "desc"')
      }
      order[column] = direction
    }
    return order
  })
}
