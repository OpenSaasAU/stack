import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FilterFieldSuggestion } from '@opensaas/stack-core'
import {
  checkRange,
  chipEditText,
  chipsOf,
  datePresets,
  dayBoundary,
  describeToken,
  draftOptions,
  filterQuery,
  formatOffset,
  hydrateTokens,
  localInstant,
  rootOptions,
  type FilterOption,
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

  it('rounds a fractional local-mean-time offset to whole minutes', () => {
    expect(formatOffset(-353.4666666)).toBe('+05:53')
    expect(formatOffset(17.5)).toBe('-00:18')
  })
})

class LocalMeanTimeDate extends Date {
  getTimezoneOffset(): number {
    return -353.4666666
  }
}

describe('a fractional offset', () => {
  it('writes the exact instant rather than an offset no parser takes', () => {
    const date = new LocalMeanTimeDate(Date.UTC(1890, 0, 1, 18, 6, 32))
    const written = localInstant(date)
    expect(written).toBe('1890-01-01T18:06:32.000Z')
    expect(new Date(written).getTime()).toBe(date.getTime())
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

const score: FilterFieldSuggestion = {
  field: 'score',
  operators: ['gte', 'lte'],
  freeText: false,
  valueSource: { kind: 'none' },
}
const title: FilterFieldSuggestion = {
  field: 'title',
  operators: ['eq'],
  freeText: true,
  valueSource: { kind: 'none' },
}
const everyField = new Map(
  [views, due, at, score, title].map((suggestion) => [suggestion.field, suggestion]),
)

const applied = (options: FilterOption[]) =>
  options.flatMap((option) => (option.kind === 'apply' ? [option.tokens] : []))

describe('a typed range on a timestamp', () => {
  it.each([
    'at 2026-01-01 to 2026-01-31',
    'at 2026-01-01..2026-01-31',
    'at 2026-01-01-2026-01-31',
    'at 2026-01-01 – 2026-01-31',
  ])('reads %j as that local range, not an is', (typed) => {
    const [first] = applied(rootOptions(typed, everyField).options)
    expect(first).toEqual([
      {
        kind: 'token',
        field: 'at',
        operator: 'range',
        negated: false,
        values: [
          { text: dayBoundary('2026-01-01', false), quoted: false },
          { text: dayBoundary('2026-01-31', true), quoted: false },
        ],
      },
    ])
  })

  it('reads an is draft that splits into two days as a range too', () => {
    const { options } = draftOptions(
      { field: 'at', condition: 'eq' },
      '2026-01-01 to 2026-01-31',
      everyField,
      undefined,
    )
    expect(applied(options)[0]?.[0].operator).toBe('range')
  })

  it('keeps a single day an is on that whole local day', () => {
    const [first] = applied(rootOptions('at 2026-01-01', everyField).options)
    expect(first?.[0].values.map((value) => value.text)).toEqual([
      dayBoundary('2026-01-01', false),
      dayBoundary('2026-01-01', true),
    ])
  })
})

describe('a typed or pasted timestamp token', () => {
  it('offers plain-day bounds through the local-day conversion', () => {
    const [first] = applied(rootOptions('at:2026-01-01..2026-01-31', everyField).options)
    expect(filterQuery(first ?? [])).toBe(
      `at:${dayBoundary('2026-01-01', false)}..${dayBoundary('2026-01-31', true)}`,
    )
  })

  it('offers plain-day comparisons through the same conversion', () => {
    const [first] = applied(rootOptions('at:>=2026-01-01 at:<=2026-01-31', everyField).options)
    expect(filterQuery(first ?? [])).toBe(
      `at:>=${dayBoundary('2026-01-01', false)} at:<=${dayBoundary('2026-01-31', true)}`,
    )
  })

  it('leaves an instant that already carries its offset as written', () => {
    const typed = 'at:2026-01-01T10:00:00Z..2026-01-02T10:00:00+05:30'
    const [first] = applied(rootOptions(typed, everyField).options)
    expect(filterQuery(first ?? [])).toBe(typed)
  })

  it('shows a plain date already in a URL as written', () => {
    const [chip] = chipsOf(hydrateTokens('at:2026-01-01..2026-01-31'), everyField)
    expect(chip.description.sentence).toBe('At between 2026-01-01 and 2026-01-31')
  })
})

describe('instant bounds', () => {
  it('writes a bound with a time as an ISO instant in the local offset', () => {
    const [first] = applied(
      rootOptions('at 2026-01-01 10:00 to 2026-01-02 12:30', everyField).options,
    )
    expect(first?.[0].values.map((value) => value.text)).toEqual([
      localInstant(new Date(2026, 0, 1, 10, 0)),
      localInstant(new Date(2026, 0, 2, 12, 30)),
    ])
  })

  it('refuses a bound that is not a time, with a hint, rather than offering it', () => {
    const { options, hint } = rootOptions('at someday to never', everyField)
    expect(
      applied(options)
        .flat()
        .every((token) => token.field === null),
    ).toBe(true)
    expect(hint).toBe('At takes a date or a time, like 2026-01-31.')
  })

  it('refuses a range whose bounds would not read back as the same range', () => {
    const { options, hint } = draftOptions(
      { field: 'score', condition: 'range' },
      'a b..c',
      everyField,
      undefined,
    )
    expect(
      applied(options)
        .flat()
        .every((token) => token.field === null),
    ).toBe(true)
    expect(hint).toBe('Score cannot take that range. Write each end without spaces or commas.')
  })

  it('reads back every range the builder offers as the same range', () => {
    const typings = [
      '1000-5000',
      '-10--5',
      '5 to 9',
      '5..9',
      '2026-01-01-2026-01-31',
      '2026-01-01 to 2026-01-31',
      '2026-01-01 10:00 to 2026-01-02 12:00',
      'Jan 1 2026 to Feb 1 2026',
      '2026-01-01T00:00:00Z..2026-02-01T00:00:00+11:00',
      'a..b',
      'a b..c',
      'x"y..z',
      '<a..b',
      '//a..b',
      'a,b..c',
    ]
    let ranges = 0
    for (const suggestion of everyField.values()) {
      for (const typed of typings) {
        const offered = [
          ...applied(rootOptions(`${suggestion.field} ${typed}`, everyField).options),
          ...applied(rootOptions(`${suggestion.field} between ${typed}`, everyField).options),
          ...applied(rootOptions(`${suggestion.field}:${typed}`, everyField).options),
          ...applied(
            draftOptions(
              { field: suggestion.field, condition: 'range' },
              typed,
              everyField,
              undefined,
            ).options,
          ),
        ]
        for (const tokens of offered) {
          if (!tokens.some((token) => token.operator === 'range')) continue
          ranges++
          expect(hydrateTokens(filterQuery(tokens)), `${suggestion.field} ${typed}`).toEqual(tokens)
        }
      }
    }
    expect(ranges).toBeGreaterThan(20)
  })
})

describe('editing a chip', () => {
  it('edits an is instant on a local midnight as its raw instant, never as a whole day', () => {
    const instant = dayBoundary('2026-11-03', false) ?? ''
    const tokens = hydrateTokens(`at:${instant}`)
    const [chip] = chipsOf(tokens, everyField)
    expect(chip.description.sentence).toBe(`At is ${instant}`)
    expect(chipEditText(chip, tokens[0], everyField)).toEqual({
      draft: { field: 'at', condition: 'eq' },
      text: instant,
    })
  })

  it('edits an at least instant on a local midnight as its day', () => {
    const tokens = hydrateTokens(`at:>=${dayBoundary('2026-11-03', false)}`)
    const [chip] = chipsOf(tokens, everyField)
    expect(chipEditText(chip, tokens[0], everyField).text).toBe('2026-11-03')
  })
})

describe('`field:a..b` on a field with no range', () => {
  it.each([
    ['title:wait...what', 'Title contains wait...what'],
    ['title:v1..v2', 'Title contains v1..v2'],
  ])('shows %s as the field’s own condition on the literal', (query, sentence) => {
    const tokens = hydrateTokens(query)
    expect(describeToken(tokens[0], everyField).sentence).toBe(sentence)
    expect(chipsOf(tokens, everyField)[0].range).toBeNull()
    expect(filterQuery(tokens)).toBe(query)
  })

  it('edits it as that condition on the literal', () => {
    const tokens = hydrateTokens('title:wait...what')
    const [chip] = chipsOf(tokens, everyField)
    expect(chipEditText(chip, tokens[0], everyField)).toEqual({
      draft: { field: 'title', condition: 'eq' },
      text: 'wait...what',
    })
  })
})

describe('negation with ranges and dates', () => {
  it('writes "is not" a day on a timestamp as the negated range of that local day', () => {
    const { options } = draftOptions(
      { field: 'at', condition: 'not' },
      '2026-01-01',
      everyField,
      undefined,
    )
    expect(filterQuery(applied(options)[0] ?? [])).toBe(
      `-at:${dayBoundary('2026-01-01', false)}..${dayBoundary('2026-01-01', true)}`,
    )
  })

  it('keeps the negation when a comparison is typed under "is not"', () => {
    const { options } = draftOptions(
      { field: 'views', condition: 'not' },
      '>5',
      everyField,
      undefined,
    )
    expect(filterQuery(applied(options)[0] ?? [])).toBe('-views:>5')
  })

  it('never pairs a negated comparison into a between chip', () => {
    const chips = chipsOf(hydrateTokens('-views:>=1 views:<=5'), everyField)
    expect(chips.map((chip) => chip.count)).toEqual([1, 1])
  })

  it('describes a range on a field with no range, negated, as its negated literal condition', () => {
    const [token] = hydrateTokens('-title:v1..v2')
    expect(describeToken(token, everyField).sentence).toBe('Title does not contain v1..v2')
  })
})
