/**
 * The `--db` flag selected between a SQLite and a PostgreSQL scaffold. The
 * scaffolder no longer transforms the template's database, so the flag has no
 * meaning; returns the refusal message when it is present in `args`, and
 * `undefined` otherwise.
 *
 * A silent ignore would be worse than a refusal: `--db postgres my-app` would
 * then scaffold a project literally named `postgres`.
 */
export function removedDbFlagMessage(args: readonly string[]): string | undefined {
  const present = args.some((arg) => arg === '--db' || arg.startsWith('--db='))
  if (!present) return undefined
  return (
    'The --db flag has been removed. The scaffolded project uses the database ' +
    'its template declares; edit `db` in the generated opensaas.config.ts to ' +
    'change it.'
  )
}
