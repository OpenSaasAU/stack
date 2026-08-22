'use client'
import * as React from 'react'
import { useState } from 'react'
import { Inbox } from 'lucide-react'
import { cn, formatFieldName, isNumericField } from '../../lib/utils.js'
import type { SelectOption } from '@opensaas/stack-core/fields'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../primitives/table.js'
import { EmptyState } from '../EmptyState.js'
import { CellRenderer } from '../cells/CellRenderer.js'
import type { SerializableFieldConfig } from '../../lib/serializeFieldConfig.js'
import { computeDefaultColumns } from '../../lib/defaultColumns.js'

/**
 * Per-part `classNames` slots for `ListTable` (issue #709). Each slot is merged
 * onto the matching part via `cn`/tailwind-merge so caller classes win, and the
 * part carries a stable `data-slot` for plain-CSS restyling.
 */
export interface ListTableClassNames {
  /** Outer wrapper (`data-slot="list-table"`). */
  root?: string
  /** Bordered frame around the table (`data-slot="list-table-frame"`). */
  frame?: string
  /** The `<table>` element (`data-slot="table"`). */
  table?: string
  /** The `<thead>` (`data-slot="table-header"`). */
  header?: string
  /** The header `<tr>` (`data-slot="table-row"`). */
  headerRow?: string
  /** Each header `<th>` (`data-slot="table-head"`). */
  headerCell?: string
  /** The `<tbody>` (`data-slot="table-body"`). */
  body?: string
  /** Each body `<tr>` (`data-slot="table-row"`). */
  row?: string
  /** Each body `<td>` (`data-slot="table-cell"`). */
  cell?: string
  /** The actions column header, when `renderActions` is set. */
  actionsHeader?: string
  /** The actions column cell, when `renderActions` is set. */
  actionsCell?: string
  /** The empty-state cell (`data-slot="list-table-empty"`). */
  empty?: string
}

export interface ListTableProps {
  items: Array<Record<string, unknown>>
  fieldTypes: Record<string, string>
  relationshipRefs?: Record<string, string>
  /**
   * Select options per column (issue #748) — lets a standalone `select` column
   * resolve label mapping and `ui.variant` badge colour via `SelectCell`,
   * matching `ListView`. Columns without an entry render the raw value in the
   * neutral badge, same as before this option existed.
   */
  fieldOptions?: Record<string, Array<SelectOption>>
  /**
   * Serialised per-field config, keyed by field name (issue #1018). When
   * supplied, an explicit `columns` list absent, the default columns are
   * curated off each field's own `ui.listView.defaultColumn` declaration
   * (see `computeDefaultColumns`) instead of showing every `fieldTypes` key.
   * Omit when you have no field config to hand — every column shows.
   */
  fields?: Record<string, SerializableFieldConfig>
  basePath?: string
  columns?: string[]
  onRowClick?: (item: Record<string, unknown>) => void
  sortable?: boolean
  emptyMessage?: string
  className?: string
  /** Structured per-part class overrides; each merges onto its `data-slot` part. */
  classNames?: ListTableClassNames
  renderActions?: (item: Record<string, unknown>) => React.ReactNode
}

/**
 * @example
 * ```tsx
 * <ListTable
 *   items={posts}
 *   fieldTypes={{ title: 'text', status: 'select', publishedAt: 'timestamp', author: 'relationship' }}
 *   relationshipRefs={{ author: 'User.posts' }}
 *   columns={['title', 'status', 'publishedAt', 'author']}
 *   onRowClick={(post) => router.push(`/posts/${post.id}`)}
 *   renderActions={(post) => (
 *     <Button onClick={() => deletePost(post.id)}>Delete</Button>
 *   )}
 * />
 * ```
 */
export function ListTable({
  items,
  fieldTypes,
  relationshipRefs,
  fieldOptions,
  fields,
  basePath = '/admin',
  columns,
  onRowClick,
  sortable = true,
  emptyMessage = 'No items found',
  className,
  classNames,
  renderActions,
}: ListTableProps) {
  const [sortBy, setSortBy] = useState<string | null>(null)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')

  /**
   * Build the serialised field config for one column so its value can be
   * routed through the shared cell registry (`CellRenderer`), exactly the path
   * `ListView` uses (issue #748). `many` is deliberately omitted: unlike
   * `ListView`'s pre-resolved access-scoped `_count`, this standalone table
   * only ever receives the raw relationship value, so `RelationshipCell`'s
   * array-vs-single branching (not its `many`-driven count branch) is what
   * renders the linked value(s).
   */
  const getFieldConfig = (fieldName: string): SerializableFieldConfig => ({
    type: fieldTypes[fieldName],
    ref: relationshipRefs?.[fieldName],
    options: fieldOptions?.[fieldName],
  })

  // Absent an explicit `columns` list, curate off each field's own declared
  // `ui.listView.defaultColumn` (issue #1018) when `fields` metadata was
  // supplied; with no `fields` at all there's nothing to curate by, so every
  // column shows.
  const displayColumns =
    columns || (fields ? computeDefaultColumns(fields) : Object.keys(fieldTypes))

  const sortedItems = [...items]
  if (sortBy && sortable) {
    sortedItems.sort((a, b) => {
      const aVal = a[sortBy]
      const bVal = b[sortBy]
      if (aVal === bVal) return 0
      const comparison = String(aVal) > String(bVal) ? 1 : -1
      return sortOrder === 'asc' ? comparison : -comparison
    })
  }

  const handleSort = (column: string) => {
    if (!sortable) return
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortOrder('asc')
    }
  }

  return (
    <div data-slot="list-table" className={cn(className, classNames?.root)}>
      <div data-slot="list-table-frame" className={cn('rounded-lg border', classNames?.frame)}>
        <Table className={classNames?.table}>
          <TableHeader className={classNames?.header}>
            <TableRow className={classNames?.headerRow}>
              {displayColumns.map((column) => {
                const numeric = isNumericField(fieldTypes[column])
                return (
                  <TableHead
                    key={column}
                    className={cn(
                      sortable && 'cursor-pointer transition-colors hover:bg-muted/70',
                      classNames?.headerCell,
                    )}
                    onClick={() => handleSort(column)}
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
              {renderActions && (
                <TableHead className={cn('text-right', classNames?.actionsHeader)}>
                  Actions
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody className={classNames?.body}>
            {sortedItems.length === 0 ? (
              <TableRow className={classNames?.row}>
                <TableCell
                  data-slot="list-table-empty"
                  colSpan={displayColumns.length + (renderActions ? 1 : 0)}
                  className={cn('p-0', classNames?.empty)}
                >
                  <EmptyState
                    className="border-0"
                    icon={<Inbox className="h-6 w-6" />}
                    title={emptyMessage}
                  />
                </TableCell>
              </TableRow>
            ) : (
              sortedItems.map((item) => (
                <TableRow
                  key={String(item.id)}
                  className={cn(onRowClick && 'cursor-pointer', classNames?.row)}
                  onClick={() => onRowClick?.(item)}
                >
                  {displayColumns.map((column) => (
                    <TableCell
                      key={column}
                      className={cn(
                        isNumericField(fieldTypes[column]) && 'text-right',
                        classNames?.cell,
                      )}
                    >
                      <CellRenderer
                        value={item[column]}
                        field={getFieldConfig(column)}
                        fieldName={column}
                        basePath={basePath}
                      />
                    </TableCell>
                  ))}
                  {renderActions && (
                    <TableCell
                      className={cn('text-right', classNames?.actionsCell)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {renderActions(item)}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
