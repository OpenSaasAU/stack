'use client'

import * as React from 'react'
import { format } from 'date-fns'
import { cn } from '../lib/utils.js'
import { Button } from './button.js'
import { Popover, PopoverContent, PopoverTrigger } from './popover.js'
import { Calendar } from './calendar.js'
import { TimePicker } from './time-picker.js'

export interface DateTimePickerProps {
  value?: Date | null
  onChange?: (date: Date | null) => void
  disabled?: boolean
  className?: string
  placeholder?: string
}

export function DateTimePicker({
  value,
  onChange,
  disabled,
  className,
  placeholder = 'Pick a date and time',
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false)
  const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(value || undefined)

  const handleDateSelect = (date: Date) => {
    // Preserve time if we already have a selected date
    if (selectedDate) {
      date.setHours(selectedDate.getHours())
      date.setMinutes(selectedDate.getMinutes())
    }
    setSelectedDate(date)
  }

  const handleTimeChange = (date: Date) => {
    setSelectedDate(date)
  }

  const handleConfirm = () => {
    if (onChange) {
      onChange(selectedDate || null)
    }
    setOpen(false)
  }

  const handleCancel = () => {
    setSelectedDate(value || undefined)
    setOpen(false)
  }

  const handleClear = () => {
    setSelectedDate(undefined)
    if (onChange) {
      onChange(null)
    }
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
          {value ? format(value, 'dd/MM/yyyy, h:mm a') : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="p-4 space-y-4">
          <Calendar selected={selectedDate} onSelect={handleDateSelect} disabled={disabled} />

          <div className="border-t pt-4">
            <div className="text-sm font-medium mb-2">Time</div>
            <TimePicker value={selectedDate} onChange={handleTimeChange} disabled={disabled} />
          </div>

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
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              disabled={disabled}
              type="button"
              className="flex-1"
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleConfirm} disabled={disabled} type="button" className="flex-1">
              Confirm
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
