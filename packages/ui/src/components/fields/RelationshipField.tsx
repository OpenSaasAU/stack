'use client'

import { cn } from '../../lib/utils.js'

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
}: RelationshipFieldProps) {
  // Read mode
  if (mode === 'read') {
    if (many) {
      const selectedItems = items.filter((item) =>
        Array.isArray(value) ? value.includes(item.id) : false,
      )
      return (
        <div className="space-y-1">
          <label className="text-sm font-medium text-muted-foreground">{label}</label>
          <p className="text-sm">
            {selectedItems.length > 0 ? selectedItems.map((item) => item.label).join(', ') : '-'}
          </p>
        </div>
      )
    } else {
      const selectedItem = items.find((item) => item.id === value)
      return (
        <div className="space-y-1">
          <label className="text-sm font-medium text-muted-foreground">{label}</label>
          <p className="text-sm">{selectedItem?.label || '-'}</p>
        </div>
      )
    }
  }

  // Edit mode - many relationship
  if (many) {
    const selectedIds = Array.isArray(value) ? value : []

    const handleCheckboxChange = (itemId: string, checked: boolean) => {
      if (checked) {
        onChange([...selectedIds, itemId])
      } else {
        onChange(selectedIds.filter((id) => id !== itemId))
      }
    }

    return (
      <div className="space-y-2">
        <label className="text-sm font-medium">
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </label>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No items available</p>
        ) : (
          <div className="space-y-2 border border-input rounded-md p-3">
            {items.map((item) => (
              <div key={item.id} className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id={`${name}-${item.id}`}
                  checked={selectedIds.includes(item.id)}
                  onChange={(e) => handleCheckboxChange(item.id, e.target.checked)}
                  disabled={disabled}
                  className="h-4 w-4 rounded border-input"
                />
                <label htmlFor={`${name}-${item.id}`} className="text-sm cursor-pointer">
                  {item.label}
                </label>
              </div>
            ))}
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    )
  }

  // Edit mode - single relationship
  return (
    <div className="space-y-2">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </label>
      <select
        id={name}
        name={name}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled || isLoading}
        required={required}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
          'ring-offset-background',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          error && 'border-destructive',
        )}
      >
        <option value="">{isLoading ? 'Loading...' : 'Select...'}</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
