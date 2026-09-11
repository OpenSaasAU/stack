'use client'

import { format } from 'date-fns'
import { DatePicker } from '../../primitives/date-picker.js'
import { parseCalendarDay, toCalendarDay } from '../../lib/calendarDay.js'
import { FieldRoot, FieldLabel, FieldHelp, FieldError, FieldReadValue } from './field-shell.js'

export interface CalendarDayFieldProps {
  name: string
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
      <FieldLabel htmlFor={name} required={required}>
        {label}
      </FieldLabel>
      <DatePicker
        value={dateValue}
        onChange={(date) => onChange(date ? toCalendarDay(date) : null)}
        disabled={disabled}
        placeholder={placeholder}
      />
      {helpText && <FieldHelp>{helpText}</FieldHelp>}
      {error && <FieldError>{error}</FieldError>}
    </FieldRoot>
  )
}
