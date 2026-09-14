// The id boundary coercion (`parseListId`, ADR-0048), walked across every
// position a `where` predicate can carry an `id`: the top level, every
// AND/OR/NOT branch at any depth, and every relation quantifier's own nested
// predicate. Nothing here decides vocabulary legality — `whereArgument` and
// the engine's own `resolveWhere` still own that — this only turns a wire id
// into the type its list's primary key actually carries, wherever one
// appears (issue #1368).

import type { OpenSaasConfig } from '../config/types.js'
import { isRelationshipField } from '../fields/index.js'
import { listIdColumn, parseListId, type ListIdValue } from '../contract/id-boundary.js'
import { RELATION_QUANTIFIERS } from '../secured/operators.js'

const LOGICAL_OPERATORS: ReadonlySet<string> = new Set(['AND', 'OR', 'NOT'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function coercesIds(config: OpenSaasConfig, listKey: string): boolean {
  const strategy = listIdColumn(config, listKey)?.strategy
  return strategy === 'int autoincrement' || strategy === 'singleton'
}

/** One `id` key's condition — a bare value, `in`/`notIn`, or a scalar operator object. `null` means it names a value the column cannot hold. */
function coerceIdCondition(
  raw: unknown,
  config: OpenSaasConfig,
  listKey: string,
): Record<string, unknown> | ListIdValue | null {
  const parse = (value: unknown): ListIdValue | null => {
    const parsed = parseListId(config, listKey, value)
    return parsed.ok ? parsed.value : null
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return parse(raw)
  }

  const operators: Record<string, unknown> = {}
  for (const [operator, value] of Object.entries(raw)) {
    if (operator === 'in' || operator === 'notIn') {
      if (!Array.isArray(value)) return null
      const ids: ListIdValue[] = []
      for (const entry of value) {
        const parsedId = parse(entry)
        if (parsedId === null) return null
        ids.push(parsedId)
      }
      operators[operator] = ids
      continue
    }
    if (operator === 'contains') {
      operators[operator] = value
      continue
    }
    const parsedId = parse(value)
    if (parsedId === null) return null
    operators[operator] = parsedId
  }
  return operators
}

/** AND/OR/NOT's own value: one predicate, or a list of them (the same normalisation `whereArgument`'s `branches` applies). */
function coerceBranches(raw: unknown, config: OpenSaasConfig, listKey: string): unknown | null {
  if (isPlainObject(raw)) return coerceWhereIds(raw, config, listKey)
  if (!Array.isArray(raw)) return raw

  const coerced: unknown[] = []
  for (const branch of raw) {
    if (!isPlainObject(branch)) {
      coerced.push(branch)
      continue
    }
    const result = coerceWhereIds(branch, config, listKey)
    if (result === null) return null
    coerced.push(result)
  }
  return coerced
}

/**
 * Walk a `where` predicate, coercing every `id` it can reach to its list's
 * own id type: the top level, every AND/OR/NOT branch, and — against the
 * RELATED list's id strategy, since that predicate filters the related
 * list's own rows — every relation quantifier's nested predicate.
 *
 * `null` means a malformed id was found somewhere in the tree. Per #1368
 * that refuses the WHOLE request rather than coercing that leaf to "matches
 * nothing": under `NOT`, "matches nothing" inverts to "matches everything",
 * which would widen the result set — the one direction a denial must never
 * move in. Refusing at the root, before any query runs, closes that off
 * for every position at once rather than needing a per-position rule.
 */
export function coerceWhereIds(
  where: Record<string, unknown>,
  config: OpenSaasConfig,
  listKey: string,
): Record<string, unknown> | null {
  const listConfig = config.lists[listKey]
  if (!listConfig) return where

  const ownIdNeedsCoercion = coercesIds(config, listKey)
  const result: Record<string, unknown> = { ...where }

  for (const [key, value] of Object.entries(where)) {
    if (LOGICAL_OPERATORS.has(key)) {
      const coerced = coerceBranches(value, config, listKey)
      if (coerced === null) return null
      result[key] = coerced
      continue
    }

    if (key === 'id') {
      if (!ownIdNeedsCoercion) continue
      const coerced = coerceIdCondition(value, config, listKey)
      if (coerced === null) return null
      result[key] = coerced
      continue
    }

    const fieldConfig = listConfig.fields[key]
    if (!isRelationshipField(fieldConfig) || !isPlainObject(value)) continue

    const relatedListKey = fieldConfig.ref.split('.')[0]
    const nested: Record<string, unknown> = { ...value }
    let changed = false
    for (const quantifier of RELATION_QUANTIFIERS) {
      if (!Object.hasOwn(value, quantifier)) continue
      const nestedWhere = value[quantifier]
      if (!isPlainObject(nestedWhere)) continue
      const coerced = coerceWhereIds(nestedWhere, config, relatedListKey)
      if (coerced === null) return null
      nested[quantifier] = coerced
      changed = true
    }
    if (changed) result[key] = nested
  }

  return result
}

/**
 * The refusal a malformed id gets wherever it can appear. Shape is all the
 * id boundary can check, and this reads the same as a missing or
 * inaccessible row (ADR-0048, Silent failure) — `query`, `update` and
 * `delete` all give it, so a malformed id can never distinguish itself from
 * an ordinary access denial.
 */
export function idBoundaryRefusal(operationLabel: string): string {
  return `Failed to ${operationLabel}. Access denied or record not found.`
}
