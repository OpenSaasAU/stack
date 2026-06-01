/**
 * Environment-file generation for scaffolded apps.
 *
 * The defining onboarding bug this module fixes: a freshly scaffolded SQLite
 * project must ship a runnable `.env` so that `pnpm generate` / `pnpm db:push`
 * succeed on the first try. Given a database provider it returns the canonical
 * `.env` (written into the project) and `.env.example` (committed for
 * reference). Pure and provider-parametrised so it is trivially testable, and
 * so a SQLite project can never be handed a PostgreSQL connection string.
 */

export type DbProvider = 'sqlite' | 'postgresql'

export interface EnvFiles {
  /** Runnable env written to `.env` in the scaffolded project. */
  env: string
  /** Reference env committed to `.env.example`. */
  envExample: string
}

/** SQLite needs no setup: a file the CLI/`db:push` creates locally. */
const SQLITE_URL = 'file:./dev.db'

/** Derive a safe Postgres database name from the project name. */
function postgresUrl(projectName: string): string {
  const dbName = projectName.replace(/-/g, '_')
  return `postgresql://user:password@localhost:5432/${dbName}?schema=public`
}

export function generateEnvFiles(options: { provider: DbProvider; projectName: string }): EnvFiles {
  const { provider, projectName } = options

  if (provider === 'sqlite') {
    const env = `# SQLite database — zero setup, created locally by \`pnpm db:push\`\nDATABASE_URL="${SQLITE_URL}"\n`
    const envExample =
      `# SQLite (default) — zero setup, great for local development\n` +
      `DATABASE_URL="${SQLITE_URL}"\n` +
      `\n` +
      `# For PostgreSQL, set provider: 'postgresql' in opensaas.config.ts and use:\n` +
      `# DATABASE_URL="${postgresUrl(projectName)}"\n`
    return { env, envExample }
  }

  const url = postgresUrl(projectName)
  const env = `DATABASE_URL="${url}"\n`
  const envExample =
    `DATABASE_URL="${url}"\n` +
    `\n` +
    `# For SQLite (zero setup, great for local development):\n` +
    `# DATABASE_URL="${SQLITE_URL}"\n`
  return { env, envExample }
}
