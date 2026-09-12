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
 * The Dev database this process started, if it started one. Playwright runs
 * `globalSetup` and `globalTeardown` in the same process, so the handle
 * survives between them without a file.
 */
let started: DevDatabase | undefined

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
    started = await startDevDatabase({
      dataDir,
      extensions: ['vector'],
      cwd: projectDir,
    })
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

/** Stops the Dev database, if this process started one. */
export async function cleanupDatabase(): Promise<void> {
  await started?.stop()
  started = undefined
}
