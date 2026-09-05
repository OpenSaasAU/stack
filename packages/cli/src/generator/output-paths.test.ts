import { describe, it, expect } from 'vitest'
import * as path from 'path'
import { resolveOutputPaths } from './output-paths.js'

const CWD = path.resolve('/project')

describe('resolveOutputPaths', () => {
  describe('defaults (no output block)', () => {
    it('writes the Contract module to prisma/ and the bundle to .opensaas/', () => {
      const { paths } = resolveOutputPaths(CWD)

      expect(paths.contractModule).toBe(path.join(CWD, 'prisma', 'contract.ts'))
      expect(paths.contractDir).toBe(path.join(CWD, 'prisma'))
      expect(paths.opensaasDir).toBe(path.join(CWD, '.opensaas'))
      expect(paths.types).toBe(path.join(CWD, '.opensaas', 'types.ts'))
      expect(paths.lists).toBe(path.join(CWD, '.opensaas', 'lists.ts'))
      expect(paths.context).toBe(path.join(CWD, '.opensaas', 'context.ts'))
      expect(paths.pluginTypes).toBe(path.join(CWD, '.opensaas', 'plugin-types.ts'))
    })

    it('places the emitted artifacts beside the Contract module', () => {
      const { paths } = resolveOutputPaths(CWD)

      expect(paths.contractJson).toBe(path.join(CWD, 'prisma', 'contract.json'))
      expect(paths.contractTypes).toBe(path.join(CWD, 'prisma', 'contract.d.ts'))
    })

    it('always keeps prisma.config.ts at the project root', () => {
      const { paths } = resolveOutputPaths(CWD)
      expect(paths.prismaConfig).toBe(path.join(CWD, 'prisma.config.ts'))
    })

    it('cross-references the Contract module, its output dir and the bundle', () => {
      const { crossReferences } = resolveOutputPaths(CWD)

      expect(crossReferences.prismaConfigContract).toBe('./prisma/contract.ts')
      expect(crossReferences.prismaConfigOutput).toBe('./prisma')
      expect(crossReferences.contractJsonImport).toBe('../prisma/contract.json')
      expect(crossReferences.configImport).toBe('../opensaas.config')
    })

    it('treats an empty output block as defaults', () => {
      const withDefaults = resolveOutputPaths(CWD)
      const withEmpty = resolveOutputPaths(CWD, {})
      expect(withEmpty).toEqual(withDefaults)
    })
  })

  describe('relocated Contract module only', () => {
    const { paths, crossReferences } = resolveOutputPaths(CWD, {
      contractModule: 'prisma-opensaas/contract.ts',
    })

    it('writes the module and its artifacts to the configured directory', () => {
      expect(paths.contractModule).toBe(path.join(CWD, 'prisma-opensaas', 'contract.ts'))
      expect(paths.contractJson).toBe(path.join(CWD, 'prisma-opensaas', 'contract.json'))
      expect(paths.contractTypes).toBe(path.join(CWD, 'prisma-opensaas', 'contract.d.ts'))
    })

    it('points prisma.config.ts at the configured module and output directory', () => {
      expect(crossReferences.prismaConfigContract).toBe('./prisma-opensaas/contract.ts')
      expect(crossReferences.prismaConfigOutput).toBe('./prisma-opensaas')
    })

    it('recomputes the bundle import of contract.json', () => {
      expect(crossReferences.contractJsonImport).toBe('../prisma-opensaas/contract.json')
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

    it('recomputes the config and contract.json imports for the deeper bundle', () => {
      expect(crossReferences.configImport).toBe('../../opensaas.config')
      expect(crossReferences.contractJsonImport).toBe('../../prisma/contract.json')
    })

    it('leaves the Contract module where it was', () => {
      expect(paths.contractModule).toBe(path.join(CWD, 'prisma', 'contract.ts'))
      expect(crossReferences.prismaConfigContract).toBe('./prisma/contract.ts')
    })
  })

  describe('both relocated', () => {
    const { paths, crossReferences } = resolveOutputPaths(CWD, {
      contractModule: 'db/contract.ts',
      opensaasDir: 'src/generated',
    })

    it('resolves every path against the configured locations', () => {
      expect(paths.contractModule).toBe(path.join(CWD, 'db', 'contract.ts'))
      expect(paths.contractJson).toBe(path.join(CWD, 'db', 'contract.json'))
      expect(paths.opensaasDir).toBe(path.join(CWD, 'src', 'generated'))
      expect(paths.prismaConfig).toBe(path.join(CWD, 'prisma.config.ts'))
    })

    it('resolves every cross-reference against the configured locations', () => {
      expect(crossReferences.prismaConfigContract).toBe('./db/contract.ts')
      expect(crossReferences.prismaConfigOutput).toBe('./db')
      expect(crossReferences.contractJsonImport).toBe('../../db/contract.json')
      expect(crossReferences.configImport).toBe('../../opensaas.config')
    })
  })

  describe('the opensaasPath fallback', () => {
    it('relocates the bundle when no output.opensaasDir is set', () => {
      const { paths } = resolveOutputPaths(CWD, undefined, 'legacy-bundle')
      expect(paths.opensaasDir).toBe(path.join(CWD, 'legacy-bundle'))
    })

    it('yields to output.opensaasDir', () => {
      const { paths } = resolveOutputPaths(CWD, { opensaasDir: 'wins' }, 'legacy-bundle')
      expect(paths.opensaasDir).toBe(path.join(CWD, 'wins'))
    })
  })

  describe('a Contract module at the project root', () => {
    const { crossReferences } = resolveOutputPaths(CWD, { contractModule: 'contract.ts' })

    it('emits an explicitly relative specifier, never a bare one', () => {
      expect(crossReferences.prismaConfigContract).toBe('./contract.ts')
      expect(crossReferences.prismaConfigOutput).toBe('.')
    })
  })
})
