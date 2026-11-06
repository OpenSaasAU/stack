'use client'

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

export interface IntegerFieldProps {
  name: string
  /** The control's DOM id. `FieldRenderer` supplies one unique to the form. Defaults to `name`. */
  id?: string
  value: number | null
  onChange: (value: number | null) => void
  label: string
  placeholder?: string
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
  min?: number
  max?: number
  helpText?: string
}

export function IntegerField({
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
  min,
  max,
  helpText,
}: IntegerFieldProps) {
  if (mode === 'read') {
    return (
      <FieldRoot mode="read">
        <FieldLabel muted>{label}</FieldLabel>
        <FieldReadValue>{value !== null ? value : '-'}</FieldReadValue>
      </FieldRoot>
    )
  }

  return (
    <FieldRoot>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <Input
        id={id}
        name={name}
        type="number"
        value={value ?? ''}
        onChange={(e) => {
          const val = e.target.value
          onChange(val === '' ? null : parseInt(val, 10))
        }}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        min={min}
        max={max}
        className={cn('tabular-nums', error && 'border-destructive')}
        {...describeField(id, { error, helpText })}
      />
      {helpText && <FieldHelp id={fieldHelpId(id)}>{helpText}</FieldHelp>}
      {error && <FieldError id={fieldErrorId(id)}>{error}</FieldError>}
    </FieldRoot>
  )
}
