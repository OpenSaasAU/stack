import type { OpenSaasConfig } from '../config/types.js'
import { RELATION_QUANTIFIERS } from '../secured/operators.js'
import { unqueryableKey } from '../secured/vocabulary.js'
import { relationOf } from './relation-member.js'

const LOGICAL_OPERATORS: ReadonlySet<string> = new Set(['AND', 'OR', 'NOT'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function relationTarget(config: OpenSaasConfig, listKey: string, key: string): string | undefined {
  return relationOf(config, listKey, key)?.relatedList
}

/**
 * Refuse a decoded `where` that filters through a relation into a list MCP
 * does not expose, with the message an unknown key gets (ADR-0053).
 */
export function assertWhereReachable(
  where: Record<string, unknown>,
  config: OpenSaasConfig,
  listKey: string,
  reachable: ReadonlySet<string>,
): void {
  for (const [key, value] of Object.entries(where)) {
    if (LOGICAL_OPERATORS.has(key)) {
      const branches = Array.isArray(value) ? value : [value]
      for (const branch of branches) {
        if (isPlainObject(branch)) assertWhereReachable(branch, config, listKey, reachable)
      }
      continue
    }

    const target = relationTarget(config, listKey, key)
    if (target === undefined) continue
    if (!reachable.has(target)) throw unqueryableKey(listKey, key)
    if (!isPlainObject(value)) continue

    for (const quantifier of RELATION_QUANTIFIERS) {
      const nested = value[quantifier]
      if (isPlainObject(nested)) assertWhereReachable(nested, config, target, reachable)
    }
  }
}

export function assertOrderByReachable(
  orderBy: unknown,
  config: OpenSaasConfig,
  listKey: string,
  reachable: ReadonlySet<string>,
): void {
  const entries = Array.isArray(orderBy) ? orderBy : [orderBy]
  for (const entry of entries) {
    if (!isPlainObject(entry)) continue
    for (const key of Object.keys(entry)) {
      const target = relationTarget(config, listKey, key)
      if (target !== undefined && !reachable.has(target)) throw unqueryableKey(listKey, key)
    }
  }
}

export function whereRelationTargets(
  where: Record<string, unknown>,
  config: OpenSaasConfig,
  listKey: string,
  found: Set<string> = new Set(),
): Set<string> {
  for (const [key, value] of Object.entries(where)) {
    if (LOGICAL_OPERATORS.has(key)) {
      const branches = Array.isArray(value) ? value : [value]
      for (const branch of branches) {
        if (isPlainObject(branch)) whereRelationTargets(branch, config, listKey, found)
      }
      continue
    }
    const target = relationTarget(config, listKey, key)
    if (target === undefined) continue
    found.add(target)
    if (!isPlainObject(value)) continue
    for (const quantifier of RELATION_QUANTIFIERS) {
      const nested = value[quantifier]
      if (isPlainObject(nested)) whereRelationTargets(nested, config, target, found)
    }
  }
  return found
}

export function orderByRelationTargets(
  orderBy: unknown,
  config: OpenSaasConfig,
  listKey: string,
): Set<string> {
  const found = new Set<string>()
  for (const entry of Array.isArray(orderBy) ? orderBy : [orderBy]) {
    if (!isPlainObject(entry)) continue
    for (const key of Object.keys(entry)) {
      const target = relationTarget(config, listKey, key)
      if (target !== undefined) found.add(target)
    }
  }
  return found
}
