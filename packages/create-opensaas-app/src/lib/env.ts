/**
 * Environment-file generation for scaffolded apps.
 *
 * A scaffolded project ships **no** `DATABASE_URL`: `pnpm dev` runs the Dev
 * database for it, and a variable set here would instead be the Database
 * escape and stop that database from starting (ADR-0063). Both files are
 * generated from one shape so the committed example can never drift from the
 * runnable `.env`.
 */

export interface EnvFiles {
  /** Runnable env written to `.env` in the scaffolded project. */
  env: string
  /** Reference env committed to `.env.example`. */
  envExample: string
}

/** Derive a safe Postgres database name from the project name. */
function postgresUrl(projectName: string): string {
  const dbName = projectName.replace(/-/g, '_')
  return `postgresql://user:password@localhost:5432/${dbName}`
}

export function generateEnvFiles(options: { projectName: string }): EnvFiles {
  const contents =
    `# Database\n` +
    `# \`pnpm dev\` starts the Dev database for this project, so DATABASE_URL is\n` +
    `# unset. Set it to reach a Postgres of your own — that is the Database\n` +
    `# escape, and no Dev database starts.\n` +
    `# DATABASE_URL="${postgresUrl(options.projectName)}"\n`

  return { env: contents, envExample: contents }
}

/** The auth template's `.env`: its example with a real secret and rate limiting left on. */
export function generateAuthEnv(example: string, secret: string): string {
  const lines = example.split(/\r?\n/)
  const hasSecret = lines.some((line) => line.startsWith('BETTER_AUTH_SECRET='))
  const out = lines.map((line) => {
    if (line.startsWith('BETTER_AUTH_SECRET=')) return `BETTER_AUTH_SECRET=${secret}`
    if (line.startsWith('DISABLE_RATE_LIMITING=')) return '# DISABLE_RATE_LIMITING=true'
    return line
  })
  if (!hasSecret) out.splice(out.length - 1, 0, `BETTER_AUTH_SECRET=${secret}`)
  return out.join('\n')
}
