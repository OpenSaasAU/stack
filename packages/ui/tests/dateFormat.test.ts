import { describe, it, expect } from 'vitest'
import { formatDate, formatDateTime } from '../src/lib/dateFormat.js'

describe('dateFormat', () => {
  it('formats one way regardless of locale', () => {
    const d = new Date(2026, 3, 11, 15, 5)
    expect(formatDate(d)).toBe('11/04/2026')
    expect(formatDateTime(d)).toBe('11/04/2026, 3:05 PM')
  })
})
