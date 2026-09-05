import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { OpenSaasConfig, FieldConfig } from '@opensaas/stack-core'
import {
  deriveContract,
  validateConfigFields,
  validateNeedsDeclarations,
  validateNeedsClosureDepth,
  validateDatabaseConfig,
  validateRelations,
} from '@opensaas/stack-core'
import { text, timestamp, relationship, virtual } from '@opensaas/stack-core/fields'
import {
  writeContractModule,
  writePrismaConfig,
  writeTypes,
  writeLists,
  writeContext,
  writePluginTypes,
  resolveOutputPaths,
} from '../generator/index.js'
import {
  formatFieldValidationErrors,
  formatNeedsClosureErrors,
  formatConfigRefusals,
} from './generate.js'

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
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        User: {
          fields: {
            name: text({ validation: { isRequired: true } }),
            email: text({ validation: { isRequired: true } }),
            posts: relationship({ ref: 'Post.author', many: true }),
          },
        },
        Post: {
          fields: {
            title: text({ validation: { isRequired: true } }),
            author: relationship({ ref: 'User.posts' }),
          },
        },
      },
    }

    /** Everything `generateCommand` writes, minus the emit shell-out. */
    function writeAll(cwd: string, forConfig: OpenSaasConfig = config) {
      const { paths, crossReferences } = resolveOutputPaths(
        cwd,
        forConfig.output,
        forConfig.opensaasPath,
      )
      const data = deriveContract(forConfig)

      writeContractModule(data, paths.contractModule)
      writePrismaConfig(data, paths.prismaConfig, {
        contractModule: crossReferences.prismaConfigContract,
        outputDir: crossReferences.prismaConfigOutput,
      })
      writeTypes(forConfig, paths.types)
      writeLists(forConfig, paths.lists)
      writeContext(forConfig, data, paths.context, {
        configImport: crossReferences.configImport,
        contractJsonImport: crossReferences.contractJsonImport,
      })
      writePluginTypes(forConfig, paths.pluginTypes)

      return { paths, crossReferences }
    }

    it('writes the Contract module, prisma.config.ts and the four bundle files', () => {
      const { paths } = writeAll(tempDir)

      expect(fs.existsSync(paths.contractModule)).toBe(true)
      expect(fs.existsSync(paths.prismaConfig)).toBe(true)
      expect(fs.existsSync(paths.types)).toBe(true)
      expect(fs.existsSync(paths.lists)).toBe(true)
      expect(fs.existsSync(paths.context)).toBe(true)
      expect(fs.existsSync(paths.pluginTypes)).toBe(true)
    })

    it('writes no Prisma schema and no generated client tree', () => {
      writeAll(tempDir)

      expect(fs.existsSync(path.join(tempDir, 'prisma', 'schema.prisma'))).toBe(false)
      expect(fs.existsSync(path.join(tempDir, '.opensaas', 'prisma-client'))).toBe(false)
      expect(fs.readdirSync(path.join(tempDir, 'prisma'))).toEqual(['contract.ts'])
    })

    it('creates the directories it writes into', () => {
      const nested = path.join(tempDir, 'deep', 'project')
      const { paths } = writeAll(nested)

      expect(fs.existsSync(path.dirname(paths.contractModule))).toBe(true)
      expect(fs.existsSync(paths.opensaasDir)).toBe(true)
    })

    it('overwrites existing files rather than appending', () => {
      const { paths } = writeAll(tempDir)
      fs.writeFileSync(paths.contractModule, '// stale\n')

      writeAll(tempDir)

      expect(fs.readFileSync(paths.contractModule, 'utf-8')).not.toContain('stale')
    })

    it('produces identical output across runs', () => {
      const { paths } = writeAll(tempDir)
      const first = {
        contract: fs.readFileSync(paths.contractModule, 'utf-8'),
        prismaConfig: fs.readFileSync(paths.prismaConfig, 'utf-8'),
        types: fs.readFileSync(paths.types, 'utf-8'),
        context: fs.readFileSync(paths.context, 'utf-8'),
      }

      writeAll(tempDir)

      expect(fs.readFileSync(paths.contractModule, 'utf-8')).toBe(first.contract)
      expect(fs.readFileSync(paths.prismaConfig, 'utf-8')).toBe(first.prismaConfig)
      expect(fs.readFileSync(paths.types, 'utf-8')).toBe(first.types)
      expect(fs.readFileSync(paths.context, 'utf-8')).toBe(first.context)
    })

    it('handles a config with no lists', () => {
      const { paths } = writeAll(tempDir, { db: { provider: 'postgresql' }, lists: {} })

      const contract = fs.readFileSync(paths.contractModule, 'utf-8')
      expect(contract).toContain('export const contract = defineContract(')
      expect(contract).toContain('models: {')
    })

    it('honours the opensaasPath fallback', () => {
      const { paths } = writeAll(tempDir, { ...config, opensaasPath: '.custom' })

      expect(paths.opensaasDir).toBe(path.join(tempDir, '.custom'))
      expect(fs.existsSync(path.join(tempDir, '.custom', 'context.ts'))).toBe(true)
      expect(fs.existsSync(path.join(tempDir, '.opensaas'))).toBe(false)
    })
  })

  describe('Configurable output paths', () => {
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      output: {
        contractModule: 'prisma-opensaas/contract.ts',
        opensaasDir: 'generated/opensaas',
      },
      lists: { User: { fields: { name: text() } } },
    }

    function writeRelocated(cwd: string, forConfig: OpenSaasConfig = config) {
      const { paths, crossReferences } = resolveOutputPaths(
        cwd,
        forConfig.output,
        forConfig.opensaasPath,
      )
      const data = deriveContract(forConfig)
      writeContractModule(data, paths.contractModule)
      writePrismaConfig(data, paths.prismaConfig, {
        contractModule: crossReferences.prismaConfigContract,
        outputDir: crossReferences.prismaConfigOutput,
      })
      writeContext(forConfig, data, paths.context, {
        configImport: crossReferences.configImport,
        contractJsonImport: crossReferences.contractJsonImport,
      })
      return { paths, crossReferences }
    }

    it('writes the Contract module and bundle to the configured locations', () => {
      const { paths } = writeRelocated(tempDir)

      expect(fs.existsSync(path.join(tempDir, 'prisma-opensaas', 'contract.ts'))).toBe(true)
      expect(fs.existsSync(path.join(tempDir, 'generated', 'opensaas', 'context.ts'))).toBe(true)
      expect(paths.contractJson).toBe(path.join(tempDir, 'prisma-opensaas', 'contract.json'))
      expect(fs.existsSync(path.join(tempDir, 'prisma'))).toBe(false)
      expect(fs.existsSync(path.join(tempDir, '.opensaas'))).toBe(false)
    })

    it('generates prisma.config.ts at the root pointing at the configured module', () => {
      writeRelocated(tempDir)

      const prismaConfig = fs.readFileSync(path.join(tempDir, 'prisma.config.ts'), 'utf-8')
      expect(prismaConfig).toContain("contract: './prisma-opensaas/contract.ts',")
      expect(prismaConfig).toContain("output: './prisma-opensaas',")
    })

    it('context.ts reaches opensaas.config and contract.json through resolvable paths', () => {
      const { paths } = writeRelocated(tempDir)

      const context = fs.readFileSync(paths.context, 'utf-8')
      const configSpecifier = context.match(/from '(\.[^']*opensaas\.config[^']*)'/)?.[1]
      const contractSpecifier = context.match(/from '(\.[^']*contract\.json)'/)?.[1]
      expect(configSpecifier).toBeDefined()
      expect(contractSpecifier).toBeDefined()

      expect(path.resolve(paths.opensaasDir, configSpecifier!)).toBe(
        path.join(tempDir, 'opensaas.config.ts'),
      )
      expect(path.resolve(paths.opensaasDir, contractSpecifier!)).toBe(paths.contractJson)
    })

    it('leaves defaults unchanged when no output block is set', () => {
      const { paths } = writeRelocated(tempDir, {
        db: { provider: 'postgresql' },
        lists: { User: { fields: { name: text() } } },
      })

      expect(paths.contractModule).toBe(path.join(tempDir, 'prisma', 'contract.ts'))
      expect(paths.opensaasDir).toBe(path.join(tempDir, '.opensaas'))
    })
  })

  describe('opensaasPath / output.opensaasDir precedence', () => {
    const lists = { User: { fields: { name: text() } } }

    it('relocates the bundle via opensaasPath alone', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'postgresql' },
        opensaasPath: '.custom',
        lists,
      }
      const { paths } = resolveOutputPaths(tempDir, config.output, config.opensaasPath)
      expect(paths.opensaasDir).toBe(path.join(tempDir, '.custom'))
    })

    it('lets output.opensaasDir override opensaasPath when both are set', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'postgresql' },
        opensaasPath: '.custom',
        output: { opensaasDir: 'generated/opensaas' },
        lists,
      }
      const { paths } = resolveOutputPaths(tempDir, config.output, config.opensaasPath)
      expect(paths.opensaasDir).toBe(path.join(tempDir, 'generated', 'opensaas'))
      expect(fs.existsSync(path.join(tempDir, '.custom'))).toBe(false)
    })
  })

  describe('Field self-containment validation', () => {
    it('passes a compliant config with no errors', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prismaClientConstructor: (() => null) as any,
        },
        lists: {
          Post: {
            fields: {
              title: text({ validation: { isRequired: true } }),
            },
          },
        },
      }

      expect(validateConfigFields(config)).toEqual([])
    })

    it('reports a non-compliant field with a friendly message instead of a stack trace', () => {
      // Simulate a misimplemented (e.g. third-party) field missing getPrismaType.
      const brokenField = text()
      delete brokenField.getPrismaType

      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prismaClientConstructor: (() => null) as any,
        },
        lists: {
          Post: {
            fields: {
              title: brokenField as FieldConfig,
            },
          },
        },
      }

      const errors = validateConfigFields(config)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatchObject({
        listKey: 'Post',
        fieldKey: 'title',
        missingMethod: 'getPrismaType',
      })

      const message = formatFieldValidationErrors(errors)
      // Friendly, actionable message naming the list, field, and method...
      expect(message).toContain('Post.title')
      expect(message).toContain('getPrismaType')
      expect(message).toContain('self-containment contract')
      // ...and explicitly not a raw stack trace.
      expect(message).not.toContain('at Object.')
      expect(message).not.toContain('.js:')
    })

    it('aggregates multiple non-compliant fields across lists into one message', () => {
      const noPrisma = text()
      delete noPrisma.getPrismaType
      const noZod = text()
      delete noZod.getZodSchema

      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prismaClientConstructor: (() => null) as any,
        },
        lists: {
          Post: { fields: { title: noPrisma as FieldConfig } },
          User: { fields: { name: noZod as FieldConfig } },
        },
      }

      const errors = validateConfigFields(config)
      expect(errors).toHaveLength(2)

      const message = formatFieldValidationErrors(errors)
      expect(message).toContain('2 field(s)')
      expect(message).toContain('Post.title')
      expect(message).toContain('User.name')
    })
  })

  describe('Declared dependency (`needs`, ADR-0025) validation', () => {
    it('passes a compliant config with no errors', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prismaClientConstructor: (() => null) as any,
        },
        lists: {
          LineItem: {
            fields: {
              price: text(),
              order: relationship({ ref: 'Order.lineItems' }),
            },
          },
          Order: {
            fields: {
              lineItems: relationship({ ref: 'LineItem.order', many: true }),
              total: virtual({
                type: 'number',
                needs: ['lineItems'],
                hooks: { resolveOutput: () => 0 },
              }),
            },
          },
        },
      }

      expect(validateNeedsDeclarations(config)).toEqual([])
      expect(validateNeedsClosureDepth(config)).toEqual([])
    })

    it('accepts a `needs` entry naming a stored column (ADR-0051)', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prismaClientConstructor: (() => null) as any,
        },
        lists: {
          Post: {
            fields: {
              title: text(),
              excerpt: virtual({
                type: 'string',
                needs: ['title'],
                hooks: { resolveOutput: () => 'x' },
              }),
            },
          },
        },
      }

      expect(validateNeedsDeclarations(config)).toEqual([])
    })

    it('reports a `needs` declaration on a field with no resolveOutput hook', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          prismaClientConstructor: () => null,
        },
        lists: {
          Post: {
            fields: {
              title: text(),
              badField: text({ needs: ['title'] }),
            },
          },
        },
      }

      const errors = validateNeedsDeclarations(config)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatchObject({
        listKey: 'Post',
        fieldKey: 'badField',
        reason: 'no-resolve-output',
      })

      const message = formatNeedsClosureErrors(errors)
      expect(message).toContain('Post.badField')
      expect(message).toContain('no resolveOutput hook')
    })

    it('reports a cyclic needs declaration closure', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prismaClientConstructor: (() => null) as any,
        },
        lists: {
          A: {
            fields: {
              b: relationship({ ref: 'B.a' }),
              computed: virtual({
                type: 'string',
                needs: ['b'],
                hooks: { resolveOutput: () => 'x' },
              }),
            },
          },
          B: {
            fields: {
              a: relationship({ ref: 'A.b' }),
              computed: virtual({
                type: 'string',
                needs: ['a'],
                hooks: { resolveOutput: () => 'x' },
              }),
            },
          },
        },
      }

      const errors = validateNeedsClosureDepth(config)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0].reason).toBe('cycle')

      const message = formatNeedsClosureErrors(errors)
      expect(message).toContain('never terminates')
    })
  })

  describe('Config surface refusals (ADR-0040, ADR-0048, ADR-0064)', () => {
    it('passes a compliant config with no refusals', () => {
      const config: OpenSaasConfig = {
        db: { provider: 'postgresql' },
        lists: {
          Post: {
            fields: {
              title: text(),
              author: relationship({ ref: 'User.posts', db: { onDelete: 'cascade' } }),
            },
            db: { indexes: [{ fields: ['title', 'author'], unique: true }] },
          },
          User: { fields: { posts: relationship({ ref: 'Post.author', many: true }) } },
        },
      }

      expect([...validateDatabaseConfig(config), ...validateRelations(config)]).toEqual([])
    })

    it('reports an index-sort refusal with the list and the entry visible', () => {
      const sorted: { field: string; sort: 'desc' } = { field: 'createdAt', sort: 'desc' }
      const config: OpenSaasConfig = {
        db: { provider: 'postgresql' },
        lists: {
          AuthVerification: {
            fields: { identifier: text(), createdAt: timestamp() },
            db: { indexes: [{ fields: ['identifier', sorted] }] },
          },
        },
      }

      const refusals = [...validateDatabaseConfig(config), ...validateRelations(config)]
      expect(refusals).toHaveLength(1)
      expect(refusals[0]).toMatchObject({
        listKey: 'AuthVerification',
        entry: 'db.indexes[0]',
        reason: 'index-sort',
      })

      const message = formatConfigRefusals(refusals)
      expect(message).toContain('1 config declaration(s) the contract cannot carry')
      expect(message).toContain('List "AuthVerification"')
      expect(message).toContain('db.indexes[0]')
      expect(message).toContain('Remove "sort"')
    })
  })
})
