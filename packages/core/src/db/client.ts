import { Pool } from 'pg'
import type {
  PostgresOptionsBase,
  PostgresOptionsWithContractJson,
} from '@prisma/orm-postgres/runtime'
import type { DatabaseClientConfig } from '../config/types.js'
import { findDatabaseConnection, resolveDatabaseUrl, type DatabaseUrlLookupOptions } from './url.js'

/**
 * Prisma's own pool waits 20 s for a connection; pg's default is `0` — wait
 * forever. A hand-built pool is not covered by rc.8's `poolOptions`, which
 * `toRuntimeBinding()` applies to `kind: 'url'` bindings only, so the ceiling
 * has to be set here or a stuck checkout wedges the single connection silently.
 */
const DEV_CONNECTION_TIMEOUT_MS = 20_000

// rc.8's `./runtime` exports `PostgresOptionsBase` but not the
// `PostgresBindingOptions` interface that carries `pg`.
type PostgresBindingOptions = PostgresOptionsWithContractJson<never>

/**
 * The connection half of the runtime client's construction options — what the
 * generated context spreads into `postgres()` beside the contract, the
 * extensions and the tripwire. Exactly one of `pg` and `url` is ever present.
 */
export interface RuntimeConnectionOptions {
  /** A pool or client the runtime binds to instead of dialling `url` itself. */
  readonly pg?: NonNullable<PostgresBindingOptions['pg']>
  /** The connection string, when the runtime opens its own pool. */
  readonly url?: string
  /** Timeouts handed to the runtime's own pool, from `db.client.poolOptions`. */
  readonly poolOptions?: PostgresOptionsBase['poolOptions']
  /** Present, and `false`, only on the Dev database (ADR-0063). */
  readonly verifyMarker?: PostgresOptionsBase['verifyMarker']
}

/**
 * Choose how the generated runtime client connects, from the app's
 * `db.client` binding and the stack's URL lookup (ADR-0049, ADR-0063).
 *
 * Three branches, in order:
 *
 * 1. `db.client.pg` — the app owns the pool. The factory is called here, and
 *    nowhere else, so a config load that never reaches the runtime opens no
 *    connection. Call this once per process, under the client singleton. An
 *    explicit pool wins outright, so it also displaces branch 2: a pool
 *    supplied while the Dev database is running gets neither workaround
 *    ADR-0063 requires, and is warned about rather than silently rebound.
 * 2. Dev-database provenance — a single-connection pool with the contract
 *    marker check off.
 * 3. An env URL — the connection string and Prisma's defaults.
 *
 * The pool built on branch 2 is not owned by anything: rc.8 installs
 * `ownedDispose` for `kind: 'url'` bindings only, so nothing ends it. The dev
 * loop's database is ephemeral and goes with the process, which is why that is
 * survivable here and not on branch 1.
 *
 * @throws {DatabaseUrlUnresolvedError} on branch 2/3 when neither
 *   `DATABASE_URL` nor a running dev database supplies a connection.
 *
 * @example
 * ```typescript
 * postgres<Contract>({
 *   contractJson,
 *   middleware: [originTripwire],
 *   ...resolveRuntimeConnection(config.db.client),
 * })
 * ```
 */
export function resolveRuntimeConnection(
  client?: DatabaseClientConfig,
  options: DatabaseUrlLookupOptions = {},
): RuntimeConnectionOptions {
  const pg = client?.pg?.()
  if (pg !== undefined) {
    if (findDatabaseConnection(options)?.provenance === 'dev-database') {
      console.warn(
        'opensaas: db.client.pg is bound while the dev database is running, so this pool ' +
          'replaces the single-connection binding that database needs (ADR-0063). Expect ' +
          'corrupted session state and a deadlock on the contract marker; unset db.client.pg ' +
          'to run against `opensaas dev`, or point DATABASE_URL at your own Postgres.',
      )
    }
    return { pg }
  }

  const { url, provenance } = resolveDatabaseUrl(options)

  if (provenance === 'dev-database') {
    // `pglite-socket` multiplexes every connection onto one PGlite session, so
    // a client spreading work across a pool corrupts its own session state,
    // and the marker's first-use read deadlocks a request that opens a
    // transaction. Both are properties of the Dev database, not of Postgres:
    // do not lift either to the `url` branch, and do not drop them here
    // (ADR-0063).
    return {
      pg: new Pool({
        connectionString: url,
        max: 1,
        connectionTimeoutMillis: DEV_CONNECTION_TIMEOUT_MS,
      }),
      verifyMarker: false,
    }
  }

  return client?.poolOptions !== undefined ? { url, poolOptions: client.poolOptions } : { url }
}
