import {
  FILTER_GROUP_KEYWORD,
  FILTER_OPERATOR_PREFIXES,
  fieldPrefixLength,
  isFilterWhitespace,
  readFilterGroup,
  splitRangeValue,
} from './parse.js'
import type { FilterQuery, FilterTerm, FilterToken, FilterValue } from './types.js'

type Placement = 'top' | 'member' | 'lastMember'

function hasWhitespace(text: string): boolean {
  for (const ch of text) if (isFilterWhitespace(ch)) return true
  return false
}

function mustQuote(
  token: FilterToken,
  value: FilterValue,
  index: number,
  placement: Placement,
): boolean {
  const { text } = value
  if (value.quoted || text.startsWith('"') || hasWhitespace(text)) return true
  if (placement === 'member' && index === token.values.length - 1 && text.endsWith(')')) return true
  if (token.field === null) {
    if (placement !== 'top' && !token.negated && /^[()]/.test(text)) return true
    if (text === '' || fieldPrefixLength(text) > 0) return true
    return !token.negated && text.startsWith('-') && text !== '-'
  }
  if (text.includes(',')) return true
  if (index > 0) return false
  if (token.operator === 'eq') {
    if (/^(?:[<>]|\/\/)/.test(text)) return true
    return token.values.length === 1 && (text === '!' || splitRangeValue(text) !== null)
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

/**
 * Quote `text` as a single filter value, so a query built from data — a
 * session's name, a record's title — reads back as exactly that value and
 * never as extra tokens. `parseFilterQuery(field + ':' + quoteFilterValue(text))`
 * is one `eq` token on `field` whose only value is `text`, whatever `text`
 * holds: quotes, backslashes, whitespace, commas, a leading `-`, `!` or an
 * operator prefix.
 *
 * @example
 * ```typescript
 * search: ({ session }) => `status:draft author:${quoteFilterValue(String(session?.name ?? ''))}`
 * ```
 */
export function quoteFilterValue(text: string): string {
  return quote(text)
}

function serializeValues(token: FilterToken, placement: Placement): string {
  const values: FilterValue[] =
    token.values.length > 0 ? token.values : [{ text: '', quoted: false }]
  return values
    .map((value, index) =>
      mustQuote(token, value, index, placement) ? quote(value.text) : value.text,
    )
    .join(',')
}

function rangeText(token: FilterToken, placement: Placement): string | null {
  if (token.field === null || token.values.length !== 2) return null
  const [low, high] = token.values
  if (low.quoted || high.quoted) return null
  const text = `${low.text}..${high.text}`
  const bounds = splitRangeValue(text)
  if (bounds === null || bounds[0] !== low.text) return null
  if (text.startsWith('"') || hasWhitespace(text) || /^(?:[<>]|\/\/)/.test(text)) return null
  if (placement === 'member' && text.endsWith(')')) return null
  return text
}

function rangeLiteral(token: FilterToken): FilterToken {
  const text = token.values.map((value) => value.text).join('..')
  return { ...token, operator: 'eq', values: [{ text, quoted: false }] }
}

function writeToken(token: FilterToken, placement: Placement): string {
  const negation = token.negated ? '-' : ''
  if (token.operator === 'empty') {
    return token.field === null ? `${negation}!` : `${negation}${token.field}:!`
  }
  if (token.operator === 'range') {
    const range = rangeText(token, placement)
    if (range !== null && token.field !== null) return `${negation}${token.field}:${range}`
    return writeToken(rangeLiteral(token), placement)
  }
  const text = serializeValues(token, placement)
  if (token.field === null) return `${negation}${text}`
  return `${negation}${token.field}:${FILTER_OPERATOR_PREFIXES[token.operator]}${text}`
}

function quotedWord(token: FilterToken): string {
  return quote(token.values.map((value) => value.text).join(','))
}

function writeGroup(tokens: readonly FilterToken[]): string {
  const members = tokens.map((token, index) =>
    writeToken(token, index === tokens.length - 1 ? 'lastMember' : 'member'),
  )
  return `(${members.join(` ${FILTER_GROUP_KEYWORD} `)})`
}

function writeTerm(term: FilterTerm): string {
  return term.kind === 'group' ? writeGroup(term.tokens) : writeToken(term, 'top')
}

/**
 * Serialise one {@link FilterToken} to its query-string form, as
 * {@link serializeFilterQuery} writes it outside a group.
 */
export function serializeFilterToken(token: FilterToken): string {
  return writeToken(token, 'top')
}

/**
 * Serialise a {@link FilterQuery} into the `?search=` grammar, joining its
 * terms with the grammar's implicit AND (a space). The inverse of
 * {@link parseFilterQuery}: for every query `parseFilterQuery` returns,
 * `parseFilterQuery(serializeFilterQuery(query))` is that query again, quoting
 * included. Every token is written, including one whose values are empty or
 * absent (`field:` or `""`).
 *
 * A value is quoted when it says so or when it would otherwise read back as
 * different syntax: whitespace, a leading quote, a comma in a field token's
 * value, a free-text word that looks like `field:value` or starts with `-`, a
 * lone `!` or `a..b`, or a value an operator prefix would swallow. A `range`
 * token is written `field:a..b`; one whose bounds cannot be written that way
 * is written as the single literal value `"a..b"`, which never reads back as a
 * range. Inside quotes a quote is written `\"`, and a backslash that precedes
 * a quote or ends the value is written `\\`.
 *
 * An OR group is written `(a OR b)`, quoting a token that would otherwise end
 * the group early or open a nested one; a group of one token is written as
 * that token, and an empty group is not written. A free-text word outside a
 * group that would read back as the start of a group is quoted.
 *
 * @example
 * serializeFilterQuery(parseFilterQuery('-name:"Ada \\"the Countess\\"",Grace (status:draft OR "OR")'))
 * // '-name:"Ada \\"the Countess\\"",Grace (status:draft OR "OR")'
 */
export function serializeFilterQuery(query: FilterQuery): string {
  const terms = query.terms.flatMap((term) =>
    term.kind === 'group' && term.tokens.length < 2 ? term.tokens : [term],
  )
  const parts = terms.map(writeTerm)
  for (let index = parts.length - 1; index >= 0; index--) {
    const term = terms[index]
    if (term.kind === 'group' || term.field !== null || term.negated) continue
    if (!parts[index].startsWith('(')) continue
    const offset = parts.slice(0, index).reduce((length, part) => length + part.length + 1, 0)
    if (readFilterGroup(parts.join(' '), offset) !== null) parts[index] = quotedWord(term)
  }
  return parts.join(' ')
}
