/**
 * The Dev database: an in-process PGlite the stack runs itself (ADR-0063).
 *
 * Known limits of this primitive:
 *
 * - Every TCP connection is multiplexed onto **one** PGlite session, so a
 *   client with a multi-connection pool corrupts its own session state.
 *   Clients bind a single connection; `maxConnections` only buys headroom for
 *   the several single-connection clients that share one sidecar. That
 *   headroom counts distinct PROCESSES (the app, the CLI, a seed, a `psql`) —
 *   the generated context's own client is one process-wide singleton
 *   regardless of how many times a bundler duplicates its module (ADR-0070),
 *   so one running app never claims more than one of these slots on its own.
 * - A connection holding an open transaction holds the whole query queue.
 * - PGlite opens a data directory in one process at a time. `startDevDatabase`
 *   enforces this against itself — a second call against the same `dataDir`
 *   fails naming the first — but the guard is a lock file inside that
 *   directory: a bare `new PGlite({ dataDir })` bypassing this primitive, or
 *   the lock file being deleted out from under a running sidecar, is not
 *   caught.
 * - There is no daemon, registry or cross-process lookup: the database dies
 *   with the process that started it, and other processes find it through the
 *   state file.
 * - Stale-sidecar detection (the state file's pid, and the `dataDir` lock's)
 *   compares process start times to tell a live pid from an unrelated process
 *   that inherited it after a reboot or pid wrap. The comparison is
 *   approximate — Linux assumes a 100 Hz clock, macOS's `ps` only carries
 *   one-second resolution — and unavailable on any other platform, where a
 *   live pid is trusted outright exactly as it was before this check existed.
 * - An IPv6 `host` is bracketed into the published URL, which is the RFC 3986
 *   form; node-postgres does not strip those brackets when it parses a
 *   connection string, so such a client takes `host` and `port` off the handle
 *   instead of the URL.
 * - `PGLiteSocketServer` reports the port it bound only through the
 *   `host:port` string of `getServerConn()`, so the port is parsed back out of
 *   it rather than read from a field.
 */

import type { Extension } from '@electric-sql/pglite'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import {
  describeSelf,
  identifiesLiveProcess,
  processClaimSchema,
  type ProcessClaim,
} from './process-identity.js'
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
   *
   * Resolved against `cwd` (or `process.cwd()`, absent that) when relative —
   * the same root the state file resolves against — so a relative `dataDir`
   * and an explicit `cwd` never disagree about where the data directory is.
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
  /** The absolute data directory, or `undefined` when the instance is in-memory. */
  readonly dataDir: string | undefined
  /** Absolute path to the state file this instance wrote. */
  readonly stateFile: string
  /**
   * Stops the socket server, closes PGlite, then drops this instance's state
   * file. Idempotent: a second call resolves without touching anything.
   */
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

async function release(steps: readonly (() => Promise<void>)[]): Promise<void> {
  const failures: unknown[] = []
  for (const step of steps) {
    try {
      await step()
    } catch (failure) {
      failures.push(failure)
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(failures, 'The dev database did not shut down cleanly.')
  }
}

function authorityOf(host: string): string {
  return host.includes(':') ? `[${host}]` : host
}

function portOf(connection: string): number {
  const port = Number(connection.slice(connection.lastIndexOf(':') + 1))
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`The dev database socket server reported no TCP port (got "${connection}").`)
  }
  return port
}

/** Thrown by {@link startDevDatabase} when another sidecar already holds `dataDir`. */
export class DevDatabaseInUseError extends Error {
  constructor(dataDir: string, pid: number) {
    super(
      `The dev database data directory "${dataDir}" is already open in another process ` +
        `(pid ${pid}). PGlite serves one process at a time, so a second sidecar racing the ` +
        `first over the same files would corrupt it — stop that process or start this one ` +
        `against a different \`dataDir\`.`,
    )
    this.name = 'DevDatabaseInUseError'
  }
}

/**
 * The lock file's name inside the data directory it claims. Distinct from
 * anything PGlite itself writes there, so this primitive's own bookkeeping
 * cannot collide with the emulated Postgres data directory it sits beside.
 */
const DATA_DIR_LOCK_FILE_NAME = '.opensaas-dev-database.lock'

function readDataDirLock(lockFile: string) {
  let contents: string
  try {
    contents = readFileSync(lockFile, 'utf8')
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    return undefined
  }
  const claim = processClaimSchema.safeParse(parsed)
  return claim.success ? claim.data : undefined
}

function writeDataDirLock(lockFile: string, claim: ProcessClaim): void {
  writeFileSync(lockFile, `${JSON.stringify(claim, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
}

/** Removes the lock only while it still names the claim that took it. */
function releaseDataDirLock(lockFile: string, claim: ProcessClaim): void {
  const existing = readDataDirLock(lockFile)
  if (
    existing !== undefined &&
    (existing.pid !== claim.pid || existing.startedAt !== claim.startedAt)
  ) {
    return
  }
  rmSync(lockFile, { force: true })
}

/** Bounds the stale-lock replacement loop below — a cost limit, not a real ceiling on contention. */
const MAX_DATA_DIR_LOCK_ATTEMPTS = 5

/**
 * Claims `dataDir` for this process before PGlite ever opens it, so a second
 * `startDevDatabase` against the same directory fails naming the first
 * instead of racing it over the same files. A lock a dead or recycled pid
 * left behind is replaced rather than honoured, mirroring the state file's
 * own stale-record handling (`identifiesLiveProcess`).
 *
 * Replacing a stale lock is read-then-write, not atomic on its own — the
 * `wx` create on the next loop iteration is what actually resolves two
 * starters racing the same replacement: at most one of them can create the
 * file, and the other's next `EEXIST` observes ITS live claim and throws
 * below rather than both believing they hold the directory. `release` is
 * likewise ownership-checked, so a starter that lost that race can never
 * delete the winner's lock out from under it at `stop()`.
 *
 * @throws {DevDatabaseInUseError} when a live sidecar already holds `dataDir`.
 */
function acquireDataDirLock(dataDir: string): () => void {
  mkdirSync(dataDir, { recursive: true })
  const lockFile = path.join(dataDir, DATA_DIR_LOCK_FILE_NAME)
  const claim = describeSelf()

  for (let attempt = 0; attempt < MAX_DATA_DIR_LOCK_ATTEMPTS; attempt++) {
    try {
      writeDataDirLock(lockFile, claim)
      return () => releaseDataDirLock(lockFile, claim)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
    }

    const existing = readDataDirLock(lockFile)
    if (existing !== undefined && identifiesLiveProcess(existing)) {
      throw new DevDatabaseInUseError(dataDir, existing.pid)
    }

    // Stale: the pid that wrote this lock is gone, or a reboot/wrap has
    // handed it to an unrelated process. Clear it and loop back to the `wx`
    // create above.
    rmSync(lockFile, { force: true })
  }

  throw new Error(
    `Could not claim the dev database data directory "${dataDir}": a stale lock kept reappearing.`,
  )
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
  const cwd = options.cwd ?? process.cwd()
  const dataDir = options.dataDir !== undefined ? path.resolve(cwd, options.dataDir) : undefined
  const extensions = await loadExtensions(options.extensions ?? [])

  const teardown: (() => Promise<void>)[] = []
  if (dataDir !== undefined) {
    const releaseLock = acquireDataDirLock(dataDir)
    teardown.push(async () => releaseLock())
  }

  try {
    const pglite = new PGlite({ ...(dataDir !== undefined && { dataDir }), extensions })
    // Registered before the `await` below, not after: a rejected `waitReady`
    // must still close the handle it rejected on, not just release the lock.
    teardown.unshift(() => pglite.close())
    await pglite.waitReady

    const server = new PGLiteSocketServer({
      db: pglite,
      host,
      port: 0,
      maxConnections: options.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
    })
    await server.start()
    teardown.unshift(() => server.stop())

    const port = portOf(server.getServerConn())
    const url = `postgres://${DATABASE_NAME}@${authorityOf(host)}:${port}/${DATABASE_NAME}`
    const location: DevDatabaseStateLocation = {
      cwd,
      ...(options.stateFile !== undefined && { stateFile: options.stateFile }),
    }
    const stateFile = devDatabaseStatePath(location)
    writeDevDatabaseState(stateFile, { url, pid: process.pid })

    let stopped = false
    return {
      url,
      host,
      port,
      dataDir,
      stateFile,
      stop: async () => {
        if (stopped) return
        stopped = true
        await release(teardown)
        clearDevDatabaseState(stateFile, url)
      },
    }
  } catch (error) {
    await release(teardown).catch(() => {})
    throw error
  }
}
