import { spawn, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import chokidar from 'chokidar'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { findDatabaseConnection } from '@opensaas/stack-core/internal'
import {
  startDevDatabase,
  type DevDatabase,
  type DevDatabaseExtension,
} from '@opensaas/stack-core/dev-database'
import { generateCommand } from './generate.js'
import { loadOpenSaasConfig, runPrismaCli } from '../generator/index.js'

/** The app command spawned when the invocation carries none of its own. */
const DEFAULT_APP_COMMAND = ['next', 'dev'] as const

/** The Dev database's data directory, inside the Generated bundle (ADR-0063). */
const DEV_DATABASE_DIR = path.join('.opensaas', 'dev-db')

/**
 * What a declared extension pack needs loaded into the Dev database's PGlite,
 * keyed by both the binding name a config gives it and the package it comes
 * from. A pack with nothing to load has no entry.
 */
const DEV_DATABASE_EXTENSIONS: Readonly<Record<string, DevDatabaseExtension>> = {
  pgvector: 'vector',
  vector: 'vector',
  '@prisma/orm-extension-pgvector': 'vector',
}

/** Options for {@link devCommand}. */
export interface DevCommandOptions {
  /**
   * The app command to run in place of `next dev` — what a caller wrote after
   * `opensaas dev --`.
   */
  appCommand?: readonly string[]
}

function declaredDevDatabaseExtensions(config: OpenSaasConfig): DevDatabaseExtension[] {
  const loadable = new Set<DevDatabaseExtension>()
  for (const extension of config.db.extensions ?? []) {
    const name = DEV_DATABASE_EXTENSIONS[extension.name] ?? DEV_DATABASE_EXTENSIONS[extension.from]
    if (name !== undefined) loadable.add(name)
  }
  return [...loadable]
}

/**
 * `PATH` with every `node_modules/.bin` from the project up to the filesystem
 * root ahead of it, so `next dev` — and any command a caller passes — resolves
 * to the project's own binary without a shell.
 */
function pathWithProjectBinaries(cwd: string): string {
  const directories: string[] = []
  let directory = path.resolve(cwd)
  for (;;) {
    directories.push(path.join(directory, 'node_modules', '.bin'))
    const parent = path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return [...directories, process.env.PATH ?? ''].join(path.delimiter)
}

function spawnApp(cwd: string, command: readonly string[], devDatabase: boolean): ChildProcess {
  const [file, ...args] = command
  if (file === undefined) throw new Error('No app command to run.')

  const env: typeof process.env = { ...process.env, PATH: pathWithProjectBinaries(cwd) }
  // The generated runtime binds a single connection and suppresses the
  // contract-marker read only when `resolveDatabaseUrl()` reports
  // `'dev-database'`; any inherited `DATABASE_URL` would put it on the `'env'`
  // branch instead, so it has to be removed, not merely left uninjected
  // (ADR-0063).
  if (devDatabase) delete env.DATABASE_URL

  return spawn(file, args, { cwd, stdio: 'inherit', env })
}

async function reconcile(cwd: string): Promise<boolean> {
  console.log(chalk.gray('\nReconciling the database with the emitted contract...\n'))

  // Interactive, so a destructive plan reaches the user as Prisma's own
  // consent prompt rather than failing or applying unasked — the loop goes no
  // further until that is answered (ADR-0063).
  const run = await runPrismaCli(cwd, ['db', 'update'], 'interactive')
  if (run.exitCode === 0) return true

  console.error(
    chalk.red(
      `\nprisma db update did not apply (exit ${run.exitCode ?? run.signal ?? 'unknown'}).`,
    ),
  )
  console.error(chalk.gray('The app was not started; the database is unchanged.\n'))
  return false
}

/**
 * The dev loop: start the Dev database, generate, reconcile, run the app, and
 * keep watching `opensaas.config.ts` (ADR-0063).
 *
 * It is a foreground sidecar. There is no daemon and no registry: the database
 * dies with this process, and every other process — the app child, a seed
 * script, a second-terminal `prisma db update` — finds it through the state
 * file rather than an injected variable.
 *
 * `DATABASE_URL` (or `DIRECT_DATABASE_URL`) already set is the Database
 * escape: no Dev database starts and the environment passes through untouched.
 */
export async function devCommand(options: DevCommandOptions = {}): Promise<void> {
  const cwd = process.cwd()
  const configPath = path.join(cwd, 'opensaas.config.ts')

  if (!fs.existsSync(configPath)) {
    console.error(chalk.red('Error: opensaas.config.ts not found in current directory'))
    console.error(chalk.gray('   Please run this command from your project root'))
    process.exit(1)
  }

  console.log(chalk.bold.cyan('\nOpenSaas Dev Mode\n'))

  const appCommand =
    options.appCommand !== undefined && options.appCommand.length > 0
      ? options.appCommand
      : DEFAULT_APP_COMMAND

  let database: DevDatabase | undefined
  if (findDatabaseConnection({ cwd })?.provenance === 'env') {
    console.log(chalk.gray('DATABASE_URL is set: using it, and starting no dev database.\n'))
  } else {
    const { config, aliasWarnings } = await loadOpenSaasConfig(cwd, configPath)
    for (const warning of aliasWarnings) console.log(chalk.yellow(`⚠️  ${warning}`))

    // PGlite's own `mkdir` of the data directory is not recursive, so the
    // Generated bundle directory has to exist before it runs.
    const dataDir = path.join(cwd, DEV_DATABASE_DIR)
    fs.mkdirSync(path.dirname(dataDir), { recursive: true })

    database = await startDevDatabase({
      cwd,
      dataDir,
      extensions: declaredDevDatabaseExtensions(config),
    })
    console.log(chalk.green(`Dev database listening on ${database.url}\n`))
  }

  const watcher = chokidar.watch(configPath, { persistent: true, ignoreInitial: true })
  watcher.on('change', async () => {
    console.log(chalk.yellow('\nConfig changed, regenerating...\n'))
    await generateCommand()
  })
  watcher.on('error', (error) => {
    console.error(chalk.red('\nWatcher error:'), error)
  })

  const stop = async (): Promise<void> => {
    await watcher.close()
    await database?.stop()
  }

  await generateCommand()

  if (!(await reconcile(cwd))) {
    await stop()
    process.exitCode = 1
    return
  }

  console.log(chalk.gray(`Starting the app: ${appCommand.join(' ')}\n`))
  console.log(chalk.gray('Watching opensaas.config.ts. Press Ctrl+C to stop.\n'))

  let child: ChildProcess
  try {
    child = spawnApp(cwd, appCommand, database !== undefined)
  } catch (error) {
    await stop()
    throw error
  }

  const exitCode = await new Promise<number>((resolve) => {
    const forward = (signal: 'SIGINT' | 'SIGTERM'): void => {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal)
    }
    process.once('SIGINT', () => forward('SIGINT'))
    process.once('SIGTERM', () => forward('SIGTERM'))

    child.once('error', (error) => {
      console.error(chalk.red(`\nCould not run \`${appCommand.join(' ')}\`:`), error.message)
      resolve(1)
    })
    child.once('exit', (code, signal) => resolve(signal !== null ? 1 : (code ?? 0)))
  })

  console.log(chalk.yellow('\nStopping dev mode...'))
  await stop()
  process.exitCode = exitCode
}
