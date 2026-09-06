import { readDevDatabaseState, type DevDatabaseStateLocation } from './state-file.js'

/**
 * The environment variables consulted, in order. `DIRECT_DATABASE_URL` wins so
 * a schema command reaches the direct connection rather than a pooler that
 * cannot run DDL (ADR-0003).
 */
const CONNECTION_VARIABLES = ['DIRECT_DATABASE_URL', 'DATABASE_URL'] as const

/** Thrown by {@link resolveDatabaseUrl} when neither remedy has been taken. */
export class DatabaseUrlUnresolvedError extends Error {
  constructor(names: readonly string[]) {
    super(
      `No database connection URL is set and no dev database is running. Either set ` +
        `${names.join(' or ')} in the environment (or a .env file the process loads) to point at ` +
        `a Postgres you own, or run \`opensaas dev\`, which starts the dev database and writes ` +
        `the state file this lookup reads.`,
    )
    this.name = 'DatabaseUrlUnresolvedError'
  }
}

/**
 * Where a connection string came from. `'env'` is a database the stack does
 * not own; `'dev-database'` is the sidecar `opensaas dev` runs, which the
 * generated runtime binds differently (one connection, no marker check —
 * ADR-0063).
 */
export type DatabaseUrlProvenance = 'env' | 'dev-database'

/** A connection string and the lookup branch that produced it. */
export interface ResolvedDatabaseUrl {
  readonly url: string
  readonly provenance: DatabaseUrlProvenance
}

/**
 * Where the Dev database state file is looked for when the environment names
 * no connection.
 */
export type DatabaseUrlLookupOptions = DevDatabaseStateLocation

function lookupDatabaseUrl(options: DatabaseUrlLookupOptions): ResolvedDatabaseUrl | undefined {
  for (const name of CONNECTION_VARIABLES) {
    const value = process.env[name]
    if (value !== undefined && value.length > 0) return { url: value, provenance: 'env' }
  }
  const state = readDevDatabaseState(options)
  if (state !== undefined) return { url: state.url, provenance: 'dev-database' }
  return undefined
}

/**
 * The stack's database URL lookup, non-throwing: the connection string if one
 * is set or a dev database is running, `undefined` otherwise.
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
export function findDatabaseUrl(options: DatabaseUrlLookupOptions = {}): string | undefined {
  return findDatabaseConnection(options)?.url
}

/**
 * {@link resolveDatabaseUrl}'s lookup, provenance and all, without the throw.
 * Stack-internal — it reaches sibling packages through
 * `@opensaas/stack-core/internal`, never the package root; the public
 * non-throwing accessor is {@link findDatabaseUrl}.
 */
export function findDatabaseConnection(
  options: DatabaseUrlLookupOptions = {},
): ResolvedDatabaseUrl | undefined {
  return lookupDatabaseUrl(options)
}

/**
 * The stack's database URL lookup — the one place a connection string is
 * chosen (ADR-0063, amending ADR-0014). `DATABASE_URL` (or
 * `DIRECT_DATABASE_URL`) wins; otherwise the Dev database state file written by
 * `startDevDatabase`; otherwise a throw. A deploy that forgets the
 * variable gets that error, never a silent in-process Postgres.
 *
 * The provenance is load-bearing, not informational: only on `'dev-database'`
 * does the generated context bind a single connection and disable Prisma's
 * contract-marker read, which is why the dev loop must never inject a
 * `DATABASE_URL` into the app it spawns.
 *
 * @throws {DatabaseUrlUnresolvedError} naming both remedies — the environment
 *   variable and `opensaas dev`.
 *
 * @example
 * ```typescript
 * import { resolveDatabaseUrl } from '@opensaas/stack-core'
 * const { url, provenance } = resolveDatabaseUrl()
 * const db = postgres({ contractJson, url })
 * ```
 */
export function resolveDatabaseUrl(options: DatabaseUrlLookupOptions = {}): ResolvedDatabaseUrl {
  const found = lookupDatabaseUrl(options)
  if (found !== undefined) return found
  throw new DatabaseUrlUnresolvedError(CONNECTION_VARIABLES)
}
