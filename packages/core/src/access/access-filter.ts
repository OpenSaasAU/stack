import type { Session, AccessContext, PrismaFilter } from './types.js'
import type { OpenSaasConfig, FieldConfig } from '../config/types.js'
import { checkAccess, getRelatedListConfig } from './engine.js'

/**
 * Access Filter — phase 1 of the two-phase read (pre-query).
 *
 * This module scopes which rows and relationships the database is allowed to
 * return, before the query runs. It evaluates *operation-level* `query` access
 * on related lists and turns the results into a Prisma `include`/`where` clause,
 * so denied rows and relations never leave the database.
 *
 * Phase 2 (post-query field stripping + `resolveOutput` + virtual computation)
 * lives in `field-visibility.ts`. The two phases cannot be merged: virtual
 * fields are computed in JavaScript and post-query field access can depend on
 * the fetched row, neither of which is expressible in SQL. See
 * `docs/adr/0001-access-control-is-a-two-phase-read.md` and the access-control
 * glossary in `CONTEXT.md`.
 */

/**
 * Build Prisma include object with access control filters
 * This allows us to filter relationships at the database level instead of in memory
 */
export async function buildIncludeWithAccessControl(
  fieldConfigs: Record<string, FieldConfig>,
  args: {
    session: Session | null
    context: AccessContext
  },
  config: OpenSaasConfig,
  depth: number = 0,
) {
  const MAX_DEPTH = 5
  if (depth >= MAX_DEPTH) {
    return undefined
  }

  // Skip auto-including relationships when inside a resolveOutput hook
  // This prevents infinite loops when hooks make DB queries that include
  // relationships back to the same entity (e.g., User virtual field queries Posts
  // which includes author back to User, triggering the virtual field again)
  if (args.context._resolveOutputCounter.depth > 0) {
    return undefined
  }

  type IncludeEntry = boolean | { where?: PrismaFilter; include?: Record<string, IncludeEntry> }

  const include: Record<string, IncludeEntry> = {}
  let hasRelationships = false

  for (const [fieldName, fieldConfig] of Object.entries(fieldConfigs)) {
    if (fieldConfig?.type === 'relationship' && 'ref' in fieldConfig && fieldConfig.ref) {
      hasRelationships = true
      const relatedConfig = getRelatedListConfig(fieldConfig.ref as string, config)

      if (relatedConfig) {
        // Check query access for the related list
        const queryAccess = relatedConfig.listConfig.access?.operation?.query
        const accessResult = await checkAccess(queryAccess, {
          session: args.session,
          context: args.context,
        })

        // If access is completely denied, exclude this relationship
        if (accessResult === false) {
          continue
        }

        // Build the include entry
        const includeEntry: Record<string, unknown> = {}

        // If access returns a filter, add it to the where clause
        if (typeof accessResult === 'object') {
          includeEntry.where = accessResult
        }

        // Recursively build nested includes
        const nestedInclude = await buildIncludeWithAccessControl(
          relatedConfig.listConfig.fields,
          args,
          config,
          depth + 1,
        )

        if (nestedInclude && Object.keys(nestedInclude).length > 0) {
          includeEntry.include = nestedInclude
        }

        // Add to include object
        include[fieldName] = Object.keys(includeEntry).length > 0 ? includeEntry : true
      }
    }
  }

  return hasRelationships ? include : undefined
}

/**
 * A single relation entry in a Prisma `include` object: either a bare `true`
 * (fetch with no extra constraints) or an object that scopes the fetch with a
 * `where` filter and/or a nested `include`.
 */
type IncludeEntry = boolean | { where?: PrismaFilter; include?: IncludeObject }
type IncludeObject = Record<string, IncludeEntry>

/** The structured (object) form of a relation include entry. */
type IncludeEntryObject = { where?: PrismaFilter; include?: IncludeObject }

/**
 * Narrow an unknown include value to the structured object form (vs bare `true`
 * or any other primitive). Caller-supplied includes arrive untyped at the
 * runtime boundary, so we validate the shape here rather than casting.
 */
function asEntryObject(value: unknown): IncludeEntryObject | null {
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const where = obj.where
    const include = obj.include
    const entry: IncludeEntryObject = {}
    if (where && typeof where === 'object') entry.where = where as PrismaFilter
    if (include && typeof include === 'object') entry.include = include as IncludeObject
    return entry
  }
  return null
}

/**
 * AND-combine an access `where` with a caller-supplied nested `where`.
 *
 * The access filter is authoritative: the caller's filter may only NARROW the
 * result further, never widen past what access permits. We therefore wrap both
 * in a Prisma `AND` so neither can override the other. If only one side is
 * present, it is returned as-is; if neither is present, the result is undefined.
 */
function andWhere(
  accessWhere: PrismaFilter | undefined,
  callerWhere: PrismaFilter | undefined,
): PrismaFilter | undefined {
  if (accessWhere && callerWhere) {
    return { AND: [accessWhere, callerWhere] }
  }
  return accessWhere ?? callerWhere
}

/**
 * Merge a caller-supplied `include` with the access-controlled include — phase-1
 * row/relation scoping for explicit caller selections.
 *
 * The caller's `include` decides WHICH relations to fetch; access control decides
 * WHETHER each relation may be fetched and WITH WHAT filter. Replacing the
 * access-controlled include with the caller's wholesale (the bug in #566) drops
 * every per-relation access `where` and denied-relation exclusion, silently
 * bypassing row-level access on any non-sudo read that passes `include`.
 *
 * For each relation the caller asks to include:
 * - If the relation is a config-declared relationship but is ABSENT from the
 *   access-controlled include, its `query` access returned `false` → it is DROPPED
 *   (not fetched).
 * - If it is present (allowed, possibly with a filter), the access entry is used
 *   as the base: the access `where` is AND-combined with any caller-supplied
 *   nested `where`, and nested includes are recursively merged using the related
 *   list's field configs (so deeply-nested selections are filtered at every
 *   level). A bare caller `true` becomes the access-controlled shape (filter +
 *   nested filtered include), never bare `true`.
 * - If the caller names a key that is NOT a config-declared relationship, it is
 *   passed through unchanged (access control does not govern it).
 *
 * The access-controlled include is recursive to `MAX_DEPTH` (see
 * `buildIncludeWithAccessControl`); beyond that depth no auto-include exists, so
 * deeper caller selections pass through unscoped — consistent with the existing
 * auto-include behaviour.
 *
 * `accessControlledInclude` being `undefined` is NOT "every relation denied". It
 * means no access-controlled include was computed at all — a non-denial outcome
 * that `buildIncludeWithAccessControl` returns when inside a `resolveOutput`/
 * virtual-field context, at `MAX_DEPTH`, or when the list has no relationships.
 * In every one of those cases there is nothing to merge against, so the caller's
 * `include` is passed through unchanged (matching the prior `args.include || …`
 * fallback). This is distinct from an `undefined` ENTRY inside a defined access
 * include, which DOES mean the relation was denied and must be dropped (see the
 * per-relation loop below). Only the whole-object `undefined` is a passthrough.
 */
export function mergeIncludeWithAccessControl(
  callerInclude: Record<string, unknown>,
  accessControlledInclude: Record<string, unknown> | undefined,
  fieldConfigs: Record<string, FieldConfig>,
  config: OpenSaasConfig,
): Record<string, unknown> {
  // No access-controlled include was computed (resolveOutput/virtual context,
  // MAX_DEPTH, or a list with no relationships) → nothing to scope against, so
  // pass the caller's include through unchanged. Dropping relations here would be
  // fail-closed data loss, not a denial. Denied relations are dropped only when a
  // defined access include OMITS them (handled per-relation below).
  if (accessControlledInclude === undefined) {
    return callerInclude
  }

  const merged: Record<string, unknown> = {}
  const accessInclude = accessControlledInclude

  for (const [relationName, callerValue] of Object.entries(callerInclude)) {
    const fieldConfig = fieldConfigs[relationName]
    const isDeclaredRelationship =
      fieldConfig?.type === 'relationship' && 'ref' in fieldConfig && !!fieldConfig.ref

    // Not a config-declared relationship → access control does not govern it; pass through unchanged.
    if (!isDeclaredRelationship) {
      merged[relationName] = callerValue
      continue
    }

    const accessValue = accessInclude[relationName]

    // Declared relationship absent from the access include → query access denied → drop it.
    if (accessValue === undefined) {
      continue
    }

    const accessEntry = asEntryObject(accessValue)
    const callerEntry = asEntryObject(callerValue)

    // Resolve the related list's field configs so nested includes merge recursively.
    const relatedConfig = getRelatedListConfig(fieldConfig.ref as string, config)
    const relatedFields = relatedConfig?.listConfig.fields

    const mergedWhere = andWhere(accessEntry?.where, callerEntry?.where)

    let mergedNested: Record<string, unknown> | undefined
    if (callerEntry?.include && relatedFields) {
      // Recurse: scope the caller's nested selection against the nested access include.
      mergedNested = mergeIncludeWithAccessControl(
        callerEntry.include,
        accessEntry?.include,
        relatedFields,
        config,
      )
    } else if (accessEntry?.include) {
      // Caller selected the relation bare (no nested include); keep the
      // access-controlled nested include so deeper relations stay filtered.
      mergedNested = accessEntry.include
    }

    const entry: { where?: PrismaFilter; include?: Record<string, unknown> } = {}
    if (mergedWhere) entry.where = mergedWhere
    if (mergedNested && Object.keys(mergedNested).length > 0) entry.include = mergedNested

    // A bare-`true` relation with no access filter and no nested include stays `true`.
    merged[relationName] = Object.keys(entry).length > 0 ? entry : true
  }

  return merged
}
