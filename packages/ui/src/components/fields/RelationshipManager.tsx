'use client'

import * as React from 'react'
import { useState } from 'react'
import Link from 'next/link'
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
}: RelationshipManagerProps) {
  const [showConnectModal, setShowConnectModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const selectedIds = Array.isArray(value) ? value : []
  const selectedItems = items.filter((item) => selectedIds.includes(item.id))
  const availableItems = items.filter((item) => !selectedIds.includes(item.id))

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

  // Filter available items based on search
  const filteredAvailableItems = searchQuery
    ? availableItems.filter((item) =>
        item.label.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : availableItems

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
          <ComboboxTrigger
            disabled={disabled || isLoading || availableItems.length === 0}
            className="h-9 px-3"
          >
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
              {filteredAvailableItems.length === 0 ? (
                <ComboboxEmpty>
                  {availableItems.length === 0
                    ? 'All items are already connected'
                    : 'No results found'}
                </ComboboxEmpty>
              ) : (
                filteredAvailableItems.map((item) => (
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
