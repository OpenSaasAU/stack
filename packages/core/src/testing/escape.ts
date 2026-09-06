/** The variable the harness reads, and the only escape from in-process PGlite. */
export const ESCAPE_VARIABLE = 'DATABASE_URL'

const POSTGRES_SCHEMES = new Set(['postgres:', 'postgresql:'])

/**
 * What `DATABASE_URL` says. `'absent'` runs the suite on in-process PGlite;
 * `'postgres'` runs the identical suite against that server; `'unusable'` is a
 * misconfiguration the harness refuses rather than dials.
 */
export type DatabaseEscape =
  | { readonly kind: 'absent' }
  | { readonly kind: 'postgres'; readonly url: string }
  | { readonly kind: 'unusable'; readonly url: string; readonly fault: string }

/**
 * Thrown when `DATABASE_URL` is set to something that is not a Postgres
 * connection string. Names the variable, its value, the fault and both
 * remedies.
 *
 * A set-but-unusable value is not the same as an unset one: node-postgres
 * quietly falls back to `localhost:5432` for a string it cannot parse, so a
 * suite that dialled it would report a bare `ECONNREFUSED` several frames from
 * the actual mistake. This is the failure a stale SQLite `DATABASE_URL` in CI
 * produced after Postgres became the only provider.
 */
export class UnusableDatabaseEscapeError extends Error {
  constructor(
    readonly url: string,
    readonly fault: string,
  ) {
    super(
      `${ESCAPE_VARIABLE} is set to \`${url}\`, which ${fault}. The test harness dials this ` +
        `variable when it is set, so either point it at a Postgres server (\`postgres://…\`) or ` +
        `unset it to run the suite on the in-process dev database.`,
    )
    this.name = 'UnusableDatabaseEscapeError'
  }
}

/**
 * Classify `DATABASE_URL` without dialling it.
 *
 * Read this at module scope in a suite whose guarantee PGlite cannot exercise —
 * ADR-0047's row-lock contention, real pool concurrency — and skip on it by
 * name, so the skip is visible in the reporter rather than silent:
 *
 * @example
 * ```typescript
 * const escape = readDatabaseEscape()
 * test.skipIf(escape.kind !== 'postgres')(
 *   `two bookings contend for one slot [escape-only: ${ESCAPE_VARIABLE} names no Postgres]`,
 *   async () => { … },
 * )
 * ```
 */
export function readDatabaseEscape(): DatabaseEscape {
  const url = process.env[ESCAPE_VARIABLE]
  if (url === undefined || url.length === 0) return { kind: 'absent' }

  let scheme: string
  try {
    scheme = new URL(url).protocol
  } catch {
    return { kind: 'unusable', url, fault: 'is not a URL' }
  }
  if (!POSTGRES_SCHEMES.has(scheme)) {
    return { kind: 'unusable', url, fault: `names the \`${scheme}\` scheme, not Postgres` }
  }
  return { kind: 'postgres', url }
}

/**
 * The escape's URL, or `undefined` to run on the dev database.
 *
 * @throws {UnusableDatabaseEscapeError} when the variable is set to anything
 *   that is not a Postgres connection string.
 */
export function requireUsableDatabaseEscape(): string | undefined {
  const escape = readDatabaseEscape()
  if (escape.kind === 'unusable') throw new UnusableDatabaseEscapeError(escape.url, escape.fault)
  return escape.kind === 'postgres' ? escape.url : undefined
}
