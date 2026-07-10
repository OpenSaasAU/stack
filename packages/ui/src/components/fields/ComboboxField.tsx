'use client'

import * as React from 'react'
import { useState } from 'react'
import {
  Combobox,
  ComboboxTrigger,
  ComboboxContent,
  ComboboxSearch,
  ComboboxList,
  ComboboxEmpty,
  ComboboxItem,
} from '../../primitives/combobox.js'
import { useRelationshipSearch } from '../../lib/useRelationshipSearch.js'
import type { ServerActionInput } from '../../server/types.js'

export interface ComboboxFieldProps {
  name: string
  value: string | null
  onChange: (value: string | null) => void
  label: string
  items: Array<{ id: string; label: string }>
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
  isLoading?: boolean
  placeholder?: string
  /** Raw list key of the list being edited — required (with `serverAction`) to live-search. */
  listKey?: string
  /** Generic server action used to resolve `relationshipOptions`. */
  serverAction?: (input: ServerActionInput) => Promise<unknown>
  /** Debounce delay (ms) before a typed query issues a server search. @default 300 */
  debounceMs?: number
}

export function ComboboxField({
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
  placeholder = 'Select...',
  listKey,
  serverAction,
  debounceMs = 300,
}: ComboboxFieldProps) {
  const [open, setOpen] = useState(false)
  const { searchQuery, setSearchQuery, searchResults, isSearching, resolveLabel } =
    useRelationshipSearch({
      initialItems: items,
      listKey,
      fieldName: name,
      serverAction,
      selectedIds: value ? [value] : [],
      debounceMs,
    })

  const selectedLabel = value
    ? (resolveLabel(value) ?? items.find((item) => item.id === value)?.label)
    : undefined

  // Read mode
  if (mode === 'read') {
    return (
      <div className="space-y-1">
        <label className="text-sm font-medium text-muted-foreground">{label}</label>
        <p className="text-sm">{selectedLabel || '-'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </label>
      <Combobox open={open} onOpenChange={setOpen}>
        <ComboboxTrigger disabled={disabled || isLoading}>
          <span className={!selectedLabel ? 'text-muted-foreground' : ''}>
            {isLoading ? 'Loading...' : selectedLabel || placeholder}
          </span>
        </ComboboxTrigger>
        <ComboboxContent>
          <ComboboxSearch
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              // Prevent form submission on Enter
              if (e.key === 'Enter') {
                e.preventDefault()
              }
            }}
          />
          <ComboboxList>
            {isSearching ? (
              <ComboboxEmpty>Searching...</ComboboxEmpty>
            ) : searchResults.length === 0 ? (
              <ComboboxEmpty />
            ) : (
              <>
                {!required && value && (
                  <>
                    <ComboboxItem
                      onClick={() => {
                        onChange(null)
                        setOpen(false)
                        setSearchQuery('')
                      }}
                    >
                      <span className="text-muted-foreground italic">Clear selection</span>
                    </ComboboxItem>
                    <div className="-mx-1 my-1 h-px bg-border" />
                  </>
                )}
                {searchResults.map((item) => (
                  <ComboboxItem
                    key={item.id}
                    selected={item.id === value}
                    onClick={() => {
                      onChange(item.id)
                      setOpen(false)
                      setSearchQuery('')
                    }}
                  >
                    {item.label}
                  </ComboboxItem>
                ))}
              </>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
