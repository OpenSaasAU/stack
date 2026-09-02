import type { ListConfig, OpenSaasConfig } from '../config/types.js'
import type { Session, AccessContext } from './types.js'
import { getRelatedListConfig } from './engine.js'
import { isFieldReadableForPredicate } from './field-access.js'
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
 *
 * `validateQueryFieldReadAccess` below is that access-control decision for
 * #915: it re-walks `where`/`orderBy` (reusing `resolveQueryField`) and checks
 * each resolved field's `read` access via the canonical evaluator, so a field
 * the session cannot read cannot be named in a predicate either. It runs
 * strictly after this module's key-existence check — an undeclared key is
 * #912's rejection, not a field-access decision — and stays scoped to the
 * CURRENT list, deliberately not recursing into a related list's fields
 * nested inside a relation filter itself (that recursion is #916's job, not
 * this module's — see below).
 *
 * #916 — the relation-filter counterpart — scopes a relation filter itself
 * (`some`/`every`/`none`/`is`/`isNot`) by the RELATED list's own `query`
 * access, folding it into the nested clause exactly like
 * `buildAccessScopedInclude` folds it into `include` (`access-filter.ts`).
 * It reuses this module's shape-recognition (`resolveQueryField`,
 * `LOGICAL_OPERATORS`, `RELATION_QUANTIFIERS`, exported below) and calls
 * `walkWhereReadAccess` once per hop — against the RELATED list's own
 * config — for the field-read half of the same job this module's
 * `validateQueryFieldReadAccess` already does for the CURRENT list. There is
 * deliberately no second copy of either the shape-recognition or the
 * field-read check: `access-filter.ts` supplies the RELATED list at each
 * hop and calls back into the same primitives this module already owns.
 *
 * #1092 — `validateQueryKeys` is also the include-nested counterpart: a
 * `where`/`orderBy` a caller nests inside an `include` entry gets the same
 * #912 check, called by `buildAccessScopedInclude` against the RELATED list
 * instead of the current one — no second key-existence walker for that
 * position. `validateQueryFieldReadAccess` needs no equivalent call there:
 * `checkKeyReadableOrThrow` already treats a key `resolveQueryField` cannot
 * resolve as "already handled elsewhere" and skips it, which is exactly the
 * synthetic-back-relation tolerance below needs — nothing to change. The one
 * thing this position needs that the top-level `where`/`orderBy` never did:
 * a key neither call resolves is tried against the optional
 * `resolveSyntheticRelation` hook before being rejected, because a synthetic
 * back-relation (#1082) is nameable in a nested predicate too. Every
 * existing caller omits the hook, so top-level behavior is unchanged.
 */

// Prisma's logical combinators for a WHERE clause — never field names.
export const LOGICAL_OPERATORS = new Set(['AND', 'OR', 'NOT'])

// Prisma's relation quantifiers. The value nested under one of these is itself a
// WHERE clause for the RELATED list, and is walked against that list's fields.
export const RELATION_QUANTIFIERS = new Set(['some', 'every', 'none', 'is', 'isNot'])

// Always present, never declared in a list's `fields` — the write path
// (`filterWritableFields`) excludes the same three names from `fieldConfigs`.
const SYSTEM_FIELDS = new Set(['id', 'createdAt', 'updatedAt'])

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- field configs are heterogeneous across field types
type FieldConfigMap = Record<string, any>

export interface ResolvedQueryField {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- field configs are heterogeneous across field types
  fieldConfig: any
  isRelationship: boolean
}

/**
 * Where an unresolved key's nested predicate should recurse when it turns out
 * to name a synthetic back-relation (#1082) rather than a declared field —
 * the source list the back-relation stands for, NOT `getRelatedListConfig`'s
 * target (a synthetic field carries no `ref` of its own to follow).
 */
export interface SyntheticRelationTarget {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>
  listName: string
}

type ResolveSyntheticRelation = (key: string, listName: string) => SyntheticRelationTarget | null

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
export function resolveQueryField(
  key: string,
  fields: FieldConfigMap,
): ResolvedQueryField | undefined {
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
  resolveSyntheticRelation?: ResolveSyntheticRelation,
): void {
  if (where === null || typeof where !== 'object') return

  if (Array.isArray(where)) {
    for (const entry of where) {
      walkWhere(entry, listConfig, listName, config, isSudo, resolveSyntheticRelation)
    }
    return
  }

  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (LOGICAL_OPERATORS.has(key)) {
      walkWhere(value, listConfig, listName, config, isSudo, resolveSyntheticRelation)
      continue
    }

    const resolved = resolveQueryField(key, listConfig.fields)
    if (!resolved) {
      const synthetic = resolveSyntheticRelation?.(key, listName)
      if (synthetic) {
        // A synthetic back-relation is always to-many (#1082's own
        // construction site has no arity branch), so its nested value takes
        // the same two shapes a declared to-many relationship's filter does
        // — walk it exactly like the resolved-relationship branch below,
        // against the synthetic's source list instead of `getRelatedListConfig`.
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          const syntheticEntries = Object.entries(value as Record<string, unknown>)
          const syntheticHasQuantifier = syntheticEntries.some(([k]) => RELATION_QUANTIFIERS.has(k))
          if (syntheticHasQuantifier) {
            for (const [quantifier, quantifierValue] of syntheticEntries) {
              if (RELATION_QUANTIFIERS.has(quantifier)) {
                walkWhere(
                  quantifierValue,
                  synthetic.listConfig,
                  synthetic.listName,
                  config,
                  isSudo,
                  resolveSyntheticRelation,
                )
              }
            }
          } else {
            walkWhere(
              value,
              synthetic.listConfig,
              synthetic.listName,
              config,
              isSudo,
              resolveSyntheticRelation,
            )
          }
        }
        continue
      }
      if (isSudo) continue
      rejectUndeclaredKey(listName, key, 'where')
    }

    // Scalar field filters use Prisma's own operator vocabulary (`equals`,
    // `contains`, `in`, …) and never nest another field name — trusted as-is,
    // no further walk needed. Only a relationship field's filter nests a
    // WHERE clause for another list.
    if (
      resolved.isRelationship &&
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      const related = getRelatedListConfig(resolved.fieldConfig.ref, config)
      if (!related) continue

      const relationEntries = Object.entries(value as Record<string, unknown>)
      const hasQuantifier = relationEntries.some(([k]) => RELATION_QUANTIFIERS.has(k))

      if (hasQuantifier) {
        // Wrapped form: `{ author: { is: {...} } }` / `{ posts: { some: {...} } }`.
        // Only the quantifier's own value is a nested WHERE clause for the
        // related list.
        for (const [quantifier, quantifierValue] of relationEntries) {
          if (RELATION_QUANTIFIERS.has(quantifier)) {
            walkWhere(
              quantifierValue,
              related.listConfig,
              related.listName,
              config,
              isSudo,
              resolveSyntheticRelation,
            )
          }
        }
      } else {
        // Direct-nesting form: Prisma's documented default for a to-one
        // relation filter nests the related list's own fields with no `is`
        // wrapper at all (`{ author: { email: { contains: '...' } } }`). The
        // whole value object IS the nested WHERE clause here — walk it
        // directly, or an undeclared key reached exactly this way (one hop
        // through a to-one relation) would pass through unchecked.
        walkWhere(
          value,
          related.listConfig,
          related.listName,
          config,
          isSudo,
          resolveSyntheticRelation,
        )
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
  resolveSyntheticRelation?: ResolveSyntheticRelation,
): void {
  if (orderBy === null || typeof orderBy !== 'object') return

  if (Array.isArray(orderBy)) {
    for (const entry of orderBy) {
      walkOrderBy(entry, listConfig, listName, config, isSudo, resolveSyntheticRelation)
    }
    return
  }

  for (const [key, value] of Object.entries(orderBy as Record<string, unknown>)) {
    const resolved = resolveQueryField(key, listConfig.fields)
    if (!resolved) {
      const synthetic = resolveSyntheticRelation?.(key, listName)
      if (synthetic) {
        // `{ relation: { _count: 'asc' } }` orders by an aggregate — no
        // nested field name to resolve, matching the declared-relationship
        // branch below.
        if (
          value !== null &&
          typeof value === 'object' &&
          !('_count' in (value as Record<string, unknown>))
        ) {
          walkOrderBy(
            value,
            synthetic.listConfig,
            synthetic.listName,
            config,
            isSudo,
            resolveSyntheticRelation,
          )
        }
        continue
      }
      if (isSudo) continue
      rejectUndeclaredKey(listName, key, 'orderBy')
    }

    if (resolved.isRelationship && value !== null && typeof value === 'object') {
      // `{ relation: { _count: 'asc' } }` orders by an aggregate — no nested
      // field name to resolve. `{ relation: { name: 'asc' } }` orders by a
      // field on a to-one related list — walk it against that list's fields.
      if ('_count' in (value as Record<string, unknown>)) continue

      const related = getRelatedListConfig(resolved.fieldConfig.ref, config)
      if (related) {
        walkOrderBy(
          value,
          related.listConfig,
          related.listName,
          config,
          isSudo,
          resolveSyntheticRelation,
        )
      }
    }
  }
}

/**
 * Validate a caller-supplied `where`/`orderBy` against the list config,
 * recursing into logical operators (`AND`/`OR`/`NOT`) and relation filters.
 * Throws a `ValidationError` naming the list and the offending key on the
 * first undeclared key found. `isSudo` bypasses the check entirely, matching
 * the write path's `sudo` escape hatch.
 *
 * `resolveSyntheticRelation` is the include-nested position's own addition
 * (#1092, see module doc comment) — omit it (every top-level `where`/`orderBy`
 * caller does) and a key `resolveQueryField` can't resolve rejects exactly as
 * before.
 */
export function validateQueryKeys(args: {
  where?: unknown
  orderBy?: unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>
  listName: string
  config: OpenSaasConfig
  isSudo: boolean
  resolveSyntheticRelation?: ResolveSyntheticRelation
}): void {
  const { where, orderBy, listConfig, listName, config, isSudo, resolveSyntheticRelation } = args
  if (where !== undefined) {
    walkWhere(where, listConfig, listName, config, isSudo, resolveSyntheticRelation)
  }
  if (orderBy !== undefined) {
    walkOrderBy(orderBy, listConfig, listName, config, isSudo, resolveSyntheticRelation)
  }
}

/**
 * #915 — the predicate-time counterpart to `checkFieldAccess`'s post-query
 * check: reject a `where`/`orderBy` key that names a field the session cannot
 * read, BEFORE the query runs. See this module's top doc comment for how this
 * relates to `validateQueryKeys` (#912) and `isFieldReadableForPredicate`'s
 * doc (in `field-access.ts`) for how a row-dependent `read` rule is handled.
 *
 * A key `resolveQueryField` cannot resolve is skipped here — #912 has already
 * rejected it (or, under `sudo`, deliberately let it through) by the time
 * this runs. A system field (`id`/`createdAt`/`updatedAt`) resolves with no
 * `fieldConfig` and carries no field-level access control, so it is always
 * readable and skipped too.
 */
async function checkKeyReadableOrThrow(
  key: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  listName: string,
  args: { session: Session | null; context: AccessContext & { _isSudo?: boolean } },
  kind: 'where' | 'orderBy',
): Promise<void> {
  const resolved = resolveQueryField(key, listConfig.fields)
  if (!resolved || resolved.fieldConfig === undefined) return

  const readable = await isFieldReadableForPredicate(resolved.fieldConfig.access, args)
  if (!readable) {
    throw new ValidationError([
      `Cannot query "${listName}" — "${key}" is denied by field-level read access. ` +
        `A field the session cannot read cannot be named in a ${kind} (use sudo to bypass).`,
    ])
  }
}

/**
 * Check field-level `read` access for every key at ONE level of a `where`
 * clause, recursing only into logical operators (`AND`/`OR`/`NOT`) — never
 * into a relationship field's own nested value. Exported for `access-filter.ts`'s
 * #916 reuse (see module doc comment above) — called once per hop against the
 * RELATED list's own config.
 */
export async function walkWhereReadAccess(
  where: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  listName: string,
  args: { session: Session | null; context: AccessContext & { _isSudo?: boolean } },
): Promise<void> {
  if (where === null || typeof where !== 'object') return

  if (Array.isArray(where)) {
    for (const entry of where) await walkWhereReadAccess(entry, listConfig, listName, args)
    return
  }

  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (LOGICAL_OPERATORS.has(key)) {
      await walkWhereReadAccess(value, listConfig, listName, args)
      continue
    }
    // Deliberately does not recurse into a relationship field's own nested
    // value: it checks whether THIS list's relationship field may be named
    // (its own `read` access) — a field on the RELATED list nested inside it
    // is checked by the CALLER re-invoking this function against the related
    // list's config (see #916 in the module doc comment above).
    await checkKeyReadableOrThrow(key, listConfig, listName, args, 'where')
  }
}

async function walkOrderByReadAccess(
  orderBy: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  listName: string,
  args: { session: Session | null; context: AccessContext & { _isSudo?: boolean } },
): Promise<void> {
  if (orderBy === null || typeof orderBy !== 'object') return

  if (Array.isArray(orderBy)) {
    for (const entry of orderBy) await walkOrderByReadAccess(entry, listConfig, listName, args)
    return
  }

  for (const key of Object.keys(orderBy as Record<string, unknown>)) {
    await checkKeyReadableOrThrow(key, listConfig, listName, args, 'orderBy')
  }
}

/**
 * Validate a caller-supplied `where`/`orderBy` against field-level `read`
 * access, recursing into logical operators (`AND`/`OR`/`NOT`) the same way
 * `validateQueryKeys` does. Throws a `ValidationError` naming the list and
 * the offending key on the first read-denied field found. `isSudo` bypasses
 * the check entirely, matching `validateQueryKeys` and the write path's
 * `sudo` escape hatch.
 */
export async function validateQueryFieldReadAccess(args: {
  where?: unknown
  orderBy?: unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>
  listName: string
  session: Session | null
  context: AccessContext & { _isSudo?: boolean }
  isSudo: boolean
}): Promise<void> {
  const { where, orderBy, listConfig, listName, session, context, isSudo } = args
  if (isSudo) return
  const evalArgs = { session, context }
  if (where !== undefined) await walkWhereReadAccess(where, listConfig, listName, evalArgs)
  if (orderBy !== undefined) await walkOrderByReadAccess(orderBy, listConfig, listName, evalArgs)
}
