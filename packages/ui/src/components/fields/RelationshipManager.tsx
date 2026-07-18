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
import { cn } from '../../lib/utils.js'
import { FieldRoot, FieldLabel, FieldError, FieldReadValue } from './field-shell.js'

/**
 * Per-part `classNames` slots for `RelationshipManager` (issue #709). Each merges
 * onto its `data-slot` part via `cn`/tailwind-merge.
 */
export interface RelationshipManagerClassNames {
  /** Outer wrapper (`data-slot="relationship-manager"`). */
  root?: string
  /** The field label (`data-slot="field-label"`). */
  label?: string
  /** The bordered frame around the connected-items table (`data-slot="relationship-manager-frame"`). */
  frame?: string
  /** Each connected-item row (`data-slot="table-row"`). */
  row?: string
  /** Each connected-item cell (`data-slot="table-cell"`). */
  cell?: string
  /** The empty state box (`data-slot="relationship-manager-empty"`). */
  emptyState?: string
  /** The action-button row (`data-slot="relationship-manager-actions"`). */
  actions?: string
  /** The connect-existing trigger (`data-slot="combobox-trigger"`). */
  connectButton?: string
  /** The error message (`data-slot="field-error"`). */
  error?: string
}

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
  /** Structured per-part class overrides; each merges onto its `data-slot` part. */
  classNames?: RelationshipManagerClassNames
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
  classNames,
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
      <FieldRoot mode="read" data-slot="relationship-manager" className={classNames?.root}>
        <FieldLabel muted className={classNames?.label}>
          {label}
        </FieldLabel>
        <FieldReadValue>
          {selectedItems.length > 0 ? selectedItems.map((item) => item.label).join(', ') : '-'}
        </FieldReadValue>
      </FieldRoot>
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
    <FieldRoot data-slot="relationship-manager" className={classNames?.root}>
      <FieldLabel required={required} className={classNames?.label}>
        {label}
      </FieldLabel>

      {/* Selected Items Table */}
      {selectedItems.length > 0 ? (
        <div
          data-slot="relationship-manager-frame"
          className={cn('rounded-md border border-input', classNames?.frame)}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {selectedItems.map((item) => (
                <TableRow key={item.id} className={classNames?.row}>
                  <TableCell className={classNames?.cell}>
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
                  <TableCell className={cn('text-right', classNames?.cell)}>
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
        <div
          data-slot="relationship-manager-empty"
          className={cn(
            'rounded-md border border-input border-dashed p-8 text-center',
            classNames?.emptyState,
          )}
        >
          <p className="text-sm text-muted-foreground">
            No items connected. Click &quot;Connect Existing&quot; to add items.
          </p>
        </div>
      )}

      {/* Action Buttons */}
      <div
        data-slot="relationship-manager-actions"
        className={cn('flex gap-2', classNames?.actions)}
      >
        <Combobox open={showConnectModal} onOpenChange={setShowConnectModal}>
          <ComboboxTrigger
            disabled={disabled || isLoading}
            className={cn('h-9 px-3', classNames?.connectButton)}
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

      {error && <FieldError className={cn('mt-2', classNames?.error)}>{error}</FieldError>}
    </FieldRoot>
  )
}
