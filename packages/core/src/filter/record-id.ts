import type { FilterToken } from './types.js'

const RECORD_ID_MARK = '#'

/**
 * The related record id a {@link FilterToken} names, written `field:#id`, or
 * `null` when the token is anything else. A quoted `field:"#id"` is label text,
 * never an id, so a literal leading `#` stays searchable.
 */
export function filterTokenRecordId(token: FilterToken): string | null {
  if (token.field === null || token.operator !== 'eq' || token.quoted) return null
  if (token.values.length !== 1) return null
  const [value] = token.values
  return value.startsWith(RECORD_ID_MARK) ? value.slice(RECORD_ID_MARK.length) : null
}

/**
 * The {@link FilterToken} matching exactly the related record `id` on `field`,
 * which serialises as `field:#id`.
 */
export function recordIdFilterToken(field: string, id: string): FilterToken {
  return {
    kind: 'token',
    field,
    operator: 'eq',
    negated: false,
    values: [`${RECORD_ID_MARK}${id}`],
    quoted: false,
  }
}
