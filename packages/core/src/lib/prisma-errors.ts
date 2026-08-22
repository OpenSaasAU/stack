type PrismaP2002Meta = {
  target?: string[]
  driverAdapterError?: {
    cause?: {
      originalMessage?: string
      constraint?: { fields?: unknown[] }
    }
  }
}

// Postgres quotes an identifier in `constraint.fields` only when it needed
// quoting (e.g. camelCase columns), so `"tenantId"` and `slug` are both valid
// entries for the same array.
function stripIdentifierQuotes(field: string): string {
  const match = field.match(/^"(.*)"$/)
  return match ? match[1] : field
}

export interface UniqueConstraintInfo {
  /** Column names covered by the violated constraint, quote-stripped. */
  fields: string[]
  /**
   * The violated constraint's name, when recoverable from the error.
   *
   * Known limit: this is parsed out of Postgres' English-locale error text
   * (`cause.originalMessage`) — the adapter exposes no structured field for
   * it. A server running under a non-English `lc_messages` locale will not
   * match, leaving this `undefined` while `fields` (structured data) still
   * resolves correctly.
   */
  constraintName?: string
}

/**
 * Resolve which columns — and, where recoverable, which named constraint — a
 * Prisma `P2002` unique-constraint violation hit.
 *
 * Prisma documents `error.meta.target` for this. Under Prisma 7 driver
 * adapters (verified against `@prisma/adapter-pg` and PGlite; see issue #979)
 * that field is `undefined` instead — the same information sits at
 * `error.meta.driverAdapterError.cause`, with the constraint name only
 * recoverable as free text inside `cause.originalMessage`. This normalises
 * both shapes to one stable result so callers never need to reach into that
 * adapter-specific structure themselves.
 *
 * A derived constraint name is truncated by Postgres at its 63-character
 * identifier limit, and one row can violate two unique indexes at once (with
 * Postgres reporting whichever it checked first) — an index an application
 * means to branch on should be named explicitly, and a caller may still need
 * to re-read the colliding row to fully disambiguate.
 *
 * Returns `undefined` when `error` isn't a `P2002` with any recoverable
 * column or constraint information — never throws, since the adapter error
 * shape is untrusted and every level of it may be absent.
 */
export function uniqueConstraintOf(error: unknown): UniqueConstraintInfo | undefined {
  if (
    !error ||
    typeof error !== 'object' ||
    !('code' in error) ||
    (error as { code?: unknown }).code !== 'P2002'
  ) {
    return undefined
  }

  const meta = (error as { meta?: PrismaP2002Meta }).meta

  if (meta?.target && Array.isArray(meta.target)) {
    return { fields: meta.target }
  }

  const cause = meta?.driverAdapterError?.cause
  const rawFields = cause?.constraint?.fields
  const fields = Array.isArray(rawFields)
    ? rawFields.filter((f): f is string => typeof f === 'string').map(stripIdentifierQuotes)
    : []

  const constraintName =
    typeof cause?.originalMessage === 'string'
      ? cause.originalMessage.match(/unique constraint "([^"]+)"/)?.[1]
      : undefined

  if (fields.length === 0 && !constraintName) return undefined

  return constraintName ? { fields, constraintName } : { fields }
}
