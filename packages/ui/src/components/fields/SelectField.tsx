'use client'

import { useRef } from 'react'
import { Button } from '../../primitives/button.js'
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
  /** The column accepts `NULL`, so an optional field offers a Clear button. */
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
  const triggerRef = useRef<HTMLButtonElement>(null)

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
      <div className="flex items-center gap-2">
        {/* Radix treats `undefined` as uncontrolled and would show the value last picked from empty. */}
        <Select
          value={value ?? ''}
          onValueChange={(val) => onChange(val || null)}
          disabled={disabled}
          required={required}
        >
          <SelectTrigger ref={triggerRef} id={name} className={cn(error && 'border-destructive')}>
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
        {/* Not a list item: Radix's typeahead on the closed trigger would reach it, so one keypress could clear the value. */}
        {nullable && !required && value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Clear ${label}`}
            disabled={disabled}
            onClick={() => {
              triggerRef.current?.focus()
              onChange(null)
            }}
          >
            Clear
          </Button>
        )}
      </div>
      {helpText && <FieldHelp>{helpText}</FieldHelp>}
      {error && <FieldError>{error}</FieldError>}
    </FieldRoot>
  )
}
