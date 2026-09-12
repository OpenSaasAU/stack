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
  type AnyStackContext,
  type FieldConfig,
  type ListConfig,
  type SecuredQuery,
  engineContextOf,
  getUrlKey,
  OpenSaasConfig,
} from '@opensaas/stack-core'
import { buildRelationshipInclude, prepareItemForm } from '../lib/prepareItemForm.js'
import { deriveItemViewLayout, type ItemViewLayout } from '../lib/deriveItemView.js'

export interface ItemFormProps {
  context: AnyStackContext
  config: OpenSaasConfig
  listKey: string
  mode: 'create' | 'edit'
  /** The record's id at its list's own key type (ADR-0048) — a number on an integer-keyed list. */
  itemId?: string | number
  basePath?: string
  // See AdminUIProps.serverAction for why this is Promise<unknown>.
  serverAction: (input: ServerActionInput) => Promise<unknown>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig is generic over TypeInfo
type AnyListConfig = ListConfig<any>

/**
 * Compose the item-view read that derives Relationship tables.
 *
 * To-one / details relationships are reached one hop. Each to-many
 * Relationship table is reached as a `combine` of two independently scoped
 * branches: the bounded page of rows the table renders (`ui.itemView.take`,
 * default `DEFAULT_ITEM_VIEW_TAKE`, issue #752) and the access-scoped total its
 * footer shows. The engine ANDs the related list's own `query` access into
 * both, so the total can never count a row the rows branch may not show, and
 * neither is a rule this component re-derives.
 *
 * **Known limit.** A relationship column ON a table's rows is not reached:
 * this composition does not nest a further `.include()` for a Relationship
 * table section's own relationship columns, so those Cells render from the
 * row without the related record. The engine itself no longer blocks the
 * nesting (issue #1236 removed the alias collision that used to refuse it);
 * wiring it here is a follow-up, not a core limitation.
 */
export function composeItemViewRead(
  read: SecuredQuery,
  listConfig: AnyListConfig,
  layout: ItemViewLayout,
): SecuredQuery {
  const withDetails = layout.detailsFields.reduce(
    (query, fieldName) =>
      listConfig.fields[fieldName]?.type === 'relationship' ? query.include(fieldName) : query,
    read,
  )

  return layout.sections.reduce(
    (query, section) =>
      query.include(section.fieldName, (rows) =>
        rows.combine({
          [SECTION_ROWS]: rows.limit(section.take),
          [SECTION_TOTAL]: rows.count(),
        }),
      ),
    withDetails,
  )
}

/** The keys {@link composeItemViewRead}'s `combine` puts the two branches under. */
const SECTION_ROWS = 'items'
const SECTION_TOTAL = 'total'

function combinedSection(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** The bounded related rows for a section, or `[]` when absent/denied. */
export function sectionRows(value: unknown): Array<Record<string, unknown>> {
  const rows = combinedSection(value)?.[SECTION_ROWS]
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : []
}

/**
 * The access-scoped total (M) for a Relationship-table section's "showing N of
 * M" footer, off the count branch {@link composeItemViewRead} composed.
 *
 * A relation this session may not read counts 0 rather than its true size, so
 * the total the footer shows is always one the session was allowed to learn.
 * The fallback covers only a value that carries no numeric total at all — a
 * shape the count branch did not produce.
 */
export function readAccessScopedTotal(value: unknown, fallback: number): number {
  const total = combinedSection(value)?.[SECTION_TOTAL]
  return typeof total === 'number' && Number.isFinite(total) ? total : fallback
}

/**
 * Strip a fetched item-view record down to the details-card fields (issue
 * #797): every Relationship-table section's field is rendered separately as a
 * read-only table, and its value carries the synthetic branch keys the footer
 * reads. Neither is a field of the list, so a value that survived into the
 * submit payload would make the server reject the whole update.
 */
export function buildDetailsItemData(
  itemData: Record<string, unknown>,
  layout: ItemViewLayout,
): Record<string, unknown> {
  const detailsItemData: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(itemData)) {
    if (!layout.sections.some((section) => section.fieldName === key)) {
      detailsItemData[key] = value
    }
  }
  return detailsItemData
}

/**
 * The row a details field's own CREATE/UPDATE access rule sees (#1402),
 * distinct from {@link buildDetailsItemData}'s render-only slice: a rule may
 * read a Relationship-table section field off `item`, and `detailsItemData`
 * has that key stripped out entirely rather than merely absent-but-`undefined`
 * — a rule that already guards against a missing value (`item.comments?.length`)
 * would silently compute over nothing instead of the real relation.
 *
 * Reshapes each section field back to the bounded rows array a plain
 * (non-derived-layout) read would have included, via {@link sectionRows},
 * rather than the `{ items, total }` combine shape `composeItemViewRead`
 * fetched it as — neither of which is a field of the list, so this is never
 * the object rendered or submitted.
 */
export function buildAccessItemData(
  itemData: Record<string, unknown>,
  layout: ItemViewLayout,
): Record<string, unknown> {
  const accessItemData = { ...itemData }
  for (const section of layout.sections) {
    accessItemData[section.fieldName] = sectionRows(itemData[section.fieldName])
  }
  return accessItemData
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
  itemId: string | number
  basePath: string
  serverAction: (input: ServerActionInput) => Promise<unknown>
  layout: ItemViewLayout
}) {
  const urlKey = getUrlKey(listKey)

  // One secured read: the bounded rows each table renders and the total its
  // footer shows come back from the SAME call, both scoped by the related
  // list's own `query` access (mirrors the list view's #732 count columns).
  let itemData: Record<string, unknown> | null = null
  try {
    itemData = await composeItemViewRead(
      context.db[listKey].where({ id: itemId }),
      listConfig,
      layout,
    ).first()
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
    listKey,
    detailsListConfig,
    detailsItemData,
    'update',
    buildAccessItemData(itemData, layout),
  )

  const detailsCard = (
    <Card data-slot="item-view-details" className="p-6">
      <ItemFormClient
        listKey={listKey}
        urlKey={urlKey}
        mode="edit"
        fields={serializableFields}
        initialData={initialData}
        itemId={String(itemId)}
        basePath={basePath}
        serverAction={serverAction}
        relationshipData={relationshipData}
      />
    </Card>
  )

  const tables = layout.sections.map((section) => {
    const sectionValue = itemData?.[section.fieldName]
    const rows = sectionRows(sectionValue)
    return (
      <RelationshipTable
        key={section.fieldName}
        config={config}
        section={section}
        rows={rows}
        // M for "showing N of M" — see {@link readAccessScopedTotal}.
        total={readAccessScopedTotal(sectionValue, rows.length)}
        basePath={basePath}
        context={context}
        parentListKey={listKey}
        parentId={String(itemId)}
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
  context: appContext,
  config,
  listKey,
  mode,
  itemId,
  basePath = '/admin',
  serverAction,
}: ItemFormProps) {
  const context = engineContextOf(appContext)
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
      itemData = await buildRelationshipInclude(listConfig)
        .reduce(
          (read, fieldName) => read.include(fieldName),
          context.db[listKey].where({ id: itemId }),
        )
        .first()
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
    listKey,
    listConfig,
    itemData,
    mode === 'create' ? 'create' : 'update',
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
          itemId={itemId === undefined ? undefined : String(itemId)}
          basePath={basePath}
          serverAction={serverAction}
          relationshipData={relationshipData}
        />
      </div>
    </div>
  )
}
