import type { Session, AccessContext } from './types.js'
import type { OpenSaasConfig, ListConfig, FieldConfig } from '../config/types.js'
import { checkAccess, getRelatedListConfig } from './engine.js'
import { mergeResolvedMember } from './relationship-count.js'

/**
 * Access-scoped to-one relationship label filters for the admin list view
 * (issue #749).
 *
 * A to-one relationship's Filter spec (`author:Ada` → `{ author: { is: { name:
 * { contains: 'Ada' } } } }`) is a pure mapper (see `relationship()` in
 * `fields/index.ts`) — it has no way to consult the related list's access
 * control, so the nested `is` clause it emits runs as an unscoped Prisma
 * sub-filter against the related table. The parent list's own access filter
 * still scopes which parent rows are visible, but the nested condition itself
 * is evaluated with no reference to the related list's `query` access — a
 * session could distinguish parent rows by a related field it is not itself
 * allowed to read (e.g. binary-searching `author:A`, `author:Ad`, `author:Ada`
 * against a `User` list it cannot query).
 *
 * This module is the single place the related list's operation-level `query`
 * access is folded into that nested `is` clause, mirroring how
 * `relationship-count.ts` folds it into `_count` selects and count-filter
 * markers. A fully denied related list makes the member never match — the
 * token cannot be used to confirm or rule out a value on a field the session
 * cannot read (narrowing-only, matching the count resolver's denied path).
 */

type LabelFilterArgs = {
  session: Session | null
  context: AccessContext
}

/**
 * Whether a field is a to-one relationship — the only field kind whose Filter
 * spec emits a nested `{ is: {...} } }` condition against the related list's
 * label field.
 */
export function isToOneRelationshipField(field: FieldConfig | undefined): boolean {
  return (
    field?.type === 'relationship' &&
    !('many' in field && field.many === true) &&
    'ref' in field &&
    typeof field.ref === 'string' &&
    field.ref.length > 0
  )
}

/** Narrow a filter member's field value to a `{ is: {...} } }` clause, if it is one. */
function readIsClause(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  const isValue = (value as Record<string, unknown>).is
  if (!isValue || typeof isValue !== 'object') return null
  return isValue as Record<string, unknown>
}

/**
 * Resolve one to-one relationship label-filter member into an access-scoped
 * condition by ANDing the related list's `query` access filter into the nested
 * `is` clause. Returns `{ id: { in: [] } }` (never matches) when the related
 * list is fully denied, the original member unchanged when it is fully
 * readable, and the `is` clause ANDed with the access filter otherwise.
 */
async function resolveOneLabelFilter(
  field: FieldConfig,
  fieldName: string,
  isClause: Record<string, unknown>,
  args: LabelFilterArgs,
  config: OpenSaasConfig,
): Promise<Record<string, unknown>> {
  if (!('ref' in field) || typeof field.ref !== 'string') {
    return { [fieldName]: { is: isClause } }
  }
  const related = getRelatedListConfig(field.ref, config)
  if (!related) return { [fieldName]: { is: isClause } }

  const queryAccess = related.listConfig.access?.operation?.query
  const result = await checkAccess(queryAccess, { session: args.session, context: args.context })

  if (result === false) return { id: { in: [] } }
  if (result === true) return { [fieldName]: { is: isClause } }
  return { [fieldName]: { is: { AND: [result, isClause] } } }
}

/**
 * Replace any to-one relationship label-filter members in a filter `where`
 * with access-scoped equivalents. Label-filter members only ever appear as
 * top-level AND members (the relationship Filter spec does not declare
 * `freeText`, so it never participates in the free-text OR), so this walks
 * only the top level. Returns the `where` unchanged when it contains no such
 * members, so lists without to-one relationship filters pay nothing.
 */
export async function resolveRelationshipLabelFilters(
  where: Record<string, unknown> | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  args: LabelFilterArgs,
  config: OpenSaasConfig,
): Promise<Record<string, unknown> | undefined> {
  if (!where) return where

  const andValue = where.AND
  const members: Array<Record<string, unknown>> = Array.isArray(andValue)
    ? (andValue as Array<Record<string, unknown>>)
    : [where]

  const findLabelFilter = (
    member: Record<string, unknown>,
  ): { field: string; isClause: Record<string, unknown> } | null => {
    for (const key of Object.keys(member)) {
      const field = listConfig.fields[key]
      if (!isToOneRelationshipField(field)) continue
      const isClause = readIsClause(member[key])
      if (!isClause) continue
      return { field: key, isClause }
    }
    return null
  }

  if (!members.some((member) => findLabelFilter(member) !== null)) {
    return where
  }

  const resolvedMembers: Array<Record<string, unknown>> = []
  for (const member of members) {
    const found = findLabelFilter(member)
    if (!found) {
      resolvedMembers.push(member)
      continue
    }
    const field = listConfig.fields[found.field]
    const resolved = await resolveOneLabelFilter(field, found.field, found.isClause, args, config)

    const siblings: Record<string, unknown> = { ...member }
    delete siblings[found.field]
    resolvedMembers.push(mergeResolvedMember(siblings, resolved))
  }

  return resolvedMembers.length === 1 ? resolvedMembers[0] : { AND: resolvedMembers }
}
