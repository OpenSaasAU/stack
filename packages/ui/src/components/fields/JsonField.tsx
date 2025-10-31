'use client'

import { useState, useMemo } from 'react'
import { Textarea } from '../../primitives/textarea.js'
import { Label } from '../../primitives/label.js'
import { cn } from '../../lib/utils.js'

export interface JsonFieldProps {
  name: string
  value: unknown
  onChange: (value: unknown) => void
  label: string
  placeholder?: string
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
  rows?: number
  formatted?: boolean
}

export function JsonField({
  name,
  value,
  onChange,
  label,
  placeholder = 'Enter JSON data...',
  error,
  disabled,
  required,
  mode = 'edit',
  rows = 8,
  formatted = true,
}: JsonFieldProps) {
  // Track the string being edited separately from the prop value
  const [editingValue, setEditingValue] = useState<string | null>(null)
  const [parseError, setParseError] = useState<string | undefined>()

  // Compute the display value - either what's being edited or the prop value
  const displayValue = useMemo(() => {
    if (editingValue !== null) {
      return editingValue
    }
    try {
      return value !== undefined && value !== null
        ? JSON.stringify(value, null, formatted ? 2 : 0)
        : ''
    } catch {
      return ''
    }
  }, [value, formatted, editingValue])

  const handleChange = (text: string) => {
    setEditingValue(text)

    // Try to parse and update value
    if (text.trim() === '') {
      // Empty string - treat as null/undefined
      onChange(undefined)
      setParseError(undefined)
      return
    }

    try {
      const parsed = JSON.parse(text)
      onChange(parsed)
      setParseError(undefined)
    } catch (e) {
      // Invalid JSON - set error but don't update value
      if (e instanceof Error) {
        setParseError(`Invalid JSON: ${e.message}`)
      } else {
        setParseError('Invalid JSON')
      }
    }
  }

  const handleBlur = () => {
    // Clear editing state on blur
    setEditingValue(null)
  }

  if (mode === 'read') {
    return (
      <div className="space-y-1">
        <Label className="text-muted-foreground">{label}</Label>
        <pre className="text-sm bg-muted rounded-md p-3 overflow-x-auto">{displayValue || '-'}</pre>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={name}>
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      <Textarea
        id={name}
        name={name}
        value={displayValue}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        rows={rows}
        className={cn('font-mono text-sm', (error || parseError) && 'border-destructive')}
      />
      {parseError && <p className="text-sm text-amber-600">{parseError}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
