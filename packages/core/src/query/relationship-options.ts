import type { OpenSaasConfig } from '../config/types.js'
import { getLabelFieldName, getItemLabel } from '../config/label.js'
import type { OrderBy, Where } from '../secured/vocabulary.js'

/**
 * The composed-read members this primitive drives. Structural rather than the
 * generated `SecuredList`, so `getContext()`'s own delegate satisfies it and a
 * test can stand one in.
 */
export interface RelationshipOptionsQuery {
  where(predicate: Where): RelationshipOptionsQuery
  orderBy(order: OrderBy): RelationshipOptionsQuery
  select(...fields: readonly string[]): RelationshipOptionsQuery
  limit(count: number): RelationshipOptionsQuery
  all(): Promise<Record<string, unknown>[]>
}

/** Compatible with the full `AccessContext` produced by `getContext()`. */
export interface QueryRunnerContext {
  db: {
    [key: string]: RelationshipOptionsQuery
  }
}

const DEFAULT_TAKE = 50

export interface RelationshipOption {
  id: string
  label: string
}

export interface RelationshipOptionsArgs {
  /** Filters the label field via `contains` when it is a text field. */
  search?: string
  /** Bounds the primary (search-scoped) window. @default 50 */
  take?: number
  /** Always unioned into the result, even outside the search/take window. */
  selectedIds?: string[]
}

/**
 * Bounded, projected fetch of `{ id, label }` options for a relationship
 * editor — the read primitive behind the `relationshipOptions` serverAction
 * op. It selects `id` and the resolved label field (via
 * {@link getLabelFieldName}) and nothing else, so no other field's
 * `resolveOutput` runs over the window and no `needs` on this list widens the
 * read into a relation.
 *
 * Operation-level `query` access on `relatedListKey` still applies — a denied
 * list resolves to `[]` (the secured terminal's own Silent failure).
 */
export async function getRelationshipOptions(
  context: QueryRunnerContext,
  config: OpenSaasConfig,
  relatedListKey: string,
  args: RelationshipOptionsArgs = {},
): Promise<RelationshipOption[]> {
  const relatedListConfig = config.lists[relatedListKey]
  if (!relatedListConfig) return []

  const labelField = getLabelFieldName(relatedListConfig)

  const { search, take = DEFAULT_TAKE, selectedIds = [] } = args
  const labelFieldConfig = relatedListConfig.fields[labelField] as
    { type?: string; virtual?: boolean } | undefined
  const where =
    search && labelFieldConfig?.type === 'text' ? { [labelField]: { contains: search } } : undefined

  // Virtual/computed label fields (resolved at read time via `resolveOutput`)
  // have no backing database column, so passing them into `orderBy` fails
  // Prisma validation and 500s the request. Fall back to ordering by `id` —
  // always a real, orderable column — whenever the label field is virtual.
  const isVirtualLabel = labelFieldConfig?.type === 'virtual' || labelFieldConfig?.virtual === true
  const orderBy: Record<string, 'asc'> = isVirtualLabel ? { id: 'asc' } : { [labelField]: 'asc' }

  const options = (query: RelationshipOptionsQuery): RelationshipOptionsQuery =>
    query.select('id', labelField)

  const scoped = where ? context.db[relatedListKey].where(where) : context.db[relatedListKey]
  const primary = await options(scoped).orderBy(orderBy).limit(take).all()

  const seenIds = new Set(primary.map((item) => String(item.id)))
  const missingSelectedIds = selectedIds.filter((id) => !seenIds.has(id))

  const selected = missingSelectedIds.length
    ? await options(context.db[relatedListKey].where({ id: { in: missingSelectedIds } })).all()
    : []

  return [...primary, ...selected].map((item) => ({
    id: String(item.id),
    label: getItemLabel(relatedListConfig, item),
  }))
}
