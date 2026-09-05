import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { deriveContract } from '../../core/src/contract/index.js'
import type { OpenSaasConfig } from '../../core/src/config/types.js'
import { emitContract } from '../src/generator/contract-emit.js'
import { writeContractModule } from '../src/generator/contract-module.js'
import { writeLists } from '../src/generator/lists.js'
import { writePluginTypes } from '../src/generator/plugin-types.js'
import { writePrismaConfig } from '../src/generator/prisma-config.js'
import { writeTypes } from '../src/generator/types.js'

/**
 * A type-level fixture: a real project on disk whose Contract artifacts come
 * from `prisma contract emit` and whose bundle comes from the generator, so a
 * `tsc` run over it is checking the same two files an application compiles
 * against — not a stub of them.
 *
 * The project lives inside this package so node resolution reaches its
 * `node_modules` for `prisma`, `@prisma/orm-postgres` and `@opensaas/stack-core`.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The project's own compiler settings plus ADR-0054's two gates: the bundle
 * loads natively under Node, so nothing in it may need a transform beyond
 * stripping types.
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
  include: ['.opensaas/**/*.ts', 'prisma/**/*.ts', 'consumer.ts'],
}

export type TypeFixture = {
  projectDir: string
  /** Type-check the project with `consumer.ts` as written. Returns tsc's output. */
  check: (consumer: string) => string
  cleanup: () => void
}

/**
 * Render, emit and prepare a project for `tsc`. The emission is the slow step
 * (a `prisma contract emit` subprocess), so a caller checks many consumers
 * against one fixture rather than building one per assertion.
 */
export function emitTypeFixture(name: string, config: OpenSaasConfig): TypeFixture {
  const scratchRoot = fs.mkdtempSync(path.join(packageRoot, 'tests', `tmp-${name}-`))
  const projectDir = path.join(scratchRoot, 'project')
  fs.mkdirSync(path.join(projectDir, 'prisma'), { recursive: true })

  const data = deriveContract(config)
  writeContractModule(data, path.join(projectDir, 'prisma', 'contract.ts'))
  writePrismaConfig(data, path.join(projectDir, 'prisma.config.ts'), {
    contractModule: './prisma/contract.ts',
    outputDir: './prisma',
  })
  emitContract(projectDir, path.join(projectDir, 'prisma'))

  const opensaasDir = path.join(projectDir, '.opensaas')
  writeTypes(config, path.join(opensaasDir, 'types.ts'))
  writeLists(config, path.join(opensaasDir, 'lists.ts'))
  writePluginTypes(config, path.join(opensaasDir, 'plugin-types.ts'))

  fs.writeFileSync(
    path.join(projectDir, 'tsconfig.json'),
    JSON.stringify(TSCONFIG, null, 2),
    'utf-8',
  )

  const tscBinary = path.join(packageRoot, 'node_modules', '.bin', 'tsc')

  return {
    projectDir,
    check(consumer: string): string {
      fs.writeFileSync(path.join(projectDir, 'consumer.ts'), consumer, 'utf-8')
      const result = spawnSync(tscBinary, ['--project', projectDir], {
        cwd: projectDir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    },
    cleanup() {
      fs.rmSync(scratchRoot, { recursive: true, force: true })
    },
  }
}

/**
 * The type-equality helper and `@ts-expect-error` discipline every consumer
 * shares: a passing compile with zero diagnostics is the assertion, since an
 * unfired `@ts-expect-error` is itself a diagnostic.
 */
export const CONSUMER_PRELUDE = `
type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
declare function assertType<T extends true>(): void
`
