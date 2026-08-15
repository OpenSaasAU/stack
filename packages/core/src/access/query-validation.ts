import type { ListConfig, OpenSaasConfig } from '../config/types.js'
import { getRelatedListConfig } from './engine.js'
import { ValidationError } from '../hooks/index.js'

/**
 * #912 — read-path key validation.
 *
 * The write path settled #564: an undeclared key in `data` throws, because the
 * generated Prisma model has strictly more fields than the config declares (most
 * notably back-relations — Prisma emits one for every inbound foreign key, whether
 * or not the list config declares the reverse relationship). Reads had no
 * equivalent — a caller's `where`/`orderBy` reached Prisma unchanged, so an
 * anonymous caller could filter or order by a relation the config never exposed.
 *
 * This module is the read-path counterpart: every key named in a caller's `where`
 * or `orderBy` is resolved against the list config before the query runs. A key
 * with no entry in the config throws, naming the list and the key. `sudo` is the
 * single trusted bypass, mirroring the write path.
 *
 * Deliberately NOT walked: the access filter produced by the list's own `query`
 * access control. That filter is trusted config authored by the same person who
 * declares the fields — walking it would make this an access-control decision
 * (that's #915/#916), not the key-existence seam this ticket establishes.
 */

// Prisma's logical combinators for a WHERE clause — never field names.
const LOGICAL_OPERATORS = new Set(['AND', 'OR', 'NOT'])

// Prisma's relation quantifiers. The value nested under one of these is itself a
// WHERE clause for the RELATED list, and is walked against that list's fields.
const RELATION_QUANTIFIERS = new Set(['some', 'every', 'none', 'is', 'isNot'])

// Always present, never declared in a list's `fields` — the write path
// (`filterWritableFields`) excludes the same three names from `fieldConfigs`.
const SYSTEM_FIELDS = new Set(['id', 'createdAt', 'updatedAt'])

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- field configs are heterogeneous across field types
type FieldConfigMap = Record<string, any>

interface ResolvedQueryField {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- field configs are heterogeneous across field types
  fieldConfig: any
  isRelationship: boolean
}

/**
 * Resolve a `where`/`orderBy` key against a list's declared fields.
 *
 * A key is valid when it is:
 * - a system field (`id`, `createdAt`, `updatedAt`) — always present, and never
 *   declared in `fields` (the write path excludes them from `fieldConfigs` the
 *   same way), or
 * - a field declared directly in the list config, or
 * - the foreign-key scalar a to-one `relationship` field implies (e.g. `authorId`
 *   for `author: relationship(...)`) — the config never names this column
 *   directly, but Prisma always generates it, and the write path
 *   (`filterWritableFields`) grants it the same pass, or
 * - a raw per-part column a multi-column field's `splitColumns` contributes (e.g.
 *   storage `image()`/`file()` in Keystone-parity mode) — undeclared by design,
 *   mirroring the write path's `splitColumnOwners` allowance (#568/#789).
 *
 * Anything else — most importantly a Prisma-generated back-relation the config
 * never declares — resolves to `undefined` and is rejected by the caller.
 */
function resolveQueryField(key: string, fields: FieldConfigMap): ResolvedQueryField | undefined {
  if (SYSTEM_FIELDS.has(key)) {
    return { fieldConfig: undefined, isRelationship: false }
  }

  const fieldConfig = fields[key]
  if (fieldConfig) {
    return { fieldConfig, isRelationship: fieldConfig.type === 'relationship' }
  }

  if (key.endsWith('Id')) {
    const baseField = fields[key.slice(0, -2)]
    if (baseField && baseField.type === 'relationship' && !baseField.many) {
      return { fieldConfig: baseField, isRelationship: false }
    }
  }

  for (const [ownerName, owner] of Object.entries(fields)) {
    if (owner && typeof owner.getColumnNames === 'function') {
      const columns: string[] = owner.getColumnNames(ownerName)
      if (columns.includes(key)) {
        return { fieldConfig: owner, isRelationship: false }
      }
    }
  }

  return undefined
}

function rejectUndeclaredKey(listName: string, key: string, kind: 'where' | 'orderBy'): never {
  throw new ValidationError([
    `Cannot query "${listName}" — "${key}" is not a field of this list. ` +
      `Undeclared ${kind} keys are rejected (use sudo to bypass).`,
  ])
}

function walkWhere(
  where: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  listName: string,
  config: OpenSaasConfig,
  isSudo: boolean,
): void {
  if (where === null || typeof where !== 'object') return

  if (Array.isArray(where)) {
    for (const entry of where) walkWhere(entry, listConfig, listName, config, isSudo)
    return
  }

  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (LOGICAL_OPERATORS.has(key)) {
      walkWhere(value, listConfig, listName, config, isSudo)
      continue
    }

    const resolved = resolveQueryField(key, listConfig.fields)
    if (!resolved) {
      if (isSudo) continue
      rejectUndeclaredKey(listName, key, 'where')
    }

    // Scalar field filters use Prisma's own operator vocabulary (`equals`,
    // `contains`, `in`, …) and never nest another field name — trusted as-is,
    // no further walk needed. Only a relationship field's filter nests a
    // WHERE clause for another list, via a relation quantifier.
    if (
      resolved.isRelationship &&
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      const related = getRelatedListConfig(resolved.fieldConfig.ref, config)
      if (!related) continue
      for (const [quantifier, quantifierValue] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (RELATION_QUANTIFIERS.has(quantifier)) {
          walkWhere(quantifierValue, related.listConfig, related.listName, config, isSudo)
        }
        // Other keys under a relation field (e.g. `equals: null` for a to-one
        // nullability check) are not nested WHERE clauses — nothing to walk.
      }
    }
  }
}

function walkOrderBy(
  orderBy: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  listName: string,
  config: OpenSaasConfig,
  isSudo: boolean,
): void {
  if (orderBy === null || typeof orderBy !== 'object') return

  if (Array.isArray(orderBy)) {
    for (const entry of orderBy) walkOrderBy(entry, listConfig, listName, config, isSudo)
    return
  }

  for (const [key, value] of Object.entries(orderBy as Record<string, unknown>)) {
    const resolved = resolveQueryField(key, listConfig.fields)
    if (!resolved) {
      if (isSudo) continue
      rejectUndeclaredKey(listName, key, 'orderBy')
    }

    if (resolved.isRelationship && value !== null && typeof value === 'object') {
      // `{ relation: { _count: 'asc' } }` orders by an aggregate — no nested
      // field name to resolve. `{ relation: { name: 'asc' } }` orders by a
      // field on a to-one related list — walk it against that list's fields.
      if ('_count' in (value as Record<string, unknown>)) continue

      const related = getRelatedListConfig(resolved.fieldConfig.ref, config)
      if (related) walkOrderBy(value, related.listConfig, related.listName, config, isSudo)
    }
  }
}

/**
 * Validate a caller-supplied `where`/`orderBy` against the list config,
 * recursing into logical operators (`AND`/`OR`/`NOT`) and relation filters.
 * Throws a `ValidationError` naming the list and the offending key on the
 * first undeclared key found. `isSudo` bypasses the check entirely, matching
 * the write path's `sudo` escape hatch.
 */
export function validateQueryKeys(args: {
  where?: unknown
  orderBy?: unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>
  listName: string
  config: OpenSaasConfig
  isSudo: boolean
}): void {
  const { where, orderBy, listConfig, listName, config, isSudo } = args
  if (where !== undefined) walkWhere(where, listConfig, listName, config, isSudo)
  if (orderBy !== undefined) walkOrderBy(orderBy, listConfig, listName, config, isSudo)
}
