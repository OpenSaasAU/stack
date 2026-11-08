import { describe, it, expect } from 'vitest'
import { parseFilterQuery } from './parse.js'
import { serializeFilterQuery } from './serialize.js'
import { filterTokenRecordId, recordIdFilterToken } from './record-id.js'
import type { FilterOperator, FilterQuery, FilterToken } from './types.js'

const token = (partial: Partial<FilterToken>): FilterToken => ({
  kind: 'token',
  field: null,
  operator: 'eq',
  negated: false,
  values: [''],
  quoted: false,
  ...partial,
})

const query = (...terms: FilterToken[]): FilterQuery => ({ terms })

describe('serializeFilterQuery', () => {
  it('serialises a bare free-text word', () => {
    expect(serializeFilterQuery(query(token({ values: ['beta'] })))).toBe('beta')
  })

  it('serialises a field:value token with the default eq operator', () => {
    expect(serializeFilterQuery(query(token({ field: 'role', values: ['Editor'] })))).toBe(
      'role:Editor',
    )
  })

  it.each<[FilterOperator, string]>([
    ['gt', 'orders:>5'],
    ['gte', 'orders:>=5'],
    ['lt', 'orders:<5'],
    ['lte', 'orders:<=5'],
  ])('serialises the %s operator as its prefix', (operator, expected) => {
    expect(serializeFilterQuery(query(token({ field: 'orders', operator, values: ['5'] })))).toBe(
      expected,
    )
  })

  it('quotes a value containing whitespace', () => {
    expect(serializeFilterQuery(query(token({ field: 'name', values: ['Ada Lovelace'] })))).toBe(
      'name:"Ada Lovelace"',
    )
    expect(serializeFilterQuery(query(token({ values: ['multi word'] })))).toBe('"multi word"')
  })

  it('keeps a value quoted when the token says it was quoted', () => {
    expect(serializeFilterQuery(query(token({ values: ['beta'], quoted: true })))).toBe('"beta"')
  })

  it('escapes an embedded quote as \\"', () => {
    expect(
      serializeFilterQuery(query(token({ field: 'name', values: ['Ada "the Countess"'] }))),
    ).toBe('name:"Ada \\"the Countess\\""')
  })

  it('escapes a backslash only where it would otherwise read as an escape', () => {
    expect(serializeFilterQuery(query(token({ values: ['ends in \\'] })))).toBe('"ends in \\\\"')
    expect(serializeFilterQuery(query(token({ values: ['C:\\Users me'] })))).toBe('"C:\\Users me"')
  })

  it('quotes a free-text word that would otherwise read back as a field token', () => {
    expect(serializeFilterQuery(query(token({ values: ['status:draft'] })))).toBe('"status:draft"')
  })

  it('leaves a URL bare, since its scheme is not a field prefix', () => {
    expect(serializeFilterQuery(query(token({ values: ['http://x'] })))).toBe('http://x')
  })

  it('quotes an eq value that would otherwise read as a comparison operator', () => {
    expect(serializeFilterQuery(query(token({ field: 'note', values: ['>5'] })))).toBe('note:">5"')
    expect(
      serializeFilterQuery(query(token({ field: 'orders', operator: 'gt', values: ['=5'] }))),
    ).toBe('orders:>"=5"')
  })

  it('does NOT quote a leading > on a bare word (parser keeps it literal)', () => {
    expect(serializeFilterQuery(query(token({ values: ['>5'] })))).toBe('>5')
  })

  it('writes an empty value as written: `field:` and `""`', () => {
    expect(serializeFilterQuery(query(token({ field: 'role', values: [''] })))).toBe('role:')
    expect(serializeFilterQuery(query(token({ values: [''] })))).toBe('""')
  })

  it.each(['\u00a0', '\f', '\v', '\u2028', '\u3000'])(
    'quotes a value containing the whitespace %j',
    (space) => {
      expect(serializeFilterQuery(query(token({ field: 'title', values: [`Ada${space}`] })))).toBe(
        `title:"Ada${space}"`,
      )
      expect(serializeFilterQuery(query(token({ values: [space] })))).toBe(`"${space}"`)
    },
  )

  it('quotes a value containing a comma, so it never reads as a list once #2250 lands', () => {
    expect(serializeFilterQuery(query(token({ field: 'title', values: ['a,b'] })))).toBe(
      'title:"a,b"',
    )
    expect(serializeFilterQuery(query(token({ field: 'title', values: ['a', 'b'] })))).toBe(
      'title:a,b',
    )
    expect(serializeFilterQuery(query(token({ field: 'title', values: ['a', 'b c,d'] })))).toBe(
      'title:a,"b c,d"',
    )
  })

  it('quotes a free-text word starting with `-`, so it never reads as negation', () => {
    expect(serializeFilterQuery(query(token({ values: ['-beta'] })))).toBe('"-beta"')
    expect(serializeFilterQuery(query(token({ values: ['beta'], negated: true })))).toBe('-beta')
    expect(serializeFilterQuery(query(token({ values: ['-'] })))).toBe('-')
    expect(
      serializeFilterQuery(query(token({ field: 'status', values: ['draft'], negated: true }))),
    ).toBe('-status:draft')
  })

  it('joins terms with the grammar implicit AND (a single space)', () => {
    expect(
      serializeFilterQuery(
        query(
          token({ field: 'role', values: ['Editor'] }),
          token({ field: 'orders', operator: 'gt', values: ['5'] }),
          token({ values: ['beta'] }),
        ),
      ),
    ).toBe('role:Editor orders:>5 beta')
  })
})

describe('serializing a token with no values', () => {
  it('writes it as an empty token, never as an empty term', () => {
    expect(serializeFilterQuery(query(token({ values: [] }), token({ values: ['x'] })))).toBe(
      '"" x',
    )
    expect(serializeFilterQuery(query(token({ field: 'role', values: [] })))).toBe('role:')
  })

  it('reads back as the same number of terms, the first one empty', () => {
    const readBack = parseFilterQuery(
      serializeFilterQuery(query(token({ values: [] }), token({ values: ['x'] }))),
    )
    expect(readBack.terms.map((term) => term.values)).toEqual([[''], ['x']])
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
    'author:#0190a3c2-7b1e-7000-8000-000000000001',
    'author:"#42" owner:#42 #42',
  ]

  it.each(queries)('serialize(parse(%s)) reproduces the query', (written) => {
    expect(serializeFilterQuery(parseFilterQuery(written))).toBe(written)
  })

  it.each([
    ['status:draft,review', 'status:"draft,review"'],
    [',', '","'],
    ['role:,', 'role:","'],
    ['-beta', '"-beta"'],
    ['-status:draft', '"-status:draft"'],
  ])('canonicalises %s to %s, with the same meaning', (written, canonical) => {
    const parsed = parseFilterQuery(written)
    expect(serializeFilterQuery(parsed)).toBe(canonical)
    expect(parseFilterQuery(canonical)).toEqual({
      terms: parsed.terms.map((term) => ({ ...term, quoted: true })),
    })
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
  ',',
  '-status:',
  'a,',
  '#',
  '"#',
]
const OPERATORS: FilterOperator[] = ['eq', 'gt', 'gte', 'lt', 'lte']
const FIELDS = ['status', 'a', '_b1', 'http', 'OR']
const RUNS = 2000

function arbitrary(random: () => number) {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]
  const text = (max: number) =>
    pick(TRICKY_PREFIXES) +
    Array.from({ length: Math.floor(random() * (max + 1)) }, () => pick(ALPHABET)).join('')
  const parserShapedToken = (): FilterToken => {
    const field = random() < 0.5 ? null : pick(FIELDS)
    return token({
      field,
      operator: field === null ? 'eq' : pick(OPERATORS),
      values: [text(8)],
      quoted: random() < 0.3,
    })
  }
  return {
    string: () => text(24),
    token: parserShapedToken,
    query: () => query(...Array.from({ length: Math.floor(random() * 5) }, parserShapedToken)),
  }
}

const quotedOnceSerialised = (term: FilterToken): boolean =>
  term.quoted ||
  term.values[0].includes(',') ||
  (term.field === null && term.values[0].startsWith('-') && term.values[0] !== '-')

describe('parse/serialize is an inverse on what the parser produces (property)', () => {
  const generate = arbitrary(seededRandom(2248))

  it('the parser never throws, and parse ∘ serialize is the identity on parsed queries', () => {
    for (let run = 0; run < RUNS; run++) {
      const written = generate.string()
      const parsed = parseFilterQuery(written)
      expect(parseFilterQuery(serializeFilterQuery(parsed)), JSON.stringify(written)).toEqual({
        terms: parsed.terms.map((term) => ({ ...term, quoted: quotedOnceSerialised(term) })),
      })
    }
  })

  it('serialize ∘ parse is the identity on serialised queries', () => {
    for (let run = 0; run < RUNS; run++) {
      const serialised = serializeFilterQuery(generate.query())
      expect(serializeFilterQuery(parseFilterQuery(serialised)), serialised).toBe(serialised)
    }
  })

  it('a structured query reads back with the same fields, operators and values', () => {
    for (let run = 0; run < RUNS; run++) {
      const original = generate.query()
      const readBack = parseFilterQuery(serializeFilterQuery(original))
      const label = JSON.stringify(original)
      expect(readBack.terms.length, label).toBe(original.terms.length)
      readBack.terms.forEach((term, index) => {
        const source = original.terms[index]
        expect(term, label).toEqual({ ...source, quoted: source.quoted || term.quoted })
      })
    }
  })

  it('a related record id reads back as the same id, and label text never becomes one', () => {
    for (let run = 0; run < RUNS; run++) {
      const original = generate.query()
      const readBack = parseFilterQuery(serializeFilterQuery(original))
      const label = JSON.stringify(original)
      readBack.terms.forEach((term, index) => {
        const source = original.terms[index]
        const id = filterTokenRecordId(source)
        if (source.quoted) expect(filterTokenRecordId(term), label).toBeNull()
        else if (id !== null && !/[\s,"]/.test(id)) {
          expect(filterTokenRecordId(term), label).toBe(id)
        }
      })
    }
  })
})

describe('a related record id token', () => {
  it('serialises as field:#id and reads back as that id', () => {
    const written = serializeFilterQuery(query(recordIdFilterToken('author', '42')))
    expect(written).toBe('author:#42')
    expect(parseFilterQuery(written).terms.map(filterTokenRecordId)).toEqual(['42'])
  })

  it('is not read from a quoted value, a free-text word or a comparison', () => {
    expect(parseFilterQuery('author:"#42" #42 views:>#42').terms.map(filterTokenRecordId)).toEqual([
      null,
      null,
      null,
    ])
  })
})

describe('serialising a token the parser never produces (property)', () => {
  const generate = arbitrary(seededRandom(2250))

  it('writes a multi-value or negated token distinct from the single literal value it would join to', () => {
    for (let run = 0; run < RUNS; run++) {
      const single = generate.token()
      const [value] = single.values
      const label = JSON.stringify(single)
      if (value.includes(',')) {
        const multi = { ...single, quoted: false, values: value.split(',') }
        expect(serializeFilterQuery(query(multi)), label).not.toBe(
          serializeFilterQuery(query({ ...single, quoted: false })),
        )
      }
      if (single.field === null && value.startsWith('-') && value !== '-') {
        const negated = { ...single, quoted: false, negated: true, values: [value.slice(1)] }
        expect(serializeFilterQuery(query(negated)), label).not.toBe(
          serializeFilterQuery(query({ ...single, quoted: false })),
        )
      }
    }
  })
})
