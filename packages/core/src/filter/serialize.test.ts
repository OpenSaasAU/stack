import { describe, it, expect } from 'vitest'
import { parseFilterQuery } from './parse.js'
import { serializeFilterQuery } from './serialize.js'
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
    '"C:\\Users me"',
  ]

  it.each(queries)('serialize(parse(%s)) reproduces the query', (written) => {
    expect(serializeFilterQuery(parseFilterQuery(written))).toBe(written)
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
]
const TRICKY_PREFIXES = ['', '', '"', '//', '>', '<', '=', '>=', 'status:', 'a:"', '\\', ' ']
const OPERATORS: FilterOperator[] = ['eq', 'gt', 'gte', 'lt', 'lte']
const FIELDS = ['status', 'a', '_b1', 'http', 'OR']
const RUNS = 2000

function arbitrary(random: () => number) {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]
  const text = (max: number) =>
    pick(TRICKY_PREFIXES) +
    Array.from({ length: Math.floor(random() * (max + 1)) }, () => pick(ALPHABET)).join('')
  const arbitraryToken = (): FilterToken => {
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
    query: () => query(...Array.from({ length: Math.floor(random() * 5) }, arbitraryToken)),
  }
}

describe('parse/serialize is a true inverse (property)', () => {
  const generate = arbitrary(seededRandom(2248))

  it('the parser never throws, and parse ∘ serialize is the identity on parsed queries', () => {
    for (let run = 0; run < RUNS; run++) {
      const written = generate.string()
      const parsed = parseFilterQuery(written)
      expect(parseFilterQuery(serializeFilterQuery(parsed)), JSON.stringify(written)).toEqual(
        parsed,
      )
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
})
