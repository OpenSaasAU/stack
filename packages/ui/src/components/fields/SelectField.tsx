'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../primitives/select.js'
import { cn } from '../../lib/utils.js'
import { FieldRoot, FieldLabel, FieldHelp, FieldError, FieldReadValue } from './field-shell.js'

export interface SelectFieldProps {
  name: string
  value: string | null
  onChange: (value: string | null) => void
  label: string
  options: Array<{ label: string; value: string }>
  error?: string
  disabled?: boolean
  required?: boolean
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
      <Select
        value={value || undefined}
        onValueChange={(val) => onChange(val || null)}
        disabled={disabled}
        required={required}
      >
        <SelectTrigger id={name} className={cn(error && 'border-destructive')}>
          <SelectValue placeholder="Select an option..." />
        </SelectTrigger>
        <SelectContent>
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
