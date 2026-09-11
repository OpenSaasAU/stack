'use client'

import * as React from 'react'
import { format } from 'date-fns'
import { cn } from '../lib/utils.js'
import { Button } from './button.js'
import { Popover, PopoverContent, PopoverTrigger } from './popover.js'
import { Calendar } from './calendar.js'

export interface DatePickerProps {
  value?: Date | null
  onChange?: (date: Date | null) => void
  disabled?: boolean
  className?: string
  placeholder?: string
}

/**
 * Date-only counterpart to {@link DateTimePicker}. Picking a day is the whole
 * of the interaction, so a selection commits and closes immediately rather
 * than waiting on a Confirm the way the date *and time* picker must.
 */
export function DatePicker({
  value,
  onChange,
  disabled,
  className,
  placeholder = 'Pick a date',
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)

  const handleSelect = (date: Date) => {
    onChange?.(date)
    setOpen(false)
  }

  const handleClear = () => {
    onChange?.(null)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          type="button"
          disabled={disabled}
          className={cn(
            'w-full justify-start text-left font-normal',
            !value && 'text-muted-foreground',
            className,
          )}
        >
          <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          {value ? format(value, 'dd/MM/yyyy') : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div data-slot="date-picker" className="p-4 space-y-4">
          <Calendar selected={value || undefined} onSelect={handleSelect} disabled={disabled} />

          <div className="flex gap-2 border-t pt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={handleClear}
              disabled={disabled}
              type="button"
              className="flex-1"
            >
              Clear
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
