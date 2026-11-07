import type { FilterOperator, FilterQuery, FilterToken } from './types.js'

const FIELD_PREFIX_RE = /([A-Za-z_][A-Za-z0-9_]*):/y

const WHITESPACE_RE = /\s/

const COMPARISON_PREFIXES: ReadonlyArray<readonly [string, FilterOperator]> = [
  ['>=', 'gte'],
  ['<=', 'lte'],
  ['>', 'gt'],
  ['<', 'lt'],
]

export function isFilterWhitespace(ch: string): boolean {
  return WHITESPACE_RE.test(ch)
}

/**
 * The length of the field prefix (`name:`) at `start` in `text`, or `0` when
 * there is none. A `word:` followed by `//` is a URL scheme, not a field.
 */
export function fieldPrefixLength(text: string, start = 0): number {
  FIELD_PREFIX_RE.lastIndex = start
  const match = FIELD_PREFIX_RE.exec(text)
  if (!match || text.startsWith('//', start + match[0].length)) return 0
  return match[0].length
}

/**
 * Parse a filter query string into a structured {@link FilterQuery}
 * (ADR-0017, ADR-0083). Never throws: input it cannot read as syntax parses as
 * bare free-text words.
 *
 * - `field:value` is a field token with the `eq` operator, and `field:>value`,
 *   `field:>=value`, `field:<value`, `field:<=value` are comparisons.
 * - A leading `-` followed by more of the token negates it: `-status:draft`.
 * - Commas separate a token's values: `status:draft,review`.
 * - A value in double quotes keeps its spaces and commas and is literal:
 *   `"status:draft"` is a free-text word. Inside quotes, `\"` is a quote and
 *   `\\` a backslash; any other backslash is itself. A token is `quoted` when
 *   its first value is.
 * - Anything else (`beta`, `>5`, `http://x`) is a free-text word (`field: null`).
 *
 * Validating fields and values is the engine's job, where a token that cannot
 * map degrades to free text. {@link serializeFilterQuery} is the inverse.
 *
 * @example
 * parseFilterQuery('role:Editor orders:>5 name:"Ada Lovelace" beta')
 * // { terms: [
 * //   { kind: 'token', field: 'role',   operator: 'eq', negated: false, values: ['Editor'],       quoted: false },
 * //   { kind: 'token', field: 'orders', operator: 'gt', negated: false, values: ['5'],            quoted: false },
 * //   { kind: 'token', field: 'name',   operator: 'eq', negated: false, values: ['Ada Lovelace'], quoted: true },
 * //   { kind: 'token', field: null,     operator: 'eq', negated: false, values: ['beta'],         quoted: false },
 * // ] }
 */
export function parseFilterQuery(query: string): FilterQuery {
  const terms: FilterToken[] = []
  const n = query.length
  let i = 0

  const readValue = (): { value: string; quoted: boolean } => {
    if (query[i] !== '"') {
      const start = i
      while (i < n && query[i] !== ',' && !isFilterWhitespace(query[i])) i++
      return { value: query.slice(start, i), quoted: false }
    }
    i++
    let value = ''
    while (i < n && query[i] !== '"') {
      const next = query[i + 1]
      if (query[i] === '\\' && (next === '"' || next === '\\')) {
        value += next
        i += 2
      } else {
        value += query[i]
        i++
      }
    }
    if (i < n) i++
    return { value, quoted: true }
  }

  while (i < n) {
    while (i < n && isFilterWhitespace(query[i])) i++
    if (i >= n) break

    const negated = query[i] === '-' && i + 1 < n && !isFilterWhitespace(query[i + 1])
    if (negated) i++

    let field: string | null = null
    const prefixLength = fieldPrefixLength(query, i)
    if (prefixLength > 0) {
      field = query.slice(i, i + prefixLength - 1)
      i += prefixLength
    }

    let operator: FilterOperator = 'eq'
    if (field !== null) {
      const comparison = COMPARISON_PREFIXES.find(([prefix]) => query.startsWith(prefix, i))
      if (comparison) {
        operator = comparison[1]
        i += comparison[0].length
      }
    }

    const first = readValue()
    const values = [first.value]
    while (query[i] === ',') {
      i++
      values.push(readValue().value)
    }

    terms.push({ kind: 'token', field, operator, negated, values, quoted: first.quoted })
  }

  return { terms }
}
