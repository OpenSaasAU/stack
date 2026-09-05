import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createJiti } from 'jiti'
import { deriveContract, deriveGeneratedTables } from '../../core/src/contract/index.js'
import type { OpenSaasConfig } from '../../core/src/config/types.js'
import { resolveOutputPaths } from '../src/generator/output-paths.js'
import { writeContext } from '../src/generator/context.js'
import { writeLists } from '../src/generator/lists.js'
import { writePluginTypes } from '../src/generator/plugin-types.js'
import { writeTables } from '../src/generator/tables.js'
import { writeTypes } from '../src/generator/types.js'

/**
 * The whole generated bundle has to compile, not just the Contract module.
 *
 * The equivalence suite type-checks `prisma/contract.ts` alone, which is why a
 * `.opensaas/types.ts` importing a Prisma client tree the pipeline no longer
 * writes could sit on green CI (#1134 review). This runs `tsc --noEmit` over
 * every file `opensaas generate` writes for the contract fixture — `types.ts`,
 * `lists.ts`, `context.ts`, `plugin-types.ts`, `tables.ts` — against the
 * committed `prisma/contract.d.ts` and `contract.json` they resolve into.
 *
 * The scratch tree lives inside this package so node resolution reaches its
 * `node_modules` for `@opensaas/stack-core` and `@prisma/orm-postgres`.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = path.join(packageRoot, 'tests', 'fixtures', 'contract-project')
const tscBinary = path.join(packageRoot, 'node_modules', '.bin', 'tsc')
const scratchRoot = fs.mkdtempSync(path.join(packageRoot, 'tests', 'tmp-bundle-'))

afterAll(() => {
  fs.rmSync(scratchRoot, { recursive: true, force: true })
})

/**
 * The project's own compiler settings (the root `tsconfig.json`), plus the two
 * ADR-0054 gates the bundle has to hold: it loads natively under Node, so
 * nothing in it may need a transform beyond stripping types.
 */
const TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    lib: ['ES2022'],
    moduleResolution: 'bundler',
    strict: true,
    esModuleInterop: true,
    forceConsistentCasingInFileNames: true,
    resolveJsonModule: true,
    noImplicitAny: true,
    skipLibCheck: true,
    noEmit: true,
    allowImportingTsExtensions: true,
    erasableSyntaxOnly: true,
    verbatimModuleSyntax: true,
    types: ['node'],
  },
  include: ['opensaas.config.ts', '.opensaas/**/*.ts', 'prisma/**/*.ts'],
}

describe('the generated bundle type-checks', () => {
  let projectDir: string

  beforeAll(async () => {
    projectDir = path.join(scratchRoot, 'contract-project')
    fs.mkdirSync(path.join(projectDir, 'prisma'), { recursive: true })

    fs.copyFileSync(
      path.join(fixtureRoot, 'opensaas.config.ts'),
      path.join(projectDir, 'opensaas.config.ts'),
    )
    // The emitted artifacts are committed and CI proves they are current, so
    // this reuses them rather than paying for another `prisma contract emit`.
    for (const artifact of ['contract.json', 'contract.d.ts']) {
      fs.copyFileSync(
        path.join(fixtureRoot, 'prisma', artifact),
        path.join(projectDir, 'prisma', artifact),
      )
    }

    const jiti = createJiti(projectDir, { interopDefault: true })
    const module = await jiti.import<{ default: OpenSaasConfig | Promise<OpenSaasConfig> }>(
      path.join(projectDir, 'opensaas.config.ts'),
    )
    const config = await Promise.resolve(module.default)
    const contractData = deriveContract(config)

    const { paths, crossReferences } = resolveOutputPaths(projectDir, config.output)
    writeTypes(config, paths.types)
    writeLists(config, paths.lists)
    writeContext(config, contractData, paths.context, {
      configImport: crossReferences.configImport,
      contractJsonImport: crossReferences.contractJsonImport,
    })
    writePluginTypes(config, paths.pluginTypes)
    writeTables(deriveGeneratedTables(config, contractData), paths.tables)
  }, 120_000)

  test('writes the bundle files', () => {
    expect(fs.readdirSync(path.join(projectDir, '.opensaas')).sort()).toEqual([
      'context.ts',
      'lists.ts',
      'plugin-types.ts',
      'tables.ts',
      'types.ts',
    ])
  })

  test('references no Prisma client tree the pipeline never writes', () => {
    for (const file of ['types.ts', 'lists.ts', 'context.ts']) {
      const source = fs.readFileSync(path.join(projectDir, '.opensaas', file), 'utf-8')
      expect(source).not.toContain('prisma-client')
    }
  })

  test('tsc --noEmit reports nothing for the bundle and the emitted contract', () => {
    fs.writeFileSync(
      path.join(projectDir, 'tsconfig.json'),
      JSON.stringify(TSCONFIG, null, 2),
      'utf-8',
    )

    const result = spawnSync(tscBinary, ['--project', projectDir], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    expect(`${result.stdout ?? ''}${result.stderr ?? ''}`.trim()).toBe('')
    expect(result.status).toBe(0)
  }, 180_000)
})
