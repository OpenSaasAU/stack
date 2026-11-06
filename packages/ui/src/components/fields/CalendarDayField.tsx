'use client'

import { format } from 'date-fns'
import { DatePicker } from '../../primitives/date-picker.js'
import { parseCalendarDay, toCalendarDay } from '../../lib/calendarDay.js'
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

export interface CalendarDayFieldProps {
  name: string
  /** The control's DOM id. `FieldRenderer` supplies one unique to the form. Defaults to `name`. */
  id?: string
  /** `YYYY-MM-DD`, the wire format of a `calendarDay()` value in both directions. */
  value: string | null
  onChange: (value: string | null) => void
  label: string
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
  helpText?: string
  placeholder?: string
}

export function CalendarDayField({
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
  placeholder,
}: CalendarDayFieldProps) {
  // A calendar day is a day, not an instant — see `lib/calendarDay.ts` for why
  // neither direction may go through ISO parsing or `toISOString()`.
  const dateValue = parseCalendarDay(value)

  if (mode === 'read') {
    return (
      <FieldRoot mode="read">
        <FieldLabel muted>{label}</FieldLabel>
        <FieldReadValue>{dateValue ? format(dateValue, 'PP') : '-'}</FieldReadValue>
      </FieldRoot>
    )
  }

  return (
    <FieldRoot>
      <FieldLabel id={fieldLabelId(id)} htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <DatePicker
        id={id}
        labelId={fieldLabelId(id)}
        label={label}
        value={dateValue}
        onChange={(date) => onChange(date ? toCalendarDay(date) : null)}
        disabled={disabled}
        placeholder={placeholder}
        {...describeField(id, { error, helpText })}
      />
      {helpText && <FieldHelp id={fieldHelpId(id)}>{helpText}</FieldHelp>}
      {error && <FieldError id={fieldErrorId(id)}>{error}</FieldError>}
    </FieldRoot>
  )
}
