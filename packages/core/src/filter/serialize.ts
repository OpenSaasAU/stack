import { fieldPrefixLength, splitRangeValue } from './parse.js'
import type { FilterQuery, FilterToken, FilterTokenOperator } from './types.js'

const OPERATOR_PREFIX: Record<FilterTokenOperator, string> = {
  range: '',
  eq: '',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
}

function mustQuoteValue(value: string): boolean {
  return /^"|[\s,]/.test(value)
}

function mustQuoteBareText(token: FilterToken, text: string): boolean {
  if (token.field === null) {
    if (fieldPrefixLength(text) > 0) return true
    if (token.negated) return text === ''
    return text === '' || (text.startsWith('-') && text !== '-')
  }
  if (token.operator === 'eq' || token.operator === 'range') {
    return /^(?:[<>]|\/\/)/.test(text) || splitRangeValue(text) !== null
  }
  if (token.operator === 'gt' || token.operator === 'lt') return text.startsWith('=')
  return false
}

function quote(value: string): string {
  let escaped = ''
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    const next = value[i + 1]
    if (ch === '"') escaped += '\\"'
    else if (ch === '\\' && (next === undefined || next === '"' || next === '\\')) escaped += '\\\\'
    else escaped += ch
  }
  return `"${escaped}"`
}

function serializeValues(token: FilterToken): string {
  const values = token.values.length > 0 ? token.values : ['']
  const written = values.map((value) => (mustQuoteValue(value) ? quote(value) : value))
  if (!written[0].startsWith('"')) {
    if (token.quoted || mustQuoteBareText(token, written.join(','))) {
      written[0] = quote(values[0])
    }
  }
  return written.join(',')
}

function rangeText(token: FilterToken): string | null {
  if (token.field === null || token.values.length !== 2) return null
  const text = token.values.join('..')
  const bounds = splitRangeValue(text)
  if (!bounds || /\s/.test(text) || /^(?:["<>]|\/\/)/.test(text)) return null
  return bounds[0] === token.values[0] ? text : null
}

/**
 * Serialise one {@link FilterToken} to its query-string form, as
 * {@link serializeFilterQuery} writes it.
 */
export function serializeFilterToken(token: FilterToken): string {
  const range = token.operator === 'range' ? rangeText(token) : null
  const text =
    range ??
    serializeValues(
      token.operator === 'range' ? { ...token, values: [token.values.join('..')] } : token,
    )
  const negation = token.negated ? '-' : ''
  if (token.field === null) return `${negation}${text}`
  return `${negation}${token.field}:${OPERATOR_PREFIX[token.operator]}${text}`
}

/**
 * Serialise a {@link FilterQuery} into the `?search=` grammar, joining its
 * terms with the grammar's implicit AND (a space). The inverse of
 * {@link parseFilterQuery}: for every query `parseFilterQuery` returns,
 * `parseFilterQuery(serializeFilterQuery(query))` is that query again, with
 * `quoted` set on a value this function had to quote. Every term is written,
 * including one whose values are empty or absent (`field:` or `""`).
 *
 * A value is quoted when its token says so or when it would otherwise read back
 * as different syntax: whitespace, a comma, a leading quote, a free-text word
 * that looks like `field:value` or starts with `-`, or a value an operator
 * prefix would swallow. A `range` token is written `field:a..b`; one whose
 * bounds cannot be written that way is written as the single literal value
 * `"a..b"`, which never reads back as a range. Inside quotes a quote is
 * written `\"`, and a backslash that precedes a quote or ends the value is
 * written `\\`.
 *
 * @example
 * serializeFilterQuery(parseFilterQuery('name:"Ada \\"the Countess\\"" "status:draft"'))
 * // 'name:"Ada \\"the Countess\\"" "status:draft"'
 */
export function serializeFilterQuery(query: FilterQuery): string {
  return query.terms.map(serializeFilterToken).join(' ')
}
