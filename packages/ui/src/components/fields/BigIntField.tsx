'use client'

import { useState, useMemo } from 'react'
import { Input } from '../../primitives/input.js'
import { cn } from '../../lib/utils.js'
import {
  FieldRoot,
  FieldLabel,
  FieldHelp,
  FieldError,
  FieldWarning,
  FieldReadValue,
} from './field-shell.js'

export interface BigIntFieldProps {
  name: string
  value: bigint | string | null
  onChange: (value: bigint | null) => void
  label: string
  placeholder?: string
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
  helpText?: string
}

const BIGINT_PATTERN = /^-?\d+$/

/**
 * Holds the raw text being typed in local state (like `JsonField`) rather
 * than converting on every keystroke (like `IntegerField`'s `parseInt`) —
 * `BigInt('-')` throws on an in-progress negative number, so a keystroke
 * that doesn't yet parse shows a warning and leaves the last valid value
 * uncommitted instead of clobbering it.
 */
export function BigIntField({
  name,
  value,
  onChange,
  label,
  placeholder,
  error,
  disabled,
  required,
  mode = 'edit',
  helpText,
}: BigIntFieldProps) {
  const [editingValue, setEditingValue] = useState<string | null>(null)
  const [parseError, setParseError] = useState<string | undefined>()

  const displayValue = useMemo(() => {
    if (editingValue !== null) return editingValue
    return value !== null && value !== undefined ? String(value) : ''
  }, [value, editingValue])

  if (mode === 'read') {
    return (
      <FieldRoot mode="read">
        <FieldLabel muted>{label}</FieldLabel>
        <FieldReadValue>
          {value !== null && value !== undefined ? String(value) : '-'}
        </FieldReadValue>
      </FieldRoot>
    )
  }

  const handleChange = (text: string) => {
    setEditingValue(text)

    const trimmed = text.trim()
    if (trimmed === '') {
      onChange(null)
      setParseError(undefined)
      return
    }

    if (!BIGINT_PATTERN.test(trimmed)) {
      setParseError(`${label} must be an integer`)
      return
    }

    onChange(BigInt(trimmed))
    setParseError(undefined)
  }

  const handleBlur = () => {
    setEditingValue(null)
  }

  return (
    <FieldRoot>
      <FieldLabel htmlFor={name} required={required}>
        {label}
      </FieldLabel>
      <Input
        id={name}
        name={name}
        type="text"
        inputMode="numeric"
        value={displayValue}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        className={cn('tabular-nums', (error || parseError) && 'border-destructive')}
      />
      {helpText && <FieldHelp>{helpText}</FieldHelp>}
      {parseError && <FieldWarning>{parseError}</FieldWarning>}
      {error && <FieldError>{error}</FieldError>}
    </FieldRoot>
  )
}
