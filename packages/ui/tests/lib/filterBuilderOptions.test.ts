import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FilterFieldSuggestion } from '@opensaas/stack-core'
import {
  checkRange,
  chipsOf,
  datePresets,
  dayBoundary,
  formatOffset,
  hydrateTokens,
  localInstant,
} from '../../src/lib/filterBuilderOptions.js'

const views: FilterFieldSuggestion = {
  field: 'views',
  operators: ['eq', 'gt', 'gte', 'lt', 'lte'],
  freeText: false,
  valueSource: { kind: 'none' },
  valueFormat: { pattern: '^-?\\d+$', description: 'takes a whole number' },
}
const due: FilterFieldSuggestion = {
  field: 'due',
  operators: ['eq', 'gt', 'gte', 'lt', 'lte'],
  freeText: false,
  valueSource: { kind: 'none' },
  valueFormat: {
    pattern: '^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])$',
    description: 'takes a date, like 2026-01-31',
  },
  datePicker: 'day',
}
const at: FilterFieldSuggestion = {
  field: 'at',
  operators: ['eq', 'gt', 'gte', 'lt', 'lte'],
  freeText: false,
  valueSource: { kind: 'none' },
  datePicker: 'instant',
}
const fields = new Map([views, due, at].map((suggestion) => [suggestion.field, suggestion]))

describe('formatOffset', () => {
  it.each([
    [-660, '+11:00'],
    [-345, '+05:45'],
    [0, '+00:00'],
    [210, '-03:30'],
    [300, '-05:00'],
  ])('writes a getTimezoneOffset of %i as %s', (minutes, offset) => {
    expect(formatOffset(minutes)).toBe(offset)
  })
})

describe('localInstant', () => {
  it('writes the local wall time with the offset the browser reports for that date', () => {
    for (const date of [new Date(2026, 0, 15, 0, 0), new Date(2026, 6, 15, 23, 59, 59, 999)]) {
      const written = localInstant(date)
      expect(written.endsWith(formatOffset(date.getTimezoneOffset())), written).toBe(true)
      expect(new Date(written).getTime(), written).toBe(date.getTime())
    }
  })

  it('bounds a calendar day at its local first and last millisecond', () => {
    expect(new Date(dayBoundary('2026-03-08', false) ?? '').getTime()).toBe(
      new Date(2026, 2, 8).getTime(),
    )
    expect(new Date(dayBoundary('2026-03-08', true) ?? '').getTime()).toBe(
      new Date(2026, 2, 8, 23, 59, 59, 999).getTime(),
    )
    expect(dayBoundary('2026-02-31', false)).toBeNull()
  })
})

describe('in a pinned time zone', () => {
  const zone = process.env.TZ
  beforeEach(() => {
    process.env.TZ = 'Australia/Sydney'
  })
  afterEach(() => {
    if (zone === undefined) delete process.env.TZ
    else process.env.TZ = zone
  })

  it('writes Sydney’s daylight-saving offset, end of day inclusive', () => {
    expect(new Date(2026, 10, 8).getTimezoneOffset()).toBe(-660)
    expect(dayBoundary('2026-11-08', false)).toBe('2026-11-08T00:00:00.000+11:00')
    expect(dayBoundary('2026-11-08', true)).toBe('2026-11-08T23:59:59.999+11:00')
    expect(dayBoundary('2026-06-08', false)).toBe('2026-06-08T00:00:00.000+10:00')
  })
})

describe('datePresets', () => {
  it('crosses a year boundary for last month', () => {
    const presets = datePresets(new Date(2026, 0, 3, 9))
    expect(presets.find((preset) => preset.label === 'Last month')).toEqual({
      label: 'Last month',
      from: '2025-12-01',
      to: '2025-12-31',
    })
    expect(presets.find((preset) => preset.label === 'Last 7 days')).toEqual({
      label: 'Last 7 days',
      from: '2025-12-28',
      to: '2026-01-03',
    })
  })
})

describe('checkRange', () => {
  it.each([
    ['1000-5000', '1000', '5000'],
    ['-5-5', '-5', '5'],
    ['-10--5', '-10', '-5'],
    ['5 – 9', '5', '9'],
    ['5 to 9', '5', '9'],
    ['5..9', '5', '9'],
  ])('reads %j on a whole number field', (typed, low, high) => {
    expect(checkRange(views, typed)).toEqual({ ok: true, low, high })
  })

  it('splits calendar days at the one dash that leaves two dates', () => {
    expect(checkRange(due, '2026-01-01-2026-01-31')).toEqual({
      ok: true,
      low: '2026-01-01',
      high: '2026-01-31',
    })
  })

  it('splits plain days on a timestamp field the same way', () => {
    expect(checkRange(at, '2026-01-01-2026-01-31')).toEqual({
      ok: true,
      low: '2026-01-01',
      high: '2026-01-31',
    })
  })

  it('explains a bound that does not fit, and a value with no range in it', () => {
    expect(checkRange(views, '5-x')).toEqual({ ok: false, message: 'Views takes a whole number.' })
    expect(checkRange(views, '5')).toEqual({
      ok: false,
      message: 'Type a range for Views, as from..to.',
    })
  })
})

describe('chipsOf', () => {
  it('pairs >= and <= only when adjacent and on one field', () => {
    const chips = chipsOf(
      hydrateTokens('views:>=1 views:<=5 views:>=2 due:<=2026-01-01 views:<=9'),
      fields,
    )
    expect(chips.map((chip) => [chip.start, chip.count, chip.description.sentence])).toEqual([
      [0, 2, 'Views between 1 and 5'],
      [2, 1, 'Views at least 2'],
      [3, 1, 'Due at most 2026-01-01'],
      [4, 1, 'Views at most 9'],
    ])
  })
})
