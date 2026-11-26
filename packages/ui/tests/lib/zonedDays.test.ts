import { describe, expect, it } from 'vitest'
import type { FilterFieldSuggestion } from '@opensaas/stack-core'
import { localiseTimestampDays, zonedDayBoundary } from '../../src/lib/zonedDays.js'

const fields = new Map<string, FilterFieldSuggestion>([
  [
    'publishedAt',
    {
      field: 'publishedAt',
      operators: ['eq', 'gt', 'gte', 'lt', 'lte'],
      freeText: false,
      valueSource: { kind: 'none' },
      datePicker: 'instant',
    },
  ],
  [
    'dueOn',
    {
      field: 'dueOn',
      operators: ['eq', 'gt', 'gte', 'lt', 'lte'],
      freeText: false,
      valueSource: { kind: 'none' },
      datePicker: 'day',
    },
  ],
  ['title', { field: 'title', operators: ['eq'], freeText: true, valueSource: { kind: 'none' } }],
])

const SYDNEY_WINTER_DAY = 'publishedAt:2026-08-04T00:00:00.000+10:00..2026-08-04T23:59:59.999+10:00'

describe('zonedDayBoundary', () => {
  it.each([
    ['2026-08-04', 'Australia/Sydney', false, '2026-08-04T00:00:00.000+10:00'],
    ['2026-08-04', 'Australia/Sydney', true, '2026-08-04T23:59:59.999+10:00'],
    ['2026-11-02', 'Australia/Sydney', false, '2026-11-02T00:00:00.000+11:00'],
    ['2026-03-08', 'America/New_York', true, '2026-03-08T23:59:59.999-04:00'],
    ['2026-03-08', 'America/New_York', false, '2026-03-08T00:00:00.000-05:00'],
    ['2026-08-04', 'UTC', false, '2026-08-04T00:00:00.000+00:00'],
    ['2026-08-04', 'Asia/Kolkata', false, '2026-08-04T00:00:00.000+05:30'],
  ])('%s in %s (end: %s) is %s', (day, zone, end, expected) => {
    expect(zonedDayBoundary(day, zone, end)).toBe(expected)
    expect(Number.isNaN(Date.parse(expected))).toBe(false)
  })
})

describe('localiseTimestampDays', () => {
  const localise = (query: string) => localiseTimestampDays(query, fields, 'Australia/Sydney')

  it('turns "is" a plain day into that local day', () => {
    expect(localise('publishedAt:2026-08-04')).toBe(SYDNEY_WINTER_DAY)
  })

  it('keeps "is not" negated', () => {
    expect(localise('-publishedAt:2026-08-04')).toBe(`-${SYDNEY_WINTER_DAY}`)
  })

  it.each([
    ['publishedAt:>2026-08-04', 'publishedAt:>2026-08-04T23:59:59.999+10:00'],
    ['publishedAt:>=2026-08-04', 'publishedAt:>=2026-08-04T00:00:00.000+10:00'],
    ['publishedAt:<2026-08-04', 'publishedAt:<2026-08-04T00:00:00.000+10:00'],
    ['publishedAt:<=2026-08-04', 'publishedAt:<=2026-08-04T23:59:59.999+10:00'],
    [
      'publishedAt:2026-08-01..2026-08-04',
      'publishedAt:2026-08-01T00:00:00.000+10:00..2026-08-04T23:59:59.999+10:00',
    ],
  ])('localises %s', (query, expected) => {
    expect(localise(query)).toBe(expected)
  })

  it.each([
    ['a calendar day field', 'dueOn:2026-08-04'],
    ['an instant already written', 'publishedAt:2026-08-04T09:00:00.000+10:00'],
    ['free text', '2026-08-04'],
    ['a text field', 'title:2026-08-04'],
    ['an unknown field', 'nosuch:2026-08-04'],
  ])('leaves %s alone', (_label, query) => {
    expect(localise(query)).toBe(query)
  })

  it('rewrites only the plain-day tokens of a mixed query, groups included', () => {
    expect(localise('status:draft (publishedAt:2026-08-04 OR title:x) beta')).toBe(
      `status:draft (${SYDNEY_WINTER_DAY} OR title:x) beta`,
    )
  })

  it('leaves the query alone for a time zone it cannot use', () => {
    expect(localiseTimestampDays('publishedAt:2026-08-04', fields, 'Not/AZone')).toBe(
      'publishedAt:2026-08-04',
    )
  })
})
