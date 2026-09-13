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

/** How long {@link probePgvectorAvailability} keeps redialling a server it cannot reach yet. */
const PROBE_DEADLINE = 30_000
const PROBE_CONNECT_TIMEOUT = 5_000
const PROBE_BACKOFF = 500

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** node-postgres reports a refused dial as an `AggregateError` whose own message is empty. */
function describeFault(fault: unknown): string {
  if (fault instanceof AggregateError) {
    return fault.errors.map(describeFault).join('; ') || fault.name
  }
  return fault instanceof Error ? `${fault.name}: ${fault.message}` : String(fault)
}

/**
 * `pg` is a real dependency of core, but a production install without the
 * PGlite peers must still be able to load this subpath — so, like
 * `testing/context.ts`'s own `pgModule`, it is reached only through a
 * dynamic `import()`, never a static one.
 */
async function pgModule(): Promise<Pick<typeof import('pg'), 'Client'>> {
  return (await import('pg')).default
}

/**
 * Whether a Postgres server named by the escape carries the pgvector
 * extension, for a suite that guards a config declaring it (ADR-0065).
 *
 * Only an answer from the server is an answer. A server that is not
 * accepting connections yet is redialled until {@link PROBE_DEADLINE} and
 * then thrown on, so a container still coming up can never be recorded as
 * one without pgvector — the only skip this can produce is a server that
 * answered and said no.
 *
 * @throws when the server stays unreachable for the whole deadline.
 */
export async function probePgvectorAvailability(url: string): Promise<boolean> {
  const until = Date.now() + PROBE_DEADLINE
  let attempts = 0
  let unreachable: unknown

  do {
    attempts++
    const pg = await pgModule()
    const client = new pg.Client({
      connectionString: url,
      connectionTimeoutMillis: PROBE_CONNECT_TIMEOUT,
    })
    try {
      await client.connect()
    } catch (fault) {
      unreachable = fault
      await pause(PROBE_BACKOFF)
      continue
    }
    // Connected: whatever the server says now is the truth about pgvector, and
    // a query that fails from here is a real fault rather than a slow boot.
    try {
      const result = await client.query(
        `select 1 from pg_available_extensions where name = 'vector'`,
      )
      return result.rowCount === 1
    } finally {
      await client.end()
    }
  } while (Date.now() < until)

  throw new Error(
    `Could not reach the ${ESCAPE_VARIABLE} server to probe for pgvector after ${attempts} ` +
      `attempts over ${PROBE_DEADLINE}ms. This is a broken connection, not a server without ` +
      `pgvector, so the caller should fail rather than skip. Last fault: ${describeFault(unreachable)}`,
  )
}
