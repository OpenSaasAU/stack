'use client'

import { DateTimePicker } from '../../primitives/datetime-picker.js'
import { format } from 'date-fns'
import { FieldRoot, FieldLabel, FieldHelp, FieldError, FieldReadValue } from './field-shell.js'

export interface TimestampFieldProps {
  name: string
  value: Date | string | null
  onChange: (value: Date | null) => void
  label: string
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
  helpText?: string
}

export function TimestampField({
  name,
  value,
  onChange,
  label,
  error,
  disabled,
  required,
  mode = 'edit',
  helpText,
}: TimestampFieldProps) {
  const dateValue = value ? new Date(value) : null

  if (mode === 'read') {
    return (
      <FieldRoot mode="read">
        <FieldLabel muted>{label}</FieldLabel>
        <FieldReadValue>{dateValue ? format(dateValue, 'PPpp') : '-'}</FieldReadValue>
      </FieldRoot>
    )
  }

  return (
    <FieldRoot>
      <FieldLabel htmlFor={name} required={required}>
        {label}
      </FieldLabel>
      <DateTimePicker value={dateValue} onChange={onChange} disabled={disabled} />
      {helpText && <FieldHelp>{helpText}</FieldHelp>}
      {error && <FieldError>{error}</FieldError>}
    </FieldRoot>
  )
}
