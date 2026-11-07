'use client'

import * as React from 'react'
import Link from 'next/link.js'
import { Inbox, Plus, SearchX } from 'lucide-react'
import { useRouter } from 'next/navigation.js'
import { cn, formatFieldName, isCountAlignedColumn } from '../lib/utils.js'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSortButton,
} from '../primitives/table.js'
import { Button } from '../primitives/button.js'
import { Checkbox } from '../primitives/checkbox.js'
import { EmptyState } from './EmptyState.js'
import { CellRenderer, rendersBuiltInCell } from './cells/CellRenderer.js'
import type { CellValue } from './cells/registry.js'
import { FilterBuilder } from './FilterBuilder.js'
import { AvatarLabelCell } from './cells/AvatarLabelCell.js'
import { RowSelectionBar } from './RowSelectionBar.js'
import { BulkActions, type SerializedBulkAction } from './BulkActions.js'
import { RowActions, type SerializedRowAction } from './RowActions.js'
import { useRowSelection, getPageCheckboxState } from '../lib/useRowSelection.js'
import { useBulkStatus } from '../lib/useBulkStatus.js'
import type { SerializableFieldConfig } from '../lib/serializeFieldConfig.js'
import { isDefaultColumnField } from '../lib/defaultColumns.js'
import { STICKY_ACTIONS_CELL, VISIBLE_TABLE_MESSAGE } from '../lib/tableClasses.js'
import type { ServerActionInput } from '../server/types.js'
import type { FilterFieldSuggestion } from '@opensaas/stack-core'

/**
 * Read the `{ deleted, total }` count a bulk-delete server action returns. The
 * deletion runs row-by-row through the secured context server-side, so denied
 * rows (Silent failure) are already absent from `deleted`; `total` falls back to
 * the number attempted if the result shape is unexpected.
 */
function parseBulkDeleteResult(
  result: unknown,
  attempted: number,
): { deleted: number; total: number } {
  if (typeof result === 'object' && result !== null && 'deleted' in result && 'total' in result) {
    const { deleted, total } = result as { deleted: unknown; total: unknown }
    if (typeof deleted === 'number' && typeof total === 'number') return { deleted, total }
  }
  return { deleted: 0, total: attempted }
}

/**
 * Read the status line for a custom Bulk or Row action from its server action
 * result, discriminated by `key`: `{ [key]: true, message? }` on success,
 * `{ [key]: false, error }` on failure. A handler's own `message`, else
 * `${label} complete`; an `error`, prefixed with `errorPrefix`; else
 * `fallback` for a shape this does not recognise.
 */
function parseActionResult(
  result: unknown,
  key: 'bulkAction' | 'rowAction',
  label: string,
  { fallback, errorPrefix = '' }: { fallback: string; errorPrefix?: string },
): string {
  if (typeof result !== 'object' || result === null || !(key in result)) return fallback
  const ran =
    key === 'bulkAction'
      ? 'bulkAction' in result && result.bulkAction
      : 'rowAction' in result && result.rowAction
  if (ran === true) {
    return 'message' in result && typeof result.message === 'string' && result.message.length > 0
      ? result.message
      : `${label} complete`
  }
  if ('error' in result && typeof result.error === 'string' && result.error.length > 0) {
    return `${errorPrefix}${result.error}`
  }
  return fallback
}

export interface ListViewClientProps {
  items: Array<Record<string, unknown>>
  fieldTypes: Record<string, string>
  /**
   * Serialised per-field config, keyed by field name. Drives Cell resolution
   * (per-field override, select option variants, relationship ref) and, absent
   * an explicit `columns` list, default-column curation (issue #1018, see
   * `isDefaultColumnField`). Optional, and may cover only a subset of
   * `fieldTypes`' keys — `columnField` below synthesises a fallback per-column
   * for cell rendering, and a column missing an entry here has no
   * `ui.listView.defaultColumn` declaration to curate by, so it defaults to
   * shown, the same as when `fields` is omitted entirely.
   */
  fields?: Record<string, SerializableFieldConfig>
  relationshipRefs: Record<string, string>
  columns?: string[]
  /**
   * Which columns offer a sort affordance, keyed by column name. `ListView`
   * resolves this on the server by asking whether this session's read can order
   * by each column; a column absent here is not sortable.
   */
  sortableFields?: Record<string, boolean>
  /**
   * Default sort for the table (from the list's `ui.listView.initialSort`).
   * Seeds the initial sort column/direction. When omitted, the table starts
   * unsorted (current default behaviour).
   */
  initialSort?: { field: string; direction: 'asc' | 'desc' }
  listKey: string
  urlKey: string
  basePath: string
  page: number
  pageSize: number
  total: number
  search?: string
  /**
   * Serializable per-field filter metadata (from the core engine's
   * `collectFilterSuggestions`) that drives the Filter builder's field /
   * operator / value pickers. When empty, the builder shows only free-text search.
   */
  filterSuggestions?: FilterFieldSuggestion[]
  /**
   * The generic server action (rebuilds the session context server-side). Used
   * by the built-in Bulk action Delete to remove each selected row through the
   * secured context. When omitted, no bulk delete is offered.
   */
  serverAction?: (input: ServerActionInput) => Promise<unknown>
  /**
   * Whether the list's delete access is NOT statically false — evaluated up
   * front on the server (see `ListView`). Gates both the selection affordance
   * and the built-in Delete: when `false`, no session can ever delete, so
   * neither is shown. When `true`, Delete is offered and per-row denials are
   * absorbed by Silent failure into the "N of M deleted" report.
   */
  canDelete?: boolean
  /** Whether the Create affordance is offered; resolved server-side from `ui.hideCreate`. Defaults to `true`. */
  canCreate?: boolean
  /**
   * The label column to render with an initials-avatar Cell (issue #735). Set by
   * `ListView` to the list's resolved label field when the list opts in via
   * `ui.avatar`; omitted otherwise (text-only label, the default). A per-field
   * cell override on that field still wins.
   */
  avatarColumn?: string
  /** The column holding each row's Item label, which names the row's checkbox. */
  labelColumn?: string
  /**
   * Serialisable metadata for the list's custom Bulk actions (issue #736), in
   * declaration order. Carries only `key`/`label`/`variant`/`destructive` — the
   * server-side handlers never cross the boundary. `ListView` filters this to
   * the actions the session may see (each action's `hasAccess`) before passing
   * it here. When non-empty, row selection is enabled even if delete is denied.
   */
  bulkActions?: SerializedBulkAction[]
  /**
   * Serialisable metadata for the Row actions this session may see, in
   * declaration order. Handlers never cross the boundary.
   */
  rowActions?: SerializedRowAction[]
  /**
   * The keys of the Row actions each row offers, keyed by row id, resolved on
   * the server from each action's `isAvailable`. A row absent here offers only
   * the built-in actions.
   */
  rowActionKeys?: Record<string, string[]>
}

export function ListViewClient({
  items,
  fieldTypes,
  fields,
  relationshipRefs,
  columns,
  sortableFields = {},
  initialSort,
  listKey,
  urlKey,
  basePath,
  page,
  pageSize,
  total,
  search: initialSearch,
  filterSuggestions = [],
  serverAction,
  canDelete = false,
  canCreate = true,
  avatarColumn,
  labelColumn,
  bulkActions = [],
  rowActions = [],
  rowActionKeys = {},
}: ListViewClientProps) {
  const router = useRouter()
  const sortBy = initialSort?.field ?? null
  const sortOrder = initialSort?.direction ?? 'asc'

  // Row selection (issue #733) is keyed on the active `search` filter query
  // (the ADR-0017 filter engine's URL param, parsed server-side in `ListView`)
  // — changing any filter token changes `filterKey` and clears the accumulated
  // id set, while page/sort changes keep it stable so selection persists while
  // paging. Reads back empty under a different filter.
  const filterKey = initialSearch ?? ''
  const selection = useRowSelection(listKey, filterKey)

  const hasCustomBulkActions = bulkActions.length > 0
  const selectionEnabled = canDelete || hasCustomBulkActions
  const canBulkDelete = canDelete && !!serverAction
  // Custom actions dispatch through the generic `serverAction`; without it
  // they are not rendered.
  const canRunBulkActions = hasCustomBulkActions && !!serverAction

  // The "N of M deleted" report must outlive the table refresh: `router.refresh()`
  // remounts this client component (the async ListView re-suspends), so the
  // report is persisted (sessionStorage) rather than held in React state that
  // the remount would discard.
  const { status: bulkStatus, setStatus: setBulkStatus, clearStatus } = useBulkStatus(listKey)

  const pageIds = items.map((item) => String(item.id))

  // Starting a fresh selection dismisses any prior report.
  const handleToggle = (id: string) => {
    clearStatus()
    selection.toggle(id)
  }
  const handleTogglePage = () => {
    clearStatus()
    selection.togglePage(pageIds)
  }

  // Absent an explicit `columns` list, curate off each field's own declared
  // `ui.listView.defaultColumn` (issue #1018) — the same declaration
  // `deriveItemView.ts`'s server-side layout helper reads, no field
  // name/type matching here. The column set itself still comes from
  // `fieldTypes` (not `Object.keys(fields)`): `fields` may cover only a
  // subset of columns (`columnField` above synthesises a fallback for any
  // column missing from it), and a column absent from `fields` has no
  // declaration to curate by, so it defaults to shown — same as when
  // `fields` is omitted entirely.
  const displayColumns =
    columns || Object.keys(fieldTypes).filter((key) => isDefaultColumnField(fields?.[key]))

  // Items are already sorted by the server via orderBy; no in-memory sort needed.

  const totalPages = Math.ceil(total / pageSize)
  const hasNextPage = page < totalPages
  const hasPrevPage = page > 1

  // Echo a non-default page size into nav URLs so an active `?pageSize=` survives
  // sorting/searching/paging. DEFAULT_PAGE_SIZE mirrors ListView's own default.
  const DEFAULT_PAGE_SIZE = 50
  const withPageSize = (params: URLSearchParams) => {
    if (pageSize !== DEFAULT_PAGE_SIZE) params.set('pageSize', String(pageSize))
    return params
  }

  const handleSort = (column: string) => {
    const newDirection = sortBy === column ? (sortOrder === 'asc' ? 'desc' : 'asc') : 'asc'
    const params = new URLSearchParams()
    if (initialSearch) {
      params.set('search', initialSearch)
    }
    params.set('sort', `${column}:${newDirection}`)
    params.set('page', '1')
    router.push(`${basePath}/${urlKey}?${withPageSize(params).toString()}`)
  }

  // Writes a Filter builder query into the `?search=` URL param, resetting to
  // page 1. An empty query drops the param (clears the filter).
  const applyQuery = (query: string) => {
    const params = new URLSearchParams()
    const trimmed = query.trim()
    if (trimmed) {
      params.set('search', trimmed)
    }
    if (sortBy) {
      params.set('sort', `${sortBy}:${sortOrder}`)
    }
    params.set('page', '1')
    const qs = withPageSize(params).toString()
    router.push(`${basePath}/${urlKey}${qs ? `?${qs}` : ''}`)
  }

  const buildPaginationUrl = (newPage: number) => {
    const params = new URLSearchParams()
    if (initialSearch) {
      params.set('search', initialSearch)
    }
    if (sortBy) {
      params.set('sort', `${sortBy}:${sortOrder}`)
    }
    params.set('page', newPage.toString())
    return `${basePath}/${urlKey}?${withPageSize(params).toString()}`
  }

  // Reset to page 1 of the current filter: a delete can remove the rows that
  // made the current page exist, leaving it out of range. `router.refresh()`
  // first invalidates the client Router Cache (so a previously-visited page 1
  // is not served stale), then the push lands on page 1 and fetches the
  // now-shorter list fresh.
  const refreshFromFirstPage = () => {
    router.refresh()
    router.push(buildPaginationUrl(1))
  }

  const handleBulkDelete = async () => {
    if (!serverAction) return
    const ids = [...selection.selectedIds]

    // One server round-trip: the deletion runs row-by-row through the secured
    // context server-side, honouring Silent failure (a denied row is not
    // counted). A single call avoids a client loop of Server Actions — each of
    // which would trigger its own route refresh/redirect — and yields the
    // "N of M" count directly without revealing which rows were denied or why.
    const result = await serverAction({ listKey, action: 'bulkDelete', ids })
    const { deleted, total } = parseBulkDeleteResult(result, ids.length)

    // Set before navigating so it isn't lost on the remount navigation triggers.
    setBulkStatus(`${deleted} of ${total} deleted`)
    selection.clear()

    refreshFromFirstPage()
  }

  // Runs a custom Bulk action (issue #736); mirrors `handleBulkDelete`'s
  // round-trip/page-reset flow. Per-id denials are absorbed server-side and
  // never leaked here.
  const handleBulkAction = async (key: string) => {
    if (!serverAction) return
    const ids = [...selection.selectedIds]
    const label = bulkActions.find((a) => a.key === key)?.label ?? 'Action'

    const result = await serverAction({ listKey, action: 'bulkAction', key, ids })
    setBulkStatus(parseActionResult(result, 'bulkAction', label, { fallback: `${label} complete` }))
    selection.clear()

    refreshFromFirstPage()
  }

  const itemHref = (id: string) => `${basePath}/${urlKey}/${id}`

  const handleCopyLink = async (id: string) => {
    const url = new URL(itemHref(id), window.location.origin).toString()
    try {
      await navigator.clipboard.writeText(url)
      setBulkStatus('Link copied')
    } catch {
      setBulkStatus(`Copy this link: ${url}`)
    }
  }

  const handleRowDelete = async (id: string, name: string) => {
    if (!serverAction) return
    let deleted = 0
    try {
      const result = await serverAction({ listKey, action: 'bulkDelete', ids: [id] })
      deleted = parseBulkDeleteResult(result, 1).deleted
    } catch {
      setBulkStatus(`“${name}” not deleted`)
      return
    }
    setBulkStatus(deleted === 1 ? `“${name}” deleted` : `“${name}” not deleted`)
    if (deleted === 1 && selection.isSelected(id)) selection.toggle(id)
    if (deleted === 1) refreshFromFirstPage()
    else router.refresh()
  }

  const handleRowAction = async (id: string, key: string) => {
    if (!serverAction) return
    const label = rowActions.find((a) => a.key === key)?.label ?? 'Action'
    const notRun = `${label}: this action was not run`
    try {
      const result = await serverAction({ listKey, action: 'rowAction', key, id })
      setBulkStatus(
        parseActionResult(result, 'rowAction', label, {
          fallback: notRun,
          errorPrefix: `${label}: `,
        }),
      )
    } catch {
      setBulkStatus(notRun)
      return
    }
    router.refresh()
  }

  const rowActionsFor = (id: string): SerializedRowAction[] => {
    const keys = rowActionKeys[id]
    return keys ? rowActions.filter((action) => keys.includes(action.key)) : []
  }

  const rowName = (item: Record<string, unknown>, index: number) => {
    const label = labelColumn && labelColumn !== 'id' ? item[labelColumn] : undefined
    const hasLabel = typeof label === 'number' || (typeof label === 'string' && label.trim() !== '')
    return hasLabel ? String(label) : `row ${(page - 1) * pageSize + index + 1}`
  }

  /** Resolves a column's field config: the explicit `fields` entry, or a synthesised fallback (see `fields` prop) plus the relationship ref. */
  const columnField = (column: string): SerializableFieldConfig => {
    if (fields?.[column]) return fields[column]
    const ref = relationshipRefs[column]
    return {
      type: fieldTypes[column],
      ...(ref ? { ref } : {}),
    }
  }

  const titleColumn =
    labelColumn && labelColumn !== 'id' && displayColumns.includes(labelColumn)
      ? labelColumn
      : displayColumns.find((column) => !relationshipRefs[column])

  /**
   * Render one body cell. The label column of an avatar-opted-in list
   * (`avatarColumn`) renders through {@link AvatarLabelCell} — unless that
   * field declares a per-field cell override (`ui.cell`), which still wins and
   * flows through the normal {@link CellRenderer} resolution chain.
   *
   * Only `ui.cell` (the explicit per-field override) suppresses the avatar; a
   * `ui.fieldType` type-registry hint does NOT. This is deliberate: `ui.avatar`
   * is a list-level opt-in specifically for the label column, so it outranks a
   * type-level registry default the same way `ui.cell` outranks `ui.fieldType`
   * in the cell chain. A project that wants a custom cell on the label column
   * instead of the avatar sets `ui.cell` on that field.
   */
  const renderCell = (column: string, item: Record<string, unknown>) => {
    const field = columnField(column)
    const cellProps = {
      value: item[column] as CellValue,
      field,
      fieldName: column,
      basePath,
    }
    if (column === avatarColumn && !field.ui?.cell) {
      return <AvatarLabelCell {...cellProps} />
    }
    return <CellRenderer {...cellProps} />
  }

  return (
    <div className="space-y-4">
      {/* Keyed on the active query so it remounts (and re-reads the URL) whenever
          the applied filter changes (issue #731). */}
      <FilterBuilder
        key={initialSearch ?? ''}
        suggestions={filterSuggestions}
        defaultValue={initialSearch ?? ''}
        onApply={applyQuery}
      />

      {/* Always mounted (outside the selection bar) so the report survives the
          selection clearing after a bulk action. */}
      {bulkStatus && (
        <div
          data-slot="selection-status"
          role="status"
          className="rounded-lg border bg-muted/50 px-4 py-2 text-sm text-foreground"
        >
          {bulkStatus}
        </div>
      )}

      {selectionEnabled && (
        <RowSelectionBar
          count={selection.selectedCount}
          onClear={selection.clear}
          onDelete={canBulkDelete ? handleBulkDelete : undefined}
          itemName={formatFieldName(listKey).toLowerCase()}
          actions={
            canRunBulkActions ? (
              <BulkActions
                actions={bulkActions}
                onRun={handleBulkAction}
                count={selection.selectedCount}
                itemName={formatFieldName(listKey).toLowerCase()}
              />
            ) : undefined
          }
        />
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {selectionEnabled && (
                <TableHead data-slot="selection-header" className="w-10">
                  <Checkbox
                    aria-label="Select all rows on this page"
                    checked={getPageCheckboxState(selection.selectedIds, pageIds)}
                    onCheckedChange={handleTogglePage}
                    disabled={pageIds.length === 0}
                  />
                </TableHead>
              )}
              {displayColumns.map((column) => {
                const field = columnField(column)
                const numeric = isCountAlignedColumn(field)
                const sortable = sortableFields[column] === true
                return (
                  <TableHead
                    key={column}
                    className={cn(sortable && 'p-0')}
                    aria-sort={
                      sortable && sortBy === column
                        ? sortOrder === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : undefined
                    }
                  >
                    {sortable ? (
                      <TableSortButton
                        numeric={numeric}
                        direction={sortBy === column ? sortOrder : undefined}
                        onClick={() => handleSort(column)}
                      >
                        {formatFieldName(column)}
                      </TableSortButton>
                    ) : (
                      <div
                        className={cn(
                          'flex items-center space-x-1',
                          numeric && 'justify-end text-right',
                        )}
                      >
                        <span>{formatFieldName(column)}</span>
                      </div>
                    )}
                  </TableHead>
                )
              })}
              <TableHead
                className={cn('text-right max-md:before:bg-background', STICKY_ACTIONS_CELL)}
              >
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell
                  data-slot="list-view-empty"
                  colSpan={displayColumns.length + 1 + (selectionEnabled ? 1 : 0)}
                  className="p-0"
                >
                  {initialSearch ? (
                    <EmptyState
                      className={cn('border-0', VISIBLE_TABLE_MESSAGE)}
                      icon={<SearchX className="h-6 w-6" />}
                      title="No matches found"
                      description={`Nothing matched “${initialSearch}”. Try a different search term.`}
                      actions={
                        <Button variant="outline" size="sm" onClick={() => applyQuery('')}>
                          Clear search
                        </Button>
                      }
                    />
                  ) : (
                    <EmptyState
                      className={cn('border-0', VISIBLE_TABLE_MESSAGE)}
                      icon={<Inbox className="h-6 w-6" />}
                      title="No items yet"
                      description={
                        canCreate
                          ? 'Create your first record to see it listed here.'
                          : 'Records will be listed here.'
                      }
                      actions={
                        canCreate ? (
                          <Button asChild size="sm">
                            <Link href={`${basePath}/${urlKey}/create`}>
                              <Plus aria-hidden="true" />
                              Create
                            </Link>
                          </Button>
                        ) : undefined
                      }
                    />
                  )}
                </TableCell>
              </TableRow>
            ) : (
              items.map((item, index) => {
                const rowId = String(item.id)
                return (
                  <TableRow
                    key={rowId}
                    data-state={selection.isSelected(rowId) ? 'selected' : undefined}
                  >
                    {selectionEnabled && (
                      <TableCell data-slot="selection-cell" className="w-10">
                        <Checkbox
                          aria-label={`Select ${rowName(item, index)}`}
                          checked={selection.isSelected(rowId)}
                          onCheckedChange={() => handleToggle(rowId)}
                        />
                      </TableCell>
                    )}
                    {displayColumns.map((column) => (
                      <TableCell
                        key={column}
                        className={cn(isCountAlignedColumn(columnField(column)) && 'text-right')}
                      >
                        {column !== titleColumn ? (
                          renderCell(column, item)
                        ) : rendersBuiltInCell(columnField(column)) ? (
                          <Link
                            href={itemHref(rowId)}
                            data-slot="row-title-link"
                            className="font-medium text-foreground hover:underline focus-visible:underline"
                          >
                            {renderCell(column, item)}
                          </Link>
                        ) : (
                          <span className="inline-flex items-center gap-2">
                            {renderCell(column, item)}
                            <Link
                              href={itemHref(rowId)}
                              data-slot="row-title-link"
                              aria-label={`Open ${rowName(item, index)}`}
                              className="text-xs font-medium text-muted-foreground hover:underline focus-visible:underline"
                            >
                              Open
                            </Link>
                          </span>
                        )}
                      </TableCell>
                    ))}
                    <TableCell
                      className={cn('text-right max-md:before:bg-background', STICKY_ACTIONS_CELL)}
                    >
                      <RowActions
                        rowLabel={rowName(item, index)}
                        href={itemHref(rowId)}
                        actions={rowActionsFor(rowId)}
                        onRun={serverAction ? (key) => handleRowAction(rowId, key) : undefined}
                        onCopyLink={() => handleCopyLink(rowId)}
                        onDelete={
                          canBulkDelete
                            ? () => handleRowDelete(rowId, rowName(item, index))
                            : undefined
                        }
                        itemName={formatFieldName(listKey).toLowerCase()}
                      />
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between max-md:flex-wrap max-md:gap-2">
          <p className="text-sm tabular-nums text-muted-foreground">
            Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total}{' '}
            results
          </p>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              onClick={() => router.push(buildPaginationUrl(page - 1))}
              disabled={!hasPrevPage}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              onClick={() => router.push(buildPaginationUrl(page + 1))}
              disabled={!hasNextPage}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
