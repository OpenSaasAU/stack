/** Thrown by {@link resolveDatabaseUrl} when no connection variable is set. */
export class DatabaseUrlUnresolvedError extends Error {
  constructor(names: readonly string[]) {
    super(
      `No database connection URL is set. Set one of ${names.join(', ')} in the environment ` +
        `(or a .env file the process loads) before running a command that reaches the database.`,
    )
    this.name = 'DatabaseUrlUnresolvedError'
  }
}

/**
 * The environment variables consulted, in order. `DIRECT_DATABASE_URL` wins so
 * a schema command reaches the direct connection rather than a pooler that
 * cannot run DDL (ADR-0003).
 */
const CONNECTION_VARIABLES = ['DIRECT_DATABASE_URL', 'DATABASE_URL'] as const

/**
 * The stack's database URL lookup, non-throwing: the connection string if one
 * is set, `undefined` otherwise.
 *
 * This is what the generated `prisma.config.ts` calls. That file is evaluated
 * for every Prisma command, including the offline ones (`contract emit`), so it
 * must not fail when nothing is configured — a command that does need a
 * connection reports its own missing-connection error.
 *
 * @example
 * ```typescript
 * db: { connection: findDatabaseUrl() }
 * ```
 */
export function findDatabaseUrl(): string | undefined {
  for (const name of CONNECTION_VARIABLES) {
    const value = process.env[name]
    if (value !== undefined && value.length > 0) return value
  }
  return undefined
}

/**
 * The stack's database URL lookup — the one place a connection string is read
 * from the environment, used by the generated context when `db.client` supplies
 * no pool of its own.
 *
 * @param fallback - A URL to use when no environment variable is set, so a
 *   caller with its own default need not pre-check the environment.
 *
 * @throws {DatabaseUrlUnresolvedError} when nothing is set and no `fallback`
 *   is given — a named failure rather than an `undefined` that surfaces as a
 *   driver error several frames later.
 *
 * @example
 * ```typescript
 * import { resolveDatabaseUrl } from '@opensaas/stack-core'
 * const db = postgres({ contractJson, url: resolveDatabaseUrl() })
 * ```
 *
 * This is the seam spec 2 (#1122's dev loop and client construction) replaces
 * with the full lookup — a `.env` load order, the dev loop's ephemeral
 * database, and the pooled/direct split per command. Callers should keep
 * reaching the connection through these two functions rather than reading
 * `process.env` themselves, so that replacement lands in one place.
 */
export function resolveDatabaseUrl(fallback?: string): string {
  const found = findDatabaseUrl()
  if (found !== undefined) return found
  if (fallback !== undefined) return fallback
  throw new DatabaseUrlUnresolvedError(CONNECTION_VARIABLES)
}
