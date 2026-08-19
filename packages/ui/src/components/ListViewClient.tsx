'use client'

import * as React from 'react'
import Link from 'next/link.js'
import { Inbox, Plus, SearchX } from 'lucide-react'
import { useRouter } from 'next/navigation.js'
import { cn, formatFieldName, isCountAlignedColumn, isSortableColumn } from '../lib/utils.js'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../primitives/table.js'
import { Button } from '../primitives/button.js'
import { Checkbox } from '../primitives/checkbox.js'
import { EmptyState } from './EmptyState.js'
import { CellRenderer } from './cells/CellRenderer.js'
import { FilterBuilder } from './FilterBuilder.js'
import { AvatarLabelCell } from './cells/AvatarLabelCell.js'
import { RowSelectionBar } from './RowSelectionBar.js'
import { BulkActions, type SerializedBulkAction } from './BulkActions.js'
import { useRowSelection, getPageCheckboxState } from '../lib/useRowSelection.js'
import { useBulkStatus } from '../lib/useBulkStatus.js'
import type { SerializableFieldConfig } from '../lib/serializeFieldConfig.js'
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
 * Read the outcome message a custom Bulk action server action returns (issue
 * #736). A successful run yields `{ bulkAction: true, message? }`; a failure
 * yields `{ bulkAction: false, error }`. Either way we surface a single status
 * line — the handler's own `message`, its `error`, or a generic completion note
 * — without leaking which selected rows the secured handler was denied.
 */
function parseBulkActionResult(result: unknown, label: string): string {
  if (typeof result === 'object' && result !== null && 'bulkAction' in result) {
    const value = result as { bulkAction: unknown; message?: unknown; error?: unknown }
    if (value.bulkAction === true) {
      return typeof value.message === 'string' && value.message.length > 0
        ? value.message
        : `${label} complete`
    }
    if (typeof value.error === 'string' && value.error.length > 0) return value.error
  }
  return `${label} complete`
}

export interface ListViewClientProps {
  items: Array<Record<string, unknown>>
  fieldTypes: Record<string, string>
  /**
   * Serialised per-field config, keyed by field name. Drives Cell resolution
   * (per-field override, select option variants, relationship ref). Optional so
   * callers that only have `fieldTypes` still render via the field-type
   * registry; a minimal config is synthesised from `fieldTypes` when absent.
   */
  fields?: Record<string, SerializableFieldConfig>
  relationshipRefs: Record<string, string>
  columns?: string[]
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
  /**
   * The label column to render with an initials-avatar Cell (issue #735). Set by
   * `ListView` to the list's resolved label field when the list opts in via
   * `ui.avatar`; omitted otherwise (text-only label, the default). A per-field
   * cell override on that field still wins.
   */
  avatarColumn?: string
  /**
   * Serialisable metadata for the list's custom Bulk actions (issue #736), in
   * declaration order. Carries only `key`/`label`/`variant`/`destructive` — the
   * server-side handlers never cross the boundary. `ListView` filters this to
   * the actions the session may see (each action's `hasAccess`) before passing
   * it here. When non-empty, row selection is enabled even if delete is denied.
   */
  bulkActions?: SerializedBulkAction[]
}

export function ListViewClient({
  items,
  fieldTypes,
  fields,
  relationshipRefs,
  columns,
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
  avatarColumn,
  bulkActions = [],
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

  const displayColumns =
    columns ||
    Object.keys(fieldTypes).filter((key) => !['password', 'createdAt', 'updatedAt'].includes(key))

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

    // Reset to page 1 of the current filter: a bulk delete can remove the rows
    // that made the current page exist (deleting across pages leaves the current
    // page out of range). `router.refresh()` first invalidates the client Router
    // Cache (so a previously-visited page 1 is not served stale), then the push
    // lands on page 1 and fetches the now-shorter list fresh.
    router.refresh()
    router.push(buildPaginationUrl(1))
  }

  // Runs a custom Bulk action (issue #736); mirrors `handleBulkDelete`'s
  // round-trip/page-reset flow. Per-id denials are absorbed server-side and
  // never leaked here.
  const handleBulkAction = async (key: string) => {
    if (!serverAction) return
    const ids = [...selection.selectedIds]
    const label = bulkActions.find((a) => a.key === key)?.label ?? 'Action'

    const result = await serverAction({ listKey, action: 'bulkAction', key, ids })
    setBulkStatus(parseBulkActionResult(result, label))
    selection.clear()

    router.refresh()
    router.push(buildPaginationUrl(1))
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
      value: item[column],
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
                const sortable = isSortableColumn(field)
                return (
                  <TableHead
                    key={column}
                    className={cn(
                      'transition-colors',
                      sortable && 'cursor-pointer hover:bg-muted/70',
                    )}
                    onClick={sortable ? () => handleSort(column) : undefined}
                    aria-sort={
                      sortable && sortBy === column
                        ? sortOrder === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : undefined
                    }
                  >
                    <div
                      className={cn(
                        'flex items-center space-x-1',
                        numeric && 'justify-end text-right',
                      )}
                    >
                      <span>{formatFieldName(column)}</span>
                      {sortable && sortBy === column && (
                        <span className="text-primary">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                )
              })}
              <TableHead className="text-right">Actions</TableHead>
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
                      className="border-0"
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
                      className="border-0"
                      icon={<Inbox className="h-6 w-6" />}
                      title="No items yet"
                      description="Create your first record to see it listed here."
                      actions={
                        <Button asChild size="sm">
                          <Link href={`${basePath}/${urlKey}/create`}>
                            <Plus aria-hidden="true" />
                            Create
                          </Link>
                        </Button>
                      }
                    />
                  )}
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => {
                const rowId = String(item.id)
                return (
                  <TableRow
                    key={rowId}
                    data-state={selection.isSelected(rowId) ? 'selected' : undefined}
                  >
                    {selectionEnabled && (
                      <TableCell data-slot="selection-cell" className="w-10">
                        <Checkbox
                          aria-label={`Select row ${rowId}`}
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
                        {renderCell(column, item)}
                      </TableCell>
                    ))}
                    <TableCell className="text-right">
                      <Link
                        href={`${basePath}/${urlKey}/${item.id}`}
                        className="text-primary hover:underline"
                      >
                        Edit
                      </Link>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
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
