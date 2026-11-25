import * as React from 'react'
import { format } from 'date-fns'

export const DATE_PATTERN = 'dd/MM/yyyy'
export const DATE_TIME_PATTERN = 'dd/MM/yyyy, h:mm a'

export function formatDate(date: Date): string {
  return format(date, DATE_PATTERN)
}

export function formatDateTime(date: Date): string {
  return format(date, DATE_TIME_PATTERN)
}

function toUtcWallClock(date: Date): Date {
  return new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  )
}

export function useFormattedDateTime(date: Date | null): string | null {
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  if (date === null) return null
  return formatDateTime(mounted ? date : toUtcWallClock(date))
}
