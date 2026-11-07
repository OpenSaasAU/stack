import { fieldPrefixLength, isFilterWhitespace } from './parse.js'
import type { FilterOperator, FilterQuery, FilterToken } from './types.js'

const OPERATOR_PREFIX: Record<FilterOperator, string> = {
  eq: '',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
}

function mustQuote(token: FilterToken, value: string): boolean {
  if (value.startsWith('"') || [...value].some(isFilterWhitespace)) return true
  if (token.field === null) return value === '' || fieldPrefixLength(value) > 0
  if (token.operator === 'eq') return /^(?:[<>]|\/\/)/.test(value)
  if (token.operator === 'gt' || token.operator === 'lt') return value.startsWith('=')
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

/**
 * Serialise one {@link FilterToken} to its query-string form, as
 * {@link serializeFilterQuery} writes it.
 */
export function serializeFilterToken(token: FilterToken): string {
  const value = token.values.join(',')
  const text = token.quoted || mustQuote(token, value) ? quote(value) : value
  const negation = token.negated ? '-' : ''
  if (token.field === null) return `${negation}${text}`
  return `${negation}${token.field}:${OPERATOR_PREFIX[token.operator]}${text}`
}

/**
 * Serialise a {@link FilterQuery} into the `?search=` grammar, joining its
 * terms with the grammar's implicit AND (a space). The inverse of
 * {@link parseFilterQuery}: for every query `parseFilterQuery` returns,
 * `parseFilterQuery(serializeFilterQuery(query))` is that query again.
 *
 * A value is quoted when its token says so or when it would otherwise read back
 * as different syntax: whitespace, a leading quote, a free-text word that looks
 * like `field:value`, or a value an operator prefix would swallow. Inside
 * quotes a quote is written `\"`, and a backslash that precedes a quote or ends
 * the value is written `\\`.
 *
 * @example
 * serializeFilterQuery(parseFilterQuery('name:"Ada \\"the Countess\\"" "status:draft"'))
 * // 'name:"Ada \\"the Countess\\"" "status:draft"'
 */
export function serializeFilterQuery(query: FilterQuery): string {
  return query.terms.map(serializeFilterToken).join(' ')
}
