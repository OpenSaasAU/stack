'use client'

import { Input } from '../../primitives/input.js'
import { Textarea } from '../../primitives/textarea.js'
import { cn } from '../../lib/utils.js'
import { FieldRoot, FieldLabel, FieldHelp, FieldError, FieldReadValue } from './field-shell.js'

interface TextFieldBaseProps {
  name: string
  value: string | null
  label: string
  placeholder?: string
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
  displayMode?: 'input' | 'textarea'
  helpText?: string
}

export type TextFieldProps = TextFieldBaseProps &
  (
    | { nullable?: false; onChange: (value: string) => void }
    | {
        /** The column accepts `NULL`: an emptied optional field stores `null`, not `''`. */
        nullable: true
        onChange: (value: string | null) => void
      }
  )

export function TextField({
  name,
  value,
  onChange,
  label,
  placeholder,
  error,
  disabled,
  required,
  nullable,
  mode = 'edit',
  displayMode = 'input',
  helpText,
}: TextFieldProps) {
  if (mode === 'read') {
    return (
      <FieldRoot mode="read">
        <FieldLabel muted>{label}</FieldLabel>
        <FieldReadValue>{value || '-'}</FieldReadValue>
      </FieldRoot>
    )
  }

  const InputComponent = displayMode === 'textarea' ? Textarea : Input

  const handleChange = (next: string) => {
    // A required field keeps `''`: that is the value `text()`'s validation
    // answers with "is required", where a null is only "must be text".
    if (nullable && !required && next === '') onChange(null)
    else onChange(next)
  }

  return (
    <FieldRoot>
      <FieldLabel htmlFor={name} required={required}>
        {label}
      </FieldLabel>
      <InputComponent
        id={name}
        name={name}
        type={displayMode === 'input' ? 'text' : undefined}
        value={value || ''}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        className={cn(error && 'border-destructive')}
      />
      {helpText && <FieldHelp>{helpText}</FieldHelp>}
      {error && <FieldError>{error}</FieldError>}
    </FieldRoot>
  )
}
