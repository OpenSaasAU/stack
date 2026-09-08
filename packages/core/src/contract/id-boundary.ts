import type { OpenSaasConfig } from '../config/types.js'
import { idColumn, resolveIdStrategy } from './derive.js'
import type { ContractIdColumn } from './types.js'

/**
 * A primary key at its own type: `string` for a `uuid7` or `cuid2` list,
 * `number` for an `int autoincrement` list and for a singleton (ADR-0048). No
 * stack-level `string | number` union crosses a package boundary — this is the
 * boundary.
 */
export type ListIdValue = string | number

/**
 * The outcome of parsing one wire id. `ok: false` carries no detail about the
 * list or the value: a caller turns it into a 404 or a validation error, and
 * neither may describe what the id should have looked like.
 */
export type ListIdParse = { ok: true; value: ListIdValue } | { ok: false }

/** UUID at any version — `uuid7` mints v7, a row adopted from elsewhere may not be. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** cuid2 as the contract's `char(24)` column holds it. */
const CUID2 = /^[a-z][a-z0-9]{23}$/i

const INTEGER = /^-?\d+$/

/**
 * The primary-key column of one list, as the contract declares it, or `null`
 * when the config declares no such list.
 */
export function listIdColumn(config: OpenSaasConfig, listKey: string): ContractIdColumn | null {
  if (!Object.hasOwn(config.lists, listKey)) return null
  return idColumn(resolveIdStrategy(config.lists[listKey], config))
}

/**
 * Parse one id off the wire into the type its list's primary key actually
 * carries (ADR-0048).
 *
 * Admin URLs, MCP tool arguments and server-action params are all strings, and
 * the id type is per list. This is the one place that reads the list's id
 * strategy from the contract and parses accordingly, so an `int autoincrement`
 * list gets a `number` and a malformed id fails here rather than reaching the
 * ORM as a `NaN`, a type error from Postgres, or a row that silently does not
 * match.
 *
 * A value already at the list's id type passes through, so a caller that
 * received a parsed id (a `number` from a JSON body) need not re-encode it.
 *
 * Known limits: shape is all this can check. A well-formed id naming no row is
 * `ok`, and the read that follows answers `null` — which is also the answer for
 * a row the session may not see, and must stay so.
 */
export function parseListId(config: OpenSaasConfig, listKey: string, raw: unknown): ListIdParse {
  const column = listIdColumn(config, listKey)
  if (!column) return { ok: false }

  if (column.strategy === 'int autoincrement' || column.strategy === 'singleton') {
    if (typeof raw === 'number') {
      return Number.isSafeInteger(raw) ? { ok: true, value: raw } : { ok: false }
    }
    if (typeof raw !== 'string' || !INTEGER.test(raw)) return { ok: false }
    const value = Number(raw)
    return Number.isSafeInteger(value) ? { ok: true, value } : { ok: false }
  }

  if (typeof raw !== 'string') return { ok: false }
  const pattern = column.strategy === 'uuid7' ? UUID : CUID2
  return pattern.test(raw) ? { ok: true, value: raw } : { ok: false }
}
