'use client'
import * as React from 'react'
import { useState } from 'react'
import Link from 'next/link.js'
import { Inbox } from 'lucide-react'
import { cn, formatFieldName, isNumericField } from '../../lib/utils.js'
import { getUrlKey } from '@opensaas/stack-core'
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

/**
 * `ListTable` is a standalone component embedded by consumers with raw
 * Prisma-shaped items and no list config, so it can't resolve labels via the
 * shared label seam (`getItemLabel`) the way `ListView`/`ListViewClient` do.
 * This local fallback (name → title → label → id) is intentionally private
 * to this component so it can't drift against another copy elsewhere.
 */
function getRelationshipDisplayValue(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return '-'
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '-'
    return value.map((item) => getRelationshipDisplayValue(item)).join(', ')
  }

  let displayValue: unknown
  if ('name' in value) {
    displayValue = value.name
  } else if ('title' in value) {
    displayValue = value.title
  } else if ('label' in value) {
    displayValue = value.label
  } else if ('id' in value) {
    displayValue = value.id
  }

  return displayValue ? String(displayValue) : '-'
}

export interface ListTableProps {
  items: Array<Record<string, unknown>>
  fieldTypes: Record<string, string>
  relationshipRefs?: Record<string, string>
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
 * Standalone table component for displaying list data
 * Can be embedded in any custom page
 *
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
   * Render a relationship field as a clickable link or links
   */
  const renderRelationshipCell = (value: unknown, fieldName: string) => {
    if (!relationshipRefs) {
      return getRelationshipDisplayValue(value)
    }

    const ref = relationshipRefs[fieldName]
    if (!ref) {
      return getRelationshipDisplayValue(value)
    }

    // Parse ref to get related list name
    const [relatedListKey] = ref.split('.')
    const relatedUrlKey = getUrlKey(relatedListKey)

    if (!value || typeof value !== 'object') {
      return <span className="text-muted-foreground">-</span>
    }

    // Handle array of relationships (many: true)
    if (Array.isArray(value)) {
      if (value.length === 0) return <span className="text-muted-foreground">-</span>
      return (
        <span className="flex flex-wrap gap-1">
          {value.map((item, idx) => {
            if (!item || typeof item !== 'object') return null
            const displayValue = getRelationshipDisplayValue(item)
            const itemId = 'id' in item ? item.id : null
            const key = itemId || idx
            return (
              <React.Fragment key={key}>
                {idx > 0 && <span className="text-muted-foreground">, </span>}
                <Link
                  href={`${basePath}/${relatedUrlKey}/${itemId}`}
                  className="text-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {displayValue}
                </Link>
              </React.Fragment>
            )
          })}
        </span>
      )
    }

    // Handle single relationship
    const itemId = 'id' in value ? value.id : null
    const displayValue = getRelationshipDisplayValue(value)
    return (
      <Link
        href={`${basePath}/${relatedUrlKey}/${itemId}`}
        className="text-primary hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {displayValue}
      </Link>
    )
  }

  // Determine which columns to show
  const displayColumns =
    columns ||
    Object.keys(fieldTypes).filter((key) => !['password', 'createdAt', 'updatedAt'].includes(key))

  // Sort items if needed
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
                      {fieldTypes[column] === 'relationship' ? (
                        renderRelationshipCell(item[column], column)
                      ) : (
                        <CellRenderer
                          value={item[column]}
                          field={{ type: fieldTypes[column] }}
                          fieldName={column}
                          basePath={basePath}
                        />
                      )}
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
