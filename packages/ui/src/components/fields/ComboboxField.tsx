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
import { FieldRoot, FieldLabel, FieldHelp, FieldError, FieldReadValue } from './field-shell.js'

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
  helpText?: string
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
  helpText,
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
      <FieldRoot mode="read">
        <FieldLabel muted>{label}</FieldLabel>
        <FieldReadValue>{selectedLabel || '-'}</FieldReadValue>
      </FieldRoot>
    )
  }

  return (
    <FieldRoot>
      <FieldLabel htmlFor={name} required={required}>
        {label}
      </FieldLabel>
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
      {helpText && <FieldHelp>{helpText}</FieldHelp>}
      {error && <FieldError>{error}</FieldError>}
    </FieldRoot>
  )
}
