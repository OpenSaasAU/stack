import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

/**
 * ADR-0054 withdrew the Node build on the claim that the `.ts` bundle loads
 * natively. This runs the claim: the real `node` binary, no flags, no loader,
 * no bundler, importing `.opensaas/context.ts` for the contract fixture.
 *
 * The bundle under test is written by the real CLI rather than by the writer
 * functions, so what `opensaas generate` actually leaves on disk — including
 * what it does *not* leave — is what is asserted.
 *
 * The probe stops at the point a connection would be opened. `DATABASE_URL` is
 * set so `resolveDatabaseUrl()` resolves, but nothing dials it: the module's
 * `rawOpensaasContext` promise is the only eager path and its rejection is
 * absorbed, so what is asserted is that the module graph — the bundle, the
 * config, `@opensaas/stack-core` and `@prisma/orm-postgres/runtime` — loads.
 * better-auth is not exercised here; ADR-0054's amendment says where that
 * anchor went.
 *
 * The scratch tree lives inside this package so node resolution reaches its
 * `node_modules`, and outside `node_modules` itself so type stripping applies.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = path.join(packageRoot, 'tests', 'fixtures', 'contract-project')
const cliEntry = path.join(packageRoot, 'bin', 'opensaas.js')
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
  let generate: ReturnType<typeof spawnSync>

  beforeAll(() => {
    expect(
      fs.existsSync(path.join(packageRoot, 'dist', 'index.js')),
      'the CLI must be built before this test runs (turbo `test` dependsOn `build`)',
    ).toBe(true)

    projectDir = path.join(scratchRoot, 'contract-project')
    fs.mkdirSync(projectDir, { recursive: true })
    fs.copyFileSync(
      path.join(fixtureRoot, 'opensaas.config.ts'),
      path.join(projectDir, 'opensaas.config.ts'),
    )

    generate = spawnSync(process.execPath, [cliEntry, 'generate'], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 180_000,
    })
  }, 240_000)

  test('opensaas generate succeeds', () => {
    const output = `${generate.stdout ?? ''}${generate.stderr ?? ''}`
    expect(output, output).toContain('Generation complete')
    expect(generate.status, output).toBe(0)
  })

  test('emits no compiled twin beside the bundle', () => {
    expect(fs.existsSync(path.join(projectDir, '.opensaas', 'context.ts'))).toBe(true)
    expect(fs.existsSync(path.join(projectDir, '.opensaas', 'dist'))).toBe(false)
  })

  test('the real node binary imports it with no flags', () => {
    fs.writeFileSync(path.join(projectDir, 'probe.mjs'), PROBE, 'utf-8')

    // `spawnSync` cannot be interrupted by vitest's test timeout, so a probe
    // that never exits would hang the worker rather than fail the test.
    const result = spawnSync(process.execPath, ['probe.mjs'], {
      cwd: projectDir,
      encoding: 'utf-8',
      timeout: 60_000,
      killSignal: 'SIGKILL',
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/never_dialled',
      },
    })

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    expect(result.signal, output).toBe(null)
    expect(output, output).toContain('BUNDLE_LOADED_UNDER_PLAIN_NODE')
    expect(result.status, output).toBe(0)
  }, 120_000)
})
