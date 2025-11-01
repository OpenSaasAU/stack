'use client'

import { useState, useMemo } from 'react'
import { Label } from '@opensaas/stack-ui/primitives'
import { Button } from '@opensaas/stack-ui/primitives'
import { Input } from '@opensaas/stack-ui/primitives'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@opensaas/stack-ui/primitives'
import { cn } from '@opensaas/stack-ui/lib/utils'

interface TaxonomyItem {
  type: 'tag' | 'category'
  name: string
  value: string
}

export interface TaxonomyFieldProps {
  name: string
  value: unknown
  onChange: (value: unknown) => void
  label: string
  placeholder?: string
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
}

export function TaxonomyField({
  name,
  value,
  onChange,
  label,
  error,
  disabled,
  required,
  mode = 'edit',
}: TaxonomyFieldProps) {
  // Parse the value as an array of taxonomy items
  const items = useMemo<TaxonomyItem[]>(() => {
    if (!value) return []
    try {
      const parsed = Array.isArray(value) ? value : []
      return parsed.filter(
        (item): item is TaxonomyItem =>
          typeof item === 'object' &&
          item !== null &&
          'type' in item &&
          'name' in item &&
          'value' in item &&
          (item.type === 'tag' || item.type === 'category'),
      )
    } catch {
      return []
    }
  }, [value])

  // Form state for new item
  const [newType, setNewType] = useState<'tag' | 'category'>('tag')
  const [newName, setNewName] = useState('')
  const [newValue, setNewValue] = useState('')

  const handleAdd = () => {
    if (!newName.trim() || !newValue.trim()) return

    const newItem: TaxonomyItem = {
      type: newType,
      name: newName.trim(),
      value: newValue.trim(),
    }

    const updatedItems = [...items, newItem]
    onChange(updatedItems)

    // Reset form
    setNewName('')
    setNewValue('')
  }

  const handleRemove = (index: number) => {
    const updatedItems = items.filter((_, i) => i !== index)
    onChange(updatedItems.length > 0 ? updatedItems : undefined)
  }

  if (mode === 'read') {
    return (
      <div className="space-y-2">
        <Label className="text-muted-foreground">{label}</Label>
        {items.length > 0 ? (
          <div className="space-y-2">
            {items.map((item, index) => (
              <div
                key={index}
                className="flex items-center gap-2 text-sm border rounded-md p-2 bg-muted/30"
              >
                <span
                  className={cn(
                    'px-2 py-0.5 rounded text-xs font-medium',
                    item.type === 'tag'
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                      : 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
                  )}
                >
                  {item.type}
                </span>
                <span className="font-medium">{item.name}:</span>
                <span className="text-muted-foreground">{item.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">-</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Label htmlFor={name}>
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>

      {/* Existing items */}
      {items.length > 0 && (
        <div className="space-y-2 border rounded-md p-3 bg-muted/10">
          <div className="text-xs font-medium text-muted-foreground mb-2">
            Current Items ({items.length})
          </div>
          {items.map((item, index) => (
            <div
              key={index}
              className="flex items-center gap-2 p-2 border rounded-md bg-background"
            >
              <span
                className={cn(
                  'px-2 py-0.5 rounded text-xs font-medium shrink-0',
                  item.type === 'tag'
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                    : 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
                )}
              >
                {item.type}
              </span>
              <span className="text-sm font-medium shrink-0">{item.name}:</span>
              <span className="text-sm text-muted-foreground flex-1">{item.value}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleRemove(index)}
                disabled={disabled}
                className="h-7 w-7 p-0 ml-2 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
              >
                ×
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Add new item form */}
      <div className="border rounded-md p-3 space-y-3 bg-muted/10">
        <div className="text-xs font-medium text-muted-foreground">Add New Item</div>

        <div className="grid grid-cols-3 gap-3">
          {/* Type selector */}
          <div className="space-y-1.5">
            <Label htmlFor={`${name}-type`} className="text-xs">
              Type
            </Label>
            <Select
              value={newType}
              onValueChange={(val) => setNewType(val as 'tag' | 'category')}
              disabled={disabled}
            >
              <SelectTrigger id={`${name}-type`} className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tag">Tag</SelectItem>
                <SelectItem value="category">Category</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Name input */}
          <div className="space-y-1.5">
            <Label htmlFor={`${name}-name`} className="text-xs">
              Name
            </Label>
            <Input
              id={`${name}-name`}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g., author"
              disabled={disabled}
              className="h-9"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAdd()
                }
              }}
            />
          </div>

          {/* Value input */}
          <div className="space-y-1.5">
            <Label htmlFor={`${name}-value`} className="text-xs">
              Value
            </Label>
            <Input
              id={`${name}-value`}
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="e.g., john-doe"
              disabled={disabled}
              className="h-9"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAdd()
                }
              }}
            />
          </div>
        </div>

        <Button
          type="button"
          onClick={handleAdd}
          disabled={disabled || !newName.trim() || !newValue.trim()}
          size="sm"
          className="w-full"
        >
          Add Item
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
