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
}: ComboboxFieldProps) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // Read mode
  if (mode === 'read') {
    const selectedItem = items.find((item) => item.id === value)
    return (
      <div className="space-y-1">
        <label className="text-sm font-medium text-muted-foreground">{label}</label>
        <p className="text-sm">{selectedItem?.label || '-'}</p>
      </div>
    )
  }

  // Filter items based on search query
  const filteredItems = searchQuery
    ? items.filter((item) =>
        item.label.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : items

  const selectedItem = items.find((item) => item.id === value)

  return (
    <div className="space-y-2">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </label>
      <Combobox open={open} onOpenChange={setOpen}>
        <ComboboxTrigger disabled={disabled || isLoading}>
          <span className={!selectedItem ? 'text-muted-foreground' : ''}>
            {isLoading
              ? 'Loading...'
              : selectedItem
                ? selectedItem.label
                : placeholder}
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
            {filteredItems.length === 0 ? (
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
                {filteredItems.map((item) => (
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
