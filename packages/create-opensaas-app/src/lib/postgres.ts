/**
 * SQLite → PostgreSQL transforms for the `--db postgres` scaffolder path.
 *
 * The templates are copied verbatim from the SQLite examples
 * (`examples/starter` / `examples/starter-auth`). A `--db postgres` project is
 * therefore the SQLite template rewritten deterministically: the `opensaas.config.ts`
 * `db` block swaps to the `PrismaPg` driver adapter, and `package.json` swaps the
 * SQLite adapter/driver for the Postgres ones. Both transforms are pure and
 * unit-tested here so `src/index.ts` stays a thin orchestrator and the rewrite
 * can be exhaustively asserted (no leftover `sqlite`/`better-sqlite3`).
 */

import type { PackageJsonLike } from './package-json.js'

/**
 * Postgres dependency versions, matched to the existing monorepo usage
 * (`examples/rag-openai-chatbot`) so the repo carries a single version of each.
 */
const PG_DEPS = {
  '@prisma/adapter-pg': '^7.9.1',
  pg: '^8.20.0',
} as const

const PG_DEV_DEPS = {
  '@types/pg': '^8.18.0',
} as const

/** SQLite-only deps removed from a Postgres project. */
const SQLITE_DEPS = ['@prisma/adapter-better-sqlite3', 'better-sqlite3'] as const

/** The import line every SQLite template carries for its driver adapter. */
const SQLITE_ADAPTER_IMPORT = "import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'"

/** The Postgres adapter imports that replace the SQLite one. */
const PG_ADAPTER_IMPORTS = "import { PrismaPg } from '@prisma/adapter-pg'\nimport pg from 'pg'"

/**
 * Rewrite an `opensaas.config.ts` SQLite `db` block into a PostgreSQL one.
 *
 * Swaps the adapter import and the `db: { ... }` block to the documented
 * `PrismaPg` form (matching `examples/rag-openai-chatbot` and the deployment
 * guide). Throws if the expected SQLite shape isn't found, so a template drift
 * fails loudly rather than silently emitting a half-converted config.
 */
export function toPostgresConfig(source: string): string {
  if (!source.includes(SQLITE_ADAPTER_IMPORT)) {
    throw new Error(
      'Expected SQLite adapter import in opensaas.config.ts; cannot convert to PostgreSQL',
    )
  }

  let result = source.replace(SQLITE_ADAPTER_IMPORT, PG_ADAPTER_IMPORTS)

  // Swap the `db` block. The SQLite block is:
  //
  //   db: {
  //     provider: 'sqlite',
  //     prismaClientConstructor: (PrismaClient) => {
  //       const adapter = new PrismaBetterSqlite3({ url: ... })
  //       return new PrismaClient({ adapter })
  //     },
  //   },
  //
  // Match it structurally (whitespace-tolerant) and replace with the Postgres
  // form. Capturing the leading indentation keeps the emitted block aligned.
  const dbBlock =
    /([ \t]*)db:\s*\{\s*provider:\s*'sqlite',\s*prismaClientConstructor:\s*\(PrismaClient\)\s*=>\s*\{[\s\S]*?return new PrismaClient\(\{ adapter \}\)\s*\},?\s*\},/

  if (!dbBlock.test(result)) {
    throw new Error(
      'Expected a SQLite `db` block in opensaas.config.ts; cannot convert to PostgreSQL',
    )
  }

  result = result.replace(dbBlock, (_match, indent: string) => {
    const inner = `${indent}  `
    const body = `${inner}  `
    return (
      `${indent}db: {\n` +
      `${inner}provider: 'postgresql',\n` +
      `${inner}prismaClientConstructor: (PrismaClient) => {\n` +
      `${body}const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })\n` +
      `${body}const adapter = new PrismaPg(pool)\n` +
      `${body}return new PrismaClient({ adapter })\n` +
      `${inner}},\n` +
      `${indent}},`
    )
  })

  return result
}

/**
 * Rewrite a scaffolded `package.json` for PostgreSQL: drop the SQLite adapter
 * and driver, add the Postgres adapter + `pg` (and `@types/pg` dev). Every
 * other field — scripts (including `migrate`/`migrate:deploy`), the `@opensaas`
 * deps — is preserved untouched. Pure: returns a new object.
 */
export function toPostgresPackageJson(pkg: PackageJsonLike): PackageJsonLike {
  const dependencies: Record<string, string> = { ...(pkg.dependencies ?? {}) }
  const devDependencies: Record<string, string> = { ...(pkg.devDependencies ?? {}) }

  for (const dep of SQLITE_DEPS) {
    delete dependencies[dep]
    delete devDependencies[dep]
  }

  for (const [name, version] of Object.entries(PG_DEPS)) {
    dependencies[name] = version
  }
  for (const [name, version] of Object.entries(PG_DEV_DEPS)) {
    devDependencies[name] = version
  }

  return {
    ...pkg,
    dependencies: sortKeys(dependencies),
    devDependencies: sortKeys(devDependencies),
  }
}

/** Stable, alphabetical key order so generated package.json diffs are clean. */
function sortKeys(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
}
