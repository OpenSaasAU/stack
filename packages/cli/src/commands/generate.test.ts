import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { OpenSaasConfig, FieldConfig } from '@opensaas/stack-core'
import {
  validateConfigFields,
  validateNeedsDeclarations,
  validateNeedsClosureDepth,
  validateDatabaseConfig,
  validateRelations,
} from '@opensaas/stack-core'
import { text, timestamp, relationship, virtual } from '@opensaas/stack-core/fields'
import {
  writePrismaSchema,
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
    it('should generate all files for a basic config', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prismaClientConstructor: (() => null) as any,
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prismaClientConstructor: (() => null) as any,
        },
        lists: {},
      }

      const prismaPath = path.join(tempDir, 'prisma', 'schema.prisma')

      writePrismaSchema(config, prismaPath)

      expect(fs.existsSync(path.join(tempDir, 'prisma'))).toBe(true)
      expect(fs.existsSync(prismaPath)).toBe(true)
    })

    // Generous timeout: this otherwise-fast synchronous test occasionally
    // stalls past the 5s default on cold/loaded CI runners (the `test` task runs
    // cache-bypassed on every PR, so a transient I/O stall here can fail an
    // unrelated change). The headroom absorbs that contention without masking a
    // real regression — the assertions are unchanged.
    it('should overwrite existing files', () => {
      const config1: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prismaClientConstructor: (() => null) as any,
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prismaClientConstructor: (() => null) as any,
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
    }, 30000)

    it('should handle custom opensaasPath', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prismaClientConstructor: (() => null) as any,
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prismaClientConstructor: (() => null) as any,
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prismaClientConstructor: (() => null) as any,
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            prismaClientConstructor: (() => null) as any,
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prismaClientConstructor: (() => null) as any,
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

  describe('Configurable output paths', () => {
    const config: OpenSaasConfig = {
      db: {
        provider: 'sqlite',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prismaClientConstructor: (() => null) as any,
      },
      output: {
        prismaSchema: 'prisma-opensaas/schema.prisma',
        opensaasDir: 'generated/opensaas',
      },
      lists: {
        User: {
          fields: {
            name: text({ validation: { isRequired: true } }),
          },
        },
      },
    }

    /**
     * Drive the generator exactly as the CLI does: resolve paths from the
     * `output` block and forward the cross-references into each writer.
     */
    function generateWithResolvedPaths(cfg: OpenSaasConfig) {
      const { paths, crossReferences } = resolveOutputPaths(tempDir, cfg.output)
      writePrismaSchema(cfg, paths.prismaSchema, crossReferences.prismaClientOutput)
      writePrismaConfig(cfg, paths.prismaConfig, crossReferences.prismaConfigSchema)
      writeTypes(cfg, paths.types)
      writeLists(cfg, paths.lists)
      writeContext(cfg, paths.context, crossReferences.configImport)
      writePluginTypes(cfg, paths.pluginTypes)
      return { paths, crossReferences }
    }

    it('writes the schema and bundle files to the configured locations', () => {
      generateWithResolvedPaths(config)

      expect(fs.existsSync(path.join(tempDir, 'prisma-opensaas', 'schema.prisma'))).toBe(true)
      // The default prisma/ dir must be untouched so an existing Keystone setup
      // can coexist.
      expect(fs.existsSync(path.join(tempDir, 'prisma', 'schema.prisma'))).toBe(false)

      const bundleDir = path.join(tempDir, 'generated', 'opensaas')
      for (const file of ['types.ts', 'lists.ts', 'context.ts', 'plugin-types.ts']) {
        expect(fs.existsSync(path.join(bundleDir, file))).toBe(true)
      }
      // The default .opensaas/ dir is never created.
      expect(fs.existsSync(path.join(tempDir, '.opensaas'))).toBe(false)
    })

    it('generates prisma.config.ts at the root pointing at the configured schema dir', () => {
      generateWithResolvedPaths(config)

      const prismaConfigPath = path.join(tempDir, 'prisma.config.ts')
      expect(fs.existsSync(prismaConfigPath)).toBe(true)

      const prismaConfig = fs.readFileSync(prismaConfigPath, 'utf-8')
      expect(prismaConfig).toContain("schema: 'prisma-opensaas'")

      // The schema directory the config points at exists and holds the schema.
      const schemaDir = path.resolve(tempDir, 'prisma-opensaas')
      expect(fs.existsSync(path.join(schemaDir, 'schema.prisma'))).toBe(true)
    })

    it('context.ts imports opensaas.config via a path that resolves', () => {
      const { paths, crossReferences } = generateWithResolvedPaths(config)

      // Place a stand-in opensaas.config at the project root so the relative
      // import target genuinely exists on disk.
      const configFile = path.join(tempDir, 'opensaas.config.ts')
      fs.writeFileSync(configFile, 'export default {}\n')

      const context = fs.readFileSync(paths.context, 'utf-8')

      // context.ts imports the config via the resolved relative specifier, now
      // carrying an explicit `.ts` extension so a host bundler / plain Node can
      // resolve it without an `extensionAlias` (ADR-0008 / SF-14).
      const emittedSpecifier = `${crossReferences.configImport}.ts`
      expect(context).toContain(`from '${emittedSpecifier}'`)

      // The emitted specifier (extension included), resolved from the bundle
      // dir, lands on the real config file — no `.ts` is re-appended because it
      // is already part of the specifier.
      const resolvedFromContext = path.resolve(path.dirname(paths.context), emittedSpecifier)
      expect(resolvedFromContext).toBe(configFile)
      expect(fs.existsSync(resolvedFromContext)).toBe(true)
    })

    it('points the prisma client generator output at the relocated bundle', () => {
      const { paths, crossReferences } = generateWithResolvedPaths(config)

      const schema = fs.readFileSync(paths.prismaSchema, 'utf-8')
      expect(schema).toContain(`output              = "${crossReferences.prismaClientOutput}"`)

      // Resolved from the schema file's directory, the output lands inside the
      // configured bundle directory.
      const resolvedClientDir = path.resolve(
        path.dirname(paths.prismaSchema),
        crossReferences.prismaClientOutput,
      )
      expect(resolvedClientDir).toBe(path.join(paths.opensaasDir, 'prisma-client'))
    })

    it('leaves defaults unchanged when no output block is set', () => {
      const defaultConfig: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prismaClientConstructor: (() => null) as any,
        },
        lists: { User: { fields: { name: text() } } },
      }

      const { paths } = resolveOutputPaths(tempDir, defaultConfig.output)
      writePrismaSchema(defaultConfig, paths.prismaSchema)
      writePrismaConfig(defaultConfig, paths.prismaConfig)
      writeContext(defaultConfig, paths.context)

      expect(fs.existsSync(path.join(tempDir, 'prisma', 'schema.prisma'))).toBe(true)
      expect(fs.existsSync(path.join(tempDir, '.opensaas', 'context.ts'))).toBe(true)

      const schema = fs.readFileSync(path.join(tempDir, 'prisma', 'schema.prisma'), 'utf-8')
      expect(schema).toContain('output              = "../.opensaas/prisma-client"')

      const context = fs.readFileSync(path.join(tempDir, '.opensaas', 'context.ts'), 'utf-8')
      // The default config import carries an explicit `.ts` extension (ADR-0008).
      expect(context).toContain("from '../opensaas.config.ts'")

      const prismaConfig = fs.readFileSync(path.join(tempDir, 'prisma.config.ts'), 'utf-8')
      expect(prismaConfig).toContain("schema: 'prisma'")
    })
  })

  describe('opensaasPath / output.opensaasDir precedence', () => {
    /**
     * Drive the generator exactly as the CLI does, forwarding the pre-existing
     * top-level `opensaasPath` as the bundle-directory fallback.
     */
    function generateWithResolvedPaths(cfg: OpenSaasConfig) {
      const { paths, crossReferences } = resolveOutputPaths(tempDir, cfg.output, cfg.opensaasPath)
      writePrismaSchema(cfg, paths.prismaSchema, crossReferences.prismaClientOutput)
      writeContext(cfg, paths.context, crossReferences.configImport)
      return { paths, crossReferences }
    }

    it('relocates the bundle via opensaasPath alone (the pre-existing option) through the CLI', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prismaClientConstructor: (() => null) as any,
        },
        opensaasPath: '.custom',
        lists: { User: { fields: { name: text() } } },
      }

      const { paths } = generateWithResolvedPaths(config)

      // The bundle lands under .custom/, not the default .opensaas/.
      expect(paths.opensaasDir).toBe(path.join(tempDir, '.custom'))
      expect(fs.existsSync(path.join(tempDir, '.custom', 'context.ts'))).toBe(true)
      expect(fs.existsSync(path.join(tempDir, '.opensaas'))).toBe(false)

      // The prisma client output cross-reference follows opensaasPath, so the
      // emitted schema points at the relocated bundle (no longer a no-op).
      const schema = fs.readFileSync(paths.prismaSchema, 'utf-8')
      expect(schema).toContain('output              = "../.custom/prisma-client"')
    })

    it('lets output.opensaasDir override opensaasPath when both are set', () => {
      const config: OpenSaasConfig = {
        db: {
          provider: 'sqlite',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prismaClientConstructor: (() => null) as any,
        },
        opensaasPath: '.custom',
        output: { opensaasDir: 'generated/opensaas' },
        lists: { User: { fields: { name: text() } } },
      }

      const { paths } = generateWithResolvedPaths(config)

      // output.opensaasDir wins; opensaasPath is ignored.
      expect(paths.opensaasDir).toBe(path.join(tempDir, 'generated', 'opensaas'))
      expect(fs.existsSync(path.join(tempDir, 'generated', 'opensaas', 'context.ts'))).toBe(true)
      expect(fs.existsSync(path.join(tempDir, '.custom'))).toBe(false)
      expect(fs.existsSync(path.join(tempDir, '.opensaas'))).toBe(false)

      const schema = fs.readFileSync(paths.prismaSchema, 'utf-8')
      expect(schema).toContain('output              = "../generated/opensaas/prisma-client"')
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
