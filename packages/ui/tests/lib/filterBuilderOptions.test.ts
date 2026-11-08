import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FilterFieldSuggestion, FilterToken } from '@opensaas/stack-core'
import {
  ALTERNATIVE_HINT,
  addAlternatives,
  alternativeRefusal,
  alternativesOption,
  checkRange,
  chipEditText,
  chipsOf,
  datePresets,
  dayBoundary,
  describeToken,
  draftOptions,
  filterQuery,
  entriesQuery,
  formatOffset,
  hydrateEntries,
  hydrateTokens,
  joinChips,
  localInstant,
  normaliseGroups,
  placeChoice,
  placeEntries,
  removableTerms,
  rootOptions,
  singleTokenOptions,
  splitChips,
  unitsOf,
  type FilterEntry,
  type GroupEdit,
  type FilterOption,
} from '../../src/lib/filterBuilderOptions.js'

const ungrouped = (tokens: FilterToken[]): FilterEntry[] =>
  tokens.map((token) => ({ token, group: null }))

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
      ungrouped(hydrateTokens('views:>=1 views:<=5 views:>=2 due:<=2026-01-01 views:<=9')),
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
    const [chip] = chipsOf(ungrouped(hydrateTokens('at:2026-01-01..2026-01-31')), everyField)
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
    const [chip] = chipsOf(ungrouped(tokens), everyField)
    expect(chip.description.sentence).toBe(`At is ${instant}`)
    expect(chipEditText(chip, tokens[0], everyField)).toEqual({
      draft: { field: 'at', condition: 'eq' },
      text: instant,
    })
  })

  it('edits an at least instant on a local midnight as its day', () => {
    const tokens = hydrateTokens(`at:>=${dayBoundary('2026-11-03', false)}`)
    const [chip] = chipsOf(ungrouped(tokens), everyField)
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
    expect(chipsOf(ungrouped(tokens), everyField)[0].range).toBeNull()
    expect(filterQuery(tokens)).toBe(query)
  })

  it('edits it as that condition on the literal', () => {
    const tokens = hydrateTokens('title:wait...what')
    const [chip] = chipsOf(ungrouped(tokens), everyField)
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
    const chips = chipsOf(ungrouped(hydrateTokens('-views:>=1 views:<=5')), everyField)
    expect(chips.map((chip) => chip.count)).toEqual([1, 1])
  })

  it('describes a range on a field with no range, negated, as its negated literal condition', () => {
    const [token] = hydrateTokens('-title:v1..v2')
    expect(describeToken(token, everyField).sentence).toBe('Title does not contain v1..v2')
  })
})

describe('OR groups', () => {
  const status: FilterFieldSuggestion = {
    field: 'status',
    operators: ['eq'],
    freeText: false,
    valueSource: {
      kind: 'enum',
      options: [
        { value: 'draft', label: 'Draft' },
        { value: 'published', label: 'Published' },
      ],
    },
  }
  const grouped = new Map(
    [views, title, status].map((suggestion) => [suggestion.field, suggestion]),
  )
  const chipsFor = (query: string) => chipsOf(hydrateEntries(query), grouped)
  const groupsOf = (entries: FilterEntry[]) => entries.map((entry) => entry.group)

  it('hydrates a group as entries sharing one group, and writes it back as written', () => {
    const entries = hydrateEntries('beta (status:draft OR title:x) views:>2')
    expect(groupsOf(entries)).toEqual([null, 0, 0, null])
    expect(entriesQuery(entries)).toBe('beta (status:draft OR title:x) views:>2')
  })

  it('reads degraded parentheses as words outside any group', () => {
    const entries = hydrateEntries('(status:draft or title:x)')
    expect(groupsOf(entries)).toEqual([null, null, null])
    expect(entriesQuery(entries)).toBe('(status:draft or title:x)')
  })

  it('takes the group off a member left alone', () => {
    const entries = hydrateEntries('(status:draft OR title:x) beta')
    expect(groupsOf(normaliseGroups([entries[0], entries[2]]))).toEqual([null, null])
  })

  it('never pairs >= and <= across a group boundary', () => {
    expect(chipsFor('(views:>=1 OR views:<=5)').map((chip) => chip.count)).toEqual([1, 1])
    expect(chipsFor('views:>=1 (views:<=5 OR title:x)').map((chip) => chip.count)).toEqual([
      1, 1, 1,
    ])
    expect(chipsFor('views:>=1 views:<=5').map((chip) => chip.count)).toEqual([2])
  })

  it('reads chips as units: a group, or one chip outside any group', () => {
    expect(unitsOf(chipsFor('beta (status:draft OR title:x OR title:y) gamma'))).toEqual([
      { first: 0, last: 0, group: null },
      { first: 1, last: 3, group: 0 },
      { first: 4, last: 4, group: null },
    ])
  })

  const written = (edit: GroupEdit) => (edit.ok ? entriesQuery(edit.entries) : edit.message)

  it('joins two chips into a group, and a between chip joins as one a..b token', () => {
    const entries = hydrateEntries('views:>=1 views:<=5 title:x')
    expect(written(joinChips(entries, chipsOf(entries, grouped), 0))).toBe(
      '(views:1..5 OR title:x)',
    )
  })

  it('joins a chip into the group beside it', () => {
    const entries = hydrateEntries('beta (status:draft OR title:x)')
    expect(written(joinChips(entries, chipsOf(entries, grouped), 0))).toBe(
      '(beta OR status:draft OR title:x)',
    )
  })

  it('leaves entries as they are when the two chips already share a group', () => {
    const entries = hydrateEntries('(status:draft OR title:x OR title:y) beta')
    const chips = chipsOf(entries, grouped)
    expect(joinChips(entries, chips, 0)).toEqual({ ok: true, entries })
    expect(joinChips(entries, chips, 1)).toEqual({ ok: true, entries })
    expect(written(joinChips(entries, chips, 2))).toBe(
      '(status:draft OR title:x OR title:y OR beta)',
    )
  })

  describe('a between chip whose ends cannot be written as a..b', () => {
    const named: FilterFieldSuggestion = {
      field: 'title',
      operators: ['eq', 'gte', 'lte'],
      freeText: true,
      valueSource: { kind: 'none' },
    }
    const ranged = new Map([named, status].map((suggestion) => [suggestion.field, suggestion]))
    const refusal =
      '“Title between Ada L and Bob” cannot be one alternative of an or group. Write each end of its range without spaces, commas or parentheses.'

    it.each(['title:>="Ada L" title:<=Bob', 'title:>=a..x title:<=c', 'title:>=a(b title:<=c'])(
      'keeps %s as its >= and <= pair, and refuses to join it',
      (query) => {
        const entries = hydrateEntries(query + ' status:draft')
        const chips = chipsOf(entries, ranged)
        expect(chips[0].count).toBe(2)
        const joined = joinChips(entries, chips, 0)
        expect(joined.ok).toBe(false)
        expect(entriesQuery(entries)).toBe(`${query} status:draft`)
        expect(alternativeRefusal(entries, chips, 0)).not.toBeNull()
        const [published] = hydrateTokens('status:published')
        expect(addAlternatives(entries, chips, 0, [published], ranged).ok).toBe(false)
      },
    )

    it('names the chip and the fix', () => {
      const entries = hydrateEntries('title:>="Ada L" title:<=Bob status:draft')
      expect(written(joinChips(entries, chipsOf(entries, ranged), 0))).toBe(refusal)
    })

    it('joins a between chip whose ends can be written as a..b', () => {
      const entries = hydrateEntries('title:>=Ada title:<=Bob status:draft')
      expect(written(joinChips(entries, chipsOf(entries, ranged), 0))).toBe(
        '(title:Ada..Bob OR status:draft)',
      )
    })
  })

  it('splits a group between two chips, and a side of one stops being a group', () => {
    const entries = hydrateEntries('(status:draft OR title:x OR title:y)')
    const chips = chipsOf(entries, grouped)
    expect(entriesQuery(splitChips(entries, chips, 0))).toBe('status:draft (title:x OR title:y)')
    expect(entriesQuery(splitChips(entries, chips, 1))).toBe('(status:draft OR title:x) title:y')
  })

  it('adds an alternative after a group, or makes a lone chip a group', () => {
    const lone = hydrateEntries('status:draft beta')
    expect(
      written(addAlternatives(lone, chipsOf(lone, grouped), 0, hydrateTokens('title:x'), grouped)),
    ).toBe('(status:draft OR title:x) beta')
    const group = hydrateEntries('(status:draft OR title:x) beta')
    expect(
      written(
        addAlternatives(
          group,
          chipsOf(group, grouped),
          0,
          hydrateTokens('status:published'),
          grouped,
        ),
      ),
    ).toBe('(status:draft OR title:x OR status:published) beta')
  })

  it('refuses an alternative of several tokens, since groups do not nest', () => {
    const lone = hydrateEntries('status:draft')
    expect(
      addAlternatives(lone, chipsOf(lone, grouped), 0, hydrateTokens('foo bar'), grouped),
    ).toEqual({ ok: false, message: ALTERNATIVE_HINT })
  })

  describe('placeChoice', () => {
    const loose = (query: string): FilterEntry[] =>
      hydrateTokens(query).map((token) => ({ token, group: null }))

    it('adds one choice as an alternative, and refuses an AND of several', () => {
      const entries = hydrateEntries('status:draft')
      const chips = chipsOf(entries, grouped)
      const target = { alternativeOf: 0, editing: null }
      expect(written(placeChoice(entries, chips, loose('title:x'), target, grouped, true))).toBe(
        '(status:draft OR title:x)',
      )
      expect(placeChoice(entries, chips, loose('foo bar'), target, grouped, true)).toEqual({
        ok: false,
        message: ALTERNATIVE_HINT,
      })
      expect(
        placeChoice(entries, chips, hydrateEntries('(a OR b)'), target, grouped, true),
      ).toEqual({ ok: false, message: ALTERNATIVE_HINT })
    })

    it('replaces an edited group member with one choice, keeping the group', () => {
      const entries = hydrateEntries('(status:draft OR beta) gamma')
      const chips = chipsOf(entries, grouped)
      const target = { alternativeOf: null, editing: chips[1] }
      expect(
        written(placeChoice(entries, chips, loose('status:published'), target, grouped, false)),
      ).toBe('(status:draft OR status:published) gamma')
      expect(placeChoice(entries, chips, loose('a:1 b:2'), target, grouped, false).ok).toBe(false)
    })

    it('places a typed group as a group, after the groups already there', () => {
      const entries = hydrateEntries('(status:draft OR beta)')
      expect(
        written(
          placeChoice(
            entries,
            chipsOf(entries, grouped),
            hydrateEntries('gamma (title:x OR title:y)'),
            { alternativeOf: null, editing: null },
            grouped,
            true,
          ),
        ),
      ).toBe('(status:draft OR beta) gamma (title:x OR title:y)')
    })
  })

  it('removes an OR group as one term, and a between chip as one', () => {
    const entries = hydrateEntries('views:>=1 views:<=5 (status:draft OR title:x) beta')
    expect(
      removableTerms(entries, chipsOf(entries, grouped)).map(({ sentence, rest }) => [
        sentence,
        entriesQuery(rest),
      ]),
    ).toEqual([
      ['Views between 1 and 5', '(status:draft OR title:x) beta'],
      ['Status is Draft or Title contains x', 'views:>=1 views:<=5 beta'],
      ['Text contains beta', 'views:>=1 views:<=5 (status:draft OR title:x)'],
    ])
  })

  it('keeps only single-token choices for an alternative, and says why', () => {
    const offered = rootOptions('foo bar', grouped)
    const single = singleTokenOptions(offered)
    expect(
      offered.options.some(
        (option) => option.kind === 'apply' && option.label === 'Search all text for “foo bar”',
      ),
    ).toBe(true)
    expect(
      single.options.every((option) => option.kind !== 'apply' || option.tokens.length === 1),
    ).toBe(true)
    expect(single.hint).toBe(ALTERNATIVE_HINT)
    expect(singleTokenOptions(rootOptions('"foo bar"', grouped)).hint).toBeNull()
  })

  it('keeps two values on one field in a group, and replaces only outside groups', () => {
    const entries = hydrateEntries('(status:draft OR title:x) status:draft')
    const [published] = hydrateTokens('status:published')
    expect(
      entriesQuery(placeEntries(entries, [{ token: published, group: null }], null, grouped, true)),
    ).toBe('(status:draft OR title:x) status:published')
    expect(
      entriesQuery(
        placeEntries(
          entries,
          [{ token: published, group: 0 }],
          { start: 2, count: 0 },
          grouped,
          true,
        ),
      ),
    ).toBe('(status:draft OR title:x OR status:published) status:draft')
  })

  const optionQuery = (option: FilterOption | undefined) =>
    option?.kind === 'apply'
      ? entriesQuery(option.entries ?? option.tokens.map((token) => ({ token, group: null })))
      : null

  it('offers `a or b` as one group, each side read on its own, after the literal search', () => {
    const option = alternativesOption('draft or priya', grouped)
    expect(option).toMatchObject({
      kind: 'apply',
      label: 'Status is Draft or Text contains priya',
    })
    expect(optionQuery(option ?? undefined)).toBe('(status:draft OR priya)')
    const { options } = rootOptions('draft or priya', grouped)
    expect(options.map(optionQuery)).toEqual(['draft or priya', '(status:draft OR priya)'])
    const phrased = rootOptions('views > 5 or title contains ada', grouped).options
    expect(phrased.at(-1)).toMatchObject({ label: 'Views greater than 5 or Title contains ada' })
    expect(optionQuery(phrased[0])).not.toBe(optionQuery(phrased.at(-1)))
  })

  it.each([
    'title:a..(b or status:draft',
    'title:a..b) or status:draft',
    'title:(a..b or status:draft',
  ])('offers no group for %s, whose range cannot be one member of a group', (typed) => {
    const named: FilterFieldSuggestion = {
      field: 'title',
      operators: ['eq', 'gte', 'lte'],
      freeText: true,
      valueSource: { kind: 'none' },
    }
    const ranged = new Map([named, status].map((suggestion) => [suggestion.field, suggestion]))
    expect(alternativesOption(typed, ranged)).toBeNull()
    expect(rootOptions(typed, ranged).options.some((option) => option.group === 'Any of')).toBe(
      false,
    )
    expect(optionQuery(alternativesOption('title:a..b or status:draft', ranged) ?? undefined)).toBe(
      '(title:a..b OR status:draft)',
    )
  })

  it('never splits an or inside quotes', () => {
    expect(alternativesOption('"black or white"', grouped)).toBeNull()
    expect(alternativesOption('"a or b" or c', grouped)).toMatchObject({
      label: 'Text contains a or b or Text contains c',
    })
    const [first] = rootOptions('"black or white"', grouped).options
    expect(optionQuery(first)).toBe('"black or white"')
  })

  describe('an enumerated value whose label holds or', () => {
    const colour: FilterFieldSuggestion = {
      field: 'colour',
      operators: ['eq'],
      freeText: false,
      valueSource: {
        kind: 'enum',
        options: [
          { value: 'bw', label: 'Black or White' },
          { value: 'red', label: 'Red' },
        ],
      },
    }
    const coloured = new Map(
      [colour, status, title].map((suggestion) => [suggestion.field, suggestion]),
    )

    it('is never split, and its exact value comes before any group', () => {
      expect(alternativesOption('black or white', coloured)).toBeNull()
      const { options } = rootOptions('black or white', coloured)
      expect(optionQuery(options[0])).toBe('colour:bw')
      expect(options.some((option) => option.group === 'Any of')).toBe(false)
    })

    it('stays one side when or splits around it', () => {
      expect(
        optionQuery(alternativesOption('black or white or draft', coloured) ?? undefined),
      ).toBe('(colour:bw OR status:draft)')
    })
  })

  describe('a typed or pasted group', () => {
    it.each([
      ['(draft OR mango)', '(draft OR mango)'],
      ['(status:draft OR status:published)', '(status:draft OR status:published)'],
      [
        '(status:draft OR status:published) status:draft status:published',
        '(status:draft OR status:published) status:published',
      ],
    ])('is offered first as exactly what %s means in the URL', (typed, query) => {
      const { options } = rootOptions(typed, grouped)
      expect(optionQuery(options[0])).toBe(query)
    })

    it('never flattens a group into AND, in any option', () => {
      for (const typed of ['(draft OR mango)', '(status:draft OR status:published) beta']) {
        for (const option of rootOptions(typed, grouped).options) {
          if (option.kind !== 'apply') continue
          expect(
            option.entries?.some((entry) => entry.group !== null),
            option.label,
          ).toBe(true)
        }
      }
    })

    it('searches the group as text, keeping it a group', () => {
      const { options } = rootOptions('(status:draft OR status:published)', grouped)
      expect(
        options.map((option) => (option.kind === 'field' ? option.field : option.label)),
      ).toEqual([
        'Status is Draft or Status is Published',
        'Search all text for “(status:draft OR status:published)”',
      ])
      expect(optionQuery(options[1])).toBe('("status:draft" OR "status:published")')
    })
  })

  it('offers no group for a side that is not one token, or an empty side', () => {
    expect(alternativesOption('draft or', grouped)).toBeNull()
    expect(alternativesOption('draft or two words', grouped)).toBeNull()
    expect(alternativesOption('views > x or draft', grouped)).toBeNull()
  })
})
