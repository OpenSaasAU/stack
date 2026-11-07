'use client'

import * as React from 'react'
import Link from 'next/link.js'
import { ArrowUpDown, Columns3, Inbox, Plus, SearchX } from 'lucide-react'
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../primitives/dropdown-menu.js'
import { EmptyState } from './EmptyState.js'
import { CellRenderer } from './cells/CellRenderer.js'
import type { CellValue } from './cells/registry.js'
import { FilterBuilder } from './FilterBuilder.js'
import { AvatarLabelCell } from './cells/AvatarLabelCell.js'
import { RowSelectionBar } from './RowSelectionBar.js'
import { BulkActions, type SerializedBulkAction } from './BulkActions.js'
import { useRowSelection, getPageCheckboxState } from '../lib/useRowSelection.js'
import { useBulkStatus } from '../lib/useBulkStatus.js'
import type { SerializableFieldConfig } from '../lib/serializeFieldConfig.js'
import { isDefaultColumnField } from '../lib/defaultColumns.js'
import {
  readServerDensity,
  readStoredDensity,
  storeDensity,
  subscribeDensity,
} from '../lib/density.js'
import { DEFAULT_PAGE_SIZE } from '../lib/pageSize.js'
import { CARD_CELL, CARD_PINNED_CELL, CARD_ROW, CARD_TITLE_CELL } from '../lib/tableClasses.js'
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

const PAGE_SIZES = [25, 50, 100]

interface ListUrlState {
  search: string
  sort: { field: string; direction: 'asc' | 'desc' } | null
  page: number
  pageSize: number
  columns: string[] | null
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
   * Every column the column picker offers, in declaration order. `ListView`
   * passes the list's displayable fields; omitted, the picker offers the keys
   * of `fieldTypes`.
   */
  availableColumns?: string[]
  /**
   * Whether `columns` is the admin's own `?columns=` choice, which navigation
   * then carries along and the picker offers to reset.
   */
  columnsChosen?: boolean
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
}

export function ListViewClient({
  items,
  fieldTypes,
  fields,
  relationshipRefs,
  columns,
  availableColumns,
  columnsChosen = false,
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
}: ListViewClientProps) {
  const router = useRouter()
  const sortBy = initialSort?.field ?? null
  const sortOrder = initialSort?.direction ?? 'asc'
  const density = React.useSyncExternalStore(subscribeDensity, readStoredDensity, readServerDensity)
  const compact = density === 'compact'

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
    columns || Object.keys(fieldTypes).filter((key) => isDefaultColumnField(fields?.[key]))
  const pickableColumns = availableColumns ?? Object.keys(fieldTypes)
  const titleColumn =
    labelColumn && displayColumns.includes(labelColumn) ? labelColumn : displayColumns[0]

  const totalPages = Math.ceil(total / pageSize)
  const hasNextPage = page < totalPages
  const hasPrevPage = page > 1

  const current: ListUrlState = {
    search: initialSearch ?? '',
    sort: sortBy ? { field: sortBy, direction: sortOrder } : null,
    page,
    pageSize,
    columns: columnsChosen ? displayColumns : null,
  }

  const buildUrl = (changes: Partial<ListUrlState>) => {
    const next = { ...current, ...changes }
    const params = new URLSearchParams()
    const search = next.search.trim()
    if (search) params.set('search', search)
    if (next.sort) params.set('sort', `${next.sort.field}:${next.sort.direction}`)
    params.set('page', String(next.page))
    if (next.pageSize !== DEFAULT_PAGE_SIZE) params.set('pageSize', String(next.pageSize))
    if (next.columns && next.columns.length > 0) params.set('columns', next.columns.join(','))
    return `${basePath}/${urlKey}?${params.toString()}`
  }

  const sortTo = (field: string, direction: 'asc' | 'desc') =>
    router.push(buildUrl({ sort: { field, direction }, page: 1 }))

  const handleSort = (column: string) => {
    sortTo(column, sortBy === column ? (sortOrder === 'asc' ? 'desc' : 'asc') : 'asc')
  }

  const applyQuery = (query: string) => {
    router.push(buildUrl({ search: query, page: 1 }))
  }

  const buildPaginationUrl = (newPage: number) => buildUrl({ page: newPage })

  const [pendingColumns, setPendingColumns] = React.useState<string[] | null>(null)
  if (pendingColumns !== null && pendingColumns.join(',') === displayColumns.join(',')) {
    setPendingColumns(null)
  }
  const pickedColumns = pendingColumns ?? displayColumns

  const toggleColumn = (column: string, shown: boolean) => {
    const next = shown
      ? [...pickedColumns.filter((name) => name !== column), column]
      : pickedColumns.filter((name) => name !== column)
    if (next.length === 0) return
    setPendingColumns(next)
    router.push(buildUrl({ columns: next }))
  }

  const resetColumns = () => {
    setPendingColumns(null)
    router.push(buildUrl({ columns: null }))
  }

  const sortOptions = displayColumns.filter((column) => sortableFields[column] === true)
  if (sortBy && !sortOptions.includes(sortBy)) sortOptions.push(sortBy)

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

      <div data-slot="list-view-toolbar" className="flex flex-wrap items-center justify-end gap-2">
        {sortOptions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-slot="list-view-sort"
                aria-label={
                  sortBy
                    ? `Sort: ${formatFieldName(sortBy)}, ${sortOrder === 'asc' ? 'ascending' : 'descending'}`
                    : 'Sort'
                }
              >
                <ArrowUpDown aria-hidden="true" />
                <span>
                  {sortBy
                    ? `Sort: ${formatFieldName(sortBy)} ${sortOrder === 'asc' ? '↑' : '↓'}`
                    : 'Sort'}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sortBy ?? ''}
                onValueChange={(field) => {
                  if (field !== sortBy) sortTo(field, sortBy ? sortOrder : 'asc')
                }}
              >
                {sortOptions.map((column) => (
                  <DropdownMenuRadioItem key={column} value={column}>
                    {formatFieldName(column)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={sortBy ? sortOrder : ''}
                onValueChange={(direction) => {
                  if (
                    sortBy &&
                    direction !== sortOrder &&
                    (direction === 'asc' || direction === 'desc')
                  )
                    sortTo(sortBy, direction)
                }}
              >
                <DropdownMenuRadioItem value="asc" disabled={!sortBy}>
                  Ascending
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="desc" disabled={!sortBy}>
                  Descending
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" data-slot="list-view-columns">
              <Columns3 aria-hidden="true" />
              <span>Columns</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Show columns</DropdownMenuLabel>
            {pickableColumns.map((column) => {
              const shown = pickedColumns.includes(column)
              return (
                <DropdownMenuCheckboxItem
                  key={column}
                  checked={shown}
                  disabled={shown && pickedColumns.length === 1}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) => toggleColumn(column, checked === true)}
                >
                  {formatFieldName(column)}
                </DropdownMenuCheckboxItem>
              )
            })}
            {columnsChosen && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={resetColumns}>Reset columns</DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <div
          role="group"
          aria-label="Row density"
          data-slot="list-view-density"
          className="inline-flex overflow-hidden rounded-md border"
        >
          {(['comfortable', 'compact'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={density === option}
              onClick={() => storeDensity(option)}
              className="h-9 px-3 font-sans text-sm text-muted-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:font-medium aria-pressed:text-foreground"
            >
              {option === 'comfortable' ? 'Comfortable' : 'Compact'}
            </button>
          ))}
        </div>
      </div>

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

      <div
        data-slot="list-view-table"
        data-density={density}
        className="rounded-lg border max-md:border-0 max-md:*:overflow-visible"
      >
        <Table className="max-md:block">
          <TableHeader className={selectionEnabled ? 'max-md:block' : 'max-md:hidden'}>
            <TableRow className="max-md:flex max-md:border-0 max-md:hover:bg-transparent">
              {selectionEnabled && (
                <TableHead
                  data-slot="selection-header"
                  className={cn('w-10', compact && 'h-9', 'max-md:h-auto max-md:px-3 max-md:pb-2')}
                >
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
                    className={cn(sortable && 'p-0', compact && 'h-9', 'max-md:hidden')}
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
                        className={cn(compact && 'min-h-9')}
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
              <TableHead className={cn('text-right', compact && 'h-9', 'max-md:hidden')}>
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="max-md:block max-md:space-y-2 max-md:p-px">
            {items.length === 0 ? (
              <TableRow className="max-md:block max-md:rounded-lg max-md:ring-1 max-md:ring-border">
                <TableCell
                  data-slot="list-view-empty"
                  colSpan={displayColumns.length + 1 + (selectionEnabled ? 1 : 0)}
                  className="p-0 max-md:block"
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
                    className={cn(CARD_ROW, selectionEnabled && 'max-md:pl-11')}
                  >
                    {selectionEnabled && (
                      <TableCell
                        data-slot="selection-cell"
                        className={cn(
                          'w-10',
                          compact && 'py-1.5',
                          CARD_PINNED_CELL,
                          'max-md:left-3',
                        )}
                      >
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
                        data-label={formatFieldName(column)}
                        className={cn(
                          isCountAlignedColumn(columnField(column)) && 'text-right',
                          compact && 'py-1.5',
                          CARD_CELL,
                          column === titleColumn && CARD_TITLE_CELL,
                        )}
                      >
                        {renderCell(column, item)}
                      </TableCell>
                    ))}
                    <TableCell
                      className={cn(
                        'text-right',
                        compact && 'py-1.5',
                        CARD_PINNED_CELL,
                        'max-md:right-3',
                      )}
                    >
                      <Link
                        href={`${basePath}/${urlKey}/${item.id}`}
                        className="text-primary hover:underline max-md:-m-3 max-md:inline-block max-md:p-3"
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

      {total > 0 && (
        <div
          data-slot="list-view-pagination"
          className="flex flex-wrap items-center justify-between gap-2"
        >
          {totalPages > 1 ? (
            <p className="text-sm tabular-nums text-muted-foreground">
              Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total}{' '}
              results
            </p>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Rows per page"
              data-slot="list-view-page-size"
              className="inline-flex overflow-hidden rounded-md border"
            >
              {PAGE_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  aria-pressed={pageSize === size}
                  onClick={() => router.push(buildUrl({ page: 1, pageSize: size }))}
                  className="h-9 min-w-10 px-3 font-sans text-sm tabular-nums text-muted-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:font-medium aria-pressed:text-foreground"
                >
                  {size}
                </button>
              ))}
            </div>
            {totalPages > 1 && (
              <>
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
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
