import type { OpenSaasConfig } from '@opensaas/stack-core'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Generate Prisma config file for CLI commands
 *
 * Prisma 7 requires a prisma.config.ts file at the project root for CLI commands
 * like `prisma db push` and `prisma migrate dev`. This is separate from the
 * runtime configuration (which uses adapters in opensaas.config.ts).
 *
 * The CLI config provides the database URL for schema operations, while the
 * runtime config provides adapters for actual query execution.
 */
export function generatePrismaConfig(_config: OpenSaasConfig): string {
  const lines: string[] = []

  // Import dotenv for environment variable loading
  lines.push("import 'dotenv/config'")
  lines.push("import { defineConfig, env } from 'prisma/config'")
  lines.push('')
  lines.push('export default defineConfig({')
  lines.push("  schema: 'prisma',")
  lines.push('  datasource: {')
  lines.push("    url: env('DATABASE_URL'),")
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
