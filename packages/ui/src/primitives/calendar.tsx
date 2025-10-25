'use client'

import * as React from 'react'
import { format, addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, isSameMonth, isSameDay, isToday } from 'date-fns'
import { cn } from '../lib/utils.js'
import { Button } from './button.js'

export interface CalendarProps {
  selected?: Date
  onSelect?: (date: Date) => void
  disabled?: boolean
  mode?: 'single'
  className?: string
}

export function Calendar({ selected, onSelect, disabled, className }: CalendarProps) {
  const [currentMonth, setCurrentMonth] = React.useState(selected || new Date())

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(monthStart)
  const startDate = startOfWeek(monthStart)
  const endDate = endOfWeek(monthEnd)

  const handlePrevMonth = () => {
    setCurrentMonth(subMonths(currentMonth, 1))
  }

  const handleNextMonth = () => {
    setCurrentMonth(addMonths(currentMonth, 1))
  }

  const handleToday = () => {
    const today = new Date()
    setCurrentMonth(today)
    if (onSelect) {
      onSelect(today)
    }
  }

  const rows: Date[][] = []
  let days: Date[] = []
  let day = startDate

  while (day <= endDate) {
    for (let i = 0; i < 7; i++) {
      days.push(day)
      day = addDays(day, 1)
    }
    rows.push(days)
    days = []
  }

  return (
    <div className={cn('p-3', className)}>
      <div className="flex items-center justify-between mb-4">
        <Button
          variant="outline"
          size="icon"
          onClick={handlePrevMonth}
          disabled={disabled}
          type="button"
          className="h-8 w-8"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Button>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{format(currentMonth, 'MMMM yyyy')}</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToday}
            disabled={disabled}
            type="button"
            className="h-7 text-xs"
          >
            Today
          </Button>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={handleNextMonth}
          disabled={disabled}
          type="button"
          className="h-8 w-8"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Button>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr>
            {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((day) => (
              <th key={day} className="text-muted-foreground text-xs font-normal h-9 w-9 p-0">
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((week, weekIdx) => (
            <tr key={weekIdx}>
              {week.map((day, dayIdx) => {
                const isSelected = selected && isSameDay(day, selected)
                const isCurrentMonth = isSameMonth(day, currentMonth)
                const isDayToday = isToday(day)

                return (
                  <td key={dayIdx} className="p-0 text-center">
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() => {
                        if (onSelect && !disabled) {
                          onSelect(day)
                        }
                      }}
                      disabled={disabled}
                      className={cn(
                        'h-9 w-9 p-0 font-normal hover:bg-accent',
                        !isCurrentMonth && 'text-muted-foreground opacity-50',
                        isSelected && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
                        isDayToday && !isSelected && 'bg-accent',
                      )}
                    >
                      {format(day, 'd')}
                    </Button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
