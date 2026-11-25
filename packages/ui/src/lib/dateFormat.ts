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

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatDateTimeUtc(date: Date): string {
  const hours = date.getUTCHours()
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}, ${hour12}:${pad(date.getUTCMinutes())} ${hours < 12 ? 'AM' : 'PM'}`
}

const ZONELESS_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+$/

export function parseTimestamp(value: unknown): Date | null {
  let date: Date
  if (value instanceof Date) date = value
  else if (typeof value === 'number') date = new Date(value)
  else if (typeof value === 'string') {
    date = new Date(ZONELESS_TIMESTAMP.test(value) ? `${value}Z` : value)
  } else return null
  return Number.isNaN(date.getTime()) ? null : date
}

function subscribeNever(): () => void {
  return () => {}
}

export function useFormattedDateTime(date: Date | null): string | null {
  const mounted = React.useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  )
  if (date === null) return null
  return mounted ? formatDateTime(date) : formatDateTimeUtc(date)
}
