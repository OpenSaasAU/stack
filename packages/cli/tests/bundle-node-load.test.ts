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
 * ADR-0054 withdrew the Node build on the claim that the `.ts` bundle loads
 * natively. This runs the claim: the real `node` binary, no flags, no loader,
 * no bundler, importing `.opensaas/context.ts` for the contract fixture.
 *
 * The probe stops at the point a connection would be opened. `DATABASE_URL` is
 * set so `resolveDatabaseUrl()` resolves, but nothing dials it: the module's
 * `rawOpensaasContext` promise is the only eager path and its rejection is
 * absorbed, so what is asserted is that the module graph — the bundle, the
 * config, `@opensaas/stack-core` and `@prisma/orm-postgres/runtime` — loads.
 *
 * The scratch tree lives inside this package so node resolution reaches its
 * `node_modules`, and outside `node_modules` itself so type stripping applies.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = path.join(packageRoot, 'tests', 'fixtures', 'contract-project')
const scratchRoot = fs.mkdtempSync(path.join(packageRoot, 'tests', 'tmp-node-load-'))

afterAll(() => {
  fs.rmSync(scratchRoot, { recursive: true, force: true })
})

/**
 * Imports the bundle entry and reports one sentinel line. `.mjs`, not `.ts`, so
 * a failure to strip types in the bundle is the bundle's failure and not the
 * probe's.
 */
const PROBE = `const mod = await import('./.opensaas/context.ts')

// The eager context promise would otherwise reject unhandled at a connection
// this probe never intends to open.
mod.rawOpensaasContext?.catch(() => {})

if (typeof mod.getContext !== 'function') {
  throw new Error('getContext missing from the natively loaded bundle')
}
console.log('BUNDLE_LOADED_UNDER_PLAIN_NODE')
`

describe('the generated bundle loads under plain Node', () => {
  let projectDir = ''

  beforeAll(async () => {
    projectDir = path.join(scratchRoot, 'contract-project')
    fs.mkdirSync(path.join(projectDir, 'prisma'), { recursive: true })

    fs.copyFileSync(
      path.join(fixtureRoot, 'opensaas.config.ts'),
      path.join(projectDir, 'opensaas.config.ts'),
    )
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

    fs.writeFileSync(path.join(projectDir, 'probe.mjs'), PROBE, 'utf-8')
  }, 120_000)

  test('emits no compiled twin beside the bundle', () => {
    expect(fs.existsSync(path.join(projectDir, '.opensaas', 'dist'))).toBe(false)
  })

  test('the real node binary imports it with no flags', () => {
    const result = spawnSync(process.execPath, ['probe.mjs'], {
      cwd: projectDir,
      encoding: 'utf-8',
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/never_dialled',
      },
    })

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    expect(output, output).toContain('BUNDLE_LOADED_UNDER_PLAIN_NODE')
    expect(result.status, output).toBe(0)
  }, 120_000)
})
