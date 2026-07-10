import type { OpenSaasConfig } from '../config/types.js'
import { getLabelFieldName, getItemLabel } from '../config/label.js'
import { defineFragment, runQuery, type QueryRunnerContext } from './index.js'

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
 * op. Selects only `id` and the resolved label field (via
 * {@link getLabelFieldName}), so the fragment carries no relation keys and
 * `buildIncludeWithAccessControl`'s depth-5 auto-include never runs.
 *
 * Operation-level `query` access on `relatedListKey` still applies — a denied
 * list resolves to `[]` (via the underlying access-controlled `findMany`).
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
  const fragment = defineFragment<Record<string, unknown>>()({
    id: true,
    [labelField]: true,
  })

  const { search, take = DEFAULT_TAKE, selectedIds = [] } = args
  const labelFieldConfig = relatedListConfig.fields[labelField] as { type?: string } | undefined
  const where =
    search && labelFieldConfig?.type === 'text' ? { [labelField]: { contains: search } } : undefined

  const primary = await runQuery(context, relatedListKey, fragment, {
    where,
    orderBy: { [labelField]: 'asc' },
    take,
  })

  const seenIds = new Set(primary.map((item) => (item as { id: string }).id))
  const missingSelectedIds = selectedIds.filter((id) => !seenIds.has(id))

  const selected = missingSelectedIds.length
    ? await runQuery(context, relatedListKey, fragment, {
        where: { id: { in: missingSelectedIds } },
      })
    : []

  return [...primary, ...selected].map((item) => ({
    id: (item as { id: string }).id,
    label: getItemLabel(relatedListConfig, item as Record<string, unknown>),
  }))
}
