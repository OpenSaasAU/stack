import { FILTER_OPERATOR_PREFIXES, fieldPrefixLength, isFilterWhitespace } from './parse.js'
import type { FilterQuery, FilterToken, FilterValue } from './types.js'

function hasWhitespace(text: string): boolean {
  for (const ch of text) if (isFilterWhitespace(ch)) return true
  return false
}

function mustQuote(token: FilterToken, value: FilterValue, index: number): boolean {
  const { text } = value
  if (value.quoted || text.startsWith('"') || hasWhitespace(text)) return true
  if (token.field === null) {
    if (text === '' || fieldPrefixLength(text) > 0) return true
    return !token.negated && text.startsWith('-') && text !== '-'
  }
  if (text.includes(',')) return true
  if (index > 0) return false
  if (token.operator === 'eq') {
    return /^(?:[<>]|\/\/)/.test(text) || (text === '!' && token.values.length === 1)
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
  const values: FilterValue[] =
    token.values.length > 0 ? token.values : [{ text: '', quoted: false }]
  return values
    .map((value, index) => (mustQuote(token, value, index) ? quote(value.text) : value.text))
    .join(',')
}

/**
 * Serialise one {@link FilterToken} to its query-string form, as
 * {@link serializeFilterQuery} writes it.
 */
export function serializeFilterToken(token: FilterToken): string {
  const negation = token.negated ? '-' : ''
  if (token.operator === 'empty') {
    return token.field === null ? `${negation}!` : `${negation}${token.field}:!`
  }
  const text = serializeValues(token)
  if (token.field === null) return `${negation}${text}`
  return `${negation}${token.field}:${FILTER_OPERATOR_PREFIXES[token.operator]}${text}`
}

/**
 * Serialise a {@link FilterQuery} into the `?search=` grammar, joining its
 * terms with the grammar's implicit AND (a space). The inverse of
 * {@link parseFilterQuery}: for every query `parseFilterQuery` returns,
 * `parseFilterQuery(serializeFilterQuery(query))` is that query again, quoting
 * included. Every term is written, including one whose values are empty or
 * absent (`field:` or `""`).
 *
 * A value is quoted when it says so or when it would otherwise read back as
 * different syntax: whitespace, a leading quote, a comma in a field token's
 * value, a free-text word that looks like `field:value` or starts with `-`, a
 * lone `!`, or a value an operator prefix would swallow. Inside quotes a quote
 * is written `\"`, and a backslash that precedes a quote or ends the value is
 * written `\\`.
 *
 * @example
 * serializeFilterQuery(parseFilterQuery('-name:"Ada \\"the Countess\\"",Grace "status:draft"'))
 * // '-name:"Ada \\"the Countess\\"",Grace "status:draft"'
 */
export function serializeFilterQuery(query: FilterQuery): string {
  return query.terms.map(serializeFilterToken).join(' ')
}
