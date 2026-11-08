import type { FilterOperator, FilterQuery, FilterToken, FilterValue } from './types.js'

const FIELD_PREFIX_RE = /([A-Za-z_][A-Za-z0-9_]*):/y

const WHITESPACE_RE = /\s/

const FILTER_OPERATORS: readonly FilterOperator[] = ['eq', 'gt', 'gte', 'lt', 'lte']

/**
 * The prefix each {@link FilterOperator} is written with after `field:`: none
 * for `eq`, and `>`, `>=`, `<`, `<=` for the comparisons.
 */
export const FILTER_OPERATOR_PREFIXES: Readonly<Record<FilterOperator, string>> = {
  eq: '',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
}

/**
 * Every comparison prefix and its operator, longest prefix first, so a reader
 * matching them in order takes `>=` before `>`.
 */
export const FILTER_COMPARISON_PREFIXES: ReadonlyArray<readonly [string, FilterOperator]> =
  FILTER_OPERATORS.filter((operator) => FILTER_OPERATOR_PREFIXES[operator] !== '')
    .map((operator): readonly [string, FilterOperator] => [
      FILTER_OPERATOR_PREFIXES[operator],
      operator,
    ])
    .sort((a, b) => b[0].length - a[0].length)

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
 * - `field:a,b` carries several values, and `field:!` is the `empty` operator.
 * - A leading `-` followed by more of the token negates it: `-field:value`.
 *   A `-` on its own is a free-text word.
 * - A value in double quotes keeps its spaces and commas and is literal:
 *   `"status:draft"` is a free-text word and `field:"!"` the text `!`. Inside
 *   quotes, `\"` is a quote and `\\` a backslash; any other backslash is itself.
 * - Anything else (`beta`, `>5`, `http://x`) is a free-text word (`field: null`),
 *   whose commas are ordinary characters.
 *
 * Validating fields and values is the engine's job, where a token that cannot
 * map degrades to free text. {@link serializeFilterQuery} is the inverse.
 *
 * @example
 * parseFilterQuery('-role:Editor status:draft,review name:"Ada Lovelace" beta')
 * // { terms: [
 * //   { kind: 'token', field: 'role',   operator: 'eq', negated: true,  values: [{ text: 'Editor', quoted: false }] },
 * //   { kind: 'token', field: 'status', operator: 'eq', negated: false, values: [{ text: 'draft', quoted: false }, { text: 'review', quoted: false }] },
 * //   { kind: 'token', field: 'name',   operator: 'eq', negated: false, values: [{ text: 'Ada Lovelace', quoted: true }] },
 * //   { kind: 'token', field: null,     operator: 'eq', negated: false, values: [{ text: 'beta', quoted: false }] },
 * // ] }
 */
export function parseFilterQuery(query: string): FilterQuery {
  const terms: FilterToken[] = []
  const n = query.length
  let i = 0

  const endsToken = (at: number) => at >= n || isFilterWhitespace(query[at])

  const readValue = (inList: boolean): FilterValue => {
    if (query[i] !== '"') {
      const start = i
      while (!endsToken(i) && !(inList && query[i] === ',')) i++
      return { text: query.slice(start, i), quoted: false }
    }
    i++
    let text = ''
    while (i < n && query[i] !== '"') {
      const next = query[i + 1]
      if (query[i] === '\\' && (next === '"' || next === '\\')) {
        text += next
        i += 2
      } else {
        text += query[i]
        i++
      }
    }
    if (i < n) i++
    return { text, quoted: true }
  }

  while (i < n) {
    while (i < n && isFilterWhitespace(query[i])) i++
    if (i >= n) break

    const negated = query[i] === '-' && !endsToken(i + 1)
    if (negated) i++

    const prefixLength = fieldPrefixLength(query, i)
    if (prefixLength === 0) {
      terms.push({
        kind: 'token',
        field: null,
        operator: 'eq',
        negated,
        values: [readValue(false)],
      })
      continue
    }
    const field = query.slice(i, i + prefixLength - 1)
    i += prefixLength

    let operator: FilterOperator = 'eq'
    const comparison = FILTER_COMPARISON_PREFIXES.find(([prefix]) => query.startsWith(prefix, i))
    if (comparison) {
      operator = comparison[1]
      i += comparison[0].length
    }

    if (operator === 'eq' && query[i] === '!' && endsToken(i + 1)) {
      i++
      terms.push({ kind: 'token', field, operator: 'empty', negated, values: [] })
      continue
    }

    const values = [readValue(true)]
    while (query[i] === ',') {
      i++
      values.push(readValue(true))
    }
    terms.push({ kind: 'token', field, operator, negated, values })
  }

  return { terms }
}
