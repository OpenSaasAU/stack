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

/**
 * The flags a non-interactive run must pass because a prompt would otherwise
 * be needed to answer them. Empty when every question is already answered.
 */
export function missingNonInteractiveFlags(args: readonly string[]): string[] {
  const missing: string[] = []
  if (!args.some((arg) => !arg.startsWith('--'))) missing.push('<project-name>')
  if (!args.includes('--with-auth') && !args.includes('--no-auth')) {
    missing.push('--with-auth or --no-auth')
  }
  if (!args.includes('--with-ai') && !args.includes('--no-ai')) {
    missing.push('--with-ai or --no-ai')
  }
  return missing
}
