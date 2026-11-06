'use client'

import { Checkbox } from '../../primitives/checkbox.js'
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

export interface CheckboxFieldProps {
  name: string
  /** The control's DOM id. `FieldRenderer` supplies one unique to the form. Defaults to `name`. */
  id?: string
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
  id = name,
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
          id={id}
          name={name}
          checked={value || false}
          onCheckedChange={(checked) => onChange(checked === true)}
          disabled={disabled}
          {...describeField(id, { error, helpText })}
        />
        <FieldLabel htmlFor={id} className="leading-none">
          {label}
        </FieldLabel>
      </div>
      {helpText && <FieldHelp id={fieldHelpId(id)}>{helpText}</FieldHelp>}
      {error && <FieldError id={fieldErrorId(id)}>{error}</FieldError>}
    </FieldRoot>
  )
}
