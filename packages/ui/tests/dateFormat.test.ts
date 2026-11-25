import { describe, it, expect } from 'vitest'
import {
  formatDate,
  formatDateTime,
  formatDateTimeUtc,
  parseTimestamp,
} from '../src/lib/dateFormat.js'

describe('dateFormat', () => {
  it('formats one way regardless of locale', () => {
    const d = new Date(2026, 3, 11, 15, 5)
    expect(formatDate(d)).toBe('11/04/2026')
    expect(formatDateTime(d)).toBe('11/04/2026, 3:05 PM')
  })

  it('formats UTC components without going through local time', () => {
    expect(formatDateTimeUtc(new Date('2024-06-10T02:30:00.123Z'))).toBe('10/06/2024, 2:30 AM')
    expect(formatDateTimeUtc(new Date('2024-06-10T00:05:00Z'))).toBe('10/06/2024, 12:05 AM')
    expect(formatDateTimeUtc(new Date('2024-06-10T12:00:00Z'))).toBe('10/06/2024, 12:00 PM')
  })

  it('reads zoneless timestamp strings as UTC and leaves explicit offsets alone', () => {
    expect(parseTimestamp('2024-06-10T02:30:00.123')?.toISOString()).toBe(
      '2024-06-10T02:30:00.123Z',
    )
    expect(parseTimestamp('2024-06-10T02:30:00+10:00')?.toISOString()).toBe(
      '2024-06-09T16:30:00.000Z',
    )
    expect(parseTimestamp(0)?.toISOString()).toBe('1970-01-01T00:00:00.000Z')
    expect(parseTimestamp('nope')).toBeNull()
  })
})
