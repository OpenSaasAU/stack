import { describe, it, expect } from 'vitest'
import * as path from 'path'
import { resolveOutputPaths } from './output-paths.js'

const CWD = path.resolve('/project')

describe('resolveOutputPaths', () => {
  describe('defaults (no output block)', () => {
    it('writes the schema to prisma/schema.prisma and the bundle to .opensaas/', () => {
      const { paths } = resolveOutputPaths(CWD)

      expect(paths.prismaSchema).toBe(path.join(CWD, 'prisma', 'schema.prisma'))
      expect(paths.opensaasDir).toBe(path.join(CWD, '.opensaas'))
      expect(paths.types).toBe(path.join(CWD, '.opensaas', 'types.ts'))
      expect(paths.lists).toBe(path.join(CWD, '.opensaas', 'lists.ts'))
      expect(paths.context).toBe(path.join(CWD, '.opensaas', 'context.ts'))
      expect(paths.pluginTypes).toBe(path.join(CWD, '.opensaas', 'plugin-types.ts'))
    })

    it('always keeps prisma.config.ts at the project root', () => {
      const { paths } = resolveOutputPaths(CWD)
      expect(paths.prismaConfig).toBe(path.join(CWD, 'prisma.config.ts'))
    })

    it('produces the historical cross-references byte-for-byte', () => {
      const { crossReferences } = resolveOutputPaths(CWD)

      expect(crossReferences.prismaConfigSchema).toBe('prisma')
      expect(crossReferences.prismaClientOutput).toBe('../.opensaas/prisma-client')
      expect(crossReferences.configImport).toBe('../opensaas.config')
    })

    it('treats an empty output block as defaults', () => {
      const withDefaults = resolveOutputPaths(CWD)
      const withEmpty = resolveOutputPaths(CWD, {})
      expect(withEmpty).toEqual(withDefaults)
    })
  })

  describe('relocated schema only', () => {
    const { paths, crossReferences } = resolveOutputPaths(CWD, {
      prismaSchema: 'prisma-opensaas/schema.prisma',
    })

    it('writes the schema to the configured path', () => {
      expect(paths.prismaSchema).toBe(path.join(CWD, 'prisma-opensaas', 'schema.prisma'))
    })

    it('points prisma.config.ts at the configured schema directory', () => {
      expect(crossReferences.prismaConfigSchema).toBe('prisma-opensaas')
    })

    it('recomputes the prisma client output relative to the new schema dir', () => {
      // From prisma-opensaas/ back up to the (unchanged) .opensaas/prisma-client.
      expect(crossReferences.prismaClientOutput).toBe('../.opensaas/prisma-client')
    })

    it('keeps the bundle and config import unchanged', () => {
      expect(paths.opensaasDir).toBe(path.join(CWD, '.opensaas'))
      expect(crossReferences.configImport).toBe('../opensaas.config')
    })
  })

  describe('relocated bundle only', () => {
    const { paths, crossReferences } = resolveOutputPaths(CWD, {
      opensaasDir: 'generated/opensaas',
    })

    it('writes the bundle files to the configured directory', () => {
      expect(paths.opensaasDir).toBe(path.join(CWD, 'generated', 'opensaas'))
      expect(paths.types).toBe(path.join(CWD, 'generated', 'opensaas', 'types.ts'))
      expect(paths.context).toBe(path.join(CWD, 'generated', 'opensaas', 'context.ts'))
    })

    it('recomputes the prisma client output to point at the new bundle', () => {
      // From the default prisma/ schema dir to generated/opensaas/prisma-client.
      expect(crossReferences.prismaClientOutput).toBe('../generated/opensaas/prisma-client')
    })

    it('recomputes the config import to climb back to the project root', () => {
      // generated/opensaas/ is two levels below the root.
      expect(crossReferences.configImport).toBe('../../opensaas.config')
    })

    it('leaves the schema path at the default', () => {
      expect(paths.prismaSchema).toBe(path.join(CWD, 'prisma', 'schema.prisma'))
      expect(crossReferences.prismaConfigSchema).toBe('prisma')
    })
  })

  describe('relocated schema and bundle', () => {
    const { paths, crossReferences } = resolveOutputPaths(CWD, {
      prismaSchema: 'prisma-opensaas/schema.prisma',
      opensaasDir: 'generated/opensaas',
    })

    it('writes both to their configured locations', () => {
      expect(paths.prismaSchema).toBe(path.join(CWD, 'prisma-opensaas', 'schema.prisma'))
      expect(paths.opensaasDir).toBe(path.join(CWD, 'generated', 'opensaas'))
    })

    it('cross-references resolve between the two relocated locations', () => {
      expect(crossReferences.prismaConfigSchema).toBe('prisma-opensaas')
      // From prisma-opensaas/ to generated/opensaas/prisma-client.
      expect(crossReferences.prismaClientOutput).toBe('../generated/opensaas/prisma-client')
      // From generated/opensaas/ up to the root.
      expect(crossReferences.configImport).toBe('../../opensaas.config')
    })
  })

  describe('opensaasPath fallback precedence', () => {
    it('uses opensaasPath for the bundle dir when no output.opensaasDir is set', () => {
      const { paths, crossReferences } = resolveOutputPaths(CWD, undefined, '.custom')

      expect(paths.opensaasDir).toBe(path.join(CWD, '.custom'))
      expect(paths.context).toBe(path.join(CWD, '.custom', 'context.ts'))
      // The client output cross-reference follows opensaasPath.
      expect(crossReferences.prismaClientOutput).toBe('../.custom/prisma-client')
    })

    it('prefers output.opensaasDir over opensaasPath when both are set', () => {
      const { paths, crossReferences } = resolveOutputPaths(
        CWD,
        { opensaasDir: 'generated/opensaas' },
        '.custom',
      )

      expect(paths.opensaasDir).toBe(path.join(CWD, 'generated', 'opensaas'))
      expect(crossReferences.prismaClientOutput).toBe('../generated/opensaas/prisma-client')
      expect(crossReferences.configImport).toBe('../../opensaas.config')
    })

    it('falls back to the default .opensaas when neither is set', () => {
      const { paths } = resolveOutputPaths(CWD, undefined, undefined)
      expect(paths.opensaasDir).toBe(path.join(CWD, '.opensaas'))
    })
  })

  describe('schema at the project root', () => {
    it('emits a relative config-schema reference for a root-level schema dir', () => {
      const { crossReferences } = resolveOutputPaths(CWD, {
        prismaSchema: 'schema.prisma',
      })
      // The schema dir is the project root itself; Prisma rejects an empty
      // `schema` value, so the resolver emits `.`.
      expect(crossReferences.prismaConfigSchema).toBe('.')
      // From the root to .opensaas/prisma-client.
      expect(crossReferences.prismaClientOutput).toBe('.opensaas/prisma-client')
    })
  })
})
