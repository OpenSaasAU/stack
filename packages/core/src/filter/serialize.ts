import { fieldPrefixLength, isFilterWhitespace } from './parse.js'
import type { FilterOperator, FilterQuery, FilterToken } from './types.js'

const OPERATOR_PREFIX: Record<FilterOperator, string> = {
  eq: '',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
}

function mustQuoteValue(value: string): boolean {
  return value.startsWith('"') || value.includes(',') || [...value].some(isFilterWhitespace)
}

function mustQuoteBareText(token: FilterToken, text: string): boolean {
  if (token.field === null) {
    if (fieldPrefixLength(text) > 0) return true
    if (token.negated) return text === ''
    return text === '' || (text.startsWith('-') && text !== '-')
  }
  if (token.operator === 'eq') return /^(?:[<>]|\/\/)/.test(text)
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
  const written = token.values.map((value) => (mustQuoteValue(value) ? quote(value) : value))
  if (written.length > 0 && !written[0].startsWith('"')) {
    if (token.quoted || mustQuoteBareText(token, written.join(','))) {
      written[0] = quote(token.values[0])
    }
  }
  return written.join(',')
}

/**
 * Serialise one {@link FilterToken} to its query-string form, as
 * {@link serializeFilterQuery} writes it.
 */
export function serializeFilterToken(token: FilterToken): string {
  const text = serializeValues(token)
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
 * including one whose values are empty (`field:` or `""`).
 *
 * A value is quoted when its token says so or when it would otherwise read back
 * as different syntax: whitespace, a comma, a leading quote, a free-text word
 * that looks like `field:value` or starts with `-`, or a value an operator
 * prefix would swallow. Inside quotes a quote is written `\"`, and a backslash
 * that precedes a quote or ends the value is written `\\`.
 *
 * @example
 * serializeFilterQuery(parseFilterQuery('name:"Ada \\"the Countess\\"" "status:draft"'))
 * // 'name:"Ada \\"the Countess\\"" "status:draft"'
 */
export function serializeFilterQuery(query: FilterQuery): string {
  return query.terms.map(serializeFilterToken).join(' ')
}
