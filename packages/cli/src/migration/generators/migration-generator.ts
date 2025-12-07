/**
 * Migration Generator - Generates opensaas.config.ts from migration session
 *
 * This is a stub for Phase 5. It will be fully implemented later.
 */

import type { MigrationSession, MigrationOutput, ProjectType } from '../types.js'

export class MigrationGenerator {
  /**
   * Generate opensaas.config.ts and related files from a completed migration session
   *
   * @param session - Completed migration session with all answers
   * @returns Generated configuration and files
   */
  async generate(session: MigrationSession): Promise<MigrationOutput> {
    // Stub implementation - will be replaced in Phase 5
    const { answers, projectType, analysis } = session

    // Extract key answers
    const enableAuth = answers.enable_auth as boolean
    const dbProvider = answers.db_provider as string
    const adminBasePath = (answers.admin_base_path as string) || '/admin'

    // Generate basic config stub
    const configContent = this.generateConfigStub(
      projectType,
      dbProvider,
      enableAuth,
      adminBasePath,
      analysis.models?.map((m) => m.name) || [],
    )

    return {
      configContent,
      dependencies: this.getDependencies(enableAuth),
      files: [],
      steps: [
        'Save the generated opensaas.config.ts to your project root',
        'Install the required dependencies',
        'Run `opensaas generate` to create your Prisma schema',
        'Run `prisma db push` to update your database',
        'Start your dev server with `pnpm dev`',
      ],
      warnings: [
        '⚠️ This is a stub implementation from Phase 3',
        '⚠️ Full config generation will be available in Phase 5',
        '⚠️ You may need to manually adjust the generated config',
      ],
    }
  }

  /**
   * Generate a basic config stub
   */
  private generateConfigStub(
    projectType: ProjectType,
    dbProvider: string,
    enableAuth: boolean,
    adminBasePath: string,
    modelNames: string[],
  ): string {
    const imports: string[] = [
      "import { config, list } from '@opensaas/stack-core'",
      "import { text, integer, checkbox, timestamp } from '@opensaas/stack-core/fields'",
    ]

    if (enableAuth) {
      imports.push("import { withAuth, authConfig } from '@opensaas/stack-auth'")
    }

    const dbConfig = this.getDatabaseConfig(dbProvider)

    const listsStub =
      modelNames.length > 0
        ? `  lists: {
    // TODO: Configure your models here
    // Detected models: ${modelNames.join(', ')}
    // Example:
    // Post: list({
    //   fields: {
    //     title: text({ validation: { isRequired: true } }),
    //     content: text(),
    //     createdAt: timestamp({ defaultValue: { kind: 'now' } }),
    //   },
    // }),
  },`
        : `  lists: {
    // Add your models here
  },`

    const baseConfig = `
${imports.join('\n')}

${dbConfig}

const baseConfig = config({
  db: {
    provider: '${dbProvider}',
    url: process.env.DATABASE_URL || 'file:./dev.db',
    prismaClientConstructor,
  },
${listsStub}
})

${
  enableAuth
    ? `
// Wrap with auth plugin
export default withAuth(baseConfig, authConfig({
  sessionFields: ['userId', 'email'],
  emailAndPassword: { enabled: true },
  basePath: '${adminBasePath}',
}))
`
    : 'export default baseConfig'
}
`

    return baseConfig.trim()
  }

  /**
   * Get database adapter configuration based on provider
   */
  private getDatabaseConfig(provider: string): string {
    switch (provider) {
      case 'sqlite':
        return `import { PrismaBetterSQLite3 } from '@prisma/adapter-better-sqlite3'
import Database from 'better-sqlite3'

const prismaClientConstructor = (PrismaClient: any) => {
  const db = new Database(process.env.DATABASE_URL || './dev.db')
  const adapter = new PrismaBetterSQLite3(db)
  return new PrismaClient({ adapter })
}`

      case 'postgresql':
        return `import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const prismaClientConstructor = (PrismaClient: any) => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}`

      case 'mysql':
        return `import { PrismaPlanetScale } from '@prisma/adapter-planetscale'

const prismaClientConstructor = (PrismaClient: any) => {
  const adapter = new PrismaPlanetScale({
    url: process.env.DATABASE_URL,
  })
  return new PrismaClient({ adapter })
}`

      default:
        return '// Database adapter configuration will be added'
    }
  }

  /**
   * Get required dependencies based on configuration
   */
  private getDependencies(enableAuth: boolean): string[] {
    const deps = [
      '@opensaas/stack-core',
      '@prisma/client',
      '@prisma/adapter-better-sqlite3',
      'better-sqlite3',
    ]

    if (enableAuth) {
      deps.push('@opensaas/stack-auth')
    }

    return deps
  }
}
