import {
  parseFilterQuery,
  serializeFilterQuery,
  type FilterFieldSuggestion,
  type FilterTerm,
  type FilterToken,
  type FilterValue,
} from '@opensaas/stack-core/client-safe'

const PLAIN_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

function offsetMinutesAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant))
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value)
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  )
  return Math.round((wall - Math.floor(instant / 1000) * 1000) / 60_000)
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+'
  const absolute = Math.abs(minutes)
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0')
  return `${sign}${hours}:${String(absolute % 60).padStart(2, '0')}`
}

export function zonedDayBoundary(day: string, timeZone: string, end: boolean): string | null {
  const match = PLAIN_DAY.exec(day)
  if (!match || !isTimeZone(timeZone)) return null
  const [, year, month, date] = match
  const wall = end
    ? Date.UTC(Number(year), Number(month) - 1, Number(date), 23, 59, 59, 999)
    : Date.UTC(Number(year), Number(month) - 1, Number(date))
  const firstGuess = wall - offsetMinutesAt(wall, timeZone) * 60_000
  const offset = offsetMinutesAt(firstGuess, timeZone)
  const time = end ? '23:59:59.999' : '00:00:00.000'
  return `${day}T${time}${formatOffset(offset)}`
}

function bound(value: FilterValue, timeZone: string, end: boolean): FilterValue | null {
  if (value.quoted) return null
  const text = zonedDayBoundary(value.text.trim(), timeZone, end)
  return text === null ? null : { text, quoted: false }
}

function localiseToken(
  token: FilterToken,
  fields: ReadonlyMap<string, FilterFieldSuggestion>,
  timeZone: string,
): FilterToken {
  const suggestion = token.field === null ? undefined : fields.get(token.field)
  if (suggestion?.datePicker !== 'instant') return token
  const [first, second] = token.values
  if (token.operator === 'range' && first && second) {
    const low = bound(first, timeZone, false) ?? first
    const high = bound(second, timeZone, true) ?? second
    return { ...token, values: [low, high] }
  }
  if (token.values.length !== 1 || !first) return token
  if (token.operator === 'eq') {
    const low = bound(first, timeZone, false)
    const high = bound(first, timeZone, true)
    return low && high ? { ...token, operator: 'range', values: [low, high] } : token
  }
  if (token.operator === 'empty') return token
  const end = token.operator === 'gt' || token.operator === 'lte'
  const value = bound(first, timeZone, end)
  return value ? { ...token, values: [value] } : token
}

/**
 * Rewrites the plain `YYYY-MM-DD` days on timestamp fields of a filter query
 * as that day in `timeZone`, written as offset instants, so a preset means
 * the viewer's local day rather than the UTC day a plain date otherwise means.
 */
export function localiseTimestampDays(
  query: string,
  fields: ReadonlyMap<string, FilterFieldSuggestion>,
  timeZone: string,
): string {
  if (!isTimeZone(timeZone)) return query
  let changed = false
  const terms = parseFilterQuery(query).terms.map((term): FilterTerm => {
    if (term.kind === 'group') {
      const tokens = term.tokens.map((token) => localiseToken(token, fields, timeZone))
      if (tokens.some((token, index) => token !== term.tokens[index])) changed = true
      return { ...term, tokens }
    }
    const token = localiseToken(term, fields, timeZone)
    if (token !== term) changed = true
    return token
  })
  return changed ? serializeFilterQuery({ terms }) : query
}
