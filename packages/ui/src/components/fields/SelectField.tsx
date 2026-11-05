'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '../../primitives/select.js'
import { cn } from '../../lib/utils.js'
import { FieldRoot, FieldLabel, FieldHelp, FieldError, FieldReadValue } from './field-shell.js'

const CLEAR_SELECTION = '__opensaas_clear_selection__'

export interface SelectFieldProps {
  name: string
  value: string | null
  onChange: (value: string | null) => void
  label: string
  options: Array<{ label: string; value: string }>
  error?: string
  disabled?: boolean
  required?: boolean
  /** The column accepts `NULL`, so an optional field offers "Clear selection". */
  nullable?: boolean
  mode?: 'read' | 'edit'
  helpText?: string
}

export function SelectField({
  name,
  value,
  onChange,
  label,
  options,
  error,
  disabled,
  required,
  nullable,
  mode = 'edit',
  helpText,
}: SelectFieldProps) {
  if (mode === 'read') {
    const selectedOption = options.find((opt) => opt.value === value)
    return (
      <FieldRoot mode="read">
        <FieldLabel muted>{label}</FieldLabel>
        <FieldReadValue>{selectedOption?.label || '-'}</FieldReadValue>
      </FieldRoot>
    )
  }

  return (
    <FieldRoot>
      <FieldLabel htmlFor={name} required={required}>
        {label}
      </FieldLabel>
      {/* Radix treats `undefined` as uncontrolled and would show the value last picked from empty. */}
      <Select
        value={value ?? ''}
        onValueChange={(val) => onChange(val === CLEAR_SELECTION ? null : val || null)}
        disabled={disabled}
        required={required}
      >
        <SelectTrigger id={name} className={cn(error && 'border-destructive')}>
          <SelectValue placeholder="Select an option..." />
        </SelectTrigger>
        <SelectContent>
          {nullable && !required && value && (
            <>
              <SelectItem value={CLEAR_SELECTION}>
                <span className="text-muted-foreground italic">Clear selection</span>
              </SelectItem>
              <SelectSeparator />
            </>
          )}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {helpText && <FieldHelp>{helpText}</FieldHelp>}
      {error && <FieldError>{error}</FieldError>}
    </FieldRoot>
  )
}
