import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { createRequire } from 'module'

/**
 * The pinned `prisma` CLI from the project's own dependency tree, so a command
 * runs the toolchain version the project depends on rather than whatever `npx`
 * would fetch. Resolving the package (rather than looking only in `<cwd>`)
 * finds it wherever the installer put it — a pnpm workspace hoists it to the
 * workspace root, and a monorepo sub-app has no local `node_modules` at all.
 *
 * The entry comes off the resolved manifest's `bin` rather than an assumed
 * path, so a layout change between prereleases surfaces as the real error
 * instead of "prisma is not installed" immediately after resolution succeeded.
 * It is preferred over `node_modules/.bin/prisma` because it is a `.js` file
 * this process can run with `process.execPath` on every platform, where the
 * shim is an `sh` script that spawning without a shell cannot run on Windows.
 *
 * Known limits:
 * - The `.bin` shim fallback is POSIX-only. It is reached only when `prisma`
 *   is installed but not resolvable as a package from `cwd`, which the
 *   manifest lookup covers for every normal install.
 *
 * @throws when the project has no `prisma` installed, naming the package.
 */
export function resolvePrismaBinary(cwd: string): string {
  try {
    const require = createRequire(path.join(cwd, 'noop.js'))
    const packageJson = require.resolve('prisma/package.json')
    const manifest: { bin?: string | Record<string, string> } = require(packageJson)
    const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.prisma
    if (entry !== undefined) {
      const binary = path.join(path.dirname(packageJson), entry)
      if (fs.existsSync(binary)) return binary
    }
  } catch {
    // A resolution failure and a missing file are the same problem for the
    // caller: fall through to the shim, then to the error below.
  }

  if (process.platform !== 'win32') {
    const shim = path.join(cwd, 'node_modules', '.bin', 'prisma')
    if (fs.existsSync(shim)) return shim
  }

  throw new Error(
    'The `prisma` CLI is not installed in this project. Add it as a dependency ' +
      '(`pnpm add -D prisma`) so `opensaas generate` can emit the contract artifacts.',
  )
}

/**
 * How a Prisma CLI run is wired to this process:
 *
 * - `'capture'` closes stdin and collects the CLI's own output for an error
 *   message.
 * - `'interactive'` hands the CLI this process's terminal, which is what lets
 *   a destructive `db update` reach the user with its consent prompt
 *   (ADR-0063).
 */
export type PrismaCliStdio = 'capture' | 'interactive'

/** How a Prisma CLI run ended. */
export interface PrismaCliRun {
  readonly exitCode: number | null
  readonly signal: string | null
  /** Combined stdout and stderr; empty for an `'interactive'` run. */
  readonly output: string
}

/**
 * Run one Prisma CLI command in the project and resolve when it exits.
 *
 * Asynchronous, always: a `spawnSync` blocks the event loop the Dev database's
 * socket server is served on, which deadlocks the first `db update` the dev
 * loop runs against its own sidecar (ADR-0063). A `'capture'` run also closes
 * stdin rather than piping it, because the rc.12 CLI blocks forever on a
 * piped-but-unwritten stdin even with no prompt to answer.
 *
 * @example
 * ```typescript
 * const run = await runPrismaCli(cwd, ['db', 'update'], 'interactive')
 * if (run.exitCode !== 0) throw new Error('reconciliation failed')
 * ```
 */
export async function runPrismaCli(
  cwd: string,
  args: readonly string[],
  stdio: PrismaCliStdio = 'capture',
): Promise<PrismaCliRun> {
  const binary = resolvePrismaBinary(cwd)
  const isScript = binary.endsWith('.js')
  const command = isScript ? process.execPath : binary
  const commandArgs = isScript ? [binary, ...args] : [...args]

  return await new Promise<PrismaCliRun>((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd,
      stdio: stdio === 'interactive' ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    })

    let output = ''
    for (const stream of [child.stdout, child.stderr]) {
      if (stream === null) continue
      stream.setEncoding('utf-8')
      stream.on('data', (chunk: string) => {
        output += chunk
      })
    }

    child.once('error', reject)
    child.once('close', (exitCode, signal) => resolve({ exitCode, signal, output }))
  })
}
