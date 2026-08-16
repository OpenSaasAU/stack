import type { FilterOperator, FilterToken } from './types.js'

/**
 * The comparison-operator prefix each {@link FilterOperator} serialises to. The
 * exact inverse of the prefixes {@link parseFilterQuery} recognises (`eq` has no
 * prefix — a plain `field:value`).
 */
const OPERATOR_PREFIX: Record<FilterOperator, string> = {
  eq: '',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
}

/**
 * Whether a value must be wrapped in double quotes to survive re-parsing.
 *
 * A value is quoted when it contains whitespace (so `parseFilterQuery` keeps it
 * as one token) or an embedded quote. When `guardOperatorChars` is set (an `eq`
 * field token, where a leading `>`/`<` would otherwise be read as a comparison
 * operator), a value starting with `<`/`>` is also quoted so it round-trips as a
 * literal value rather than an operator.
 */
function quoteIfNeeded(value: string, guardOperatorChars: boolean): string {
  const needsQuote =
    /\s/.test(value) ||
    value.includes('"') ||
    (guardOperatorChars && (value.startsWith('>') || value.startsWith('<')))
  return needsQuote ? `"${value}"` : value
}

/**
 * Serialise {@link FilterToken}s back into a filter query string — the exact
 * inverse of {@link parseFilterQuery} (ADR-0017). This is the grammar-producing
 * half the Filter builder UI relies on: the builder turns UI state into tokens
 * and serialises them into the `?search=` URL param the engine already consumes,
 * so the same quoting and operator-prefix rules live next to the parser and can
 * never drift.
 *
 * Pure and field-agnostic (no DB/Prisma imports). Tokens are joined with the
 * grammar's implicit AND (a single space). A token with an empty value carries
 * no filter and is omitted, so `serializeFilterQuery` never emits a dangling
 * `field:` or a stray quote pair.
 *
 * @example
 * serializeFilterQuery([
 *   { field: 'role',   operator: 'eq', value: 'Editor',       raw: '' },
 *   { field: 'orders', operator: 'gt', value: '5',            raw: '' },
 *   { field: 'name',   operator: 'eq', value: 'Ada Lovelace', raw: '' },
 *   { field: null,     operator: 'eq', value: 'beta',         raw: '' },
 * ])
 * // 'role:Editor orders:>5 name:"Ada Lovelace" beta'
 */
export function serializeFilterQuery(tokens: FilterToken[]): string {
  const parts: string[] = []

  for (const token of tokens) {
    if (token.value === '') continue

    if (token.field === null) {
      // A leading `>`/`<` stays literal for a bare word (the parser only
      // treats them as operators after a `field:`), so no operator guard here.
      parts.push(quoteIfNeeded(token.value, false))
      continue
    }

    const prefix = OPERATOR_PREFIX[token.operator]
    parts.push(`${token.field}:${prefix}${quoteIfNeeded(token.value, prefix === '')}`)
  }

  return parts.join(' ')
}
