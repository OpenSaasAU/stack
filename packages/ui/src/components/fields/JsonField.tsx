'use client'

import { useMemo, useRef } from 'react'
import { Textarea } from '../../primitives/textarea.js'
import { cn } from '../../lib/utils.js'
import { FieldRoot, FieldLabel, FieldHelp, FieldError, FieldWarning } from './field-shell.js'
import { useFieldDraft } from './useFieldDraft.js'

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
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const committedText = useMemo(() => {
    try {
      return value !== undefined && value !== null
        ? JSON.stringify(value, null, formatted ? 2 : 0)
        : ''
    } catch {
      return ''
    }
  }, [value, formatted])

  const {
    text: displayValue,
    parseError,
    setDraftText,
    endEditing,
  } = useFieldDraft({ name, mode, committedText, focusTarget: textareaRef })

  const handleChange = (text: string) => {
    if (text.trim() === '') {
      setDraftText(text)
      onChange(undefined)
      return
    }

    try {
      const parsed = JSON.parse(text)
      setDraftText(text)
      onChange(parsed)
    } catch (e) {
      // Invalid JSON: leave the last valid value uncommitted instead of clobbering it.
      setDraftText(text, e instanceof Error ? `Invalid JSON: ${e.message}` : 'Invalid JSON')
    }
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
        ref={textareaRef}
        id={name}
        name={name}
        value={displayValue}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={endEditing}
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
