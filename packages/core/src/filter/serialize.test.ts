import { describe, it, expect } from 'vitest'
import { filterQueryTokens, filterTermTokens, parseFilterQuery } from './parse.js'
import { quoteFilterValue, serializeFilterQuery } from './serialize.js'
import { filterTokenRecordId, recordIdFilterToken } from './record-id.js'
import { buildFilterWhere } from './map.js'
import type {
  FilterOperator,
  FilterQuery,
  FilterGroup,
  FilterSpec,
  FilterTerm,
  FilterToken,
  FilterTokenOperator,
  FilterValue,
} from './types.js'

const tokensOf = (written: string) => filterQueryTokens(parseFilterQuery(written))

const v = (text: string, quoted = false): FilterValue => ({ text, quoted })

const token = (partial: Partial<FilterToken>): FilterToken => ({
  kind: 'token',
  field: null,
  operator: 'eq',
  negated: false,
  values: [v('')],
  ...partial,
})

const query = (...terms: FilterTerm[]): FilterQuery => ({ terms })

const group = (...tokens: FilterToken[]): FilterGroup => ({ kind: 'group', tokens })

describe('serializeFilterQuery', () => {
  it('serialises a bare free-text word', () => {
    expect(serializeFilterQuery(query(token({ values: [v('beta')] })))).toBe('beta')
  })

  it('serialises a field:value token with the default eq operator', () => {
    expect(serializeFilterQuery(query(token({ field: 'role', values: [v('Editor')] })))).toBe(
      'role:Editor',
    )
  })

  it.each<[FilterOperator, string]>([
    ['gt', 'orders:>5'],
    ['gte', 'orders:>=5'],
    ['lt', 'orders:<5'],
    ['lte', 'orders:<=5'],
  ])('serialises the %s operator as its prefix', (operator, expected) => {
    expect(
      serializeFilterQuery(query(token({ field: 'orders', operator, values: [v('5')] }))),
    ).toBe(expected)
  })

  it('quotes a value containing whitespace', () => {
    expect(serializeFilterQuery(query(token({ field: 'name', values: [v('Ada Lovelace')] })))).toBe(
      'name:"Ada Lovelace"',
    )
    expect(serializeFilterQuery(query(token({ values: [v('multi word')] })))).toBe('"multi word"')
  })

  it('keeps a value quoted when it says it was quoted', () => {
    expect(serializeFilterQuery(query(token({ values: [v('beta', true)] })))).toBe('"beta"')
  })

  it('escapes an embedded quote as \\"', () => {
    expect(
      serializeFilterQuery(query(token({ field: 'name', values: [v('Ada "the Countess"')] }))),
    ).toBe('name:"Ada \\"the Countess\\""')
  })

  it('escapes a backslash only where it would otherwise read as an escape', () => {
    expect(serializeFilterQuery(query(token({ values: [v('ends in \\')] })))).toBe('"ends in \\\\"')
    expect(serializeFilterQuery(query(token({ values: [v('C:\\Users me')] })))).toBe(
      '"C:\\Users me"',
    )
  })

  it('quotes a free-text word that would otherwise read back as a field token', () => {
    expect(serializeFilterQuery(query(token({ values: [v('status:draft')] })))).toBe(
      '"status:draft"',
    )
  })

  it('leaves a URL bare, since its scheme is not a field prefix', () => {
    expect(serializeFilterQuery(query(token({ values: [v('http://x')] })))).toBe('http://x')
  })

  it('quotes an eq value that would otherwise read as a comparison operator', () => {
    expect(serializeFilterQuery(query(token({ field: 'note', values: [v('>5')] })))).toBe(
      'note:">5"',
    )
    expect(
      serializeFilterQuery(query(token({ field: 'orders', operator: 'gt', values: [v('=5')] }))),
    ).toBe('orders:>"=5"')
  })

  it('does NOT quote a leading > on a bare word (parser keeps it literal)', () => {
    expect(serializeFilterQuery(query(token({ values: [v('>5')] })))).toBe('>5')
  })

  it('writes an empty value as written: `field:` and `""`', () => {
    expect(serializeFilterQuery(query(token({ field: 'role', values: [v('')] })))).toBe('role:')
    expect(serializeFilterQuery(query(token({ values: [v('')] })))).toBe('""')
  })

  it.each(['\u00a0', '\f', '\v', '\u2028', '\u3000'])(
    'quotes a value containing the whitespace %j',
    (space) => {
      expect(
        serializeFilterQuery(query(token({ field: 'title', values: [v(`Ada${space}`)] }))),
      ).toBe(`title:"Ada${space}"`)
      expect(serializeFilterQuery(query(token({ values: [v(space)] })))).toBe(`"${space}"`)
    },
  )

  it('writes several values as a comma list, quoting each one that needs it', () => {
    expect(serializeFilterQuery(query(token({ field: 'title', values: [v('a,b')] })))).toBe(
      'title:"a,b"',
    )
    expect(serializeFilterQuery(query(token({ field: 'title', values: [v('a'), v('b')] })))).toBe(
      'title:a,b',
    )
    expect(
      serializeFilterQuery(query(token({ field: 'title', values: [v('a'), v('b c,d')] }))),
    ).toBe('title:a,"b c,d"')
    expect(
      serializeFilterQuery(query(token({ field: 'title', values: [v('a'), v('b', true)] }))),
    ).toBe('title:a,"b"')
  })

  it('leaves a comma in a free-text word bare, since only a field value is a list', () => {
    expect(serializeFilterQuery(query(token({ values: [v('a,b')] })))).toBe('a,b')
  })

  it('writes a negated token with a leading `-`', () => {
    expect(
      serializeFilterQuery(query(token({ field: 'status', values: [v('draft')], negated: true }))),
    ).toBe('-status:draft')
    expect(serializeFilterQuery(query(token({ values: [v('beta')], negated: true })))).toBe('-beta')
  })

  it('quotes a free-text word starting with `-`, so it never reads as negation', () => {
    expect(serializeFilterQuery(query(token({ values: [v('-beta')] })))).toBe('"-beta"')
    expect(serializeFilterQuery(query(token({ values: [v('-')] })))).toBe('-')
    expect(serializeFilterQuery(query(token({ values: [v('-x')], negated: true })))).toBe('--x')
  })

  it('writes the empty operator as `field:!` and quotes a literal lone `!`', () => {
    expect(
      serializeFilterQuery(query(token({ field: 'status', operator: 'empty', values: [] }))),
    ).toBe('status:!')
    expect(
      serializeFilterQuery(
        query(token({ field: 'status', operator: 'empty', values: [], negated: true })),
      ),
    ).toBe('-status:!')
    expect(serializeFilterQuery(query(token({ field: 'status', values: [v('!')] })))).toBe(
      'status:"!"',
    )
    expect(serializeFilterQuery(query(token({ field: 'status', values: [v('!'), v('a')] })))).toBe(
      'status:!,a',
    )
  })

  it('joins terms with the grammar implicit AND (a single space)', () => {
    expect(
      serializeFilterQuery(
        query(
          token({ field: 'role', values: [v('Editor')] }),
          token({ field: 'orders', operator: 'gt', values: [v('5')] }),
          token({ values: [v('beta')] }),
        ),
      ),
    ).toBe('role:Editor orders:>5 beta')
  })
})

describe('serializing a token with no values', () => {
  it('writes it as an empty token, never as an empty term', () => {
    expect(serializeFilterQuery(query(token({ values: [] }), token({ values: [v('x')] })))).toBe(
      '"" x',
    )
    expect(serializeFilterQuery(query(token({ field: 'role', values: [] })))).toBe('role:')
  })

  it('reads back as the same number of terms, the first one empty', () => {
    const readBack = tokensOf(
      serializeFilterQuery(query(token({ values: [] }), token({ values: [v('x')] }))),
    )
    expect(readBack.map((term) => term.values.map((value) => value.text))).toEqual([[''], ['x']])
  })
})

describe('parse/serialize round-trip on written queries', () => {
  const queries = [
    'beta',
    'role:Editor',
    'orders:>5',
    'orders:>=5',
    'orders:<10',
    'name:"Ada Lovelace"',
    'role:Editor orders:>5 name:"Ada Lovelace" beta',
    '"multi word" gamma',
    '"status:draft"',
    'name:"Ada \\"the Countess\\""',
    '"beta"',
    'role: ""',
    'http://x',
    'status:"a,b" "a,b" "-status:draft" "-beta" - "--x"',
    '"C:\\Users me"',
    'views:5..10',
    'at:2026-11-01T00:00:00.000+11:00..2026-11-01T23:59:59.999+11:00 title:"1..2"',
    'author:#0190a3c2-7b1e-7000-8000-000000000001',
    'author:"#42" owner:#42 #42',
    '-author:#42 author:#1,#2 author:#1,"#2"',
    '-status:draft -beta --x -"a b"',
    'status:draft,review status:a,"b c" status:a,b c',
    'status:! -status:! status:"!" status:!,a status:!x',
    ', a,b role:, role:a,',
    '-http://x -orders:>5,6',
    '-views:5..10 title:a..b,c views:1..2,"3..4" views:"1..2" -at:a..b..c',
  ]

  it.each(queries)('serialize(parse(%s)) reproduces the query', (written) => {
    expect(serializeFilterQuery(parseFilterQuery(written))).toBe(written)
  })

  it('tells `a,"b c"` from `a,b c` by its per-value quoting', () => {
    const quoted = tokensOf('status:a,"b c"')
    const split = tokensOf('status:a,b c')
    expect(quoted).toHaveLength(1)
    expect(quoted[0].values).toEqual([v('a'), v('b c', true)])
    expect(split.map((term) => term.values)).toEqual([[v('a'), v('b')], [v('c')]])
  })
})

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ALPHABET = [
  'a',
  'b',
  'Z',
  '_',
  '1',
  ' ',
  '\t',
  '\n',
  '"',
  '\\',
  ':',
  '>',
  '<',
  '=',
  '/',
  '-',
  ',',
  '(',
  ')',
  '.',
  '#',
  '!',
  'é',
  '\u00a0',
  '\f',
  '\v',
  '\u2028',
]
const TRICKY_PREFIXES = [
  '',
  '',
  '"',
  '//',
  '>',
  '<',
  '=',
  '>=',
  'status:',
  'a:"',
  '\\',
  ' ',
  '-',
  '--',
  ',',
  '-status:',
  'a,',
  '..',
  'a..',
  'status:1..',
  '-status:1..',
  '#',
  '"#',
  'a:!',
  '!',
  '-a:!',
  'a:x,',
  '(',
  ')',
  'OR',
  '(a OR ',
]
const GROUP_PIECES = ['(', ')', ' OR ', ' OR ', ' or ', ' ', '((', '))', '"OR"', ' OR)', '-(']
const OPERATORS: FilterTokenOperator[] = ['eq', 'gt', 'gte', 'lt', 'lte', 'empty']
const FIELDS = ['status', 'a', '_b1', 'http', 'OR']
const RUNS = 2000
const LOW_BOUND = ['a', 'Z', '1', '_', '-', ':', '+', 'T', '=', '#', '!', 'é']
const HIGH_BOUND = [...LOW_BOUND, '.', '"', '>', '<', '/']

function arbitrary(random: () => number) {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]
  const text = (max: number) =>
    pick(TRICKY_PREFIXES) +
    Array.from({ length: Math.floor(random() * (max + 1)) }, () => pick(ALPHABET)).join('')
  const value = (): FilterValue => v(text(8), random() < 0.3)
  const parserShapedToken = (): FilterToken => {
    const field = random() < 0.4 ? null : pick(FIELDS)
    const negated = random() < 0.3
    if (field === null) return token({ negated, values: [value()] })
    const operator = pick(OPERATORS)
    if (operator === 'empty') return token({ field, operator, negated, values: [] })
    const count = 1 + Math.floor(random() * 3)
    return token({ field, operator, negated, values: Array.from({ length: count }, value) })
  }
  const freeTextToken = (): FilterToken =>
    token({
      negated: random() < 0.3,
      values: Array.from({ length: 1 + Math.floor(random() * 3) }, value),
    })
  const bound = (alphabet: readonly string[]) =>
    Array.from({ length: 1 + Math.floor(random() * 6) }, () => pick(alphabet)).join('')
  const rangeToken = (): FilterToken =>
    token({
      field: pick(FIELDS),
      operator: 'range',
      negated: random() < 0.3,
      values: [v(bound(LOW_BOUND)), v(bound(HIGH_BOUND))],
    })
  const anyToken = () => (random() < 0.2 ? rangeToken() : parserShapedToken())
  const groupTerm = (): FilterGroup =>
    group(...Array.from({ length: 2 + Math.floor(random() * 3) }, anyToken))
  const anyTerm = (): FilterTerm => (random() < 0.3 ? groupTerm() : anyToken())
  const groupString = () => {
    const members = Array.from({ length: 1 + Math.floor(random() * 3) }, () => text(6))
    const written = `(${members.join(random() < 0.8 ? ' OR ' : pick(GROUP_PIECES))})`
    const pieces = Array.from({ length: Math.floor(random() * 3) }, () => pick(GROUP_PIECES))
    return random() < 0.5 ? written + pieces.join('') : pieces.join('') + written
  }
  return {
    string: () =>
      random() < 0.4
        ? Array.from({ length: 1 + Math.floor(random() * 3) }, () =>
            random() < 0.5 ? groupString() : text(8),
          ).join(' ')
        : text(24),
    token: parserShapedToken,
    freeTextToken,
    query: () => query(...Array.from({ length: Math.floor(random() * 5) }, anyTerm)),
  }
}

describe('parse/serialize is an inverse on what the parser produces (property)', () => {
  const generate = arbitrary(seededRandom(2250))

  it('the parser never throws, and parse ∘ serialize is the identity on parsed queries', () => {
    for (let run = 0; run < RUNS; run++) {
      const written = generate.string()
      const parsed = parseFilterQuery(written)
      expect(parseFilterQuery(serializeFilterQuery(parsed)), JSON.stringify(written)).toEqual(
        parsed,
      )
    }
  })

  it('produces negated, multi-value and empty tokens from what it is given', () => {
    const parsed = Array.from({ length: RUNS }, () => tokensOf(generate.string()))
    const terms = parsed.flat()
    const groups = Array.from({ length: RUNS }, () => parseFilterQuery(generate.string()).terms)
      .flat()
      .filter((term) => term.kind === 'group')
    expect(groups.length).toBeGreaterThan(0)
    expect(groups.some((term) => term.tokens.some((member) => member.field !== null))).toBe(true)
    expect(terms.some((term) => term.negated)).toBe(true)
    expect(terms.some((term) => term.values.length > 1)).toBe(true)
    expect(terms.some((term) => term.operator === 'empty')).toBe(true)
    expect(terms.some((term) => term.operator === 'range')).toBe(true)
    expect(terms.some((term) => term.operator === 'range' && term.negated)).toBe(true)
    expect(terms.some((term) => filterTokenRecordId(term) !== null)).toBe(true)
  })

  it('generates groups holding negated, multi-value, empty, #id and range tokens', () => {
    const generated = Array.from({ length: RUNS }, () => generate.query().terms).flat()
    const members = generated.flatMap((term) => (term.kind === 'group' ? term.tokens : []))
    expect(members.some((member) => member.negated)).toBe(true)
    expect(members.some((member) => member.values.length > 1)).toBe(true)
    expect(members.some((member) => member.operator === 'empty')).toBe(true)
    expect(members.some((member) => member.operator === 'range')).toBe(true)
    expect(members.some((member) => member.field === null)).toBe(true)
    expect(
      members.some((member) => member.values.some((value) => value.text.startsWith('#'))),
    ).toBe(true)
    const terms = generated.flatMap(filterTermTokens)
    expect(terms.some((term) => term.negated && term.values.length > 1)).toBe(true)
    expect(terms.some((term) => term.operator === 'empty')).toBe(true)
    expect(terms.some((term) => term.values.some((value) => value.text.startsWith('#')))).toBe(true)
    expect(terms.some((term) => term.operator === 'range' && term.negated)).toBe(true)
  })

  it('serialize ∘ parse is the identity on serialised queries', () => {
    for (let run = 0; run < RUNS; run++) {
      const serialised = serializeFilterQuery(generate.query())
      expect(serializeFilterQuery(parseFilterQuery(serialised)), serialised).toBe(serialised)
    }
  })

  it('a structured query reads back with the same fields, operators, negation and values', () => {
    for (let run = 0; run < RUNS; run++) {
      const original = generate.query()
      const readBack = parseFilterQuery(serializeFilterQuery(original))
      const label = JSON.stringify(original)
      const asRead = (source: FilterToken, read: FilterToken | undefined): FilterToken => ({
        ...source,
        values: source.values.map((value, at) => ({
          ...value,
          quoted: value.quoted || read?.values[at]?.quoted === true,
        })),
      })
      expect(readBack.terms.length, label).toBe(original.terms.length)
      readBack.terms.forEach((term, index) => {
        const source = original.terms[index]
        if (source.kind === 'group') {
          const members = term.kind === 'group' ? term.tokens : []
          expect(term, label).toEqual(
            group(...source.tokens.map((member, at) => asRead(member, members[at]))),
          )
          return
        }
        expect(term, label).toEqual(asRead(source, term.kind === 'token' ? term : undefined))
      })
    }
  })

  it('a related record id reads back as the same id, and label text never becomes one', () => {
    for (let run = 0; run < RUNS; run++) {
      const original = generate.query()
      const readBack = filterQueryTokens(parseFilterQuery(serializeFilterQuery(original)))
      const sources = original.terms.flatMap((term) =>
        filterTermTokens(term).map((source) => ({ source, inGroup: term.kind === 'group' })),
      )
      const label = JSON.stringify(original)
      expect(readBack.length, label).toBe(sources.length)
      readBack.forEach((term, index) => {
        const { source, inGroup } = sources[index]
        const id = filterTokenRecordId(source)
        if (source.values.some((value) => value.quoted)) {
          expect(filterTokenRecordId(term), label).toBeNull()
        }
        if (id !== null && !/[\s,"]/.test(id) && !(inGroup && /[()]/.test(id))) {
          expect(filterTokenRecordId(term), label).toBe(id)
        }
      })
    }
  })
})

describe('a range reads back as one range token (property)', () => {
  const generate = arbitrary(seededRandom(2252))

  it('every parsed range has two unquoted, comma-free bounds and writes back bare', () => {
    for (let run = 0; run < RUNS; run++) {
      const written = generate.string()
      for (const term of tokensOf(written)) {
        if (term.operator !== 'range') continue
        expect(term.values, JSON.stringify(written)).toHaveLength(2)
        expect(
          term.values.every((value) => !value.quoted && !value.text.includes(',')),
          JSON.stringify(written),
        ).toBe(true)
        const [low, high] = term.values
        expect(serializeFilterQuery(query(term)), JSON.stringify(written)).toBe(
          `${term.negated ? '-' : ''}${term.field}:${low.text}..${high.text}`,
        )
      }
    }
  })
})

const NASTY_BOUND = ['a', '1', 'Z', '(', ')', ',', '.', '..', '"', ' ', '-', ':', '#']
const PLAIN_MEMBERS: FilterToken[] = [
  token({ field: 'status', values: [v('a')] }),
  token({ values: [v('beta')] }),
  token({ field: 'a', operator: 'gte', values: [v('5')] }),
]

function rangeIsWritable(low: string, high: string, inGroup: boolean): boolean {
  const text = `${low}..${high}`
  if (low === '' || high === '' || /[\s,]/.test(text)) return false
  if (low.includes('..') || low.endsWith('.') || /^(?:[<>"]|\/\/)/.test(low)) return false
  return !(inGroup && /[()]/.test(text))
}

describe('a structured range with awkward bounds round-trips through its URL (property)', () => {
  const random = seededRandom(2270)
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]
  const bound = () =>
    Array.from({ length: 1 + Math.floor(random() * 4) }, () => pick(NASTY_BOUND)).join('')
  const nastyRange = () =>
    token({
      field: pick(FIELDS),
      operator: 'range',
      negated: random() < 0.3,
      values: [v(bound()), v(bound())],
    })
  const structured = (): { query: FilterQuery; ranges: FilterToken[]; inGroup: boolean } => {
    const ranges = Array.from({ length: 1 + Math.floor(random() * 2) }, nastyRange)
    if (random() < 0.25) return { query: query(...ranges), ranges, inGroup: false }
    const members = [...ranges, ...PLAIN_MEMBERS.slice(0, 1 + Math.floor(random() * 3))]
    const shuffled = members
      .map((member) => ({ member, at: random() }))
      .sort((a, b) => a.at - b.at)
      .map(({ member }) => member)
    return { query: query(group(...shuffled)), ranges, inGroup: true }
  }

  it('reads a writable range back as the same structured query', () => {
    let writable = 0
    let inGroup = 0
    for (let run = 0; run < RUNS * 2; run++) {
      const generated = structured()
      const fits = generated.ranges.every((range) =>
        rangeIsWritable(range.values[0].text, range.values[1].text, generated.inGroup),
      )
      if (!fits) continue
      writable++
      if (generated.inGroup) inGroup++
      const written = serializeFilterQuery(generated.query)
      expect(parseFilterQuery(written), written).toEqual(generated.query)
    }
    expect(writable).toBeGreaterThan(50)
    expect(inGroup).toBeGreaterThan(20)
  })

  it('writes an unwritable range as its literal `a..b`, and reads that back unchanged', () => {
    let unwritable = 0
    let parenInGroup = 0
    for (let run = 0; run < RUNS * 2; run++) {
      const generated = structured()
      const written = serializeFilterQuery(generated.query)
      const readBack = parseFilterQuery(written)
      const sources = filterQueryTokens(generated.query)
      const read = filterQueryTokens(readBack)
      expect(read.length, written).toBe(sources.length)
      sources.forEach((source, index) => {
        if (source.operator !== 'range') return
        const [low, high] = source.values
        if (rangeIsWritable(low.text, high.text, generated.inGroup)) return
        unwritable++
        if (generated.inGroup && rangeIsWritable(low.text, high.text, false)) parenInGroup++
        expect(read[index], written).toMatchObject({
          field: source.field,
          operator: 'eq',
          negated: source.negated,
          values: [{ text: `${low.text}..${high.text}` }],
        })
      })
      expect(parseFilterQuery(serializeFilterQuery(readBack)), written).toEqual(readBack)
    }
    expect(unwritable).toBeGreaterThan(50)
    expect(parenInGroup).toBeGreaterThan(5)
  })

  it('filters a structured query exactly as its URL does', () => {
    for (let run = 0; run < RUNS * 2; run++) {
      const generated = structured()
      const readBack = parseFilterQuery(serializeFilterQuery(generated.query))
      expect(
        buildFilterWhere(generated.query, PROPERTY_SPECS),
        JSON.stringify(generated.query),
      ).toEqual(buildFilterWhere(readBack, PROPERTY_SPECS))
    }
  })

  it('writes a member range whose bound holds a parenthesis as its quoted literal', () => {
    const range = token({ field: 'f', operator: 'range', values: [v('1'), v('2)')] })
    const written = serializeFilterQuery(query(group(range, token({ values: [v('b')] }))))
    expect(written).toBe('(f:"1..2)" OR b)')
    expect(parseFilterQuery(written).terms).toEqual([
      group(token({ field: 'f', values: [v('1..2)', true)] }), token({ values: [v('b')] })),
    ])
    expect(serializeFilterQuery(query(range))).toBe('f:1..2)')
  })
})

const TOP_LEVEL_BOUND = ['', '1', '2', '5', 'a', ',', '(', ')', '..', '.', '"', ' ', '-', '\\']
const TOP_LEVEL_RANGE_FIELDS = ['a', 'status', 'title', 'zz']

describe('a top-level structured range filters exactly as its URL does (property)', () => {
  const random = seededRandom(2271)
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]
  const bound = (): FilterValue =>
    v(
      Array.from({ length: Math.floor(random() * 3) }, () => pick(TOP_LEVEL_BOUND)).join(''),
      random() < 0.3,
    )
  const range = (): FilterToken =>
    token({
      field: pick(TOP_LEVEL_RANGE_FIELDS),
      operator: 'range',
      negated: random() < 0.4,
      values: [bound(), bound()],
    })
  const structured = (): FilterQuery => {
    const terms: FilterTerm[] = Array.from({ length: 1 + Math.floor(random() * 2) }, range)
    if (random() < 0.5) terms.push(pick(PLAIN_MEMBERS))
    return query(...terms)
  }

  it('builds the same condition from the query and from its URL, and writes a stable URL', () => {
    let quoted = 0
    let empty = 0
    for (let run = 0; run < RUNS * 2; run++) {
      const generated = structured()
      const ranges = filterQueryTokens(generated).filter((term) => term.operator === 'range')
      if (ranges.some((term) => term.values.some((value) => value.quoted))) quoted++
      if (ranges.some((term) => term.values.some((value) => value.text === ''))) empty++
      const written = serializeFilterQuery(generated)
      const readBack = parseFilterQuery(written)
      expect(buildFilterWhere(generated, PROPERTY_SPECS), JSON.stringify(generated)).toEqual(
        buildFilterWhere(readBack, PROPERTY_SPECS),
      )
      expect(serializeFilterQuery(readBack), written).toBe(written)
      expect(parseFilterQuery(serializeFilterQuery(readBack)), written).toEqual(readBack)
    }
    expect(quoted).toBeGreaterThan(50)
    expect(empty).toBeGreaterThan(50)
  })

  it.each([
    [
      '-a:"1..2"',
      token({ field: 'a', operator: 'range', negated: true, values: [v('1', true), v('2')] }),
    ],
    ['zz:..', token({ field: 'zz', operator: 'range', values: [v(''), v('')] })],
  ])('filters the hand-built range written %s as that URL does', (_written, range) => {
    const readBack = parseFilterQuery(serializeFilterQuery(query(range)))
    expect(buildFilterWhere(query(range), PROPERTY_SPECS)).toEqual(
      buildFilterWhere(readBack, PROPERTY_SPECS),
    )
  })

  it('keeps the range meaning of a writable top-level range', () => {
    const range = token({ field: 'a', operator: 'range', values: [v('1'), v('5')] })
    expect(serializeFilterQuery(query(range))).toBe('a:1..5')
    expect(buildFilterWhere(query(range), PROPERTY_SPECS)).toEqual({
      AND: [{ a: { gte: '1' } }, { a: { lte: '5' } }],
    })
  })
})

describe('a free-text word outside a group that would open one', () => {
  it('is quoted as the text it is written as, so a range keeps its `..`', () => {
    const structured = query(
      token({ operator: 'range', values: [v('(x'), v('y')] }),
      token({ values: [v('OR')] }),
      token({ values: [v('z)')] }),
    )
    const written = serializeFilterQuery(structured)
    expect(written).toBe('"(x..y" OR z)')
    expect(tokensOf(written)[0].values).toEqual([v('(x..y', true)])
    expect(buildFilterWhere(structured, PROPERTY_SPECS)).toEqual(
      buildFilterWhere(parseFilterQuery(written), PROPERTY_SPECS),
    )
  })
})

describe('a related record id token', () => {
  it('serialises as field:#id and reads back as that id', () => {
    const written = serializeFilterQuery(query(recordIdFilterToken('author', '42')))
    expect(written).toBe('author:#42')
    expect(tokensOf(written).map(filterTokenRecordId)).toEqual(['42'])
  })

  it('is not read from a quoted value, a free-text word or a comparison', () => {
    expect(tokensOf('author:"#42" #42 views:>#42').map(filterTokenRecordId)).toEqual([
      null,
      null,
      null,
    ])
  })

  it('names no single record when negated or listing several ids', () => {
    expect(tokensOf('-author:#42 author:#1,#2').map(filterTokenRecordId)).toEqual([null, null])
  })

  it('serialises negated as -field:#id', () => {
    expect(serializeFilterQuery(query(recordIdFilterToken('author', '42', true)))).toBe(
      '-author:#42',
    )
  })
})

describe('quoteFilterValue reads back as exactly one value (property)', () => {
  const generate = arbitrary(seededRandom(2256))
  const fixed = [
    '',
    '"',
    'a" status:published',
    '\\',
    'a\\',
    'a\\"',
    '\\\\"b',
    'Ada\nLovelace',
    '\t\r\n',
    'a,b',
    ',',
    '-',
    '-Ada',
    '!',
    '-!',
    '..',
    '1..5',
    '>5',
    '>=',
    '//x',
    'status:draft',
    '#abc',
  ]

  it('parses field:quoteFilterValue(text) as one eq token whose value is text', () => {
    const texts = [...fixed, ...Array.from({ length: RUNS }, () => generate.string())]
    for (const text of texts) {
      for (const field of FIELDS) {
        expect(
          parseFilterQuery(`${field}:${quoteFilterValue(text)}`),
          JSON.stringify(text),
        ).toEqual(query(token({ field, values: [v(text, true)] })))
      }
    }
  })
})

const PROPERTY_SPECS: Record<string, FilterSpec> = {
  title: {
    operators: ['eq'],
    freeText: true,
    toCondition: (operator, value) => (operator === 'eq' ? { title: { contains: value } } : null),
    suggestions: { valueSource: { kind: 'none' } },
  },
  a: {
    operators: ['eq', 'gte', 'lte'],
    toCondition: (operator, value) =>
      /^\d+$/.test(value) ? { a: { [operator === 'eq' ? 'equals' : operator]: value } } : null,
    empty: { a: { equals: null } },
    suggestions: { valueSource: { kind: 'none' } },
  },
  status: {
    operators: ['eq'],
    toCondition: (_operator, value) => (value === 'a' ? { status: { equals: 'a' } } : null),
    empty: { status: { equals: null } },
    suggestions: { valueSource: { kind: 'none' } },
  },
}

describe('buildFilterWhere reads a structured token as its serialised URL reads back (property)', () => {
  const generate = arbitrary(seededRandom(2265))

  it('agrees on multi-value free-text tokens', () => {
    let multiValue = 0
    for (let run = 0; run < RUNS; run++) {
      const free = generate.freeTextToken()
      const structured = query(free)
      if (free.values.length > 1) multiValue++
      const readBack = parseFilterQuery(serializeFilterQuery(structured))
      expect(buildFilterWhere(structured, PROPERTY_SPECS), JSON.stringify(structured)).toEqual(
        buildFilterWhere(readBack, PROPERTY_SPECS),
      )
    }
    expect(multiValue).toBeGreaterThan(0)
  })

  it('agrees on parser-shaped queries', () => {
    for (let run = 0; run < RUNS; run++) {
      const structured = generate.query()
      const readBack = parseFilterQuery(serializeFilterQuery(structured))
      expect(buildFilterWhere(structured, PROPERTY_SPECS), JSON.stringify(structured)).toEqual(
        buildFilterWhere(readBack, PROPERTY_SPECS),
      )
    }
  })
})
