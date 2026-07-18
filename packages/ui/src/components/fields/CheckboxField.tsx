'use client'

import { Checkbox } from '../../primitives/checkbox.js'
import { FieldRoot, FieldLabel, FieldHelp, FieldError, FieldReadValue } from './field-shell.js'

export interface CheckboxFieldProps {
  name: string
  value: boolean
  onChange: (value: boolean) => void
  label: string
  error?: string
  disabled?: boolean
  mode?: 'read' | 'edit'
  helpText?: string
}

export function CheckboxField({
  name,
  value,
  onChange,
  label,
  error,
  disabled,
  mode = 'edit',
  helpText,
}: CheckboxFieldProps) {
  if (mode === 'read') {
    return (
      <FieldRoot mode="read">
        <FieldLabel muted>{label}</FieldLabel>
        <FieldReadValue>{value ? 'Yes' : 'No'}</FieldReadValue>
      </FieldRoot>
    )
  }

  return (
    <FieldRoot>
      <div className="flex items-center space-x-2">
        <Checkbox
          id={name}
          name={name}
          checked={value || false}
          onCheckedChange={(checked) => onChange(checked === true)}
          disabled={disabled}
        />
        <FieldLabel htmlFor={name} className="leading-none">
          {label}
        </FieldLabel>
      </div>
      {helpText && <FieldHelp>{helpText}</FieldHelp>}
      {error && <FieldError>{error}</FieldError>}
    </FieldRoot>
  )
}
