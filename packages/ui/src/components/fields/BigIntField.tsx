'use client'

import { useRef } from 'react'
import { Input } from '../../primitives/input.js'
import { cn } from '../../lib/utils.js'
import {
  FieldRoot,
  FieldLabel,
  FieldHelp,
  FieldError,
  FieldReadValue,
  describeField,
  fieldErrorId,
  fieldHelpId,
} from './field-shell.js'
import { useFieldDraft } from './useFieldDraft.js'

export interface BigIntFieldProps {
  name: string
  /** The control's DOM id. `FieldRenderer` supplies one unique to the form. Defaults to `name`. */
  id?: string
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
  id = name,
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
  const inputRef = useRef<HTMLInputElement>(null)
  const {
    text: displayValue,
    parseError,
    setDraftText,
    endEditing,
  } = useFieldDraft({
    name,
    mode,
    committedText: value !== null && value !== undefined ? String(value) : '',
    focusTarget: inputRef,
  })

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
    const trimmed = text.trim()
    if (trimmed !== '' && !BIGINT_PATTERN.test(trimmed)) {
      setDraftText(text, `${label} must be an integer`)
      return
    }

    setDraftText(text)
    onChange(trimmed === '' ? null : BigInt(trimmed))
  }

  return (
    <FieldRoot>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <Input
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        value={displayValue}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={endEditing}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        className={cn('tabular-nums', (error || parseError) && 'border-destructive')}
        {...describeField(id, { error: parseError || error, helpText })}
      />
      {helpText && <FieldHelp id={fieldHelpId(id)}>{helpText}</FieldHelp>}
      {(parseError || error) && (
        <FieldError id={fieldErrorId(id)}>{parseError || error}</FieldError>
      )}
    </FieldRoot>
  )
}
