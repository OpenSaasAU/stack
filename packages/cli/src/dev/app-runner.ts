import { spawn, type ChildProcess } from 'child_process'
import * as path from 'path'

/** Options for {@link createAppRunner}. */
export interface AppRunnerOptions {
  /** The project root the app runs in. */
  cwd: string
  /** The app command and its arguments — `next dev` unless a caller named one. */
  command: readonly string[]
  /**
   * Whether the Dev database is the connection. On that branch the child must
   * inherit no `DATABASE_URL` at all: the generated runtime binds a single
   * connection and skips Prisma's contract-marker read only when
   * `resolveDatabaseUrl()` reports `'dev-database'` provenance, and an
   * inherited variable puts it on the `'env'` branch instead (ADR-0063).
   */
  devDatabase: boolean
}

/** The app child, and the two things the loop does to it. */
export interface AppRunner {
  /** Starts the app and resolves with its exit code — across restarts. */
  run(): Promise<number>
  /**
   * Replaces the running app with a fresh process. A client cached across HMR
   * keeps querying a column a destructive promote dropped, so a promote of
   * that kind is followed by a restart rather than a reload (ADR-0063).
   */
  restart(): void
  /** Forwards a signal to the app, if it is still running. */
  kill(signal: 'SIGINT' | 'SIGTERM'): void
  isRunning(): boolean
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

/**
 * The dev loop's app child: spawned once, restartable, and awaited as a single
 * run whose exit code is the one the loop reports.
 *
 * @example
 * ```typescript
 * const app = createAppRunner({ cwd, command: ['next', 'dev'], devDatabase: true })
 * const exitCode = await app.run()
 * ```
 */
export function createAppRunner(options: AppRunnerOptions): AppRunner {
  const [file, ...args] = options.command
  if (file === undefined) throw new Error('No app command to run.')

  let child: ChildProcess | undefined
  let restarting = false

  const spawnChild = (): ChildProcess => {
    const env: typeof process.env = {
      ...process.env,
      PATH: pathWithProjectBinaries(options.cwd),
    }
    if (options.devDatabase) delete env.DATABASE_URL
    return spawn(file, args, { cwd: options.cwd, stdio: 'inherit', env })
  }

  const isRunning = (): boolean =>
    child !== undefined && child.exitCode === null && child.signalCode === null

  return {
    isRunning,

    kill(signal) {
      // Cancels a restart the loop asked for and the child has not answered
      // yet: without this the pending `exit` respawns the app instead of
      // resolving `run()`, and the loop never reaches its shutdown.
      restarting = false
      if (isRunning()) child?.kill(signal)
    },

    restart() {
      if (!isRunning()) return
      restarting = true
      child?.kill('SIGTERM')
    },

    async run(): Promise<number> {
      return await new Promise<number>((resolve) => {
        const attach = (spawned: ChildProcess): void => {
          spawned.once('error', (error) => {
            console.error(`\nCould not run \`${options.command.join(' ')}\`: ${error.message}`)
            resolve(1)
          })
          spawned.once('exit', (code, signal) => {
            if (restarting) {
              restarting = false
              child = spawnChild()
              attach(child)
              return
            }
            resolve(signal !== null ? 1 : (code ?? 0))
          })
        }

        child = spawnChild()
        attach(child)
      })
    },
  }
}
