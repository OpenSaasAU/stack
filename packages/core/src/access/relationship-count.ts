import type { Session, AccessContext, PrismaFilter } from './types.js'
import type { OpenSaasConfig, ListConfig, FieldConfig } from '../config/types.js'
import { checkAccess, getRelatedListConfig } from './engine.js'

/**
 * Access-scoped to-many relationship counts for the admin list view (issue
 * #732).
 *
 * A to-many relationship column shows the count of the related rows the session
 * may see — fetched in the SAME query as the row via Prisma's filtered
 * `_count` (`_count: { select: { orders: { where: <access filter> } } }`), so no
 * per-row query is issued and the count can never include rows the session
 * cannot read. This module is the single place the related list's
 * operation-level `query` access is folded into that `_count`, mirroring how
 * `buildAccessScopedInclude` folds it into relation includes.
 *
 * A count comparison is no longer expressible as a filter: Prisma 8 cannot
 * compare a relation count in a `where`, and the id-list resolver that used to
 * fake one is gone. A to-many Filter spec emits `some`/`none` for presence and
 * degrades any other comparison to free text (ADR-0055).
 */

type CountArgs = {
  session: Session | null
  context: AccessContext
}

/**
 * Whether a field is a to-many relationship — the only field kind that carries a
 * relationship count (a to-one relationship has at most one related row).
 */
export function isToManyRelationshipField(field: FieldConfig | undefined): boolean {
  return (
    field?.type === 'relationship' &&
    'many' in field &&
    field.many === true &&
    'ref' in field &&
    typeof field.ref === 'string' &&
    field.ref.length > 0
  )
}

/** The per-relation entry the count `_count.select` uses for one relationship. */
export type CountAccessEntry =
  | { kind: 'all' } // related list fully readable → count every related row
  | { kind: 'scoped'; where: PrismaFilter } // count only rows matching the access filter
  | { kind: 'denied' } // related list not readable at all → count is always 0

/**
 * Resolve one related list's operation-level `query` access directly into the
 * entry its `_count` select needs. The shared decision both
 * `relationshipCountAccessEntry` below (field → related list, for this
 * module's own admin-list-view and count-filter callers) and
 * `access-filter.ts`'s caller-`_count` scoping (issue #1087, which already
 * has the related list resolved — including a synthetic back-relation's,
 * which has no field of its own on the counting list) build on.
 */
export async function resolveCountAccessEntryForList(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  relatedListConfig: ListConfig<any>,
  args: CountArgs,
): Promise<CountAccessEntry> {
  const queryAccess = relatedListConfig.access?.operation?.query
  const result = await checkAccess(queryAccess, { session: args.session, context: args.context })

  if (result === false) return { kind: 'denied' }
  if (typeof result === 'object') return { kind: 'scoped', where: result }
  return { kind: 'all' }
}

/**
 * Resolve the related list's operation-level `query` access for one to-many
 * relationship into the entry its `_count` select needs. Returns `null` when the
 * field is not a resolvable to-many relationship.
 */
async function relationshipCountAccessEntry(
  field: FieldConfig | undefined,
  args: CountArgs,
  config: OpenSaasConfig,
): Promise<CountAccessEntry | null> {
  if (!field || !isToManyRelationshipField(field) || !('ref' in field)) {
    return null
  }
  const ref = field.ref
  if (typeof ref !== 'string') return null
  const related = getRelatedListConfig(ref, config)
  if (!related) return null

  return resolveCountAccessEntryForList(related.listConfig, args)
}

/**
 * Build the object to place at `include._count.select` for a list's to-many
 * relationships, with each related list's `query` access folded into the
 * per-relation `where` so the returned counts are access-scoped. A relationship
 * whose related list is fully denied is omitted (its count renders as 0). Returns
 * `undefined` when the list has no countable to-many relationships.
 */
export async function buildRelationshipCountSelect(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  args: CountArgs,
  config: OpenSaasConfig,
): Promise<Record<string, unknown> | undefined> {
  const select: Record<string, unknown> = {}
  for (const [fieldName, field] of Object.entries(listConfig.fields)) {
    const entry = await relationshipCountAccessEntry(field, args, config)
    if (entry === null || entry.kind === 'denied') continue
    select[fieldName] = entry.kind === 'scoped' ? { where: entry.where } : true
  }
  return Object.keys(select).length > 0 ? select : undefined
}
