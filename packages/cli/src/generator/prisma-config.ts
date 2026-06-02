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
 */
export function generatePrismaConfig(_config: OpenSaasConfig): string {
  const lines: string[] = []

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
  lines.push("  schema: 'prisma',")
  lines.push('  datasource: {')
  lines.push("    url: env('DIRECT_DATABASE_URL') ?? env('DATABASE_URL'),")
  lines.push('  },')
  lines.push('})')
  lines.push('')

  return lines.join('\n')
}

/**
 * Write Prisma config to file
 */
export function writePrismaConfig(config: OpenSaasConfig, outputPath: string): void {
  const prismaConfig = generatePrismaConfig(config)

  // Ensure directory exists
  const dir = path.dirname(outputPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(outputPath, prismaConfig, 'utf-8')
}
