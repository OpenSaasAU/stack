'use client'

import * as React from 'react'
import { useRef, useState } from 'react'
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
import {
  FieldRoot,
  FieldLabel,
  FieldError,
  FieldHelp,
  FieldReadValue,
  describeField,
  fieldErrorId,
  fieldHelpId,
  fieldLabelId,
  fieldValueId,
} from './field-shell.js'

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
  /** The control's DOM id. `FieldRenderer` supplies one unique to the form. Defaults to `name`. */
  id?: string
  value: string[]
  onChange: (value: string[]) => void
  label: string
  items: Array<{ id: string; label: string }>
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
  isLoading?: boolean
  helpText?: string
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
  id = name,
  value,
  onChange,
  label,
  items,
  error,
  disabled,
  required,
  mode = 'edit',
  isLoading = false,
  helpText,
  relatedListKey,
  basePath = '/admin',
  listKey,
  serverAction,
  debounceMs = 300,
  classNames,
}: RelationshipManagerProps) {
  const [showConnectModal, setShowConnectModal] = useState(false)
  const connectTriggerRef = useRef<HTMLButtonElement>(null)

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

  if (mode === 'read') {
    return (
      <FieldRoot mode="read" data-slot="relationship-manager" className={classNames?.root}>
        <FieldLabel muted className={classNames?.label}>
          {label}
        </FieldLabel>
        <FieldReadValue>
          {selectedItems.length > 0 ? selectedItems.map((item) => item.label).join(', ') : '-'}
        </FieldReadValue>
        {helpText && <FieldHelp>{helpText}</FieldHelp>}
      </FieldRoot>
    )
  }

  const handleRemove = (itemId: string) => {
    connectTriggerRef.current?.focus()
    onChange(selectedIds.filter((selectedId) => selectedId !== itemId))
  }

  const handleConnect = (itemId: string) => {
    onChange([...selectedIds, itemId])
    setShowConnectModal(false)
    setSearchQuery('')
  }

  return (
    <FieldRoot data-slot="relationship-manager" className={classNames?.root}>
      <FieldLabel
        id={fieldLabelId(id)}
        htmlFor={id}
        required={required}
        className={classNames?.label}
      >
        {label}
      </FieldLabel>

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
                      aria-label={`Remove ${item.label}`}
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

      <div
        data-slot="relationship-manager-actions"
        className={cn('flex gap-2', classNames?.actions)}
      >
        <Combobox open={showConnectModal} onOpenChange={setShowConnectModal}>
          <ComboboxTrigger
            ref={connectTriggerRef}
            id={id}
            disabled={disabled || isLoading}
            className={cn('h-9 px-3', classNames?.connectButton)}
            aria-labelledby={`${fieldLabelId(id)} ${fieldValueId(id)}`}
            {...describeField(id, { error, helpText })}
          >
            <span id={fieldValueId(id)}>{isLoading ? 'Loading...' : 'Connect Existing'}</span>
          </ComboboxTrigger>
          <ComboboxContent aria-label={label}>
            <ComboboxSearch
              aria-label={`Search ${label}`}
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <ComboboxEmpty>
              {isSearching
                ? 'Searching...'
                : availableItems.length === 0
                  ? 'No results found'
                  : null}
            </ComboboxEmpty>
            <ComboboxList aria-label={label}>
              {!isSearching &&
                availableItems.map((item) => (
                  <ComboboxItem key={item.id} onClick={() => handleConnect(item.id)}>
                    {item.label}
                  </ComboboxItem>
                ))}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>

      {helpText && (
        <FieldHelp id={fieldHelpId(id)} className="mt-2">
          {helpText}
        </FieldHelp>
      )}
      {error && (
        <FieldError id={fieldErrorId(id)} className={cn('mt-2', classNames?.error)}>
          {error}
        </FieldError>
      )}
    </FieldRoot>
  )
}
