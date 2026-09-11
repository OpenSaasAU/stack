'use client'

import * as React from 'react'
import { parseCalendarDay } from '../../lib/calendarDay.js'
import type { CellComponentProps } from './registry.js'

/**
 * Renders a `calendarDay()` value in the list table. Unlike {@link TimestampCell}
 * this shows a date alone — and resolves it through the local-time components
 * (`lib/calendarDay.ts`), so the day shown is the day stored regardless of the
 * viewer's timezone.
 */
export function CalendarDayCell({ value }: CellComponentProps) {
  const date = parseCalendarDay(value)
  if (date === null) {
    return (
      <span data-slot="cell-calendar-day" className="text-muted-foreground">
        -
      </span>
    )
  }
  return <span data-slot="cell-calendar-day">{date.toLocaleDateString()}</span>
}
