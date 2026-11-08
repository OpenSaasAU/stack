import type {
  FilterGroup,
  FilterOperator,
  FilterQuery,
  FilterTerm,
  FilterToken,
  FilterValue,
} from './types.js'

const FIELD_PREFIX_RE = /([A-Za-z_][A-Za-z0-9_]*):/y

const WHITESPACE_RE = /\s/

const RANGE_SEPARATOR = '..'

const GROUP_OPEN = '('

const GROUP_CLOSE = ')'

/** The keyword joining the tokens of an OR group: `(a OR b)`. */
export const FILTER_GROUP_KEYWORD = 'OR'

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
 * The two bounds of an unquoted single value written as an inclusive range
 * (`a..b`), split at its first `..`, or `null` when it is not one: a bound is
 * missing, or the value holds a comma.
 */
export function splitRangeValue(value: string): [string, string] | null {
  const at = value.indexOf(RANGE_SEPARATOR)
  if (at <= 0 || at + RANGE_SEPARATOR.length >= value.length || value.includes(',')) return null
  return [value.slice(0, at), value.slice(at + RANGE_SEPARATOR.length)]
}

/** What a reader produced, and the index just past the text it read. */
export interface FilterRead<T> {
  value: T
  end: number
}

function endsPlainToken(query: string, at: number): boolean {
  return at >= query.length || isFilterWhitespace(query[at])
}

/**
 * Whether the `)` at `at` closes an OR group: it ends the word it is in. The
 * last `)` of a word is the closer, so `(a OR b))` holds the value `b)`.
 */
function closesGroup(query: string, at: number): boolean {
  return query[at] === GROUP_CLOSE && endsPlainToken(query, at + 1)
}

function readToken(query: string, start: number, inGroup: boolean): FilterRead<FilterToken> {
  const n = query.length
  let i = start

  const endsToken = (at: number) => endsPlainToken(query, at) || (inGroup && closesGroup(query, at))

  const readValue = (inList: boolean): FilterValue => {
    if (query[i] !== '"') {
      const from = i
      while (!endsToken(i) && !(inList && query[i] === ',')) i++
      return { text: query.slice(from, i), quoted: false }
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

  const negated = query[i] === '-' && !endsToken(i + 1)
  if (negated) i++

  const prefixLength = fieldPrefixLength(query, i)
  if (prefixLength === 0) {
    const value = readValue(false)
    return {
      value: { kind: 'token', field: null, operator: 'eq', negated, values: [value] },
      end: i,
    }
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
    return {
      value: { kind: 'token', field, operator: 'empty', negated, values: [] },
      end: i + 1,
    }
  }

  const values = [readValue(true)]
  while (query[i] === ',') {
    i++
    values.push(readValue(true))
  }
  const range =
    operator === 'eq' && values.length === 1 && !values[0].quoted
      ? splitRangeValue(values[0].text)
      : null
  if (range) {
    return {
      value: {
        kind: 'token',
        field,
        operator: 'range',
        negated,
        values: range.map((text) => ({ text, quoted: false })),
      },
      end: i,
    }
  }
  return { value: { kind: 'token', field, operator, negated, values }, end: i }
}

function skipWhitespace(query: string, at: number): number {
  let i = at
  while (i < query.length && isFilterWhitespace(query[i])) i++
  return i
}

/**
 * The OR group opening at `start`, or `null` when the text there is not one:
 * `(` directly before its first token, two or more tokens joined by
 * whitespace, an uppercase `OR` and whitespace, and a `)` directly after the
 * last token that ends its word. A token starting `(` (a nested group) or `)`
 * makes it no group.
 */
export function readFilterGroup(query: string, start: number): FilterRead<FilterGroup> | null {
  if (query[start] !== GROUP_OPEN) return null
  const tokens: FilterToken[] = []
  let i = start + 1
  for (;;) {
    if (endsPlainToken(query, i) || query[i] === GROUP_OPEN || query[i] === GROUP_CLOSE) {
      return null
    }
    const member = readToken(query, i, true)
    tokens.push(member.value)
    i = member.end
    if (query[i] === GROUP_CLOSE) {
      if (!closesGroup(query, i) || tokens.length < 2) return null
      return { value: { kind: 'group', tokens }, end: i + 1 }
    }
    const keyword = skipWhitespace(query, i)
    if (keyword === i || !query.startsWith(FILTER_GROUP_KEYWORD, keyword)) return null
    const next = skipWhitespace(query, keyword + FILTER_GROUP_KEYWORD.length)
    if (next === keyword + FILTER_GROUP_KEYWORD.length) return null
    i = next
  }
}

/**
 * Parse a filter query string into a structured {@link FilterQuery}
 * (ADR-0017, ADR-0083). Never throws: input it cannot read as syntax parses as
 * bare free-text words.
 *
 * - `field:value` is a field token with the `eq` operator, and `field:>value`,
 *   `field:>=value`, `field:<value`, `field:<=value` are comparisons.
 * - `field:a,b` carries several values, and `field:!` is the `empty` operator.
 * - `field:a..b` is an inclusive `range` token whose two values are its
 *   bounds, split at the first `..`. A quoted value is never a range, and
 *   neither is a list: `field:a..b,c` is `eq` on `a..b` and `c`.
 * - A leading `-` followed by more of the token negates it: `-field:value`.
 *   A `-` on its own is a free-text word.
 * - `(a OR b)` is an OR group of the tokens `a` and `b`: `(` directly before
 *   the first token, the uppercase keyword `OR` between tokens, and `)`
 *   directly after the last. Anything else, such as a lowercase `or`, a
 *   nested or unmatched parenthesis, or a group of one token, reads as it
 *   would without the group: literal words.
 * - A value in double quotes keeps its spaces and commas and is literal:
 *   `"status:draft"` and `"OR"` are free-text words and `field:"!"` the text
 *   `!`. Inside quotes, `\"` is a quote and `\\` a backslash; any other
 *   backslash is itself.
 * - Anything else (`beta`, `>5`, `http://x`) is a free-text word (`field: null`),
 *   whose commas are ordinary characters.
 *
 * Validating fields and values is the engine's job, where a token that cannot
 * map degrades to free text. {@link serializeFilterQuery} is the inverse.
 *
 * @example
 * parseFilterQuery('-role:Editor (status:draft OR author:#42) name:"Ada Lovelace" beta')
 * // { terms: [
 * //   { kind: 'token', field: 'role', operator: 'eq', negated: true, values: [{ text: 'Editor', quoted: false }] },
 * //   { kind: 'group', tokens: [
 * //     { kind: 'token', field: 'status', operator: 'eq', negated: false, values: [{ text: 'draft', quoted: false }] },
 * //     { kind: 'token', field: 'author', operator: 'eq', negated: false, values: [{ text: '#42', quoted: false }] },
 * //   ] },
 * //   { kind: 'token', field: 'name', operator: 'eq', negated: false, values: [{ text: 'Ada Lovelace', quoted: true }] },
 * //   { kind: 'token', field: null, operator: 'eq', negated: false, values: [{ text: 'beta', quoted: false }] },
 * // ] }
 */
export function parseFilterQuery(query: string): FilterQuery {
  const terms: FilterTerm[] = []
  let i = skipWhitespace(query, 0)
  while (i < query.length) {
    const read: FilterRead<FilterTerm> = readFilterGroup(query, i) ?? readToken(query, i, false)
    terms.push(read.value)
    i = skipWhitespace(query, read.end)
  }
  return { terms }
}

/** The tokens of one {@link FilterTerm}: the token itself, or a group's tokens. */
export function filterTermTokens(term: FilterTerm): FilterToken[] {
  return term.kind === 'group' ? term.tokens : [term]
}

/** Every token of a {@link FilterQuery}, with its groups flattened, in order. */
export function filterQueryTokens(query: FilterQuery): FilterToken[] {
  return query.terms.flatMap(filterTermTokens)
}
