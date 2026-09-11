/**
 * Conversions between a `calendarDay()` value and a `Date` the calendar
 * primitives can render.
 *
 * A `calendarDay()` value crosses the wire as a `YYYY-MM-DD` string in both
 * directions (`formatCalendarDay` in `packages/core/src/fields/index.ts`) — it
 * names a day, not an instant. `new Date('2026-09-11')` reads that string as
 * **UTC** midnight, which renders as the 10th anywhere west of Greenwich, and
 * `Date.prototype.toISOString()` shifts it back the other way. Both directions
 * therefore go through the local-time components here, never through ISO
 * parsing or serialisation.
 */

const CALENDAR_DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/

/**
 * Narrow a field value to the local-midnight `Date` for that calendar day, or
 * `null` when it is absent or not a `YYYY-MM-DD` string.
 */
export function parseCalendarDay(value: unknown): Date | null {
  if (typeof value !== 'string') return null

  const match = CALENDAR_DAY_PATTERN.exec(value)
  if (!match) return null

  const [, year, month, day] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day))

  // Rejects a well-formed but non-existent day (e.g. 2026-02-31, which the
  // Date constructor would silently roll forward into March).
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return null
  }

  return date
}

/** Format a `Date` as the `YYYY-MM-DD` string the field writes back. */
export function toCalendarDay(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
