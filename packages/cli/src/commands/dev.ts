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
import { generateCommand, type GenerationResult } from './generate.js'
import { loadOpenSaasConfig, runPrismaCli } from '../generator/index.js'
import { createAppRunner, type AppRunner } from '../dev/app-runner.js'
import { startControlChannel, type ControlChannel, type ControlReply } from '../dev/control.js'
import {
  describePlan,
  planDatabaseUpdate,
  promoteStagedGeneration,
  restoreMigrationRefs,
  snapshotMigrationRefs,
  STAGING_DIR,
} from '../dev/staged-reconcile.js'

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

  const stagingDir = path.join(cwd, STAGING_DIR)

  let database: DevDatabase | undefined
  let watcher: FSWatcher | undefined
  let control: ControlChannel | undefined
  let app: AppRunner | undefined
  let interrupted = false

  /** A staged generation the database does not carry yet. */
  let staged: GenerationResult | undefined
  /** One reconcile at a time: a burst of writes must not race itself. */
  let queue = Promise.resolve()

  const stop = async (): Promise<void> => {
    await watcher?.close()
    await control?.close()
    await database?.stop()
  }

  const onSignal = (signal: 'SIGINT' | 'SIGTERM'): void => {
    interrupted = true
    app?.kill(signal)
  }
  const onSigint = (): void => onSignal('SIGINT')
  const onSigterm = (): void => onSignal('SIGTERM')

  // `process.exit` skips `finally`, so this listener is the only shutdown left
  // on that path, and it is confined to what can be done synchronously:
  // orphan neither the app child nor the files pointing other processes at a
  // loop and a database that are about to disappear.
  const onExit = (): void => {
    app?.kill('SIGTERM')
    control?.clearFile()
    if (database !== undefined) fs.rmSync(database.stateFile, { force: true })
  }

  // Registered before the database starts: Ctrl-C at Prisma's consent prompt
  // is the natural way to decline a destructive plan, and default SIGINT
  // handling would kill this process with PGlite still open.
  process.once('SIGINT', onSigint)
  process.once('SIGTERM', onSigterm)
  process.once('exit', onExit)

  /**
   * Generates into staging. The app keeps running on the contract it has if
   * this refuses — a half-saved config must not take the loop down with it.
   */
  const stage = async (say: (message: string) => void): Promise<GenerationResult | undefined> => {
    // `staged` only ever names files inside `stagingDir`, so it has to be
    // dropped with them — a pointer left behind names the bytes of whatever
    // generation runs next, including one this loop refused.
    staged = undefined
    fs.rmSync(stagingDir, { recursive: true, force: true })
    try {
      return await generateCommand({ stagingDir, throwOnFailure: true })
    } catch (error) {
      say(
        `Generation failed, so nothing was staged: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      say('The app keeps serving the contract the database already carries.')
      return undefined
    }
  }

  const promote = (generation: GenerationResult): void => {
    promoteStagedGeneration(generation.paths, generation.livePaths, stagingDir)
    staged = undefined
  }

  const reportFailure = (say: (message: string) => void, output: string): void => {
    say('prisma db update did not apply. Nothing was promoted.')
    const trimmed = output.trim()
    if (trimmed.length > 0) say(trimmed)
  }

  const onConfigChange = async (): Promise<void> => {
    console.log(chalk.yellow('\nConfig changed: staging the new contract...\n'))
    const say = (message: string): void => console.log(chalk.gray(message))

    // Before staging, not after: generation seeds each declared pack's
    // extension contract space into the project's own `migrations/`, so a
    // snapshot taken afterwards restores the post-seed refs rather than the
    // ones the loop found.
    const refs = snapshotMigrationRefs(cwd)

    const generation = await stage(say)
    if (generation === undefined) {
      restoreMigrationRefs(cwd, refs)
      return
    }

    const planned = await planDatabaseUpdate(cwd, generation.prismaConfig, { dryRun: true })
    if (!planned.ok) {
      restoreMigrationRefs(cwd, refs)
      reportFailure((message) => console.error(chalk.red(message)), planned.failure.output)
      return
    }

    if (planned.plan.destructive) {
      restoreMigrationRefs(cwd, refs)
      staged = generation
      console.log(chalk.yellow('\nThis change would destroy data, so it was not applied:\n'))
      for (const line of describePlan(planned.plan)) console.log(chalk.yellow(line))
      console.log(
        chalk.yellow(
          '\nThe app keeps serving the previous schema. To apply it, run `pnpm db:update` ' +
            '(`opensaas db update --confirm postgres`) in another terminal.\n',
        ),
      )
      return
    }

    const applied = await planDatabaseUpdate(cwd, generation.prismaConfig)
    if (!applied.ok) {
      restoreMigrationRefs(cwd, refs)
      reportFailure((message) => console.error(chalk.red(message)), applied.failure.output)
      return
    }

    promote(generation)
    console.log(chalk.green('\nDatabase updated and the new contract promoted.\n'))
  }

  const onDatabaseUpdateRequest = async (
    confirm: readonly string[],
    reply: ControlReply,
  ): Promise<void> => {
    const say = (message: string): void => {
      console.log(chalk.gray(message))
      reply.log(message)
    }

    const refs = snapshotMigrationRefs(cwd)

    const generation = staged ?? (await stage(say))
    if (generation === undefined) {
      restoreMigrationRefs(cwd, refs)
      reply.finish(false, 'Nothing was staged: generation refused the current config.')
      return
    }

    const applied = await planDatabaseUpdate(cwd, generation.prismaConfig, { confirm })
    if (!applied.ok) {
      restoreMigrationRefs(cwd, refs)
      reportFailure(say, applied.failure.output)
      reply.finish(false, 'The database is unchanged and nothing was promoted.')
      return
    }

    promote(generation)
    for (const line of describePlan(applied.plan)) say(line)

    if (applied.plan.destructive) {
      say('Restarting the app: a client cached across a reload would query the dropped column.')
      app?.restart()
    }

    reply.finish(true, 'Applied, promoted.')
  }

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

    fs.rmSync(stagingDir, { recursive: true, force: true })

    await generateCommand()

    if (!(await reconcile(cwd)) || interrupted) {
      process.exitCode = 1
      return
    }

    // Armed only now: `queue` serialises reconciles against each other, not
    // against this startup generate and reconcile, so a save landing earlier
    // would run a second `db update` against the same database concurrently.
    watcher = chokidar.watch(configPath, { persistent: true, ignoreInitial: true })
    watcher.on('change', () => {
      queue = queue.then(onConfigChange).catch((error: unknown) => {
        console.error(chalk.red('\nStaged reconcile failed:'), error)
      })
    })
    watcher.on('error', (error) => {
      console.error(chalk.red('\nWatcher error:'), error)
    })

    control = await startControlChannel(cwd, async (request, reply) => {
      await new Promise<void>((resolve) => {
        queue = queue
          .then(() => onDatabaseUpdateRequest(request.confirm, reply))
          .catch((error: unknown) => {
            reply.finish(false, error instanceof Error ? error.message : String(error))
          })
          .finally(resolve)
      })
    })

    console.log(chalk.gray(`Starting the app: ${appCommand.join(' ')}\n`))
    console.log(chalk.gray('Watching opensaas.config.ts. Press Ctrl+C to stop.\n'))

    app = createAppRunner({ cwd, command: appCommand, devDatabase: database !== undefined })
    process.exitCode = await app.run()
  } finally {
    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigterm)
    process.off('exit', onExit)
    if (app !== undefined) console.log(chalk.yellow('\nStopping dev mode...'))
    await stop()
  }
}
