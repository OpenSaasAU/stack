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
  getDbKey,
  getUrlKey,
  OpenSaasConfig,
} from '@opensaas/stack-core'
import { buildRelationshipInclude, prepareItemForm } from '../lib/prepareItemForm.js'
import { deriveItemViewLayout, type ItemViewLayout } from '../lib/deriveItemView.js'

export interface ItemFormProps {
  context: AccessContext<unknown>
  config: OpenSaasConfig
  listKey: string
  mode: 'create' | 'edit'
  itemId?: string
  basePath?: string
  // Server action can return any shape depending on the list item type
  serverAction: (input: ServerActionInput) => Promise<unknown>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig is generic over TypeInfo
type AnyListConfig = ListConfig<any>

/**
 * Build the `include` object for an item-view fetch that derives Relationship
 * tables. To-one / details relationships are included one level deep; each
 * to-many Relationship table is included with a nested include of its own
 * relationship columns, so their Cells can resolve labels — all through the
 * secured context, so only access-visible rows and fields come back.
 */
function buildItemViewInclude(
  listConfig: AnyListConfig,
  config: OpenSaasConfig,
  layout: ItemViewLayout,
): Record<string, boolean | { include: Record<string, boolean> }> {
  const include: Record<string, boolean | { include: Record<string, boolean> }> = {}

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
    include[section.fieldName] =
      relationshipColumns.length > 0
        ? { include: Object.fromEntries(relationshipColumns.map((column) => [column, true])) }
        : true
  }

  return include
}

/** The related rows for a section, or `[]` when absent/denied. */
function sectionRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []
}

/**
 * Edit-mode item view whose layout is DERIVED from the list shape (issue #734):
 * scalar/to-one fields (and picker-demoted relationships) in a details card
 * with the existing whole-form Save/Cancel, and each to-many relationship as a
 * read-only Relationship table. The arrangement follows from the number of
 * tables — one → two-column split, several → stacked.
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
  context: AccessContext<unknown>
  config: OpenSaasConfig
  listConfig: AnyListConfig
  listKey: string
  itemId: string
  basePath: string
  serverAction: (input: ServerActionInput) => Promise<unknown>
  layout: ItemViewLayout
}) {
  const urlKey = getUrlKey(listKey)

  // One secured read: details relationships one level deep, each Relationship
  // table nested-included so its cells resolve. Access control on the include
  // means only access-visible rows/fields are returned.
  const include = buildItemViewInclude(listConfig, config, layout)
  let itemData: Record<string, unknown> | null = null
  try {
    const delegate = context.db[getDbKey(listKey)]
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
  const detailsItemData: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(itemData)) {
    if (!layout.sections.some((section) => section.fieldName === key)) {
      detailsItemData[key] = value
    }
  }

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

  const tables = layout.sections.map((section) => (
    <RelationshipTable
      key={section.fieldName}
      config={config}
      section={section}
      rows={sectionRows(itemData?.[section.fieldName])}
      basePath={basePath}
    />
  ))

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

/**
 * Item form component - create or edit an item
 * Server Component that fetches data and sets up actions
 */
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

  // Fetch item data if in edit mode
  let itemData: Record<string, unknown> = {}
  if (mode === 'edit' && itemId) {
    try {
      // Fetch item with relationships included
      const includeRelationships = buildRelationshipInclude(listConfig)
      const delegate = context.db[getDbKey(listKey)]
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

  // Fetch relationship options, serialize field configs, and transform the
  // record into client-ready form data (shared with the singleton editor).
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

      {/* Form */}
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
