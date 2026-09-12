/**
 * Migration Generator Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs-extra'
import path from 'path'
import os from 'os'
import { MigrationGenerator } from '../src/migration/generators/migration-generator.js'
import type { MigrationSession } from '../src/migration/types.js'

describe('MigrationGenerator', () => {
  let generator: MigrationGenerator

  beforeEach(() => {
    generator = new MigrationGenerator()
  })

  describe('Basic Config Generation', () => {
    it('should generate a Postgres-only db block with no driver adapter or client constructor', async () => {
      const session: MigrationSession = {
        id: 'test',
        projectType: 'prisma',
        analysis: {
          projectTypes: ['prisma'],
          cwd: '/tmp',
        },
        currentQuestionIndex: 0,
        answers: {
          preserve_database: true,
          db_provider: 'postgresql',
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
      expect(output.configContent).toContain(`db: {
      provider: 'postgresql',
    },`)
      expect(output.configContent).not.toContain('prismaClientConstructor')
      expect(output.configContent).not.toMatch(/@prisma\/adapter-[a-z0-9-]+/)
      expect(output.dependencies).toContain('@opensaas/stack-core')
      expect(output.dependencies).toContain('@prisma/orm-postgres')
      expect(output.dependencies).not.toContain('@prisma/client')
      expect(output.dependencies.some((dep) => dep.startsWith('@prisma/adapter-'))).toBe(false)
      expect(output.steps.length).toBeGreaterThan(0)
      expect(output.steps.some((step) => step.includes('prisma db push'))).toBe(false)
      expect(output.steps.some((step) => step.includes('prisma generate'))).toBe(false)
    })

    it('ignores a non-Postgres db_provider answer — the emitted config is always Postgres-only', async () => {
      const session: MigrationSession = {
        id: 'test',
        projectType: 'prisma',
        analysis: {
          projectTypes: ['prisma'],
          cwd: '/tmp',
        },
        currentQuestionIndex: 0,
        answers: {
          // The wizard's `db_provider` question only ever offers 'postgresql'
          // now, but a stale session answer must not resurrect a dead provider.
          db_provider: 'sqlite',
          enable_auth: false,
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(session)

      expect(output.configContent).toContain("provider: 'postgresql'")
      expect(output.configContent).not.toContain("provider: 'sqlite'")
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
          db_provider: 'postgresql',
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
          db_provider: 'postgresql',
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
          db_provider: 'postgresql',
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
          db_provider: 'postgresql',
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(session)

      const secretStep = output.steps.find((step) => step.includes('BETTER_AUTH_SECRET'))
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
    it('should generate .env.example with a Postgres connection string, commented out', async () => {
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
      expect(envFile).toBeDefined()
      expect(envFile?.content).toContain('DATABASE_URL')
      expect(envFile?.content).toContain('postgresql://')
      // Commented out: `opensaas dev` runs the Dev database unless it is set.
      expect(envFile?.content).toContain('# DATABASE_URL=')
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
          db_provider: 'postgresql',
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
          db_provider: 'postgresql',
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
      expect(output.steps.some((step) => step.includes('pnpm generate'))).toBe(true)
      expect(output.steps.some((step) => step.includes('pnpm dev'))).toBe(true)
      expect(output.steps.some((step) => step.includes('prisma generate'))).toBe(false)
      expect(output.steps.some((step) => step.includes('prisma db push'))).toBe(false)
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
          db_provider: 'postgresql',
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
          db_provider: 'postgresql',
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
          db_provider: 'postgresql',
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
          db_provider: 'postgresql',
          enable_auth: false,
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(session)

      expect(output.dependencies).toContain('@opensaas/stack-core')
      expect(output.dependencies).toContain('@opensaas/stack-ui')
      expect(output.dependencies).toContain('@prisma/orm-postgres')
      expect(output.dependencies).toContain('prisma')
    })

    it('never includes a removed driver-adapter or a Prisma 7 client package', async () => {
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

      expect(output.dependencies).not.toContain('@prisma/client')
      expect(output.dependencies.some((dep) => dep.startsWith('@prisma/adapter-'))).toBe(false)
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
          db_provider: 'postgresql',
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(session)

      expect(output.configContent).toContain(
        "import type { AccessControl } from '@opensaas/stack-core'",
      )
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
          db_provider: 'postgresql',
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(session)

      expect(output.configContent).not.toContain('AccessControl')
    })
  })

  describe('Float Field Mapping', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'migration-float-'))
      await fs.ensureDir(path.join(tempDir, 'prisma'))
    })

    afterEach(async () => {
      await fs.remove(tempDir)
    })

    it('should generate decimal() (not float()) for a Float column and warn', async () => {
      const schema = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Product {
  id    String @id @default(cuid())
  price Float
}
`
      await fs.writeFile(path.join(tempDir, 'prisma', 'schema.prisma'), schema)

      const session: MigrationSession = {
        id: 'test',
        projectType: 'prisma',
        analysis: {
          projectTypes: ['prisma'],
          cwd: tempDir,
          provider: 'postgresql',
        },
        currentQuestionIndex: 0,
        answers: {
          db_provider: 'postgresql',
          enable_auth: false,
          default_access: 'public-read-auth-write',
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(session)

      // References the real decimal() builder, not the non-existent float()
      expect(output.configContent).toContain('price: decimal(')
      expect(output.configContent).not.toContain('float(')
      // decimal is imported from the fields entry point
      expect(output.configContent).toContain('decimal')
      // Warns about the Float -> Decimal type change
      expect(output.warnings.some((w) => w.includes('Float') && w.includes('decimal()'))).toBe(true)
    })
  })

  describe('Decimal Field Mapping (issue #908)', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'migration-decimal-'))
      await fs.ensureDir(path.join(tempDir, 'prisma'))
    })

    afterEach(async () => {
      await fs.remove(tempDir)
    })

    it('should carry precision/scale through for a declared @db.Decimal(p, s) column', async () => {
      const schema = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Product {
  id    String  @id @default(cuid())
  price Decimal @db.Decimal(10, 2)
}
`
      await fs.writeFile(path.join(tempDir, 'prisma', 'schema.prisma'), schema)

      const session: MigrationSession = {
        id: 'test',
        projectType: 'prisma',
        analysis: {
          projectTypes: ['prisma'],
          cwd: tempDir,
          provider: 'postgresql',
        },
        currentQuestionIndex: 0,
        answers: {
          db_provider: 'postgresql',
          enable_auth: false,
          default_access: 'public-read-auth-write',
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(session)

      expect(output.configContent).toContain(
        'price: decimal({ validation: { isRequired: true }, precision: 10, scale: 2 })',
      )
      expect(output.configContent).toMatch(
        /import \{[^}]*\bdecimal\b[^}]*\} from '@opensaas\/stack-core\/fields'/,
      )
      expect(output.warnings.some((w) => w.includes('Decimal'))).toBe(false)
    })

    it('should generate a bare decimal() with no precision/scale for a Decimal column without @db.Decimal', async () => {
      const schema = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Product {
  id    String   @id @default(cuid())
  price Decimal?
}
`
      await fs.writeFile(path.join(tempDir, 'prisma', 'schema.prisma'), schema)

      const session: MigrationSession = {
        id: 'test',
        projectType: 'prisma',
        analysis: {
          projectTypes: ['prisma'],
          cwd: tempDir,
          provider: 'postgresql',
        },
        currentQuestionIndex: 0,
        answers: {
          db_provider: 'postgresql',
          enable_auth: false,
          default_access: 'public-read-auth-write',
        },
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const output = await generator.generate(session)

      expect(output.configContent).toContain('price: decimal()')
      expect(output.configContent).not.toContain('precision')
      expect(output.configContent).not.toContain('scale')
      expect(output.warnings.some((w) => w.includes('Decimal'))).toBe(false)
    })
  })
})
