import type { Session, AccessContext, PrismaFilter } from './types.js'
import type { OpenSaasConfig, ListConfig, FieldConfig } from '../config/types.js'
import type { FilterOperator, RelationshipCountFilterMarker } from '../filter/types.js'
import { RELATIONSHIP_COUNT_FILTER_KEY } from '../filter/types.js'
import { checkAccess, getRelatedListConfig } from './engine.js'
import { getDbKey } from '../lib/case-utils.js'

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
 * It also resolves the count Filter spec's markers: Prisma cannot compare a
 * relation count in a `where`, so a to-many relationship's Filter spec emits a
 * {@link RELATIONSHIP_COUNT_FILTER_KEY} marker that
 * {@link resolveRelationshipCountFilters} turns into an access-scoped
 * `{ id: { in } }` before the query runs — never leaking counts of related rows
 * the session cannot see.
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
type CountAccessEntry =
  | { kind: 'all' } // related list fully readable → count every related row
  | { kind: 'scoped'; where: PrismaFilter } // count only rows matching the access filter
  | { kind: 'denied' } // related list not readable at all → count is always 0

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

  const queryAccess = related.listConfig.access?.operation?.query
  const result = await checkAccess(queryAccess, { session: args.session, context: args.context })

  if (result === false) return { kind: 'denied' }
  if (typeof result === 'object') return { kind: 'scoped', where: result }
  return { kind: 'all' }
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

function readRelationshipCount(row: Record<string, unknown>, fieldName: string): number {
  const counts = row._count
  if (counts && typeof counts === 'object') {
    const value = (counts as Record<string, unknown>)[fieldName]
    if (typeof value === 'number') return value
  }
  return 0
}

function matchesCount(count: number, operator: FilterOperator, value: number): boolean {
  switch (operator) {
    case 'eq':
      return count === value
    case 'gt':
      return count > value
    case 'gte':
      return count >= value
    case 'lt':
      return count < value
    case 'lte':
      return count <= value
  }
}

/** Minimal shape the resolver needs off the secured `context.db` delegate. */
interface CountFindManyDelegate {
  findMany: (args: { include: { _count: { select: Record<string, unknown> } } }) => Promise<unknown>
}

function asCountDelegate(value: unknown): CountFindManyDelegate | null {
  if (value && typeof value === 'object' && 'findMany' in value) {
    const candidate = value as { findMany?: unknown }
    if (typeof candidate.findMany === 'function') {
      return value as CountFindManyDelegate
    }
  }
  return null
}

function readCountMarker(value: unknown): RelationshipCountFilterMarker | null {
  if (!value || typeof value !== 'object') return null
  const marker = (value as Record<string, unknown>)[RELATIONSHIP_COUNT_FILTER_KEY]
  if (!marker || typeof marker !== 'object') return null
  const { operator, value: n } = marker as { operator?: unknown; value?: unknown }
  if (
    (operator === 'eq' ||
      operator === 'gt' ||
      operator === 'gte' ||
      operator === 'lt' ||
      operator === 'lte') &&
    typeof n === 'number'
  ) {
    return { operator, value: n }
  }
  return null
}

/**
 * Resolve one to-many relationship count-filter marker into a Prisma `where`
 * fragment constraining the parent by id. Runs a single access-scoped read
 * through the SECURED context — never a raw/unscoped query and never a per-row
 * query — computing the access-visible count per parent and keeping the ids
 * whose count satisfies the comparison. A fully-denied related list makes every
 * count 0, resolved without any query.
 */
async function resolveOneCountFilter(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  listKey: string,
  fieldName: string,
  marker: RelationshipCountFilterMarker,
  args: CountArgs,
  config: OpenSaasConfig,
): Promise<PrismaFilter> {
  const field = listConfig.fields[fieldName]
  const entry = await relationshipCountAccessEntry(field, args, config)

  // Not resolvable (shouldn't happen for a marker the spec emitted) → no-op.
  if (entry === null) return {}

  // Related list fully denied → every parent's access-visible count is 0.
  if (entry.kind === 'denied') {
    return matchesCount(0, marker.operator, marker.value) ? {} : { id: { in: [] } }
  }

  const delegate = asCountDelegate(args.context.db[getDbKey(listKey)])
  if (!delegate) return {}

  const countSelect = entry.kind === 'scoped' ? { where: entry.where } : true
  // This over-fetches the parent's scalar columns — it reads only `id` + `_count`
  // per row yet materialises every scalar. It is left un-narrowed on purpose: the
  // secured `context.db` `findMany` does NOT honour Prisma `select` (it
  // warns-and-ignores it and returns the full access-filtered record — see
  // `warnIfSelectIgnored` in context/index.ts and the "Narrowing Reads" note in
  // packages/core/CLAUDE.md). The only supported narrowing is `include`/fragment
  // `query`, neither of which can drop scalar columns. So adding
  // `select: { id: true, _count: {...} }` here would be a silent no-op that also
  // trips the ignore-warning, not a real projection. The count stays access-scoped
  // via the filtered `_count` include below regardless; trimming the projection
  // would first require the read pipeline to honour `select`.
  const rows = await delegate.findMany({
    include: { _count: { select: { [fieldName]: countSelect } } },
  })

  const matchingIds: string[] = []
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      const record = row as Record<string, unknown>
      if (matchesCount(readRelationshipCount(record, fieldName), marker.operator, marker.value)) {
        matchingIds.push(String(record.id))
      }
    }
  }
  return { id: { in: matchingIds } }
}

/**
 * Merge a filter-member's non-resolved sibling conditions with a resolved
 * access-scoped fragment (e.g. a count marker's `{ id: { in } }`, or a to-one
 * label filter's access-scoped `is`). With no siblings (the guaranteed case
 * today) this is just the resolved fragment. When a sibling shares a key with
 * the resolved fragment — a contrived case that cannot arise under the current
 * one-condition-per-member invariant — both are ANDed so neither condition is
 * silently lost. Shared by both relationship resolvers in this module and in
 * `relationship-label-filter.ts`.
 */
export function mergeResolvedMember(
  siblings: Record<string, unknown>,
  resolved: Record<string, unknown>,
): Record<string, unknown> {
  if (Object.keys(siblings).length === 0) return resolved
  const collides = Object.keys(resolved).some((key) => key in siblings)
  return collides ? { AND: [siblings, resolved] } : { ...siblings, ...resolved }
}

/**
 * Replace any to-many relationship count-filter markers in a filter `where` with
 * access-scoped `{ id: { in } }` fragments. Markers only ever appear as
 * top-level AND members (the pure filter engine pushes each field condition into
 * the top-level AND, and never nests a marker inside the free-text OR), so this
 * walks only the top level. Returns the `where` unchanged when it contains no
 * markers, so lists without count filters pay nothing.
 */
export async function resolveRelationshipCountFilters(
  where: Record<string, unknown> | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  listKey: string,
  args: CountArgs,
  config: OpenSaasConfig,
): Promise<Record<string, unknown> | undefined> {
  if (!where) return where

  const andValue = where.AND
  const members: Array<Record<string, unknown>> = Array.isArray(andValue)
    ? (andValue as Array<Record<string, unknown>>)
    : [where]

  const findMarker = (
    member: Record<string, unknown>,
  ): { field: string; marker: RelationshipCountFilterMarker } | null => {
    for (const key of Object.keys(member)) {
      if (!isToManyRelationshipField(listConfig.fields[key])) continue
      const marker = readCountMarker(member[key])
      if (marker) return { field: key, marker }
    }
    return null
  }

  if (!members.some((member) => findMarker(member) !== null)) {
    return where
  }

  const resolvedMembers: Array<Record<string, unknown>> = []
  for (const member of members) {
    const found = findMarker(member)
    if (!found) {
      resolvedMembers.push(member)
      continue
    }
    const resolved = await resolveOneCountFilter(
      listConfig,
      listKey,
      found.field,
      found.marker,
      args,
      config,
    )
    // Preserve any sibling conditions rather than replacing the member
    // wholesale — see `mergeResolvedMember` above for why.
    const siblings: Record<string, unknown> = { ...member }
    delete siblings[found.field]
    resolvedMembers.push(mergeResolvedMember(siblings, resolved))
  }

  // Drop no-op members (a fully-denied related list where 0 satisfies the
  // comparison resolves to `{}` — matches everything, so it need not be ANDed).
  const effective = resolvedMembers.filter((member) => Object.keys(member).length > 0)
  if (effective.length === 0) return undefined
  return effective.length === 1 ? effective[0] : { AND: effective }
}
