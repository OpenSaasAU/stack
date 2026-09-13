import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

/**
 * `db.client.pg` is a lazy factory precisely so that loading the config opens
 * no connection (ADR-0049), and the client is a per-process singleton, so the
 * factory runs once however many callers race for a context — and a first
 * attempt that fails leaves the next one free to succeed.
 *
 * All three are observed by counting the factory's own invocations in a real
 * project, since the memo they turn on lives in the emitted module and nowhere
 * else.
 *
 * One thing makes the concurrency probe able to fail rather than merely pass:
 * the config resolves behind a plugin that sleeps, which holds every caller
 * inside `getClient`'s own `await getConfig()` at once — without it a fast
 * implementation could let one racer's construction finish before the next
 * one starts, proving only that they end up sharing a resolved value rather
 * than sharing the same in-flight attempt.
 *
 * A second probe below proves the guarantee the module-local memo alone
 * cannot: that two separate copies of the generated module — what a bundler
 * produces when it compiles the same file into more than one bundle — share
 * one client through the process-wide registry (`processGlobal`), in every
 * environment (ADR-0070). The single-module race above would pass against a
 * per-module-instance implementation too, since `clientPromise` already
 * serialises callers that share one module scope.
 *
 * The scratch tree lives inside this package so node resolution reaches its
 * `node_modules`, and outside `node_modules` itself so type stripping applies.
 * Its `tmp-` prefix is already gitignored, so a killed run that never reaches
 * `afterAll` leaves nothing tracked behind.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cliEntry = path.join(packageRoot, 'bin', 'opensaas.js')
const scratchRoot = fs.mkdtempSync(path.join(packageRoot, 'tests', 'tmp-client-'))

afterAll(() => {
  fs.rmSync(scratchRoot, { recursive: true, force: true })
})

/**
 * `db.client` is supplied only under `OPENSAAS_TEST_POOL`, so the same
 * generated bundle serves both the pool branch and the URL branch whose
 * failure the recovery probe drives.
 */
const CONFIG = `import { appendFileSync } from 'node:fs'
import { Pool } from 'pg'
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'

const slowConfig = {
  name: 'slow-config',
  version: '0.0.0',
  init: async () => {
    await new Promise((resolve) => setTimeout(resolve, 500))
  },
}

const pool = {
  pg: () => {
    appendFileSync(process.env.PG_FACTORY_LOG ?? 'pg-factory.log', 'called\\n')
    return new Pool({ connectionString: 'postgres://nobody@127.0.0.1:1/never-dialled' })
  },
}

export default config({
  plugins: [slowConfig],
  db: {
    provider: 'postgresql',
    client: process.env.OPENSAAS_TEST_POOL === '1' ? pool : undefined,
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
const CONCURRENCY_PROBE = `const mod = await import('./.opensaas/context.ts')

const contexts = await Promise.all([mod.getContext(), mod.getContext(), mod.rawOpensaasContext])
if (contexts.some((context) => typeof context?.db !== 'object')) {
  throw new Error('a context came back without a db surface')
}
console.log('CONTEXTS_READY')
`

/**
 * The dev server that boots before its database: the first construction throws
 * because nothing names a connection, and the second — after the URL appears —
 * must build a client rather than replay the cached rejection.
 */
const RECOVERY_PROBE = `const mod = await import('./.opensaas/context.ts')

let firstError = null
try {
  await mod.getContext()
} catch (error) {
  firstError = error
}
if (firstError === null) throw new Error('the first context resolved with no connection URL')
console.log('FIRST_FAILED:' + firstError.name)

process.env.DATABASE_URL = 'postgres://nobody@127.0.0.1:1/never-dialled'
const context = await mod.getContext()
if (typeof context?.db !== 'object') throw new Error('the recovered context carried no db surface')
console.log('RECOVERED')
`

/**
 * `rawOpensaasContext` is exported once, at module scope, and handed to
 * helpers like \`createAuth\` that hold onto that one reference for the life
 * of the process — so unlike \`getContext()\`, which is just a function called
 * fresh each time, there is no second call site to fall back on if the first
 * \`await\` poisons it. This is issue #1377: confirm the same object recovers
 * across two \`await\`s, the second made after the connection becomes
 * resolvable, exactly as a caller holding the export across a database blip
 * would experience it.
 */
const RAW_CONTEXT_RECOVERY_PROBE = `const mod = await import('./.opensaas/context.ts')

const rawContext = mod.rawOpensaasContext

let firstError = null
try {
  await rawContext
} catch (error) {
  firstError = error
}
if (firstError === null) throw new Error('the first rawOpensaasContext resolved with no connection URL')
console.log('RAW_FIRST_FAILED:' + firstError.name)

process.env.DATABASE_URL = 'postgres://nobody@127.0.0.1:1/never-dialled'
const context = await rawContext
if (typeof context?.db !== 'object') throw new Error('the recovered raw context carried no db surface')
console.log('RAW_RECOVERED')
`

describe('the generated client is constructed once, from db.client', () => {
  let projectDir = ''
  let factoryLog = ''
  let generate: ReturnType<typeof spawnSync>

  const calls = (): number =>
    fs.existsSync(factoryLog)
      ? fs.readFileSync(factoryLog, 'utf-8').split('\n').filter(Boolean).length
      : 0

  const runProbe = (name: string, source: string, env: Record<string, string>) => {
    fs.writeFileSync(path.join(projectDir, name), source, 'utf-8')

    // `spawnSync` cannot be interrupted by vitest's test timeout, so a probe
    // that never exits would hang the worker rather than fail the test.
    return spawnSync(process.execPath, [name], {
      cwd: projectDir,
      encoding: 'utf-8',
      timeout: 60_000,
      killSignal: 'SIGKILL',
      env: { ...process.env, PG_FACTORY_LOG: factoryLog, ...env },
    })
  }

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
      env: { ...process.env, PG_FACTORY_LOG: factoryLog, OPENSAAS_TEST_POOL: '1' },
    })
  }, 240_000)

  test('opensaas generate succeeds', () => {
    const output = `${generate.stdout ?? ''}${generate.stderr ?? ''}`
    expect(output, output).toContain('Generation complete')
    expect(generate.status, output).toBe(0)
  })

  /**
   * A guard rather than a regression test: `opensaas generate` never reaches
   * the runtime, so this held before the client moved behind the singleton too.
   * The count it reads is cross-validated by the probe below, which asserts `1`
   * from the same log, so it cannot be passing because the log went missing.
   */
  test('loading the config for generation never calls db.client.pg', () => {
    expect(calls()).toBe(0)
  })

  test('three racing consumers construct one client and call the factory once', () => {
    const result = runProbe('probe.mjs', CONCURRENCY_PROBE, {
      NODE_ENV: 'production',
      OPENSAAS_TEST_POOL: '1',
      DATABASE_URL: '',
      DIRECT_DATABASE_URL: '',
    })

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    expect(result.signal, output).toBe(null)
    expect(output, output).toContain('CONTEXTS_READY')
    expect(result.status, output).toBe(0)
    expect(calls()).toBe(1)
  }, 120_000)

  test('two copies of the generated module share one client, under NODE_ENV=production', () => {
    // A literal second copy of `context.ts`, at its own resolved specifier, is
    // what stands in for what a bundler produces when it compiles the same
    // generated file into more than one bundle: Node gives it its own module
    // scope, so anything held in `context.ts`'s own module-local `clientPromise`
    // would NOT be shared with the original — only the process-wide registry
    // (ADR-0070) would be. Its sibling imports (`./types.ts`, `./tables.ts`)
    // resolve unchanged, so both copies still describe the same config.
    //
    // Run under `NODE_ENV=production`: an earlier version of the generated
    // file wrote its cross-instance registry (`globalForClient`) everywhere
    // EXCEPT production, so this is the one environment where that
    // implementation logs two calls instead of one — exactly the asymmetry
    // this record removes (ADR-0070).
    const opensaasDir = path.join(projectDir, '.opensaas')
    fs.copyFileSync(path.join(opensaasDir, 'context.ts'), path.join(opensaasDir, 'context-copy.ts'))
    const callsBefore = calls()

    const result = runProbe(
      'two-copies.mjs',
      `const [first, second] = await Promise.all([
  import('./.opensaas/context.ts'),
  import('./.opensaas/context-copy.ts'),
])
const contexts = await Promise.all([first.getContext(), second.getContext()])
if (contexts.some((context) => typeof context?.db !== 'object')) {
  throw new Error('a context came back without a db surface')
}
console.log('TWO_COPIES_READY')
`,
      {
        NODE_ENV: 'production',
        OPENSAAS_TEST_POOL: '1',
        DATABASE_URL: '',
        DIRECT_DATABASE_URL: '',
      },
    )

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    expect(result.signal, output).toBe(null)
    expect(output, output).toContain('TWO_COPIES_READY')
    expect(result.status, output).toBe(0)
    // One call for this process, whichever of the two copies got there first —
    // not two, which is what a per-module-instance client would log.
    expect(calls() - callsBefore).toBe(1)
  }, 120_000)

  test('a construction that failed for want of a URL does not poison the next', () => {
    const result = runProbe('recovery.mjs', RECOVERY_PROBE, {
      OPENSAAS_TEST_POOL: '',
      DATABASE_URL: '',
      DIRECT_DATABASE_URL: '',
    })

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    expect(result.signal, output).toBe(null)
    expect(output, output).toContain('FIRST_FAILED:DatabaseUrlUnresolvedError')
    expect(output, output).toContain('RECOVERED')
    expect(result.status, output).toBe(0)
  }, 120_000)

  test('the same rawOpensaasContext reference recovers after a failed first await (#1377)', () => {
    const result = runProbe('raw-recovery.mjs', RAW_CONTEXT_RECOVERY_PROBE, {
      OPENSAAS_TEST_POOL: '',
      DATABASE_URL: '',
      DIRECT_DATABASE_URL: '',
    })

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    expect(result.signal, output).toBe(null)
    expect(output, output).toContain('RAW_FIRST_FAILED:DatabaseUrlUnresolvedError')
    expect(output, output).toContain('RAW_RECOVERED')
    expect(result.status, output).toBe(0)
  }, 120_000)
})
