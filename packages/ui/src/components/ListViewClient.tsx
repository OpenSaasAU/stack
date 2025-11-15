'use client'

import * as React from 'react'
import { useState } from 'react'
import Link from 'next/link.js'
import { useRouter } from 'next/navigation.js'
import { formatFieldName, getFieldDisplayValue } from '../lib/utils.js'
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
import { getUrlKey, type OpenSaasConfig } from '@opensaas/stack-core'
import { FilterBar } from './filters/FilterBar.js'
import type { ListFilters } from '../lib/filter-types.js'

export interface ListViewClientProps {
  items: Array<Record<string, unknown>>
  fieldTypes: Record<string, string>
  relationshipRefs: Record<string, string>
  columns?: string[]
  listKey: string
  urlKey: string
  basePath: string
  page: number
  pageSize: number
  total: number
  search?: string
  filters?: ListFilters
  searchParams?: Record<string, string | string[] | undefined>
  config: OpenSaasConfig
}

/**
 * Client component for interactive list table
 * Handles sorting, pagination, and row interactions
 */
export function ListViewClient({
  items,
  fieldTypes,
  relationshipRefs,
  columns,
  listKey,
  urlKey,
  basePath,
  page,
  pageSize,
  total,
  search: initialSearch,
  filters = [],
  searchParams = {},
  config,
}: ListViewClientProps) {
  const router = useRouter()
  const [sortBy, setSortBy] = useState<string | null>(null)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [searchInput, setSearchInput] = useState(initialSearch || '')

  // Determine which columns to show
  const displayColumns =
    columns ||
    Object.keys(fieldTypes).filter((key) => !['password', 'createdAt', 'updatedAt'].includes(key))

  // Sort items if needed
  const sortedItems = [...items]
  if (sortBy) {
    sortedItems.sort((a, b) => {
      const aVal = a[sortBy]
      const bVal = b[sortBy]
      if (aVal === bVal) return 0
      // Handle unknown types for comparison - convert to string for safety
      const aStr = String(aVal ?? '')
      const bStr = String(bVal ?? '')
      const comparison = aStr > bStr ? 1 : -1
      return sortOrder === 'asc' ? comparison : -comparison
    })
  }

  const totalPages = Math.ceil(total / pageSize)
  const hasNextPage = page < totalPages
  const hasPrevPage = page > 1

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortOrder('asc')
    }
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const params = new URLSearchParams()
    if (searchInput.trim()) {
      params.set('search', searchInput.trim())
    }
    params.set('page', '1') // Reset to page 1 on new search
    router.push(`${basePath}/${urlKey}?${params.toString()}`)
  }

  const handleClearSearch = () => {
    setSearchInput('')
    router.push(`${basePath}/${urlKey}`)
  }

  const buildPaginationUrl = (newPage: number) => {
    const params = new URLSearchParams()
    if (initialSearch) {
      params.set('search', initialSearch)
    }
    params.set('page', newPage.toString())
    return `${basePath}/${urlKey}?${params.toString()}`
  }

  /**
   * Render a relationship field as a clickable link or links
   */
  const renderRelationshipCell = (value: unknown, fieldName: string) => {
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

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <FilterBar
        listKey={listKey}
        config={config}
        basePath={basePath}
        urlKey={urlKey}
        currentFilters={filters}
        searchParams={searchParams}
      />

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

      {/* Table */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {displayColumns.map((column) => (
                <TableHead
                  key={column}
                  className="cursor-pointer hover:bg-muted/70 transition-colors"
                  onClick={() => handleSort(column)}
                >
                  <div className="flex items-center space-x-1">
                    <span>{formatFieldName(column)}</span>
                    {sortBy === column && (
                      <span className="text-primary">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </TableHead>
              ))}
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={displayColumns.length + 1} className="h-24 text-center">
                  No items found
                </TableCell>
              </TableRow>
            ) : (
              sortedItems.map((item) => (
                <TableRow key={String(item.id)}>
                  {displayColumns.map((column) => (
                    <TableCell key={column}>
                      {fieldTypes[column] === 'relationship'
                        ? renderRelationshipCell(item[column], column)
                        : getFieldDisplayValue(item[column], fieldTypes[column])}
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
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
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
