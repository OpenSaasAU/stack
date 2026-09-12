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

export interface DecimalFieldProps {
  name: string
  value: string | null
  onChange: (value: string | null) => void
  label: string
  placeholder?: string
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
  helpText?: string
}

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/

/**
 * `decimal()`'s application value is already a plain numeric-text string on
 * both sides of the ORM (Prisma 8's `pg/numeric@1` codec is a branded
 * `string`, never a `decimal.js` `Decimal` instance), so there is nothing to
 * parse into and nothing for `jsonSafeClone` to special-case the way it does
 * for `bigInt()`'s `bigint`. This holds the raw text being typed in local
 * state (like `BigIntField`) rather than committing on every keystroke, since
 * an in-progress value like `-` or `1.` isn't canonical numeric text yet — a
 * keystroke that doesn't yet parse shows a warning and leaves the last valid
 * value uncommitted instead of clobbering it.
 */
export function DecimalField({
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
}: DecimalFieldProps) {
  const [editingValue, setEditingValue] = useState<string | null>(null)
  const [parseError, setParseError] = useState<string | undefined>()

  const displayValue = useMemo(() => {
    if (editingValue !== null) return editingValue
    return value ?? ''
  }, [value, editingValue])

  if (mode === 'read') {
    return (
      <FieldRoot mode="read">
        <FieldLabel muted>{label}</FieldLabel>
        <FieldReadValue>{value ?? '-'}</FieldReadValue>
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

    if (!DECIMAL_PATTERN.test(trimmed)) {
      setParseError(`${label} must be a decimal value`)
      return
    }

    onChange(trimmed)
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
        inputMode="decimal"
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
