// The id boundary coercion (`parseListId`, ADR-0048), walked across every
// position a `where` predicate can carry an `id`: the top level, every
// AND/OR/NOT branch at any depth, and every relation quantifier's own nested
// predicate. Nothing here decides vocabulary legality — `whereArgument` and
// the engine's own `resolveWhere` still own that — this only turns a wire id
// into the type its list's primary key actually carries, wherever one
// appears (issue #1368).

import type { OpenSaasConfig } from '../config/types.js'
import type { AccessContext, Session } from '../access/types.js'
import { classifyRowIndependentRead } from '../access/field-access.js'
import { isRelationshipField } from '../fields/index.js'
import { ownsForeignKey } from './field-schema.js'
import { listIdColumn, parseListId, type ListIdValue } from '../contract/id-boundary.js'
import { RELATION_QUANTIFIERS } from '../secured/operators.js'

const LOGICAL_OPERATORS: ReadonlySet<string> = new Set(['AND', 'OR', 'NOT'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type ForeignKeyVisibility = (listKey: string, fieldName: string) => boolean

const allForeignKeysVisible: ForeignKeyVisibility = () => true

/** Which owning relationship fields this session may name a foreign-key column of; a hidden one is left for the engine to refuse exactly as an unknown key. */
export async function foreignKeyVisibility(
  config: OpenSaasConfig,
  session: Session | null,
  context: AccessContext,
): Promise<ForeignKeyVisibility> {
  const hidden = new Set<string>()
  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
      if (!isRelationshipField(fieldConfig) || fieldConfig.access === undefined) continue
      const answer = await classifyRowIndependentRead(fieldConfig.access, { session, context })
      if (answer !== 'allow') hidden.add(`${listKey}.${fieldName}`)
    }
  }
  return (listKey, fieldName) => !hidden.has(`${listKey}.${fieldName}`)
}

const ID_VALUE_OPERATORS: ReadonlySet<string> = new Set(['equals', 'not', 'lt', 'lte', 'gt', 'gte'])

/** One `id` key's condition — a bare value, `in`/`notIn`, or a scalar operator object. `null` means it names a value the column cannot hold. `nullable` admits a literal `null` (a foreign-key column). */
function coerceIdCondition(
  raw: unknown,
  config: OpenSaasConfig,
  listKey: string,
  nullable = false,
): Record<string, unknown> | ListIdValue | null {
  const parse = (value: unknown): ListIdValue | null | undefined => {
    if (nullable && value === null) return null
    const parsed = parseListId(config, listKey, value)
    return parsed.ok ? parsed.value : undefined
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    const parsed = parse(raw)
    return parsed === undefined ? null : parsed
  }

  const operators: Record<string, unknown> = {}
  for (const [operator, value] of Object.entries(raw)) {
    if (operator === 'in' || operator === 'notIn') {
      if (!Array.isArray(value)) return null
      const ids: Array<ListIdValue | null> = []
      for (const entry of value) {
        const parsedId = parse(entry)
        if (parsedId === undefined) return null
        ids.push(parsedId)
      }
      operators[operator] = ids
      continue
    }
    if (operator === 'contains') {
      if (listIdColumn(config, listKey)?.strategy !== 'cuid2') return null
      operators[operator] = value
      continue
    }
    if (!ID_VALUE_OPERATORS.has(operator)) {
      operators[operator] = value
      continue
    }
    const parsedId = parse(value)
    if (parsedId === undefined) return null
    operators[operator] = parsedId
  }
  return operators
}

/** The related list a foreign-key column (`authorId`) points at, when `key` names one this list owns. */
function foreignKeyRelation(
  config: OpenSaasConfig,
  listKey: string,
  key: string,
  visible: ForeignKeyVisibility,
): string | undefined {
  if (!key.endsWith('Id') || Object.hasOwn(config.lists[listKey]?.fields ?? {}, key))
    return undefined
  const fieldName = key.slice(0, -2)
  const fieldConfig = config.lists[listKey]?.fields[fieldName]
  if (!isRelationshipField(fieldConfig)) return undefined
  if (!visible(listKey, fieldName)) return undefined
  if (!ownsForeignKey(listKey, fieldName, fieldConfig, config)) return undefined
  return fieldConfig.ref.split('.')[0]
}

/** AND/OR/NOT's own value: one predicate, or a list of them (the same normalisation `whereArgument`'s `branches` applies). */
function coerceBranches(
  raw: unknown,
  config: OpenSaasConfig,
  listKey: string,
  visible: ForeignKeyVisibility,
): unknown | null {
  if (isPlainObject(raw)) return coerceWhereIds(raw, config, listKey, visible)
  if (!Array.isArray(raw)) return raw

  const coerced: unknown[] = []
  for (const branch of raw) {
    if (!isPlainObject(branch)) {
      coerced.push(branch)
      continue
    }
    const result = coerceWhereIds(branch, config, listKey, visible)
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
  visible: ForeignKeyVisibility = allForeignKeysVisible,
): Record<string, unknown> | null {
  const listConfig = config.lists[listKey]
  if (!listConfig) return where

  const result: Record<string, unknown> = { ...where }

  for (const [key, value] of Object.entries(where)) {
    if (LOGICAL_OPERATORS.has(key)) {
      const coerced = coerceBranches(value, config, listKey, visible)
      if (coerced === null) return null
      result[key] = coerced
      continue
    }

    if (key === 'id') {
      const coerced = coerceIdCondition(value, config, listKey)
      if (coerced === null) return null
      result[key] = coerced
      continue
    }

    const foreignKeyOwner = foreignKeyRelation(config, listKey, key, visible)
    if (foreignKeyOwner !== undefined) {
      if (value === null) continue
      const coerced = coerceIdCondition(value, config, foreignKeyOwner, true)
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
      const coerced = coerceWhereIds(nestedWhere, config, relatedListKey, visible)
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
