import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { writePrismaSchema, writeTypes, writeContext } from '../generator/index.js'

// Mock ora module
vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    text: '',
  })),
}))

// Mock chalk module
vi.mock('chalk', () => ({
  default: {
    bold: vi.fn((str) => str),
    cyan: vi.fn((str) => str),
    gray: vi.fn((str) => str),
    red: vi.fn((str) => str),
    yellow: vi.fn((str) => str),
    green: vi.fn((str) => str),
  },
}))

describe('Generate Command Integration', () => {
  let tempDir: string

  beforeEach(() => {
    // Create temp directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'generate-test-'))
  })

  afterEach(() => {
    // Clean up
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('Generator Integration', () => {
    it('should generate all files for a basic config', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          url: 'file:./dev.db',
        },
        lists: {
          User: {
            fields: {
              name: text({ validation: { isRequired: true } }),
              email: text({ validation: { isRequired: true } }),
            },
          },
        },
      }

      // Generate files
      const prismaPath = path.join(tempDir, 'prisma', 'schema.prisma')
      const typesPath = path.join(tempDir, '.opensaas', 'types.ts')
      const contextPath = path.join(tempDir, '.opensaas', 'context.ts')

      writePrismaSchema(config, prismaPath)
      writeTypes(config, typesPath)
      writeContext(config, contextPath)

      // Verify all files exist
      expect(fs.existsSync(prismaPath)).toBe(true)
      expect(fs.existsSync(typesPath)).toBe(true)
      expect(fs.existsSync(contextPath)).toBe(true)

      // Verify file contents with snapshots
      const prismaSchema = fs.readFileSync(prismaPath, 'utf-8')
      expect(prismaSchema).toMatchSnapshot('prisma-schema')

      const types = fs.readFileSync(typesPath, 'utf-8')
      expect(types).toMatchSnapshot('types')

      const context = fs.readFileSync(contextPath, 'utf-8')
      expect(context).toMatchSnapshot('context')
    })

    it('should create directories if they do not exist', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          url: 'file:./dev.db',
        },
        lists: {},
      }

      const prismaPath = path.join(tempDir, 'prisma', 'schema.prisma')

      writePrismaSchema(config, prismaPath)

      expect(fs.existsSync(path.join(tempDir, 'prisma'))).toBe(true)
      expect(fs.existsSync(prismaPath)).toBe(true)
    })

    it('should overwrite existing files', () => {
      const config1: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          url: 'file:./dev.db',
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
        },
      }

      const config2: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          url: 'file:./dev.db',
        },
        lists: {
          Post: {
            fields: {
              title: text(),
            },
          },
        },
      }

      const prismaPath = path.join(tempDir, 'prisma', 'schema.prisma')

      // Generate first config
      writePrismaSchema(config1, prismaPath)
      let schema = fs.readFileSync(prismaPath, 'utf-8')
      expect(schema).toMatchSnapshot('overwrite-before')

      // Generate second config (should overwrite)
      writePrismaSchema(config2, prismaPath)
      schema = fs.readFileSync(prismaPath, 'utf-8')
      expect(schema).toMatchSnapshot('overwrite-after')
    })

    it('should handle custom opensaasPath', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          url: 'file:./dev.db',
        },
        opensaasPath: '.custom',
        lists: {},
      }

      const typesPath = path.join(tempDir, '.custom', 'types.ts')
      const contextPath = path.join(tempDir, '.custom', 'context.ts')

      writeTypes(config, typesPath)
      writeContext(config, contextPath)

      expect(fs.existsSync(path.join(tempDir, '.custom'))).toBe(true)
      expect(fs.existsSync(typesPath)).toBe(true)
      expect(fs.existsSync(contextPath)).toBe(true)
    })

    it('should generate consistent output across multiple runs', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          url: 'file:./dev.db',
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
        },
      }

      const prismaPath = path.join(tempDir, 'prisma', 'schema.prisma')

      // Generate twice
      writePrismaSchema(config, prismaPath)
      const schema1 = fs.readFileSync(prismaPath, 'utf-8')

      writePrismaSchema(config, prismaPath)
      const schema2 = fs.readFileSync(prismaPath, 'utf-8')

      // Should be identical
      expect(schema1).toBe(schema2)
      expect(schema1).toMatchSnapshot('consistent-output')
    })

    it('should handle empty lists config', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          url: 'file:./dev.db',
        },
        lists: {},
      }

      const prismaPath = path.join(tempDir, 'prisma', 'schema.prisma')
      const typesPath = path.join(tempDir, '.opensaas', 'types.ts')

      writePrismaSchema(config, prismaPath)
      writeTypes(config, typesPath)

      expect(fs.existsSync(prismaPath)).toBe(true)
      expect(fs.existsSync(typesPath)).toBe(true)

      const schema = fs.readFileSync(prismaPath, 'utf-8')
      expect(schema).toMatchSnapshot('empty-lists-schema')

      const types = fs.readFileSync(typesPath, 'utf-8')
      expect(types).toMatchSnapshot('empty-lists-types')
    })

    it('should handle different database providers', () => {
      const providers = ['sqlite', 'postgresql', 'mysql'] as const

      providers.forEach((provider) => {
        const config: OpenSaasConfig = {
          db: {
            provider,
            url: provider === 'sqlite' ? 'file:./dev.db' : 'postgresql://localhost:5432/db',
          },
          lists: {},
        }

        const prismaPath = path.join(tempDir, `${provider}-schema.prisma`)
        writePrismaSchema(config, prismaPath)

        const schema = fs.readFileSync(prismaPath, 'utf-8')
        expect(schema).toMatchSnapshot(`${provider}-provider`)
      })
    })

    it('should generate files in correct locations', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          url: 'file:./dev.db',
        },
        lists: {
          User: {
            fields: {
              name: text(),
            },
          },
        },
      }

      writePrismaSchema(config, path.join(tempDir, 'prisma', 'schema.prisma'))
      writeTypes(config, path.join(tempDir, '.opensaas', 'types.ts'))
      writeContext(config, path.join(tempDir, '.opensaas', 'context.ts'))

      // Verify directory structure
      const prismaDir = path.join(tempDir, 'prisma')
      const opensaasDir = path.join(tempDir, '.opensaas')

      expect(fs.existsSync(prismaDir)).toBe(true)
      expect(fs.existsSync(opensaasDir)).toBe(true)
      expect(fs.readdirSync(prismaDir)).toContain('schema.prisma')
      expect(fs.readdirSync(opensaasDir)).toContain('types.ts')
      expect(fs.readdirSync(opensaasDir)).toContain('context.ts')
    })
  })
})
