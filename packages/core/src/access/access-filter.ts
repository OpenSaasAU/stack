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
