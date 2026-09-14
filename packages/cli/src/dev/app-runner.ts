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
  /** Defaults to `process.platform`; injectable so the shim/kill decision is testable on any host. */
  platform?: typeof process.platform
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
 * The path-extension env write: the key to assign under, and its extended
 * value. Windows spells the variable `Path`; writing back under a fixed
 * `PATH` would leave that alongside the host's own casing, and the child
 * resolves against whichever one Windows happens to prefer (#1219).
 */
export interface PathExtension {
  key: string
  value: string
}

/**
 * Every `node_modules/.bin` from the project up to the filesystem root, ahead
 * of the existing path, under the host's own `PATH`/`Path` casing — so `next
 * dev`, and any command a caller passes, resolves to the project's own binary
 * without a shell.
 */
export function extendPathEnv(cwd: string, env: typeof process.env): PathExtension {
  const directories: string[] = []
  let directory = path.resolve(cwd)
  for (;;) {
    directories.push(path.join(directory, 'node_modules', '.bin'))
    const parent = path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === 'PATH') ?? 'PATH'
  return { key, value: [...directories, env[key] ?? ''].join(path.delimiter) }
}

/**
 * Whether the app child needs a shell to launch. Node's `spawn` resolves an
 * unresolved command straight to `CreateProcess` on Windows, which cannot run
 * a `.cmd`/`.bat` batch shim — `next` and every other locally-installed bin
 * are exactly that. An extension naming a real executable (`.exe`, `.js`, a
 * shebang-free binary) needs no shell; anything else on Windows might be a
 * shim, so it gets one. POSIX never does: `shell: true` there changes
 * quoting and signal semantics for no Windows-only benefit.
 */
export function needsShell(file: string, platform: typeof process.platform): boolean {
  if (platform !== 'win32') return false
  const extension = path.extname(file).toLowerCase()
  return extension === '' || extension === '.cmd' || extension === '.bat'
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

  const platform = options.platform ?? process.platform
  const usesShell = needsShell(file, platform)

  let child: ChildProcess | undefined
  let restarting = false

  const spawnChild = (): ChildProcess => {
    const env: typeof process.env = { ...process.env }
    const pathExtension = extendPathEnv(options.cwd, env)
    env[pathExtension.key] = pathExtension.value
    if (options.devDatabase) delete env.DATABASE_URL
    return spawn(file, args, { cwd: options.cwd, stdio: 'inherit', env, shell: usesShell })
  }

  // `shell: true` makes the tracked child cmd.exe, not the shim it runs —
  // `next.cmd`'s own `next-server` process is cmd.exe's child, not ours.
  // `target.kill()` would only stop the wrapper and orphan the real app.
  // `taskkill /t` reaches the whole tree from the wrapper's pid.
  const killChild = (target: ChildProcess, signal: 'SIGINT' | 'SIGTERM'): void => {
    if (usesShell && target.pid !== undefined) {
      spawn('taskkill', ['/pid', String(target.pid), '/t', '/f'])
      return
    }
    target.kill(signal)
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
      if (isRunning() && child !== undefined) killChild(child, signal)
    },

    restart() {
      if (!isRunning() || child === undefined) return
      restarting = true
      killChild(child, 'SIGTERM')
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
