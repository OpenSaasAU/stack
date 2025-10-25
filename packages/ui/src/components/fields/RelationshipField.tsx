'use client'

import { ComboboxField } from './ComboboxField.js'
import { RelationshipManager } from './RelationshipManager.js'

export interface RelationshipFieldProps {
  name: string
  value: string | string[] | null
  onChange: (value: string | string[] | null) => void
  label: string
  items: Array<{ id: string; label: string }>
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
  isLoading?: boolean
  many?: boolean
  relatedListKey?: string
  basePath?: string
}

export function RelationshipField({
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
  many = false,
  relatedListKey,
  basePath,
}: RelationshipFieldProps) {
  // Delegate to specialized components based on cardinality
  if (many) {
    return (
      <RelationshipManager
        name={name}
        value={Array.isArray(value) ? value : []}
        onChange={onChange}
        label={label}
        items={items}
        error={error}
        disabled={disabled}
        required={required}
        mode={mode}
        isLoading={isLoading}
        relatedListKey={relatedListKey}
        basePath={basePath}
      />
    )
  }

  return (
    <ComboboxField
      name={name}
      value={typeof value === 'string' ? value : null}
      onChange={onChange}
      label={label}
      items={items}
      error={error}
      disabled={disabled}
      required={required}
      mode={mode}
      isLoading={isLoading}
    />
  )
}
