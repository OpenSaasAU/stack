import type { OpenSaasConfig } from '@opensaas/stack-core'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Generate Prisma config file for CLI commands
 *
 * Prisma 7 requires a prisma.config.ts file at the project root for CLI commands
 * like `prisma db push`, `prisma migrate dev`, and `prisma migrate deploy`. This
 * is separate from the runtime configuration (which uses adapters in
 * opensaas.config.ts).
 *
 * The CLI config provides the database URL for schema operations, while the
 * runtime config provides adapters for actual query execution.
 *
 * The datasource URL prefers `DIRECT_DATABASE_URL` and falls back to
 * `DATABASE_URL`. On serverless Postgres (e.g. Neon) the running app connects
 * through a pooled `DATABASE_URL`, while migrations need a direct (non-pooled)
 * connection — set `DIRECT_DATABASE_URL` to that direct URL. Local SQLite is
 * untouched: with `DIRECT_DATABASE_URL` unset, the expression falls back to
 * `DATABASE_URL`.
 *
 * Note: a local `env` helper is emitted instead of the one from `prisma/config`
 * because the upstream helper throws when a variable is unset, which would break
 * the `??` fallback. The local helper returns `undefined` for missing variables
 * so the fallback can take effect.
 *
 * @param extraDatasourceLines - Verbatim `datasource` block entries the
 *   generator does not itself manage (e.g. a host-added `shadowDatabaseUrl`),
 *   extracted from a pre-existing file by {@link extractExtraDatasourceLines}.
 *   Re-emitted after the managed `url` key so a re-generate does not drop them.
 */
export function generatePrismaConfig(
  _config: OpenSaasConfig,
  schemaPath?: string,
  extraDatasourceLines: string[] = [],
): string {
  const lines: string[] = []

  // The schema path Prisma's CLI resolves (a directory or a `.prisma` file).
  // Defaults to the historical `prisma` directory so existing projects are
  // unaffected; the output-path resolver supplies the configured location when
  // the schema is relocated via the `output` config block.
  const schema = schemaPath ?? 'prisma'

  // Import dotenv for environment variable loading
  lines.push("import 'dotenv/config'")
  lines.push("import { defineConfig } from 'prisma/config'")
  lines.push('')
  lines.push('// Read an environment variable, returning undefined when unset so the')
  lines.push('// `??` fallback below can take effect. (The `env` helper from')
  lines.push("// 'prisma/config' throws on missing variables, which would break the")
  lines.push('// fallback.)')
  lines.push('const env = (name: string): string | undefined => process.env[name]')
  lines.push('')
  lines.push('export default defineConfig({')
  lines.push(`  schema: '${schema}',`)
  lines.push('  datasource: {')
  lines.push("    url: env('DIRECT_DATABASE_URL') ?? env('DATABASE_URL'),")
  for (const extraLine of extraDatasourceLines) {
    lines.push(`    ${extraLine}`)
  }
  lines.push('  },')
  lines.push('})')
  lines.push('')

  return lines.join('\n')
}

/**
 * Extract host-added `datasource` block entries from a pre-existing
 * `prisma.config.ts` file, so a re-generate can preserve them instead of
 * clobbering the block wholesale.
 *
 * Only the `url` key is generator-managed; every other entry in the block
 * (e.g. `shadowDatabaseUrl`) is treated as host-owned and returned verbatim
 * for re-emission by {@link generatePrismaConfig}.
 *
 * This is a lightweight line-based extraction, not a TypeScript parser: it
 * assumes the `datasource` block contains flat, single-line `key: value,`
 * entries with no nested braces, which matches every entry this generator or
 * documented host customization emits.
 */
export function extractExtraDatasourceLines(existingContent: string): string[] {
  const match = existingContent.match(/datasource:\s*\{([^}]*)\}/)
  if (!match) {
    return []
  }

  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('url:'))
}

/**
 * Write Prisma config to file
 *
 * If a `prisma.config.ts` already exists at `outputPath`, its `datasource`
 * block is read first so host-added keys the generator does not manage (e.g.
 * `shadowDatabaseUrl`) survive the rewrite — see {@link extractExtraDatasourceLines}.
 *
 * @param schemaPath - Optional override for the `schema` field, forwarded to
 *   {@link generatePrismaConfig}.
 */
export function writePrismaConfig(
  config: OpenSaasConfig,
  outputPath: string,
  schemaPath?: string,
): void {
  const extraDatasourceLines = fs.existsSync(outputPath)
    ? extractExtraDatasourceLines(fs.readFileSync(outputPath, 'utf-8'))
    : []

  const prismaConfig = generatePrismaConfig(config, schemaPath, extraDatasourceLines)

  // Ensure directory exists
  const dir = path.dirname(outputPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(outputPath, prismaConfig, 'utf-8')
}
