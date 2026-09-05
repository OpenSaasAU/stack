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
 * The pinned `prisma` binary from the project's own `node_modules/.bin`, so
 * emission runs the toolchain version the project depends on rather than
 * whatever `npx` would fetch.
 *
 * @throws when the project has no `prisma` installed, naming the package.
 */
export function resolvePrismaBinary(cwd: string): string {
  const local = path.join(cwd, 'node_modules', '.bin', 'prisma')
  if (fs.existsSync(local)) return local

  // A pnpm workspace hoists the binary to the workspace root; resolving the
  // package itself finds it wherever the installer put it.
  try {
    const require = createRequire(path.join(cwd, 'noop.js'))
    const packageJson = require.resolve('prisma/package.json')
    const binary = path.join(path.dirname(packageJson), 'dist', 'prisma.js')
    if (fs.existsSync(binary)) return binary
  } catch {
    // Fall through to the error below — a resolution failure and a missing
    // file are the same problem for the caller.
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
