import type { FilterOperator, FilterToken } from './types.js'

/**
 * A field prefix is an identifier (letter/underscore, then word chars)
 * immediately followed by a colon, e.g. `role:` or `orders:`.
 */
const FIELD_PREFIX_RE = /^([A-Za-z_][A-Za-z0-9_]*):/

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'
}

/**
 * Parse a filter query string into {@link FilterToken}s (ADR-0017 grammar).
 *
 * Pure and field-agnostic: it recognises the *syntax* (field prefix, comparison
 * operator, quoted value, bare word) but never validates field names or values
 * — that is the mapping step's job, where unknown/unmappable tokens degrade to
 * free text. This parser therefore never throws; malformed input simply parses
 * as bare free-text words.
 *
 * Grammar:
 * - `field:value` → a field token with the `eq` operator.
 * - `field:>value`, `field:>=value`, `field:<value`, `field:<=value` →
 *   comparison operators.
 * - `field:"multi word"` / bare `"multi word"` → quoted values keep spaces.
 * - anything else (`beta`, `>5`, `http://x`) → a bare free-text token
 *   (`field: null`).
 *
 * @example
 * parseFilterQuery('role:Editor orders:>5 name:"Ada Lovelace" beta')
 * // [
 * //   { field: 'role',   operator: 'eq',  value: 'Editor',       raw: 'role:Editor' },
 * //   { field: 'orders', operator: 'gt',  value: '5',            raw: 'orders:>5' },
 * //   { field: 'name',   operator: 'eq',  value: 'Ada Lovelace', raw: 'name:"Ada Lovelace"' },
 * //   { field: null,     operator: 'eq',  value: 'beta',         raw: 'beta' },
 * // ]
 */
export function parseFilterQuery(query: string): FilterToken[] {
  const tokens: FilterToken[] = []
  if (!query) return tokens

  const n = query.length
  let i = 0

  while (i < n) {
    // Skip leading whitespace between tokens.
    while (i < n && isWhitespace(query[i])) i++
    if (i >= n) break

    const start = i

    // Optional `field:` prefix.
    let field: string | null = null
    const prefixMatch = FIELD_PREFIX_RE.exec(query.slice(i))
    if (prefixMatch) {
      field = prefixMatch[1]
      i += prefixMatch[0].length
    }

    // Comparison operator prefix — only meaningful once a field is present.
    // A leading `>`/`<` on a bare word is left as part of the free-text value.
    let operator: FilterOperator = 'eq'
    if (field) {
      if (query.startsWith('>=', i)) {
        operator = 'gte'
        i += 2
      } else if (query.startsWith('<=', i)) {
        operator = 'lte'
        i += 2
      } else if (query[i] === '>') {
        operator = 'gt'
        i += 1
      } else if (query[i] === '<') {
        operator = 'lt'
        i += 1
      }
    }

    // Value: quoted (spaces kept) or a run up to the next whitespace.
    let value = ''
    if (query[i] === '"') {
      i++ // opening quote
      while (i < n && query[i] !== '"') {
        value += query[i]
        i++
      }
      if (i < n) i++ // closing quote
    } else {
      while (i < n && !isWhitespace(query[i])) {
        value += query[i]
        i++
      }
    }

    tokens.push({ field, operator, value, raw: query.slice(start, i) })
  }

  return tokens
}
