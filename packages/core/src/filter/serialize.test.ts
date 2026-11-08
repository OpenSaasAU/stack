import { describe, it, expect } from 'vitest'
import { parseFilterQuery } from './parse.js'
import { quoteFilterValue, serializeFilterQuery } from './serialize.js'
import { buildFilterWhere } from './map.js'
import type {
  FilterOperator,
  FilterQuery,
  FilterSpec,
  FilterToken,
  FilterTokenOperator,
  FilterValue,
} from './types.js'

const v = (text: string, quoted = false): FilterValue => ({ text, quoted })

const token = (partial: Partial<FilterToken>): FilterToken => ({
  kind: 'token',
  field: null,
  operator: 'eq',
  negated: false,
  values: [v('')],
  ...partial,
})

const query = (...terms: FilterToken[]): FilterQuery => ({ terms })

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
    const readBack = parseFilterQuery(
      serializeFilterQuery(query(token({ values: [] }), token({ values: [v('x')] }))),
    )
    expect(readBack.terms.map((term) => term.values.map((value) => value.text))).toEqual([
      [''],
      ['x'],
    ])
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
    '-status:draft -beta --x -"a b"',
    'status:draft,review status:a,"b c" status:a,b c',
    'status:! -status:! status:"!" status:!,a status:!x',
    ', a,b role:, role:a,',
    '-http://x -orders:>5,6',
  ]

  it.each(queries)('serialize(parse(%s)) reproduces the query', (written) => {
    expect(serializeFilterQuery(parseFilterQuery(written))).toBe(written)
  })

  it('tells `a,"b c"` from `a,b c` by its per-value quoting', () => {
    const quoted = parseFilterQuery('status:a,"b c"')
    const split = parseFilterQuery('status:a,b c')
    expect(quoted.terms).toHaveLength(1)
    expect(quoted.terms[0].values).toEqual([v('a'), v('b c', true)])
    expect(split.terms.map((term) => term.values)).toEqual([[v('a'), v('b')], [v('c')]])
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
  'a:!',
  '!',
  '-a:!',
  'a:x,',
]
const OPERATORS: FilterTokenOperator[] = ['eq', 'gt', 'gte', 'lt', 'lte', 'empty']
const FIELDS = ['status', 'a', '_b1', 'http', 'OR']
const RUNS = 2000

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
  return {
    string: () => text(24),
    token: parserShapedToken,
    freeTextToken,
    query: () => query(...Array.from({ length: Math.floor(random() * 5) }, parserShapedToken)),
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
    const parsed = Array.from({ length: RUNS }, () => parseFilterQuery(generate.string()).terms)
    const terms = parsed.flat()
    expect(terms.some((term) => term.negated)).toBe(true)
    expect(terms.some((term) => term.values.length > 1)).toBe(true)
    expect(terms.some((term) => term.operator === 'empty')).toBe(true)
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
      expect(readBack.terms.length, label).toBe(original.terms.length)
      readBack.terms.forEach((term, index) => {
        const source = original.terms[index]
        expect(term, label).toEqual({
          ...source,
          values: source.values.map((value, at) => ({
            ...value,
            quoted: value.quoted || term.values[at]?.quoted === true,
          })),
        })
      })
    }
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
        expect(parseFilterQuery(`${field}:${quoteFilterValue(text)}`), JSON.stringify(text)).toEqual(
          query(token({ field, values: [v(text, true)] })),
        )
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
      const structured = query(generate.freeTextToken())
      if (structured.terms[0].values.length > 1) multiValue++
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
