import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createJiti } from 'jiti'
import { deriveContract } from '../../core/src/contract/index.js'
import type { OpenSaasConfig } from '../../core/src/config/types.js'
import { resolveOutputPaths } from '../src/generator/output-paths.js'
import { writeContext } from '../src/generator/context.js'
import { writeLists } from '../src/generator/lists.js'
import { writePluginTypes } from '../src/generator/plugin-types.js'
import { writeTypes } from '../src/generator/types.js'

/**
 * The whole generated bundle has to compile, not just the Contract module.
 *
 * The equivalence suite type-checks `prisma/contract.ts` alone, which is why a
 * `.opensaas/types.ts` importing a Prisma client tree the pipeline no longer
 * writes could sit on green CI (#1134 review). This runs `tsc --noEmit` over
 * every file `opensaas generate` writes for the contract fixture — `types.ts`,
 * `lists.ts`, `context.ts`, `plugin-types.ts` — against the committed
 * `prisma/contract.d.ts` and `contract.json` they resolve into.
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
    //
    // The Contract MODULE is copied alongside them deliberately: it sits in the
    // same directory in a real project, and `./contract.d.ts` resolves to it
    // rather than to the emitted declarations, so a scratch tree missing it
    // would let that import land on the wrong file and still pass (#1136).
    for (const artifact of ['contract.json', 'contract.d.ts', 'contract.ts']) {
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
  }, 120_000)

  test('writes the four bundle files', () => {
    expect(fs.readdirSync(path.join(projectDir, '.opensaas')).sort()).toEqual([
      'context.ts',
      'lists.ts',
      'plugin-types.ts',
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

  /**
   * The check above only proves the bundle is clean today; these prove the
   * check would catch it if it stopped being. Each construct is one plain Node
   * refuses to strip, injected into a throwaway copy of the same bundle.
   */
  describe.each([
    ['an enum', 'export enum Sentinel {\n  A,\n}\n', /TS1294/],
    ['a runtime namespace', 'export namespace Sentinel {\n  export const a = 1\n}\n', /TS1294/],
    [
      'a parameter property',
      'export class Sentinel {\n  constructor(public readonly a: string) {}\n}\n',
      /TS1294/,
    ],
    [
      'a non-type re-export of a type',
      "import { Post } from './types.ts'\nexport { Post }\n",
      /TS1484/,
    ],
  ])('%s in generator output', (_label, construct, diagnostic) => {
    // The diagnostic is asserted, not just a non-zero status: the last case
    // would otherwise keep passing as TS2305 if the generator renamed `Post`,
    // and stop guarding `verbatimModuleSyntax` without going red.
    test('fails the same check', () => {
      const injectedDir = fs.mkdtempSync(path.join(scratchRoot, 'injected-'))
      fs.cpSync(projectDir, injectedDir, { recursive: true })
      fs.writeFileSync(path.join(injectedDir, '.opensaas', 'sentinel.ts'), construct, 'utf-8')
      fs.writeFileSync(
        path.join(injectedDir, 'tsconfig.json'),
        JSON.stringify(TSCONFIG, null, 2),
        'utf-8',
      )

      const result = spawnSync(tscBinary, ['--project', injectedDir], {
        cwd: injectedDir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
      expect(output, output).toMatch(/sentinel\.ts/)
      expect(output, output).toMatch(diagnostic)
      expect(result.status, output).not.toBe(0)
    }, 180_000)
  })
})
