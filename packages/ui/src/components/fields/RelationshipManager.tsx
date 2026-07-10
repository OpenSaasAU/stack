'use client'

import * as React from 'react'
import { useState } from 'react'
import Link from 'next/link.js'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../primitives/table.js'
import {
  Combobox,
  ComboboxTrigger,
  ComboboxContent,
  ComboboxSearch,
  ComboboxList,
  ComboboxEmpty,
  ComboboxItem,
} from '../../primitives/combobox.js'
import { Button } from '../../primitives/button.js'
import { useRelationshipSearch } from '../../lib/useRelationshipSearch.js'
import type { ServerActionInput } from '../../server/types.js'

export interface RelationshipManagerProps {
  name: string
  value: string[]
  onChange: (value: string[]) => void
  label: string
  items: Array<{ id: string; label: string }>
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
  isLoading?: boolean
  relatedListKey?: string
  basePath?: string
  /** Raw list key of the list being edited — required (with `serverAction`) to live-search. */
  listKey?: string
  /** Generic server action used to resolve `relationshipOptions`. */
  serverAction?: (input: ServerActionInput) => Promise<unknown>
  /** Debounce delay (ms) before a typed query issues a server search. @default 300 */
  debounceMs?: number
}

export function RelationshipManager({
  name,
  value,
  onChange,
  label,
  items,
  error,
  disabled,
  required,
  mode = 'edit',
  isLoading = false,
  relatedListKey,
  basePath = '/admin',
  listKey,
  serverAction,
  debounceMs = 300,
}: RelationshipManagerProps) {
  const [showConnectModal, setShowConnectModal] = useState(false)

  const selectedIds = Array.isArray(value) ? value : []

  const { searchQuery, setSearchQuery, searchResults, isSearching, resolveLabel } =
    useRelationshipSearch({
      initialItems: items,
      listKey,
      fieldName: name,
      serverAction,
      selectedIds,
      debounceMs,
    })

  const selectedItems = selectedIds.map((id) => ({
    id,
    label: resolveLabel(id) ?? items.find((item) => item.id === id)?.label ?? id,
  }))
  const availableItems = searchResults.filter((item) => !selectedIds.includes(item.id))

  // Read mode
  if (mode === 'read') {
    return (
      <div className="space-y-1">
        <label className="text-sm font-medium text-muted-foreground">{label}</label>
        <p className="text-sm">
          {selectedItems.length > 0 ? selectedItems.map((item) => item.label).join(', ') : '-'}
        </p>
      </div>
    )
  }

  const handleRemove = (itemId: string) => {
    onChange(selectedIds.filter((id) => id !== itemId))
  }

  const handleConnect = (itemId: string) => {
    onChange([...selectedIds, itemId])
    setShowConnectModal(false)
    setSearchQuery('')
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </label>

      {/* Selected Items Table */}
      {selectedItems.length > 0 ? (
        <div className="rounded-md border border-input">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {selectedItems.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    {relatedListKey ? (
                      <Link
                        href={`${basePath}/${relatedListKey}/${item.id}`}
                        className="text-primary hover:underline"
                      >
                        {item.label}
                      </Link>
                    ) : (
                      item.label
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemove(item.id)}
                      disabled={disabled}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="rounded-md border border-input border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No items connected. Click &quot;Connect Existing&quot; to add items.
          </p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2">
        <Combobox open={showConnectModal} onOpenChange={setShowConnectModal}>
          <ComboboxTrigger disabled={disabled || isLoading} className="h-9 px-3">
            <span>{isLoading ? 'Loading...' : 'Connect Existing'}</span>
          </ComboboxTrigger>
          <ComboboxContent>
            <ComboboxSearch
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                }
              }}
            />
            <ComboboxList>
              {isSearching ? (
                <ComboboxEmpty>Searching...</ComboboxEmpty>
              ) : availableItems.length === 0 ? (
                <ComboboxEmpty>No results found</ComboboxEmpty>
              ) : (
                availableItems.map((item) => (
                  <ComboboxItem key={item.id} onClick={() => handleConnect(item.id)}>
                    {item.label}
                  </ComboboxItem>
                ))
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>

        {/* Note: "Create New" functionality would require additional props for the related list's fields
            and form rendering logic. For now, we'll leave it as a placeholder or implement in a future iteration */}
      </div>

      {error && <p className="text-sm text-destructive mt-2">{error}</p>}
    </div>
  )
}
