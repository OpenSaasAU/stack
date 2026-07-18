'use client'

import { useState, useMemo } from 'react'
import { Textarea } from '../../primitives/textarea.js'
import { cn } from '../../lib/utils.js'
import { FieldRoot, FieldLabel, FieldHelp, FieldError, FieldWarning } from './field-shell.js'

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
  helpText?: string
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
  helpText,
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
      <FieldRoot mode="read">
        <FieldLabel muted>{label}</FieldLabel>
        <pre
          data-slot="field-value"
          className="text-sm bg-muted rounded-md p-3 overflow-x-auto font-mono"
        >
          {displayValue || '-'}
        </pre>
      </FieldRoot>
    )
  }

  return (
    <FieldRoot>
      <FieldLabel htmlFor={name} required={required}>
        {label}
      </FieldLabel>
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
      {helpText && <FieldHelp>{helpText}</FieldHelp>}
      {parseError && <FieldWarning>{parseError}</FieldWarning>}
      {error && <FieldError>{error}</FieldError>}
    </FieldRoot>
  )
}
