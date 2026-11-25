'use client'

import { DateTimePicker } from '../../primitives/datetime-picker.js'
import { parseTimestamp, useFormattedDateTime } from '../../lib/dateFormat.js'
import {
  FieldRoot,
  FieldLabel,
  FieldHelp,
  FieldError,
  FieldReadValue,
  describeField,
  fieldErrorId,
  fieldHelpId,
  fieldLabelId,
} from './field-shell.js'

export interface TimestampFieldProps {
  name: string
  /** The control's DOM id. `FieldRenderer` supplies one unique to the form. Defaults to `name`. */
  id?: string
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
  id = name,
  value,
  onChange,
  label,
  error,
  disabled,
  required,
  mode = 'edit',
  helpText,
}: TimestampFieldProps) {
  const dateValue = value ? parseTimestamp(value) : null
  const valueText = useFormattedDateTime(dateValue)

  if (mode === 'read') {
    return (
      <FieldRoot mode="read">
        <FieldLabel muted>{label}</FieldLabel>
        <FieldReadValue>{valueText ?? '-'}</FieldReadValue>
      </FieldRoot>
    )
  }

  return (
    <FieldRoot>
      <FieldLabel id={fieldLabelId(id)} htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <DateTimePicker
        id={id}
        labelId={fieldLabelId(id)}
        label={label}
        value={dateValue}
        onChange={onChange}
        disabled={disabled}
        {...describeField(id, { error, helpText })}
      />
      {helpText && <FieldHelp id={fieldHelpId(id)}>{helpText}</FieldHelp>}
      {error && <FieldError id={fieldErrorId(id)}>{error}</FieldError>}
    </FieldRoot>
  )
}
