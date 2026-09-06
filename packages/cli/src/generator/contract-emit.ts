import { runPrismaCli } from './prisma-cli.js'

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
 * Shell to `prisma contract emit`, which reads `prisma.config.ts`, evaluates
 * the Contract module and writes `contract.json` + `contract.d.ts` into
 * `outputPath`.
 *
 * @param configPath - A Prisma config to read instead of the project root's,
 *   which is how a staged Contract module is emitted without the live one
 *   being touched.
 *
 * @throws {ContractEmitError} on a non-zero exit, carrying the CLI's own
 *   output so a purity violation or a validation failure reaches the user as
 *   the toolchain worded it.
 */
export async function emitContract(
  cwd: string,
  outputPath: string,
  configPath?: string,
): Promise<void> {
  const config = configPath === undefined ? [] : ['--config', configPath]
  const run = await runPrismaCli(cwd, ['contract', 'emit', ...config, '--output-path', outputPath])
  if (run.exitCode !== 0) throw new ContractEmitError(run.output, run.exitCode)
}
