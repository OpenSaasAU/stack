'use client'

import { Input } from '../../primitives/input.js'
import { Textarea } from '../../primitives/textarea.js'
import { cn } from '../../lib/utils.js'
import { FieldRoot, FieldLabel, FieldHelp, FieldError, FieldReadValue } from './field-shell.js'

export interface TextFieldProps {
  name: string
  value: string
  onChange: (value: string) => void
  label: string
  placeholder?: string
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
  displayMode?: 'input' | 'textarea'
  helpText?: string
}

export function TextField({
  name,
  value,
  onChange,
  label,
  placeholder,
  error,
  disabled,
  required,
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
        onChange={(e) => onChange(e.target.value)}
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
