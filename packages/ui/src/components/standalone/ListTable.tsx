'use client'
import * as React from 'react'
import { useState } from 'react'
import Link from 'next/link.js'
import { formatFieldName, getFieldDisplayValue } from '../../lib/utils.js'
import { getUrlKey } from '@opensaas/stack-core'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../primitives/table.js'

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
  renderActions,
}: ListTableProps) {
  const [sortBy, setSortBy] = useState<string | null>(null)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')

  /**
   * Render a relationship field as a clickable link or links
   */
  const renderRelationshipCell = (value: unknown, fieldName: string) => {
    if (!relationshipRefs) {
      return getFieldDisplayValue(value, 'relationship')
    }

    const ref = relationshipRefs[fieldName]
    if (!ref) {
      return getFieldDisplayValue(value, 'relationship')
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
            const displayValue = getFieldDisplayValue(item, 'relationship')
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
    const displayValue = getFieldDisplayValue(value, 'relationship')
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
    <div className={className}>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {displayColumns.map((column) => (
                <TableHead
                  key={column}
                  className={sortable ? 'cursor-pointer hover:bg-muted/70 transition-colors' : ''}
                  onClick={() => handleSort(column)}
                >
                  <div className="flex items-center space-x-1">
                    <span>{formatFieldName(column)}</span>
                    {sortable && sortBy === column && (
                      <span className="text-primary">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </TableHead>
              ))}
              {renderActions && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedItems.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={displayColumns.length + (renderActions ? 1 : 0)}
                  className="h-24 text-center"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              sortedItems.map((item) => (
                <TableRow
                  key={String(item.id)}
                  className={onRowClick ? 'cursor-pointer' : ''}
                  onClick={() => onRowClick?.(item)}
                >
                  {displayColumns.map((column) => (
                    <TableCell key={column}>
                      {fieldTypes[column] === 'relationship'
                        ? renderRelationshipCell(item[column], column)
                        : getFieldDisplayValue(item[column], fieldTypes[column])}
                    </TableCell>
                  ))}
                  {renderActions && (
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
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
