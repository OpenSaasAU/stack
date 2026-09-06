import { spawn, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import chokidar, { type FSWatcher } from 'chokidar'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { findDatabaseConnection } from '@opensaas/stack-core/internal'
import {
  startDevDatabase,
  type DevDatabase,
  type DevDatabaseExtension,
} from '@opensaas/stack-core/dev-database'
import { generateCommand } from './generate.js'
import { loadOpenSaasConfig, runPrismaCli } from '../generator/index.js'

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
 * Loads the project's `.env` before the Database escape is decided.
 *
 * The generated `prisma.config.ts` loads that same file, and `next dev` loads
 * it too, so a `DATABASE_URL` written there is what the reconcile and the app
 * resolve — the escape check has to see it or it predicts the wrong branch.
 * `process.loadEnvFile` throws when the file is absent, and leaves variables
 * already in the environment untouched, so a shell variable still wins.
 */
function loadProjectEnvFile(cwd: string): void {
  const envFile = path.join(cwd, '.env')
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile)
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

/** The dev loop: Dev database, generate, reconcile, app child, config watch (ADR-0063). */
export async function devCommand(options: DevCommandOptions = {}): Promise<void> {
  const cwd = process.cwd()
  const configPath = path.join(cwd, 'opensaas.config.ts')

  if (!fs.existsSync(configPath)) {
    console.error(chalk.red('Error: opensaas.config.ts not found in current directory'))
    console.error(chalk.gray('   Please run this command from your project root'))
    process.exit(1)
  }

  console.log(chalk.bold.cyan('\nOpenSaas Dev Mode\n'))

  loadProjectEnvFile(cwd)

  const appCommand =
    options.appCommand !== undefined && options.appCommand.length > 0
      ? options.appCommand
      : DEFAULT_APP_COMMAND

  let database: DevDatabase | undefined
  let watcher: FSWatcher | undefined
  let child: ChildProcess | undefined
  let interrupted = false

  const stop = async (): Promise<void> => {
    await watcher?.close()
    await database?.stop()
  }

  const childIsRunning = (): boolean =>
    child !== undefined && child.exitCode === null && child.signalCode === null

  const onSignal = (signal: 'SIGINT' | 'SIGTERM'): void => {
    interrupted = true
    if (childIsRunning()) child?.kill(signal)
  }
  const onSigint = (): void => onSignal('SIGINT')
  const onSigterm = (): void => onSignal('SIGTERM')

  // `generateCommand` reports every refusal by exiting the process, and
  // `process.exit` skips `finally` — so this listener is the only shutdown
  // left on that path, and it is confined to what can be done synchronously:
  // orphan neither the app child nor the state file pointing other processes
  // at a database that is about to disappear.
  const onExit = (): void => {
    if (childIsRunning()) child?.kill('SIGTERM')
    if (database !== undefined) fs.rmSync(database.stateFile, { force: true })
  }

  // Registered before the database starts: Ctrl-C at Prisma's consent prompt
  // is the natural way to decline a destructive plan, and default SIGINT
  // handling would kill this process with PGlite still open.
  process.once('SIGINT', onSigint)
  process.once('SIGTERM', onSigterm)
  process.once('exit', onExit)

  try {
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

    watcher = chokidar.watch(configPath, { persistent: true, ignoreInitial: true })
    watcher.on('change', async () => {
      console.log(chalk.yellow('\nConfig changed, regenerating...\n'))
      await generateCommand()
    })
    watcher.on('error', (error) => {
      console.error(chalk.red('\nWatcher error:'), error)
    })

    await generateCommand()

    if (!(await reconcile(cwd)) || interrupted) {
      process.exitCode = 1
      return
    }

    console.log(chalk.gray(`Starting the app: ${appCommand.join(' ')}\n`))
    console.log(chalk.gray('Watching opensaas.config.ts. Press Ctrl+C to stop.\n'))

    child = spawnApp(cwd, appCommand, database !== undefined)
    const spawned = child

    process.exitCode = await new Promise<number>((resolve) => {
      spawned.once('error', (error) => {
        console.error(chalk.red(`\nCould not run \`${appCommand.join(' ')}\`:`), error.message)
        resolve(1)
      })
      spawned.once('exit', (code, signal) => resolve(signal !== null ? 1 : (code ?? 0)))
    })
  } finally {
    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigterm)
    process.off('exit', onExit)
    if (child !== undefined) console.log(chalk.yellow('\nStopping dev mode...'))
    await stop()
  }
}
