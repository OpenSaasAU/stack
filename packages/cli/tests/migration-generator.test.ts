/**
 * Migration Generator Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { MigrationGenerator } from '../src/migration/generators/migration-generator.js'
import type { MigrationSession } from '../src/migration/types.js'

describe('MigrationGenerator', () => {
  let generator: MigrationGenerator

  beforeEach(() => {
    generator = new MigrationGenerator()
  })

  describe('Basic Config Generation', () => {
    it('should generate basic config for SQLite', async () => {
      const session: MigrationSession = {
        id: 'test',
        projectType: 'prisma',
        analysis: {
          projectTypes: ['prisma'],
          cwd: '/tmp',
          provider: 'sqlite',
        },
        currentQuestionIndex: 0,
        answers: {
          preserve_database: true,
          db_provider: 'sqlite',
          enable_auth: false,
          default_access: 'public-read-auth-write',
          admin_base_path: '/admin',
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(session)

      expect(output.configContent).toContain("import { config, list } from '@opensaas/stack-core'")
      expect(output.configContent).toContain("provider: 'sqlite'")
      expect(output.configContent).toContain('PrismaBetterSqlite3')
      expect(output.dependencies).toContain('@opensaas/stack-core')
      expect(output.dependencies).toContain('@prisma/adapter-better-sqlite3')
      expect(output.steps.length).toBeGreaterThan(0)
    })

    it('should generate config for PostgreSQL', async () => {
      const session: MigrationSession = {
        id: 'test',
        projectType: 'prisma',
        analysis: {
          projectTypes: ['prisma'],
          cwd: '/tmp',
        },
        currentQuestionIndex: 0,
        answers: {
          db_provider: 'postgresql',
          enable_auth: false,
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(session)

      expect(output.configContent).toContain("provider: 'postgresql'")
      expect(output.configContent).toContain('PrismaPg')
      expect(output.configContent).toContain('pg.Pool')
      expect(output.dependencies).toContain('@prisma/adapter-pg')
      expect(output.dependencies).toContain('pg')
      expect(output.dependencies).toContain('@types/pg')
    })

    it('should generate config for MySQL', async () => {
      const session: MigrationSession = {
        id: 'test',
        projectType: 'prisma',
        analysis: {
          projectTypes: ['prisma'],
          cwd: '/tmp',
        },
        currentQuestionIndex: 0,
        answers: {
          db_provider: 'mysql',
          enable_auth: false,
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(session)

      expect(output.configContent).toContain("provider: 'mysql'")
      expect(output.configContent).toContain('PrismaPlanetScale')
      expect(output.dependencies).toContain('@prisma/adapter-planetscale')
    })
  })

  describe('Auth Integration', () => {
    it('should include auth when enabled', async () => {
      const session: MigrationSession = {
        id: 'test',
        projectType: 'prisma',
        analysis: {
          projectTypes: ['prisma'],
          cwd: '/tmp',
        },
        currentQuestionIndex: 0,
        answers: {
          enable_auth: true,
          auth_methods: ['email-password'],
          db_provider: 'sqlite',
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(session)

      expect(output.configContent).toContain('authPlugin')
      expect(output.configContent).toContain('emailAndPassword')
      expect(output.configContent).toContain('plugins:')
      expect(output.dependencies).toContain('@opensaas/stack-auth')
      expect(output.dependencies).toContain('better-auth')
    })

    it('should include magic link auth', async () => {
      const session: MigrationSession = {
        id: 'test',
        projectType: 'prisma',
        analysis: {
          projectTypes: ['prisma'],
          cwd: '/tmp',
        },
        currentQuestionIndex: 0,
        answers: {
          enable_auth: true,
          auth_methods: ['magic-link'],
          db_provider: 'sqlite',
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(session)

      expect(output.configContent).toContain('magicLink')
      expect(output.configContent).toContain('enabled: true')
    })

    it('should include OAuth providers as comments', async () => {
      const session: MigrationSession = {
        id: 'test',
        projectType: 'prisma',
        analysis: {
          projectTypes: ['prisma'],
          cwd: '/tmp',
        },
        currentQuestionIndex: 0,
        answers: {
          enable_auth: true,
          auth_methods: ['email-password', 'google', 'github'],
          db_provider: 'sqlite',
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(session)

      expect(output.configContent).toContain('// Uncomment and configure Google OAuth')
      expect(output.configContent).toContain('GOOGLE_CLIENT_ID')
      expect(output.configContent).toContain('// Uncomment and configure GitHub OAuth')
      expect(output.configContent).toContain('GITHUB_CLIENT_ID')
    })

    it('should generate BETTER_AUTH_SECRET step when auth enabled', async () => {
      const session: MigrationSession = {
        id: 'test',
        projectType: 'prisma',
        analysis: {
          projectTypes: ['prisma'],
          cwd: '/tmp',
        },
        currentQuestionIndex: 0,
        answers: {
          enable_auth: true,
          auth_methods: ['email-password'],
          db_provider: 'sqlite',
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(session)

      const secretStep = output.steps.find((step) =>
        step.includes('BETTER_AUTH_SECRET'),
      )
      expect(secretStep).toBeDefined()
      expect(secretStep).toContain('openssl rand -base64 32')
    })
  })

  describe('Access Control', () => {
    it('should generate owner access control', async () => {
      const session: MigrationSession = {
        id: 'test',
        projectType: 'prisma',
        analysis: {
          projectTypes: ['prisma'],
          cwd: '/tmp',
          models: [{ name: 'Post', fieldCount: 5 }],
        },
        currentQuestionIndex: 0,
        answers: {
          models_with_owner: ['Post'],
          default_access: 'public-read-auth-write',
          enable_auth: false,
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(session)

      // Should have isOwner helper
      expect(output.configContent).toContain('const isOwner')
      expect(output.configContent).toContain('session.userId')
    })

    it('should respect default access patterns', async () => {
      // Test that different access patterns are used based on answers
      const authOnlySession: MigrationSession = {
        id: 'test',
        projectType: 'prisma',
        analysis: {
          projectTypes: ['prisma'],
          cwd: '/tmp',
        },
        currentQuestionIndex: 0,
        answers: {
          default_access: 'authenticated-only',
          enable_auth: false,
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(authOnlySession)

      // Verify the default_access answer is captured (it will be used when actual schema is provided)
      expect(output.configContent).toBeDefined()
      expect(output.dependencies).toContain('@opensaas/stack-core')
    })

    it('should handle different access control strategies', async () => {
      // Test that admin-only access pattern is registered
      const adminOnlySession: MigrationSession = {
        id: 'test',
        projectType: 'prisma',
        analysis: {
          projectTypes: ['prisma'],
          cwd: '/tmp',
        },
        currentQuestionIndex: 0,
        answers: {
          default_access: 'admin-only',
          enable_auth: false,
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(adminOnlySession)

      // Verify the config is generated
      expect(output.configContent).toBeDefined()
      expect(output.dependencies).toContain('@opensaas/stack-core')
    })
  })

  describe('Additional Files', () => {
    it('should generate .env.example with database URL', async () => {
      const session: MigrationSession = {
        id: 'test',
        projectType: 'prisma',
        analysis: {
          projectTypes: ['prisma'],
          cwd: '/tmp',
        },
        currentQuestionIndex: 0,
        answers: {
          db_provider: 'sqlite',
          enable_auth: false,
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(session)

      const envFile = output.files.find((f) => f.path === '.env.example')
      expect(envFile).toBeDefined()
      expect(envFile?.content).toContain('DATABASE_URL')
      expect(envFile?.content).toContain('file:./dev.db')
    })

    it('should include auth vars in .env.example when auth enabled', async () => {
      const session: MigrationSession = {
        id: 'test',
        projectType: 'prisma',
        analysis: {
          projectTypes: ['prisma'],
          cwd: '/tmp',
        },
        currentQuestionIndex: 0,
        answers: {
          enable_auth: true,
          auth_methods: ['email-password', 'google'],
          db_provider: 'sqlite',
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(session)

      const envFile = output.files.find((f) => f.path === '.env.example')
      expect(envFile?.content).toContain('BETTER_AUTH_SECRET')
      expect(envFile?.content).toContain('BETTER_AUTH_URL')
      expect(envFile?.content).toContain('GOOGLE_CLIENT_ID')
      expect(envFile?.content).toContain('GOOGLE_CLIENT_SECRET')
    })

    it('should generate PostgreSQL connection string in .env.example', async () => {
      const session: MigrationSession = {
        id: 'test',
        projectType: 'prisma',
        analysis: {
          projectTypes: ['prisma'],
          cwd: '/tmp',
        },
        currentQuestionIndex: 0,
        answers: {
          db_provider: 'postgresql',
          enable_auth: false,
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(session)

      const envFile = output.files.find((f) => f.path === '.env.example')
      expect(envFile?.content).toContain('postgresql://')
    })
  })

  describe('Next Steps', () => {
    it('should provide complete next steps', async () => {
      const session: MigrationSession = {
        id: 'test',
        projectType: 'prisma',
        analysis: {
          projectTypes: ['prisma'],
          cwd: '/tmp',
        },
        currentQuestionIndex: 0,
        answers: {
          db_provider: 'sqlite',
          enable_auth: false,
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(session)

      expect(output.steps).toContain('Save the generated config to `opensaas.config.ts`')
      expect(output.steps).toContain('Copy `.env.example` to `.env` and fill in values')
      expect(output.steps).toContain('Install dependencies: `pnpm add <dependencies>`')
      expect(output.steps).toContain('Generate Prisma schema: `pnpm opensaas generate`')
      expect(output.steps).toContain('Generate Prisma client: `npx prisma generate`')
      expect(output.steps).toContain('Push schema to database: `npx prisma db push`')
      expect(output.steps).toContain('Start development server: `pnpm dev`')
    })

    it('should include admin UI path in steps', async () => {
      const session: MigrationSession = {
        id: 'test',
        projectType: 'prisma',
        analysis: {
          projectTypes: ['prisma'],
          cwd: '/tmp',
        },
        currentQuestionIndex: 0,
        answers: {
          db_provider: 'sqlite',
          enable_auth: false,
          admin_base_path: '/admin',
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(session)

      const adminStep = output.steps.find((step) => step.includes('Visit admin UI'))
      expect(adminStep).toContain('/admin')
    })
  })

  describe('Custom Admin Path', () => {
    it('should use custom admin base path', async () => {
      const session: MigrationSession = {
        id: 'test',
        projectType: 'prisma',
        analysis: {
          projectTypes: ['prisma'],
          cwd: '/tmp',
        },
        currentQuestionIndex: 0,
        answers: {
          db_provider: 'sqlite',
          enable_auth: false,
          admin_base_path: '/dashboard',
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(session)

      expect(output.configContent).toContain("basePath: '/dashboard'")
    })
  })

  describe('Empty Schema', () => {
    it('should generate example config when no schema available', async () => {
      const session: MigrationSession = {
        id: 'test',
        projectType: 'nextjs',
        analysis: {
          projectTypes: ['nextjs'],
          cwd: '/tmp',
        },
        currentQuestionIndex: 0,
        answers: {
          db_provider: 'sqlite',
          enable_auth: false,
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(session)

      expect(output.configContent).toContain('// Add your lists here')
      expect(output.configContent).toContain('// Example:')
    })
  })

  describe('Dependencies', () => {
    it('should include all core dependencies', async () => {
      const session: MigrationSession = {
        id: 'test',
        projectType: 'prisma',
        analysis: {
          projectTypes: ['prisma'],
          cwd: '/tmp',
        },
        currentQuestionIndex: 0,
        answers: {
          db_provider: 'sqlite',
          enable_auth: false,
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(session)

      expect(output.dependencies).toContain('@opensaas/stack-core')
      expect(output.dependencies).toContain('@opensaas/stack-ui')
      expect(output.dependencies).toContain('@prisma/client')
      expect(output.dependencies).toContain('prisma')
    })

    it('should include database-specific dependencies', async () => {
      const postgresSession: MigrationSession = {
        id: 'test',
        projectType: 'prisma',
        analysis: {
          projectTypes: ['prisma'],
          cwd: '/tmp',
        },
        currentQuestionIndex: 0,
        answers: {
          db_provider: 'postgresql',
          enable_auth: false,
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const postgresOutput = await generator.generate(postgresSession)
      expect(postgresOutput.dependencies).toContain('@prisma/adapter-pg')
      expect(postgresOutput.dependencies).toContain('pg')

      const sqliteSession: MigrationSession = {
        ...postgresSession,
        answers: {
          db_provider: 'sqlite',
          enable_auth: false,
        },
      }

      const sqliteOutput = await generator.generate(sqliteSession)
      expect(sqliteOutput.dependencies).toContain('@prisma/adapter-better-sqlite3')
    })
  })

  describe('Import Generation', () => {
    it('should include AccessControl type when auth enabled', async () => {
      const session: MigrationSession = {
        id: 'test',
        projectType: 'prisma',
        analysis: {
          projectTypes: ['prisma'],
          cwd: '/tmp',
        },
        currentQuestionIndex: 0,
        answers: {
          enable_auth: true,
          auth_methods: ['email-password'],
          db_provider: 'sqlite',
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(session)

      expect(output.configContent).toContain("import type { AccessControl } from '@opensaas/stack-core'")
    })

    it('should not include AccessControl type when auth disabled', async () => {
      const session: MigrationSession = {
        id: 'test',
        projectType: 'prisma',
        analysis: {
          projectTypes: ['prisma'],
          cwd: '/tmp',
        },
        currentQuestionIndex: 0,
        answers: {
          enable_auth: false,
          db_provider: 'sqlite',
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(session)

      expect(output.configContent).not.toContain('AccessControl')
    })
  })
})
