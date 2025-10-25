'use client'

import * as React from 'react'
import { cn } from '../lib/utils.js'
import { Input } from './input.js'

export interface TimePickerProps {
  value?: Date
  onChange?: (date: Date) => void
  disabled?: boolean
  className?: string
}

export function TimePicker({ value, onChange, disabled, className }: TimePickerProps) {
  const hours = value ? value.getHours() : 12
  const minutes = value ? value.getMinutes() : 30

  const handleHourChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newHours = parseInt(e.target.value) || 0
    const clampedHours = Math.max(0, Math.min(23, newHours))

    if (onChange) {
      const newDate = value ? new Date(value) : new Date()
      newDate.setHours(clampedHours)
      onChange(newDate)
    }
  }

  const handleMinuteChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newMinutes = parseInt(e.target.value) || 0
    const clampedMinutes = Math.max(0, Math.min(59, newMinutes))

    if (onChange) {
      const newDate = value ? new Date(value) : new Date()
      newDate.setMinutes(clampedMinutes)
      onChange(newDate)
    }
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="flex items-center">
        <Input
          type="number"
          min={0}
          max={23}
          value={hours.toString().padStart(2, '0')}
          onChange={handleHourChange}
          disabled={disabled}
          className="w-14 text-center"
        />
        <span className="mx-1 text-lg">:</span>
        <Input
          type="number"
          min={0}
          max={59}
          value={minutes.toString().padStart(2, '0')}
          onChange={handleMinuteChange}
          disabled={disabled}
          className="w-14 text-center"
        />
      </div>
    </div>
  )
}
