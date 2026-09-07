// The config-aware half of error normalisation (ADR-0042): resolving a
// classified unique violation to the OpenSaas fields it hit, through the
// constraint map the generator emitted. The classification itself, and the
// error classes, live in `database-errors.ts` — a leaf the Engine stamp can
// import.

import type { OpenSaasConfig } from '../config/types.js'
import type { ConstraintMap } from '../contract/dependencies.js'
import { deriveConstraintMap } from '../contract/dependencies.js'
import { deriveContract } from '../contract/derive.js'
import {
  UniqueConstraintViolation,
  classifyDriverError,
  isUniqueConstraintViolation,
} from './database-errors.js'

const derived = new WeakMap<OpenSaasConfig, ConstraintMap>()

/**
 * The constraint map for `config`: the one `pnpm generate` emitted when the
 * generated context supplied it, otherwise the same computation, memoised per
 * config rather than recomputed per failure — the shape
 * `getDependencyTable` uses for the other emitted table.
 *
 * A config the derivation refuses (two constraints colliding on one name)
 * resolves to an empty map here rather than throwing: this runs while an
 * error is already in flight, and replacing a unique violation with a
 * generation error would lose the failure the caller is handling. The same
 * config fails loudly at `pnpm generate`, which is where that collision is
 * meant to surface.
 */
export function getConstraintMap(config: OpenSaasConfig): ConstraintMap {
  const emitted = config._tables?.constraints
  if (emitted) return emitted
  const cached = derived.get(config)
  if (cached) return cached
  let map: ConstraintMap = {}
  try {
    map = deriveConstraintMap(config, deriveContract(config))
  } catch {
    map = {}
  }
  derived.set(config, map)
  return map
}

// A camelCase field name (e.g. a relationship's `tenantId` foreign key) needs
// its word boundary split before title-casing, or it reads as one run-together
// word ("Tenantid") in a user-facing unique-constraint message.
function humanizeFieldName(fieldName: string): string {
  const spaced = fieldName.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function resolveUniqueViolation(
  error: UniqueConstraintViolation,
  config: OpenSaasConfig,
): UniqueConstraintViolation {
  const { constraintName } = error
  if (constraintName === undefined || error.fields.length > 0) return error

  const entry = getConstraintMap(config)[constraintName]
  if (entry === undefined || entry.fields.length === 0) return error

  const listConfig = config.lists[entry.list]
  const fieldErrors: Record<string, string> = {}
  for (const fieldKey of entry.fields) {
    fieldErrors[fieldKey] = listConfig?.fields[fieldKey]
      ? `This ${humanizeFieldName(fieldKey).toLowerCase()} is already in use`
      : 'This value is already in use'
  }

  const labels = entry.fields.map(humanizeFieldName).join(', ')
  return new UniqueConstraintViolation(
    `${labels} must be unique. The value you entered is already in use.`,
    { constraintName, list: entry.list, fields: entry.fields, fieldErrors },
    { cause: error.cause },
  )
}

/**
 * The stack-owned error for `error`, or `error` itself when it is not a driver
 * failure (ADR-0042).
 *
 * Idempotent: an error the engine terminals already classified passes through
 * with its fields resolved a second time only if the first attempt had no
 * constraint map to resolve them against. That is what lets the transaction
 * owner's settle apply the same normalisation to a failure raised at `COMMIT`,
 * after every terminal in the callback has already returned.
 */
export function normalizeDatabaseError(error: unknown, config: OpenSaasConfig): unknown {
  const classified = classifyDriverError(error) ?? error
  return isUniqueConstraintViolation(classified)
    ? resolveUniqueViolation(classified, config)
    : classified
}

/**
 * The user-facing message and per-field messages for an error caught around a
 * `context.db` operation — what a server action returns to a form.
 *
 * A {@link DatabaseError} already carries both. Anything else is a hook's own
 * throw or a bug, and reaches the caller as its own message.
 */
export function databaseErrorMessage(error: unknown, config: OpenSaasConfig): Error {
  const normalized = normalizeDatabaseError(error, config)
  if (normalized instanceof Error) return normalized
  return new Error('An unknown error occurred')
}
