import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { createRequire } from 'module'

/** Thrown when `prisma contract emit` exits non-zero. */
export class ContractEmitError extends Error {
  constructor(
    /** The CLI's combined stdout and stderr, verbatim. */
    readonly output: string,
    readonly exitCode: number | null,
  ) {
    super(
      `prisma contract emit failed (exit ${exitCode ?? 'signal'}).\n\n${output.trim()}`.trimEnd(),
    )
    this.name = 'ContractEmitError'
  }
}

/**
 * The pinned `prisma` CLI from the project's own dependency tree, so emission
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
 * shim is an `sh` script on Windows that `spawnSync` cannot run without a
 * shell.
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
 * Shell to `prisma contract emit`, which reads `prisma.config.ts`, evaluates
 * the Contract module and writes `contract.json` + `contract.d.ts` into
 * `outputPath`.
 *
 * @throws {ContractEmitError} on a non-zero exit, carrying the CLI's own
 *   output so a purity violation or a validation failure reaches the user as
 *   the toolchain worded it.
 */
export function emitContract(cwd: string, outputPath: string): void {
  const binary = resolvePrismaBinary(cwd)
  const args = ['contract', 'emit', '--output-path', outputPath]
  const command = binary.endsWith('.js') ? process.execPath : binary
  const commandArgs = binary.endsWith('.js') ? [binary, ...args] : args

  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: 'utf-8',
    // The rc.12 CLI blocks forever on a piped-but-unwritten stdin, even with
    // no interactive prompt to answer, so stdin is closed rather than piped.
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new ContractEmitError(`${result.stdout ?? ''}${result.stderr ?? ''}`, result.status)
  }
}
