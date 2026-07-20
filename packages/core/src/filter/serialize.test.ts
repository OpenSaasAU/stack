import { describe, it, expect } from 'vitest'
import { parseFilterQuery } from './parse.js'
import { serializeFilterQuery } from './serialize.js'
import type { FilterToken } from './types.js'

// ─────────────────────────────────────────────────────────────
// serializeFilterQuery — the pure tokens → query-string boundary
// (ADR-0017). The exact inverse of parseFilterQuery; this is the
// grammar the Filter builder UI produces into the `?search=` param.
// ─────────────────────────────────────────────────────────────

const token = (partial: Partial<FilterToken>): FilterToken => ({
  field: null,
  operator: 'eq',
  value: '',
  raw: '',
  ...partial,
})

describe('serializeFilterQuery', () => {
  it('serialises a bare free-text word', () => {
    expect(serializeFilterQuery([token({ field: null, value: 'beta' })])).toBe('beta')
  })

  it('serialises a field:value token with the default eq operator', () => {
    expect(serializeFilterQuery([token({ field: 'role', value: 'Editor' })])).toBe('role:Editor')
  })

  it('serialises each comparison operator as its prefix', () => {
    expect(serializeFilterQuery([token({ field: 'orders', operator: 'gt', value: '5' })])).toBe(
      'orders:>5',
    )
    expect(serializeFilterQuery([token({ field: 'orders', operator: 'gte', value: '5' })])).toBe(
      'orders:>=5',
    )
    expect(serializeFilterQuery([token({ field: 'orders', operator: 'lt', value: '5' })])).toBe(
      'orders:<5',
    )
    expect(serializeFilterQuery([token({ field: 'orders', operator: 'lte', value: '5' })])).toBe(
      'orders:<=5',
    )
  })

  it('quotes a field value containing whitespace', () => {
    expect(serializeFilterQuery([token({ field: 'name', value: 'Ada Lovelace' })])).toBe(
      'name:"Ada Lovelace"',
    )
  })

  it('quotes a bare word containing whitespace', () => {
    expect(serializeFilterQuery([token({ field: null, value: 'multi word' })])).toBe('"multi word"')
  })

  it('quotes an eq value that would otherwise read as a comparison operator', () => {
    // Without the guard, `field:>5` would re-parse as gt, not eq of ">5".
    expect(serializeFilterQuery([token({ field: 'note', operator: 'eq', value: '>5' })])).toBe(
      'note:">5"',
    )
  })

  it('does NOT quote a leading > on a bare word (parser keeps it literal)', () => {
    expect(serializeFilterQuery([token({ field: null, value: '>5' })])).toBe('>5')
  })

  it('joins tokens with the grammar implicit AND (a single space)', () => {
    expect(
      serializeFilterQuery([
        token({ field: 'role', value: 'Editor' }),
        token({ field: 'orders', operator: 'gt', value: '5' }),
        token({ field: null, value: 'beta' }),
      ]),
    ).toBe('role:Editor orders:>5 beta')
  })

  it('omits tokens with an empty value (no dangling field: or stray quotes)', () => {
    expect(
      serializeFilterQuery([
        token({ field: 'role', value: '' }),
        token({ field: null, value: '' }),
        token({ field: 'name', value: 'Ada' }),
      ]),
    ).toBe('name:Ada')
  })
})

// ─────────────────────────────────────────────────────────────
// Round-trip: parse ∘ serialize is stable, and serialize ∘ parse
// reproduces the meaning the engine assigns.
// ─────────────────────────────────────────────────────────────

describe('parse/serialize round-trip', () => {
  const queries = [
    'beta',
    'role:Editor',
    'orders:>5',
    'orders:>=5',
    'orders:<10',
    'name:"Ada Lovelace"',
    'role:Editor orders:>5 name:"Ada Lovelace" beta',
    '"multi word" gamma',
  ]

  it.each(queries)('serialize(parse(%s)) reproduces the query', (query) => {
    expect(serializeFilterQuery(parseFilterQuery(query))).toBe(query)
  })

  it.each(queries)('parse is idempotent through a serialize round-trip: %s', (query) => {
    const once = parseFilterQuery(query)
    const twice = parseFilterQuery(serializeFilterQuery(once))
    // Compare on the semantic fields (raw differs after re-serialisation).
    const strip = (tokens: FilterToken[]) =>
      tokens.map(({ field, operator, value }) => ({ field, operator, value }))
    expect(strip(twice)).toEqual(strip(once))
  })
})
