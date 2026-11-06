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

export interface DecimalFieldProps {
  name: string
  /** The control's DOM id. `FieldRenderer` supplies one unique to the form. Defaults to `name`. */
  id?: string
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

const DECIMAL_PATTERN = /^-?(\d+(\.\d+)?|\.\d+)$/

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
}: DecimalFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const {
    text: displayValue,
    parseError,
    setDraftText,
    endEditing,
  } = useFieldDraft({ name, mode, committedText: value ?? '', focusTarget: inputRef })

  if (mode === 'read') {
    return (
      <FieldRoot mode="read">
        <FieldLabel muted>{label}</FieldLabel>
        <FieldReadValue>{value ?? '-'}</FieldReadValue>
      </FieldRoot>
    )
  }

  const handleChange = (text: string) => {
    const trimmed = text.trim()
    if (trimmed !== '' && !DECIMAL_PATTERN.test(trimmed)) {
      setDraftText(text, `${label} must be a decimal value`)
      return
    }

    setDraftText(text)
    onChange(trimmed === '' ? null : trimmed)
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
        inputMode="decimal"
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
        <FieldError id={fieldErrorId(id)}>
          {[parseError, error].filter(Boolean).join(' ')}
        </FieldError>
      )}
    </FieldRoot>
  )
}
