import type { AccessControl, Session, AccessContext, PrismaFilter } from './types.js'
import type { OpenSaasConfig, ListConfig, RelationshipField } from '../config/types.js'
import { getSyntheticFieldName } from '../fields/index.js'
import { InvalidCreateAccessResultError } from './errors.js'

/**
 * Access engine — operation-level access control and shared helpers.
 *
 * This module holds the *operation-level* (list-level) access primitives and
 * the ref-parsing helper shared across both phases of the two-phase read:
 *
 *   - Phase 1, Access Filter (pre-query row/relation scoping): `access-filter.ts`
 *   - Phase 2, Field Visibility (post-query field stripping + resolveOutput +
 *     virtual fields): `field-visibility.ts`
 *
 * Field-level access evaluation is centralized in `field-access.ts`
 * (`checkFieldAccess`). See `docs/adr/0001-access-control-is-a-two-phase-read.md`
 * and the access-control glossary in `CONTEXT.md`.
 */

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

export function isPrismaFilter(value: unknown): value is PrismaFilter {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getRelatedListConfig(
  relationshipRef: string,
  config: OpenSaasConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): { listName: string; listConfig: ListConfig<any> } | null {
  // Parse ref format: "ListName.fieldName" or "ListName"
  const parts = relationshipRef.split('.')
  if (parts.length !== 1 && parts.length !== 2) {
    return null
  }

  const listName = parts[0]
  const listConfig = config.lists[listName]

  if (!listConfig) {
    return null
  }

  return { listName, listConfig }
}

/** A synthetic reverse relation, resolved back to the declared field that owns it. */
export interface SyntheticReverseRelation {
  sourceListName: string
  sourceFieldName: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RelationshipField must accept any TypeInfo
  sourceFieldConfig: RelationshipField<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  sourceListConfig: ListConfig<any>
}

/**
 * Resolve a candidate data key as the synthetic back-relation a list-only
 * `ref` (`ref: 'ListName'`, no target field) generates on its target model —
 * Prisma requires an opposite field there, but the config never declares one,
 * so it never appears in `parentListName`'s own `fields`. Reuses
 * `getSyntheticFieldName` (the same construction `getPrismaRelation` emits the
 * schema with) rather than re-deriving the `from_<List>_<field>` format by
 * string parsing, so the two cannot drift (#978).
 *
 * Returns the declared relationship field that owns the relation — the write
 * pipeline treats a resolved synthetic key exactly like a nested write through
 * that field, so it runs the same hooks/access/recovery machinery a declared
 * relationship field gets. Returns `null` when `fieldName` isn't one of these
 * on `parentListName` (a genuinely unknown key, or a bidirectional relation's
 * ref, which never synthesizes a back-relation).
 */
export function resolveSyntheticReverseRelation(
  fieldName: string,
  parentListName: string,
  config: OpenSaasConfig,
): SyntheticReverseRelation | null {
  for (const [sourceListName, sourceListConfig] of Object.entries(config.lists)) {
    for (const [sourceFieldName, sourceFieldConfig] of Object.entries(sourceListConfig.fields)) {
      if (sourceFieldConfig.type !== 'relationship') continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RelationshipField must accept any TypeInfo
      const rel = sourceFieldConfig as RelationshipField<any>
      // Only a list-only ref ('ListName', no '.fieldName') synthesizes a
      // back-relation — a bidirectional ref's other side is a real field.
      const refParts = rel.ref.split('.')
      if (refParts.length !== 1 || refParts[0] !== parentListName) continue
      if (getSyntheticFieldName(sourceListName, sourceFieldName) !== fieldName) continue
      return { sourceListName, sourceFieldName, sourceFieldConfig: rel, sourceListConfig }
    }
  }
  return null
}

/**
 * Enumerate every synthetic back-relation name a list-only `ref` elsewhere in
 * the config synthesizes onto `parentListName` — the same relations
 * `resolveSyntheticReverseRelation` resolves one at a time given a candidate
 * key, returned here as the full set for a caller that instead needs "every
 * relation this list carries" with no candidate to check (e.g. `_count:
 * true`'s "count every relation" expansion in `access-filter.ts`, issue
 * #1087 — a bare `_count: true` must include a synthetic back-relation's
 * count exactly as it always has, not only a caller-named one).
 */
export function listSyntheticReverseRelationNames(
  parentListName: string,
  config: OpenSaasConfig,
): string[] {
  const names: string[] = []
  for (const [sourceListName, sourceListConfig] of Object.entries(config.lists)) {
    for (const [sourceFieldName, sourceFieldConfig] of Object.entries(sourceListConfig.fields)) {
      if (sourceFieldConfig.type !== 'relationship') continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RelationshipField must accept any TypeInfo
      const rel = sourceFieldConfig as RelationshipField<any>
      const refParts = rel.ref.split('.')
      if (refParts.length !== 1 || refParts[0] !== parentListName) continue
      names.push(getSyntheticFieldName(sourceListName, sourceFieldName))
    }
  }
  return names
}

export async function checkAccess<T = Record<string, unknown>>(
  accessControl: AccessControl<T> | undefined,
  args: {
    session: Session | null
    item?: T
    context: AccessContext
  },
): Promise<boolean | PrismaFilter<T>> {
  // No access control means deny by default
  if (!accessControl) {
    return false
  }

  const result = await accessControl(args)

  return result
}

/**
 * Evaluate operation-level `create` access. The single evaluator shared by the
 * write pipeline's top-level create and the nested-create path — both must
 * reject the same way, or the two drift again (#1009).
 *
 * Unlike `checkAccess` (which `query`/`update`/`delete` call directly and which
 * legitimately returns a filter for them to re-check against a row), create
 * has no existing row and no way to test a filter against input data. A rule
 * that returns anything other than a strict boolean — most notably a filter,
 * which type-checks against the shared `AccessControl` signature and reads as
 * though it scopes the create — throws `InvalidCreateAccessResultError`
 * rather than being silently treated as an allow. See that error's doc,
 * ADR-0022, and ADR-0030.
 */
export async function checkCreateAccess<T = Record<string, unknown>>(
  listKey: string,
  accessControl: AccessControl<T> | undefined,
  args: {
    session: Session | null
    context: AccessContext
  },
): Promise<boolean> {
  const result = await checkAccess(accessControl, args)

  if (isBoolean(result)) {
    return result
  }

  throw new InvalidCreateAccessResultError(listKey, result)
}

export function mergeFilters(
  userFilter: PrismaFilter | undefined,
  accessFilter: boolean | PrismaFilter,
): PrismaFilter | null {
  if (accessFilter === false) {
    return null
  }

  if (accessFilter === true) {
    return userFilter || {}
  }

  if (!userFilter) {
    return accessFilter
  }

  return {
    AND: [accessFilter, userFilter],
  }
}
