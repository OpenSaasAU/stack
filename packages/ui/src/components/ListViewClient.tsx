'use client'

import * as React from 'react'
import Link from 'next/link.js'
import { Inbox, Plus, SearchX } from 'lucide-react'
import { useRouter } from 'next/navigation.js'
import { cn, formatFieldName, isNumericField } from '../lib/utils.js'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../primitives/table.js'
import { Input } from '../primitives/input.js'
import { Button } from '../primitives/button.js'
import { Card } from '../primitives/card.js'
import { Checkbox } from '../primitives/checkbox.js'
import { EmptyState } from './EmptyState.js'
import { CellRenderer } from './cells/CellRenderer.js'
import { RowSelectionBar } from './RowSelectionBar.js'
import { useRowSelection, getPageCheckboxState } from '../lib/useRowSelection.js'
import type { SerializableFieldConfig } from '../lib/serializeFieldConfig.js'
import type { ServerActionInput } from '../server/types.js'

/**
 * Narrow a `serverAction` result to a success without leaking a shape onto the
 * external API. A denied delete comes back `{ success: false }` (Silent
 * failure) and is simply not counted.
 */
function isServerActionSuccess(result: unknown): boolean {
  return (
    typeof result === 'object' &&
    result !== null &&
    'success' in result &&
    (result as { success: unknown }).success === true
  )
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
}

/**
 * Client component for interactive list table
 * Handles sorting, pagination, and row interactions
 */
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
  serverAction,
  canDelete = false,
}: ListViewClientProps) {
  const router = useRouter()
  const sortBy = initialSort?.field ?? null
  const sortOrder = initialSort?.direction ?? 'asc'
  const [searchInput, setSearchInput] = React.useState(initialSearch || '')

  // Row selection (issue #733). The filter identity is the active search — page
  // and sort changes keep it stable (selection persists while paging) while a
  // filter change resets it. When the Filter builder lands this becomes the full
  // filter query string.
  const filterKey = initialSearch ?? ''
  const selection = useRowSelection(listKey, filterKey)

  // Selection is offered only when a Bulk action exists. Today that is the
  // built-in Delete (gated by static delete access); #736 will widen this to
  // `canDelete || hasCustomBulkActions`.
  const selectionEnabled = canDelete
  const canBulkDelete = canDelete && !!serverAction

  // The "N of M deleted" report persists after the selection clears, so it lives
  // here (always mounted) rather than in the selection bar (which unmounts once
  // the selection empties).
  const [bulkStatus, setBulkStatus] = React.useState<string | null>(null)

  const pageIds = items.map((item) => String(item.id))

  const handleBulkDelete = async () => {
    if (!serverAction) return
    const ids = [...selection.selectedIds]
    setBulkStatus(null)

    // Row-by-row through the secured context. A denied row returns a Silent
    // failure (`{ success: false }`) and is simply not counted — the report
    // never reveals which rows were denied or why.
    let deleted = 0
    for (const id of ids) {
      const result = await serverAction({ listKey, action: 'delete', id })
      if (isServerActionSuccess(result)) deleted++
    }

    selection.clear()
    setBulkStatus(`${deleted} of ${ids.length} deleted`)
    router.refresh()
  }

  // Determine which columns to show
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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const params = new URLSearchParams()
    if (searchInput.trim()) {
      params.set('search', searchInput.trim())
    }
    if (sortBy) {
      params.set('sort', `${sortBy}:${sortOrder}`)
    }
    params.set('page', '1') // Reset to page 1 on new search
    router.push(`${basePath}/${urlKey}?${withPageSize(params).toString()}`)
  }

  const handleClearSearch = () => {
    setSearchInput('')
    const params = new URLSearchParams()
    if (sortBy) {
      params.set('sort', `${sortBy}:${sortOrder}`)
    }
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

  /**
   * The serialised field config for a column. Prefer the explicit `fields`
   * prop; otherwise synthesise a minimal config from `fieldTypes` (and the
   * relationship ref) so Cells still resolve via the field-type registry.
   */
  const columnField = (column: string): SerializableFieldConfig => {
    if (fields?.[column]) return fields[column]
    const ref = relationshipRefs[column]
    return {
      type: fieldTypes[column],
      ...(ref ? { ref } : {}),
    }
  }

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <Card className="p-4">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="flex-1 relative">
            <Input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search..."
              className="pr-10"
            />
            {searchInput && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            )}
          </div>
          <Button type="submit">Search</Button>
        </form>
      </Card>

      {/* Bulk-action result ("N of M deleted"). Lives here (always mounted) so
          it survives the selection clearing after a delete. */}
      {bulkStatus && (
        <div
          data-slot="selection-status"
          role="status"
          className="rounded-lg border bg-muted/50 px-4 py-2 text-sm text-foreground"
        >
          {bulkStatus}
        </div>
      )}

      {/* Selection bar — visible only while rows are selected. */}
      {selectionEnabled && (
        <RowSelectionBar
          count={selection.selectedCount}
          onClear={selection.clear}
          onDelete={canBulkDelete ? handleBulkDelete : undefined}
          itemName={formatFieldName(listKey).toLowerCase()}
        />
      )}

      {/* Table */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {selectionEnabled && (
                <TableHead data-slot="selection-header" className="w-10">
                  <Checkbox
                    aria-label="Select all rows on this page"
                    checked={getPageCheckboxState(selection.selectedIds, pageIds)}
                    onCheckedChange={() => selection.togglePage(pageIds)}
                    disabled={pageIds.length === 0}
                  />
                </TableHead>
              )}
              {displayColumns.map((column) => {
                const numeric = isNumericField(fieldTypes[column])
                return (
                  <TableHead
                    key={column}
                    className="cursor-pointer transition-colors hover:bg-muted/70"
                    onClick={() => handleSort(column)}
                  >
                    <div
                      className={cn(
                        'flex items-center space-x-1',
                        numeric && 'justify-end text-right',
                      )}
                    >
                      <span>{formatFieldName(column)}</span>
                      {sortBy === column && (
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
                        <Button variant="outline" size="sm" onClick={handleClearSearch}>
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
                          onCheckedChange={() => selection.toggle(rowId)}
                        />
                      </TableCell>
                    )}
                    {displayColumns.map((column) => (
                      <TableCell
                        key={column}
                        className={cn(isNumericField(fieldTypes[column]) && 'text-right')}
                      >
                        <CellRenderer
                          value={item[column]}
                          field={columnField(column)}
                          fieldName={column}
                          basePath={basePath}
                        />
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

      {/* Pagination */}
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
