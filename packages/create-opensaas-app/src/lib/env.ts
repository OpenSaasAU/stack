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

  // PostgreSQL: emit the pooled-app / direct-CLI split (see the deployment
  // guide). `DATABASE_URL` is the pooled connection the app's driver adapter
  // uses at runtime; `DIRECT_DATABASE_URL` is the direct (non-pooled)
  // connection the Prisma CLI uses for migrations. The generated
  // `prisma.config.ts` resolves `DIRECT_DATABASE_URL ?? DATABASE_URL`, so both
  // are placeholders the user replaces with their provider's connection
  // strings.
  const url = postgresUrl(projectName)
  const env =
    `# PostgreSQL — pooled connection used by the app's driver adapter.\n` +
    `# Replace with your provider's pooled connection string before \`pnpm db:push\`.\n` +
    `DATABASE_URL="${url}"\n` +
    `\n` +
    `# Direct (non-pooled) connection used by the Prisma CLI for migrations.\n` +
    `# Replace with your provider's direct connection string.\n` +
    `DIRECT_DATABASE_URL="${url}"\n`
  const envExample =
    `# PostgreSQL — pooled connection used by the app's driver adapter.\n` +
    `DATABASE_URL="${url}"\n` +
    `\n` +
    `# Direct (non-pooled) connection used by the Prisma CLI for migrations.\n` +
    `DIRECT_DATABASE_URL="${url}"\n` +
    `\n` +
    `# For SQLite (zero setup, great for local development):\n` +
    `# DATABASE_URL="${SQLITE_URL}"\n`
  return { env, envExample }
}
