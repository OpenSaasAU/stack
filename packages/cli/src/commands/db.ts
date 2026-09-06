import { Command } from 'commander'
import chalk from 'chalk'
import { DevLoopUnreachableError, NoDevLoopError, requestDatabaseUpdate } from '../dev/control.js'

/** Options for {@link dbUpdateCommand}. */
export interface DbUpdateCommandOptions {
  /**
   * Consent tokens passed straight through to Prisma's `--confirm`. Prisma
   * asks for the database name before it destroys data; the Dev database's is
   * `postgres`.
   */
  confirm?: readonly string[]
}

/**
 * `opensaas db update` — what `pnpm db:update` points at.
 *
 * The reconcile itself runs inside the `opensaas dev` loop: it holds the Dev
 * database's data directory, the staged generation and the app child, so this
 * command opens no connection of its own. It hands the loop the consent and
 * prints what the loop reports (ADR-0063).
 *
 * @example
 * ```bash
 * opensaas db update --confirm postgres
 * ```
 */
export async function dbUpdateCommand(options: DbUpdateCommandOptions = {}): Promise<void> {
  try {
    const ok = await requestDatabaseUpdate(process.cwd(), options.confirm ?? [], (message) => {
      console.log(message)
    })
    if (!ok) process.exitCode = 1
  } catch (error) {
    if (!(error instanceof NoDevLoopError) && !(error instanceof DevLoopUnreachableError))
      throw error
    console.error(chalk.red(error.message))
    process.exitCode = 1
  }
}

/** The `db` command group. */
export function createDbCommand(): Command {
  const db = new Command('db').description('Database commands for the running dev loop')

  db.command('update')
    .description('Apply the staged schema change through the running `opensaas dev` loop')
    .option(
      '--confirm <token>',
      "Consent token for a destructive change — the database name (the Dev database's is `postgres`)",
      (value: string, previous: string[]) => [...previous, value],
      [],
    )
    .action(async (options: { confirm: string[] }) => {
      await dbUpdateCommand({ confirm: options.confirm })
    })

  return db
}
