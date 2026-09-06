import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

/**
 * `db.client.pg` is a lazy factory precisely so that loading the config opens
 * no connection (ADR-0049), and the client is a per-process singleton, so the
 * factory runs once however many callers race for a context.
 *
 * Both halves are observed the only way that proves them — by counting the
 * factory's own invocations in a real project: `opensaas generate` loads the
 * config and must leave the counter untouched, and a probe that pulls on the
 * eager module-level context and two concurrent `getContext()` calls must
 * leave it at exactly one.
 *
 * The scratch tree lives inside this package so node resolution reaches its
 * `node_modules`, and outside `node_modules` itself so type stripping applies.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cliEntry = path.join(packageRoot, 'bin', 'opensaas.js')
const scratchRoot = fs.mkdtempSync(path.join(packageRoot, 'tests', 'tmp-client-'))

afterAll(() => {
  fs.rmSync(scratchRoot, { recursive: true, force: true })
})

const CONFIG = `import { appendFileSync } from 'node:fs'
import { Pool } from 'pg'
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'

export default config({
  db: {
    provider: 'postgresql',
    client: {
      pg: () => {
        appendFileSync(process.env.PG_FACTORY_LOG ?? 'pg-factory.log', 'called\\n')
        return new Pool({ connectionString: 'postgres://nobody@127.0.0.1:1/never-dialled' })
      },
    },
  },
  lists: {
    Note: list({ fields: { body: text() } }),
  },
})
`

/**
 * Pulls on every path that reaches the client — the eager module-level context
 * and two concurrent `getContext()` calls — without issuing a query, so the
 * pool the factory returned is constructed but never dialled.
 */
const PROBE = `const mod = await import('./.opensaas/context.ts')

const contexts = await Promise.all([mod.getContext(), mod.getContext(), mod.rawOpensaasContext])
if (contexts.some((context) => typeof context?.db !== 'object')) {
  throw new Error('a context came back without a db surface')
}
console.log('CONTEXTS_READY')
`

describe('the generated client is constructed once, from db.client', () => {
  let projectDir = ''
  let factoryLog = ''
  let generate: ReturnType<typeof spawnSync>

  const calls = (): number =>
    fs.existsSync(factoryLog)
      ? fs.readFileSync(factoryLog, 'utf-8').split('\n').filter(Boolean).length
      : 0

  beforeAll(() => {
    expect(
      fs.existsSync(path.join(packageRoot, 'dist', 'index.js')),
      'the CLI must be built before this test runs (turbo `test` dependsOn `build`)',
    ).toBe(true)

    projectDir = path.join(scratchRoot, 'client-project')
    factoryLog = path.join(projectDir, 'pg-factory.log')
    fs.mkdirSync(projectDir, { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'opensaas.config.ts'), CONFIG, 'utf-8')

    generate = spawnSync(process.execPath, [cliEntry, 'generate'], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 180_000,
      env: { ...process.env, PG_FACTORY_LOG: factoryLog },
    })
  }, 240_000)

  test('opensaas generate succeeds', () => {
    const output = `${generate.stdout ?? ''}${generate.stderr ?? ''}`
    expect(output, output).toContain('Generation complete')
    expect(generate.status, output).toBe(0)
  })

  test('loading the config for generation never calls db.client.pg', () => {
    expect(calls()).toBe(0)
  })

  test('three racing consumers construct one client and call the factory once', () => {
    fs.writeFileSync(path.join(projectDir, 'probe.mjs'), PROBE, 'utf-8')

    // `spawnSync` cannot be interrupted by vitest's test timeout, so a probe
    // that never exits would hang the worker rather than fail the test.
    const result = spawnSync(process.execPath, ['probe.mjs'], {
      cwd: projectDir,
      encoding: 'utf-8',
      timeout: 60_000,
      killSignal: 'SIGKILL',
      env: { ...process.env, PG_FACTORY_LOG: factoryLog, DATABASE_URL: '' },
    })

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    expect(result.signal, output).toBe(null)
    expect(output, output).toContain('CONTEXTS_READY')
    expect(result.status, output).toBe(0)
    expect(calls()).toBe(1)
  }, 120_000)
})
