'use client'

import { Checkbox } from '../../primitives/checkbox.js'
import { Label } from '../../primitives/label.js'

export interface CheckboxFieldProps {
  name: string
  value: boolean
  onChange: (value: boolean) => void
  label: string
  error?: string
  disabled?: boolean
  mode?: 'read' | 'edit'
}

export function CheckboxField({
  name,
  value,
  onChange,
  label,
  error,
  disabled,
  mode = 'edit',
}: CheckboxFieldProps) {
  if (mode === 'read') {
    return (
      <div className="space-y-1">
        <Label className="text-muted-foreground">{label}</Label>
        <p className="text-sm">{value ? 'Yes' : 'No'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center space-x-2">
        <Checkbox
          id={name}
          name={name}
          checked={value || false}
          onCheckedChange={(checked) => onChange(checked === true)}
          disabled={disabled}
        />
        <Label
          htmlFor={name}
          className="leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
        >
          {label}
        </Label>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
