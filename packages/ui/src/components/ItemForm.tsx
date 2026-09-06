import * as React from 'react'
import Link from 'next/link.js'
import { ItemFormClient } from './ItemFormClient.js'
import { RelationshipTable } from './RelationshipTable.js'
import { formatListName } from '../lib/utils.js'
import { PageHeader } from './PageHeader.js'
import { Card } from '../primitives/card.js'
import type { ServerActionInput } from '../server/types.js'
import {
  type AccessContext,
  type FieldConfig,
  type ListConfig,
  buildRelationshipCountSelect,
  getUrlKey,
  OpenSaasConfig,
} from '@opensaas/stack-core'
import { buildRelationshipInclude, prepareItemForm } from '../lib/prepareItemForm.js'
import { deriveItemViewLayout, type ItemViewLayout } from '../lib/deriveItemView.js'

export interface ItemFormProps {
  context: AccessContext
  config: OpenSaasConfig
  listKey: string
  mode: 'create' | 'edit'
  itemId?: string
  basePath?: string
  // See AdminUIProps.serverAction for why this is Promise<unknown>.
  serverAction: (input: ServerActionInput) => Promise<unknown>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig is generic over TypeInfo
type AnyListConfig = ListConfig<any>

/** A single relation entry in the item-view include (bounded to-many, or bare). */
type ItemViewIncludeEntry = boolean | { take?: number; include?: Record<string, boolean> }

/**
 * Build the `include` object for an item-view fetch that derives Relationship
 * tables. To-one / details relationships are included one level deep; each
 * to-many Relationship table is included with a nested include of its own
 * relationship columns (so their Cells can resolve labels) AND a `take` that
 * BOUNDS the related-row fetch (issue #752) to the section's cap — all through
 * the secured context, so only access-visible rows and fields come back. The
 * bound is per-relationship (`ui.itemView.take`, default `DEFAULT_ITEM_VIEW_TAKE`);
 * the full access-scoped total for the footer is fetched separately via `_count`
 * (see {@link ItemViewLayoutView}), never by fetching every row.
 */
export function buildItemViewInclude(
  listConfig: AnyListConfig,
  config: OpenSaasConfig,
  layout: ItemViewLayout,
): Record<string, ItemViewIncludeEntry> {
  const include: Record<string, ItemViewIncludeEntry> = {}

  for (const fieldName of layout.detailsFields) {
    if (listConfig.fields[fieldName]?.type === 'relationship') {
      include[fieldName] = true
    }
  }

  for (const section of layout.sections) {
    const relatedListConfig = config.lists[section.relatedListKey]
    const relationshipColumns = section.columns.filter(
      (column) => relatedListConfig?.fields[column]?.type === 'relationship',
    )
    // Always carry the row bound; add a nested include only when the table has
    // relationship columns whose Cells need the related record to label.
    const entry: { take: number; include?: Record<string, boolean> } = { take: section.take }
    if (relationshipColumns.length > 0) {
      entry.include = Object.fromEntries(relationshipColumns.map((column) => [column, true]))
    }
    include[section.fieldName] = entry
  }

  return include
}

/** The related rows for a section, or `[]` when absent/denied. */
function sectionRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []
}

/**
 * Read the access-scoped total (M) for a Relationship-table section off the
 * parent record's filtered `_count` payload (issue #752). The `_count` is built
 * by {@link buildRelationshipCountSelect}, which folds each related list's own
 * `query` access into the count's `where` and OMITS a fully-denied related list
 * entirely — so a denied list has no key here and reads as `fallback` (the
 * bounded rows length, which is itself 0 for a denied list), never leaking a
 * true total. When the value is present it is the authoritative access-scoped
 * total (always ≥ the bounded row count).
 */
export function readAccessScopedTotal(
  countPayload: unknown,
  fieldName: string,
  fallback: number,
): number {
  if (countPayload && typeof countPayload === 'object') {
    const value = (countPayload as Record<string, unknown>)[fieldName]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return fallback
}

/**
 * Strip a fetched item-view record down to the details-card fields (issue
 * #797): every Relationship-table section's field (rendered separately as a
 * read-only table) AND the synthetic `_count` payload the fetch adds
 * alongside the real fields (for {@link readAccessScopedTotal}'s "showing N of
 * M" footer). Neither belongs in the details form's data — `_count` in
 * particular is not a field of the list, so if it survived into the submit
 * payload the server would reject the whole update.
 */
export function buildDetailsItemData(
  itemData: Record<string, unknown>,
  layout: ItemViewLayout,
): Record<string, unknown> {
  const detailsItemData: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(itemData)) {
    if (key !== '_count' && !layout.sections.some((section) => section.fieldName === key)) {
      detailsItemData[key] = value
    }
  }
  return detailsItemData
}

/**
 * Edit-mode item view whose layout is DERIVED from the list shape (issue #734):
 * scalar/to-one fields (and picker-demoted relationships) in a details card
 * with the existing whole-form Save/Cancel, and each to-many relationship as a
 * read-only Relationship table.
 */
async function ItemViewLayoutView({
  context,
  config,
  listConfig,
  listKey,
  itemId,
  basePath,
  serverAction,
  layout,
}: {
  context: AccessContext
  config: OpenSaasConfig
  listConfig: AnyListConfig
  listKey: string
  itemId: string
  basePath: string
  serverAction: (input: ServerActionInput) => Promise<unknown>
  layout: ItemViewLayout
}) {
  const urlKey = getUrlKey(listKey)

  // One secured read: {@link buildItemViewInclude} bounds each table's nested
  // include, and the filtered `_count` below is fetched in the SAME call so
  // {@link readAccessScopedTotal} never leaks a denied list's true total
  // (mirrors the list view's #732 count columns).
  const include: Record<string, unknown> = { ...buildItemViewInclude(listConfig, config, layout) }
  const countSelect = await buildRelationshipCountSelect(
    listConfig,
    { session: context.session, context },
    config,
  )
  if (countSelect) {
    include._count = { select: countSelect }
  }
  let itemData: Record<string, unknown> | null = null
  try {
    const delegate = context.db[listKey]
    if (delegate?.findUnique) {
      itemData = await delegate.findUnique({ where: { id: itemId }, include })
    }
  } catch (error) {
    console.error(`Failed to fetch item ${itemId}:`, error)
  }

  if (!itemData) {
    return (
      <div className="p-8">
        <div className="bg-destructive/10 border border-destructive text-destructive rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-2">Item not found</h2>
          <p>
            The item you&apos;re trying to edit doesn&apos;t exist or you don&apos;t have access to
            it.
          </p>
          <Link
            href={`${basePath}/${urlKey}`}
            className="inline-block mt-4 text-primary hover:underline"
          >
            ← Back to {formatListName(listKey)}
          </Link>
        </div>
      </div>
    )
  }

  // The details card owns only the scalar/to-one/picker fields. Restricting the
  // form's fields (and data) to that subset keeps the whole-form Save/Cancel
  // behaviour identical to the pre-#734 edit page: one update, one hook pass —
  // the read-only Relationship tables are never part of the form payload.
  const detailsFieldEntries = layout.detailsFields
    .map((fieldName): [string, FieldConfig] | null => {
      const field = listConfig.fields[fieldName]
      return field ? [fieldName, field] : null
    })
    .filter((entry): entry is [string, FieldConfig] => entry !== null)
  const detailsListConfig: AnyListConfig = {
    ...listConfig,
    fields: Object.fromEntries(detailsFieldEntries),
  }
  const detailsItemData = buildDetailsItemData(itemData, layout)

  const { serializableFields, initialData, relationshipData } = await prepareItemForm(
    context,
    config,
    detailsListConfig,
    detailsItemData,
  )

  const detailsCard = (
    <Card data-slot="item-view-details" className="p-6">
      <ItemFormClient
        listKey={listKey}
        urlKey={urlKey}
        mode="edit"
        fields={serializableFields}
        initialData={initialData}
        itemId={itemId}
        basePath={basePath}
        serverAction={serverAction}
        relationshipData={relationshipData}
      />
    </Card>
  )

  const countPayload = itemData?._count
  const tables = layout.sections.map((section) => {
    const rows = sectionRows(itemData?.[section.fieldName])
    return (
      <RelationshipTable
        key={section.fieldName}
        config={config}
        section={section}
        rows={rows}
        // M for "showing N of M" — see {@link readAccessScopedTotal}.
        total={readAccessScopedTotal(countPayload, section.fieldName, rows.length)}
        basePath={basePath}
        context={context}
        parentListKey={listKey}
        parentId={itemId}
        serverAction={serverAction}
      />
    )
  })

  return (
    <div className="p-8">
      <PageHeader
        backHref={`${basePath}/${urlKey}`}
        backLabel={`Back to ${formatListName(listKey)}`}
        title={`Edit ${formatListName(listKey)}`}
      />

      {layout.arrangement === 'split' ? (
        // One Relationship table → two-column split (details card beside it).
        <div
          data-slot="item-view-layout"
          className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2"
        >
          {detailsCard}
          {tables}
        </div>
      ) : (
        // Several Relationship tables → details card on top, tables stacked.
        <div data-slot="item-view-layout" className="space-y-6">
          {detailsCard}
          {tables}
        </div>
      )}
    </div>
  )
}

export async function ItemForm({
  context,
  config,
  listKey,
  mode,
  itemId,
  basePath = '/admin',
  serverAction,
}: ItemFormProps) {
  const listConfig = config.lists[listKey]
  const urlKey = getUrlKey(listKey)

  if (!listConfig) {
    return (
      <div className="p-8">
        <div className="bg-destructive/10 border border-destructive text-destructive rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-2">List not found</h2>
          <p>The list &quot;{listKey}&quot; does not exist in your configuration.</p>
        </div>
      </div>
    )
  }

  // Edit mode: derive the item-view layout from the list shape. When the list
  // has one or more to-many relationships rendered as Relationship tables, use
  // the derived layout; otherwise (no tables, or create) fall through to the
  // single details-card path below — byte-identical to the pre-#734 form.
  if (mode === 'edit' && itemId) {
    const layout = deriveItemViewLayout(config, listKey)
    if (layout.sections.length > 0) {
      return (
        <ItemViewLayoutView
          context={context}
          config={config}
          listConfig={listConfig}
          listKey={listKey}
          itemId={itemId}
          basePath={basePath}
          serverAction={serverAction}
          layout={layout}
        />
      )
    }
  }

  let itemData: Record<string, unknown> | null = {}
  if (mode === 'edit' && itemId) {
    try {
      const includeRelationships = buildRelationshipInclude(listConfig)
      const delegate = context.db[listKey]
      if (delegate?.findUnique) {
        itemData = await delegate.findUnique({
          where: { id: itemId },
          ...(Object.keys(includeRelationships).length > 0 && { include: includeRelationships }),
        })
      }
    } catch (error) {
      console.error(`Failed to fetch item ${itemId}:`, error)
    }

    if (!itemData) {
      return (
        <div className="p-8">
          <div className="bg-destructive/10 border border-destructive text-destructive rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-2">Item not found</h2>
            <p>
              The item you&apos;re trying to edit doesn&apos;t exist or you don&apos;t have access
              to it.
            </p>
            <Link
              href={`${basePath}/${urlKey}`}
              className="inline-block mt-4 text-primary hover:underline"
            >
              ← Back to {formatListName(listKey)}
            </Link>
          </div>
        </div>
      )
    }
  }

  // Also used by SingletonView so both editors serialize identically.
  const { serializableFields, initialData, relationshipData } = await prepareItemForm(
    context,
    config,
    listConfig,
    itemData,
  )

  return (
    <div className="p-8 max-w-4xl">
      <PageHeader
        backHref={`${basePath}/${urlKey}`}
        backLabel={`Back to ${formatListName(listKey)}`}
        title={`${mode === 'create' ? 'Create' : 'Edit'} ${formatListName(listKey)}`}
      />

      <div className="bg-card border border-border rounded-lg p-6">
        <ItemFormClient
          listKey={listKey}
          urlKey={urlKey}
          mode={mode}
          fields={serializableFields}
          initialData={initialData}
          itemId={itemId}
          basePath={basePath}
          serverAction={serverAction}
          relationshipData={relationshipData}
        />
      </div>
    </div>
  )
}
