import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { startDevDatabase, type DevDatabase } from '@opensaas/stack-core/dev-database'
import { findDatabaseConnection } from '@opensaas/stack-core/internal'
import { runPrismaCli } from '@opensaas/stack-cli/generator'

/**
 * The database an e2e run reaches, and the lookup branch that produced it
 * (ADR-0063). `'env'` is the CI service container; `'dev-database'` is the
 * in-process Postgres this module starts for a local run.
 */
export interface PreparedDatabase {
  readonly url: string
  readonly provenance: 'env' | 'dev-database'
}

/**
 * The Dev databases this process started, if it started any. Playwright runs
 * `globalSetup` and `globalTeardown` in the same process, so the handles
 * survive between them without a file. One entry per project directory this
 * run's `setupDatabase` actually started a database for — in the common case
 * that project's own webServer already started one before `globalSetup` ran,
 * so this stays empty.
 */
const started: DevDatabase[] = []

const cliEntry = path.join(process.cwd(), 'packages', 'cli', 'bin', 'opensaas.js')

async function run(command: string, args: readonly string[], cwd: string): Promise<void> {
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: 'inherit' })
    child.once('error', reject)
    child.once('close', resolve)
  })
  if (exitCode !== 0) {
    throw new Error(`\`${[command, ...args].join(' ')}\` exited ${exitCode ?? 'on a signal'}.`)
  }
}

/**
 * Brings the project's database up to its config and hands back the connection
 * the app will find.
 *
 * The connection is never chosen here and never injected into the app: this
 * calls the same lookup `.opensaas/context.ts` and `prisma.config.ts` call, so
 * CI (with `DATABASE_URL` on the service container) and a local run (with
 * nothing set) differ only in which branch that lookup takes. When it finds
 * neither, the Dev database is started under the project's Generated bundle,
 * which is where every later process — `generate`, `prisma db update` and the
 * Next server Playwright starts — reads it back from.
 *
 * The Dev database's data directory is persistent, and the specs create posts
 * under fixed unique slugs, so it is discarded first: a run that inherited the
 * previous run's rows would assert against them instead of what it created.
 * The `'env'` branch is not reset — a server named by `DATABASE_URL` belongs to
 * whoever set it, and in CI it is a fresh container per job.
 */
export async function setupDatabase(projectDir: string): Promise<PreparedDatabase> {
  const existing = findDatabaseConnection({ cwd: projectDir })
  if (existing === undefined) {
    const dataDir = path.join(projectDir, '.opensaas', 'dev-db')
    fs.rmSync(dataDir, { recursive: true, force: true })
    // PGlite's own `mkdir` of the data directory is not recursive, so the
    // Generated bundle directory has to exist before it runs.
    fs.mkdirSync(path.dirname(dataDir), { recursive: true })
    started.push(
      await startDevDatabase({
        dataDir,
        extensions: ['vector'],
        cwd: projectDir,
      }),
    )
  }

  const connection = findDatabaseConnection({ cwd: projectDir })
  if (connection === undefined) {
    throw new Error('The database lookup found nothing after the Dev database was started.')
  }

  await run(process.execPath, [cliEntry, 'generate'], projectDir)

  const update = await runPrismaCli(projectDir, ['db', 'update'])
  if (update.exitCode !== 0) {
    throw new Error(
      `\`prisma db update\` exited ${update.exitCode ?? 'on a signal'}.\n${update.output}`,
    )
  }

  return connection
}

/** Stops every Dev database this process started. */
export async function cleanupDatabase(): Promise<void> {
  await Promise.all(started.splice(0).map((db) => db.stop()))
}

/**
 * Derives one example's own database name out of the connection string the
 * app's own lookup would otherwise find, so multiple examples on the e2e
 * job's `postgres` leg each reconcile against a database of their own
 * instead of fighting over the one shared connection names (the same reason
 * `example-gates` gives each of its suites a database of its own).
 * `playwright.config.ts`'s `webServer.env` is the only caller — each
 * example's own `opensaas dev` reconciles before Playwright ever runs
 * `global-setup.ts`, so nothing there needs this too.
 *
 * Checks `DIRECT_DATABASE_URL` before `DATABASE_URL`, mirroring
 * `CONNECTION_VARIABLES` in `packages/core/src/db/url.ts` — the app's own
 * lookup takes the same precedence, so a run with both set (ADR-0003's
 * pooled/direct pair) still overrides the connection the app would actually
 * use. Returns `undefined` when neither is set — the `dev-database` leg,
 * where each example isolates itself with its own PGlite data directory
 * instead and needs no override.
 */
export function exampleDatabaseUrl(databaseName: string): string | undefined {
  const base = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL
  if (!base) return undefined
  const url = new URL(base)
  url.pathname = `/${databaseName}`
  return url.toString()
}
