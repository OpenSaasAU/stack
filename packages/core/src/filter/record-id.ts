import type { FilterToken, FilterValue } from './types.js'

const RECORD_ID_MARK = '#'

/**
 * The related record id one {@link FilterValue} names, written `#id`, or
 * `null` when it is anything else. A quoted `"#id"` is label text, never an
 * id, so a literal leading `#` stays searchable.
 */
export function filterValueRecordId(value: FilterValue): string | null {
  if (value.quoted || !value.text.startsWith(RECORD_ID_MARK)) return null
  return value.text.slice(RECORD_ID_MARK.length)
}

/**
 * The related record id a {@link FilterToken} names when it is exactly
 * `field:#id`: one unquoted value on a positive `eq` token. `null` for
 * anything else, including `-field:#id` and `field:#a,#b`.
 */
export function filterTokenRecordId(token: FilterToken): string | null {
  if (token.field === null || token.operator !== 'eq' || token.negated) return null
  if (token.values.length !== 1) return null
  return filterValueRecordId(token.values[0])
}

/**
 * The {@link FilterToken} matching exactly the related record `id` on `field`,
 * which serialises as `field:#id`, or `-field:#id` when `negated`.
 */
export function recordIdFilterToken(field: string, id: string, negated = false): FilterToken {
  return {
    kind: 'token',
    field,
    operator: 'eq',
    negated,
    values: [{ text: `${RECORD_ID_MARK}${id}`, quoted: false }],
  }
}
