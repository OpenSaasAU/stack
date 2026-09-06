/**
 * The Dev database: an in-process PGlite the stack runs itself (ADR-0063).
 *
 * Known limits of this primitive, all of them properties of the socket server
 * it runs PGlite behind:
 *
 * - Every TCP connection is multiplexed onto **one** PGlite session, so a
 *   client with a multi-connection pool corrupts its own session state.
 *   Clients bind a single connection; `maxConnections` only buys headroom for
 *   the several single-connection clients that share one sidecar.
 * - A connection holding an open transaction holds the whole query queue.
 * - PGlite opens a data directory in one process at a time. A second process
 *   reaches the database over the socket or not at all.
 * - There is no daemon, registry or cross-process lookup: the database dies
 *   with the process that started it, and other processes find it through the
 *   state file.
 * - `PGLiteSocketServer` reports the port it bound only through the
 *   `host:port` string of `getServerConn()`, so the port is parsed back out of
 *   it rather than read from a field.
 */

import type { Extension } from '@electric-sql/pglite'
import {
  clearDevDatabaseState,
  devDatabaseStatePath,
  writeDevDatabaseState,
  type DevDatabaseStateLocation,
} from './state-file.js'

/** Extensions this primitive can make available on the started instance. */
export type DevDatabaseExtension = 'vector'

/** Options for {@link startDevDatabase}. */
export interface StartDevDatabaseOptions {
  /**
   * The PGlite data directory. Omitted, the database is in-memory and nothing
   * survives the process — which is what the test harness wants and the dev
   * loop does not.
   */
  dataDir?: string
  /** Extensions loaded into the instance, ready for `CREATE EXTENSION`. */
  extensions?: readonly DevDatabaseExtension[]
  /**
   * The socket server's connection ceiling. Defaults to
   * {@link DEFAULT_MAX_CONNECTIONS} — headroom for the several
   * single-connection clients that share one sidecar (the app, the CLI, a
   * seed, a `psql`), not licence for any one of them to open a pool.
   */
  maxConnections?: number
  /** The loopback address to bind. Defaults to `127.0.0.1`. */
  host?: string
  /** The project root whose Generated bundle receives the state file. */
  cwd?: string
  /** An explicit state file path, bypassing `cwd` and the bundle directory. */
  stateFile?: string
}

/** A running Dev database. */
export interface DevDatabase {
  /** The connection string written to the state file. */
  readonly url: string
  readonly host: string
  readonly port: number
  /** The data directory, or `undefined` when the instance is in-memory. */
  readonly dataDir: string | undefined
  /** Absolute path to the state file this instance wrote. */
  readonly stateFile: string
  /** Stops the socket server, closes PGlite and drops this instance's state file. */
  stop(): Promise<void>
}

/**
 * Headroom for the several single-connection clients that share one sidecar
 * (ADR-0063).
 */
export const DEFAULT_MAX_CONNECTIONS = 20

/** PGlite's one database, and therefore the name every URL carries. */
const DATABASE_NAME = 'postgres'

const EXTENSION_LOADERS: Record<DevDatabaseExtension, () => Promise<Extension>> = {
  vector: async () => (await import('@electric-sql/pglite-pgvector')).vector,
}

async function loadExtensions(
  names: readonly DevDatabaseExtension[],
): Promise<Record<string, Extension>> {
  const loaded: Record<string, Extension> = {}
  for (const name of names) {
    loaded[name] = await EXTENSION_LOADERS[name]()
  }
  return loaded
}

function portOf(connection: string): number {
  const port = Number(connection.slice(connection.lastIndexOf(':') + 1))
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`The dev database socket server reported no TCP port (got "${connection}").`)
  }
  return port
}

/**
 * Starts an in-process PGlite behind a socket server on a free loopback TCP
 * port and publishes it in the Generated bundle's state file, so that every
 * other process — the app, `db update` in a second terminal, a seed script —
 * finds it through `resolveDatabaseUrl()` rather than an injected variable
 * (ADR-0063).
 *
 * The state file is rewritten on every boot; a record left behind by a crashed
 * sidecar is ignored on its pid.
 *
 * PGlite and its socket and pgvector packages are optional peers of core,
 * imported only here, only when called — a production install carries no WASM
 * Postgres.
 *
 * @example
 * ```typescript
 * import { startDevDatabase } from '@opensaas/stack-core/dev-database'
 *
 * const database = await startDevDatabase({
 *   dataDir: '.opensaas/dev-db',
 *   extensions: ['vector'],
 * })
 * try {
 *   // `resolveDatabaseUrl()` now reports provenance 'dev-database' here
 *   // and in every child process.
 * } finally {
 *   await database.stop()
 * }
 * ```
 */
export async function startDevDatabase(
  options: StartDevDatabaseOptions = {},
): Promise<DevDatabase> {
  const { PGlite } = await import('@electric-sql/pglite')
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket')

  const host = options.host ?? '127.0.0.1'
  const extensions = await loadExtensions(options.extensions ?? [])
  const pglite = new PGlite({
    ...(options.dataDir !== undefined && { dataDir: options.dataDir }),
    extensions,
  })
  await pglite.waitReady

  const server = new PGLiteSocketServer({
    db: pglite,
    host,
    port: 0,
    maxConnections: options.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
  })
  try {
    await server.start()
  } catch (error) {
    await pglite.close()
    throw error
  }

  const port = portOf(server.getServerConn())
  const url = `postgres://${DATABASE_NAME}@${host}:${port}/${DATABASE_NAME}`
  const location: DevDatabaseStateLocation = {
    ...(options.cwd !== undefined && { cwd: options.cwd }),
    ...(options.stateFile !== undefined && { stateFile: options.stateFile }),
  }
  const stateFile = devDatabaseStatePath(location)
  writeDevDatabaseState(stateFile, { url, pid: process.pid })

  return {
    url,
    host,
    port,
    dataDir: options.dataDir,
    stateFile,
    stop: async () => {
      clearDevDatabaseState(stateFile, url)
      await server.stop()
      await pglite.close()
    },
  }
}
