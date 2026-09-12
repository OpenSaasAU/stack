import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startDevDatabase } from '@opensaas/stack-core/dev-database'
import { findDatabaseConnection } from '@opensaas/stack-core/internal'
import { CONTROL_FILE, requestDatabaseUpdate } from '../dev/control.js'
import { runPrismaCli } from '../generator/index.js'
import { resolveOutputPaths, stageWritePaths } from '../generator/output-paths.js'
import { devCommand } from './dev.js'
import { GenerationFailedError, generateCommand } from './generate.js'

/**
 * The loop end to end — a real Dev database, a real reconcile and a real app
 * child — is `tests/dev-loop.test.ts`. What is left here is the boot decisions
 * that test cannot observe cheaply: the guard on a missing config, and what
 * the app child is spawned with when the invocation names no command.
 */

const spawned = vi.hoisted(() => {
  const calls: { file: string; args: string[]; env: typeof process.env }[] = []
  return calls
})

const child = vi.hoisted(() => {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>()
  return {
    exitCode: null,
    signalCode: null,
    /** When true the spawn mock leaves the child running for the test to drive. */
    hold: false,
    kill: () => true,
    once(event: string, handler: (...args: unknown[]) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
      return this
    },
    emit(event: string, ...args: unknown[]) {
      for (const handler of handlers.get(event) ?? []) handler(...args)
    },
  }
})

vi.mock('child_process', () => ({
  spawn: (file: string, args: string[], options: { env: typeof process.env }) => {
    spawned.push({ file, args, env: options.env })
    if (!child.hold) setTimeout(() => child.emit('exit', 0, null), 0)
    return child
  },
}))

const stop = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('@opensaas/stack-core/dev-database', () => ({
  startDevDatabase: vi.fn().mockResolvedValue({
    url: 'postgres://postgres@127.0.0.1:54321/postgres',
    host: '127.0.0.1',
    port: 54321,
    dataDir: undefined,
    stateFile: 'dev-db.json',
    stop,
  }),
}))

vi.mock('@opensaas/stack-core/internal', () => ({
  findDatabaseConnection: vi.fn(() => undefined),
}))

vi.mock('./generate.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./generate.js')>()
  return {
    ...actual,
    generateCommand: vi.fn().mockResolvedValue({
      paths: {},
      livePaths: {},
      prismaConfig: '',
      resolvedModules: [],
    }),
  }
})

vi.mock('../generator/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../generator/index.js')>()
  return {
    ...actual,
    loadOpenSaasConfig: vi.fn().mockResolvedValue({
      config: { db: { provider: 'postgresql' }, lists: {} },
      aliasWarnings: [],
      resolvedModules: [],
    }),
    runPrismaCli: vi.fn().mockResolvedValue({ exitCode: 0, signal: null, output: '' }),
  }
})

const watcherHandlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => void>())
const watcherApi = vi.hoisted(() => ({ add: vi.fn(), unwatch: vi.fn() }))
const watchCalls = vi.hoisted(() => [] as unknown[][])

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn((...args: unknown[]) => {
      watchCalls.push(args)
      return {
        on: (event: string, handler: (...args: unknown[]) => void) => {
          watcherHandlers.set(event, handler)
        },
        add: watcherApi.add,
        unwatch: watcherApi.unwatch,
        close: vi.fn().mockResolvedValue(undefined),
      }
    }),
  },
}))

/** Waits for the loop's queued work to reach a state the test can assert on. */
async function until(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the dev loop.')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('devCommand', () => {
  let tempDir: string
  let originalCwd: string
  let exitCode: number | undefined
  let originalExit: typeof process.exit
  let originalDatabaseUrl: string | undefined
  let revision = 0
  /**
   * The devCommand() call each test starts, so afterEach can settle it before
   * removing the temp dir a timed-out test's abandoned continuation might
   * still be reading from (#1472).
   */
  let pendingLoop: Promise<void> | undefined
  let loopSettled = false

  /**
   * Starts the loop under test and tracks whether it has settled on its own,
   * so afterEach knows whether it still needs to release the held child
   * (below) before it can await the result.
   */
  const startLoop = (options?: Parameters<typeof devCommand>[0]): Promise<void> => {
    pendingLoop = devCommand(options)
    pendingLoop.then(
      () => (loopSettled = true),
      () => (loopSettled = true),
    )
    return pendingLoop
  }

  /**
   * Rewrites the watched config so a fired `change` carries bytes the loop has
   * not already generated from — the loop skips one that does not.
   */
  const editConfig = (): void => {
    revision += 1
    fs.writeFileSync(
      path.join(tempDir, 'opensaas.config.ts'),
      `export default { revision: ${revision} }\n`,
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    spawned.length = 0
    watcherHandlers.clear()
    watchCalls.length = 0
    child.hold = false
    pendingLoop = undefined
    loopSettled = false

    originalDatabaseUrl = process.env.DATABASE_URL
    delete process.env.DATABASE_URL

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-test-'))
    originalCwd = process.cwd()
    process.chdir(tempDir)

    originalExit = process.exit
    exitCode = undefined
    process.exit = vi.fn((code?: number) => {
      exitCode = code
      throw new Error(`process.exit(${code})`)
    }) as never

    fs.writeFileSync(path.join(tempDir, 'opensaas.config.ts'), 'export default {}\n')
  })

  afterEach(async () => {
    if (pendingLoop !== undefined) {
      // A test that held the child (`child.hold = true`) and failed before its
      // own `child.emit('exit', ...)` would otherwise leave devCommand()
      // permanently awaiting an exit nothing will ever send.
      if (!loopSettled) child.emit('exit', 0, null)
      await pendingLoop.catch(() => {})
    }
    process.chdir(originalCwd)
    process.exit = originalExit
    process.exitCode = 0
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = originalDatabaseUrl
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('refuses a directory with no opensaas.config.ts', async () => {
    fs.unlinkSync(path.join(tempDir, 'opensaas.config.ts'))

    await expect(startLoop()).rejects.toThrow('process.exit(1)')
    expect(exitCode).toBe(1)
  })

  it('runs `next dev` when the invocation names no command', async () => {
    await startLoop()

    expect(spawned).toHaveLength(1)
    expect(spawned[0]?.file).toBe('next')
    expect(spawned[0]?.args).toEqual(['dev'])
  })

  it('runs the command given after `--`, and hands the child no database URL', async () => {
    process.env.DATABASE_URL = 'postgres://someone@example.test:5432/inherited'
    await startLoop({ appCommand: ['node', 'server.mjs'] })

    expect(spawned[0]?.file).toBe('node')
    expect(spawned[0]?.args).toEqual(['server.mjs'])
    expect(spawned[0]?.env.DATABASE_URL).toBeUndefined()
    expect(stop).toHaveBeenCalled()
  })

  it('starts no dev database and passes the environment through when a URL is already resolved', async () => {
    vi.mocked(findDatabaseConnection).mockReturnValueOnce({
      url: 'postgres://someone@example.test:5432/inherited',
      provenance: 'env',
    })
    process.env.DATABASE_URL = 'postgres://someone@example.test:5432/inherited'

    await startLoop({ appCommand: ['node', 'server.mjs'] })

    expect(startDevDatabase).not.toHaveBeenCalled()
    expect(spawned[0]?.env.DATABASE_URL).toBe('postgres://someone@example.test:5432/inherited')
  })

  it('takes the escape from a DATABASE_URL in the project .env, with nothing in the shell', async () => {
    fs.writeFileSync(
      path.join(tempDir, '.env'),
      'DATABASE_URL=postgres://someone@example.test:5432/from-dotenv\n',
    )
    vi.mocked(findDatabaseConnection).mockImplementationOnce(() => {
      const url = process.env.DATABASE_URL
      return url === undefined || url.length === 0 ? undefined : { url, provenance: 'env' as const }
    })

    await startLoop({ appCommand: ['node', 'server.mjs'] })

    expect(startDevDatabase).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
    expect(spawned[0]?.env.DATABASE_URL).toBe('postgres://someone@example.test:5432/from-dotenv')
  })

  it('stops the dev database when the boot sequence fails before the app starts', async () => {
    vi.mocked(runPrismaCli).mockRejectedValueOnce(new Error('The `prisma` CLI is not installed'))

    await expect(startLoop()).rejects.toThrow('The `prisma` CLI is not installed')
    expect(spawned).toHaveLength(0)
    expect(stop).toHaveBeenCalled()
  })

  it('runs the loop async stop() when boot generation fails, rather than exiting the process (#1223)', async () => {
    vi.mocked(generateCommand).mockRejectedValueOnce(
      new GenerationFailedError('config surface invalid'),
    )

    await startLoop()

    expect(exitCode).toBeUndefined()
    expect(process.exit).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    expect(spawned).toHaveLength(0)
    expect(stop).toHaveBeenCalled()
  })

  it('has signal handlers installed before the dev database starts, and removes them after', async () => {
    const baseline = process.listenerCount('SIGINT')
    let installedWhenStarting = 0
    vi.mocked(startDevDatabase).mockImplementationOnce(async () => {
      installedWhenStarting = process.listenerCount('SIGINT')
      return {
        url: 'postgres://postgres@127.0.0.1:54321/postgres',
        host: '127.0.0.1',
        port: 54321,
        dataDir: undefined,
        stateFile: path.join(tempDir, '.opensaas', 'dev-db.json'),
        stop,
      }
    })

    await startLoop({ appCommand: ['node', 'server.mjs'] })

    expect(installedWhenStarting).toBe(baseline + 1)
    expect(process.listenerCount('SIGINT')).toBe(baseline)
  })

  it('refuses `db update` when a refused generation replaced the parked one', async () => {
    child.hold = true

    const { paths: live } = resolveOutputPaths(tempDir)
    const stagingDir = path.join(tempDir, '.opensaas', 'staged')
    const staged = stageWritePaths(live, stagingDir)

    let stagedGenerations = 0
    vi.mocked(generateCommand).mockImplementation(async (options = {}) => {
      if (options.stagingDir === undefined) {
        return {
          paths: live,
          livePaths: live,
          prismaConfig: live.prismaConfig,
          resolvedModules: [],
        }
      }
      stagedGenerations += 1
      if (stagedGenerations > 1) throw new Error('config surface invalid')
      fs.mkdirSync(path.dirname(staged.contractModule), { recursive: true })
      fs.writeFileSync(staged.contractModule, 'the parked generation', 'utf-8')
      return {
        paths: staged,
        livePaths: live,
        prismaConfig: staged.prismaConfig,
        resolvedModules: [],
      }
    })

    const destructivePlan = JSON.stringify({
      kind: 'result',
      envelope: {
        result: {
          plan: { operations: [{ label: 'drop Post.title', operationClass: 'destructive' }] },
        },
      },
    })
    vi.mocked(runPrismaCli).mockImplementation(async () => ({
      exitCode: 0,
      signal: null,
      output: destructivePlan,
      stdout: destructivePlan,
    }))

    startLoop({ appCommand: ['node', 'server.mjs'] })

    await until(() => fs.existsSync(path.join(tempDir, CONTROL_FILE)))

    const change = watcherHandlers.get('change')
    expect(change).toBeDefined()

    editConfig()
    change?.()
    await until(() => stagedGenerations === 1)
    expect(fs.existsSync(staged.contractModule)).toBe(true)

    editConfig()
    change?.()
    await until(() => stagedGenerations === 2)

    const said: string[] = []
    const ok = await requestDatabaseUpdate(tempDir, ['postgres'], (message) => said.push(message))

    expect(ok).toBe(false)
    expect(said.join('\n')).toContain('Nothing was staged')
    expect(fs.existsSync(live.contractModule)).toBe(false)

    child.emit('exit', 0, null)
    await pendingLoop
  })

  it('stages nothing for a save that reproduces the config it already reconciled', async () => {
    child.hold = true
    const said: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
      said.push(parts.map((part) => String(part)).join(' '))
    })

    const { paths: live } = resolveOutputPaths(tempDir)
    const stagingDir = path.join(tempDir, '.opensaas', 'staged')
    const staged = stageWritePaths(live, stagingDir)

    let stagedGenerations = 0
    vi.mocked(generateCommand).mockImplementation(async (options = {}) => {
      if (options.stagingDir === undefined) {
        return {
          paths: live,
          livePaths: live,
          prismaConfig: live.prismaConfig,
          resolvedModules: [],
        }
      }
      stagedGenerations += 1
      return {
        paths: staged,
        livePaths: live,
        prismaConfig: staged.prismaConfig,
        resolvedModules: [],
      }
    })

    const destructivePlan = JSON.stringify({
      kind: 'result',
      envelope: {
        result: {
          plan: { operations: [{ label: 'drop Post.title', operationClass: 'destructive' }] },
        },
      },
    })
    vi.mocked(runPrismaCli).mockImplementation(async () => ({
      exitCode: 0,
      signal: null,
      output: destructivePlan,
      stdout: destructivePlan,
    }))

    startLoop({ appCommand: ['node', 'server.mjs'] })

    await until(() => fs.existsSync(path.join(tempDir, CONTROL_FILE)))

    const change = watcherHandlers.get('change')
    editConfig()
    change?.()
    await until(() => said.join('\n').includes('This change would destroy data'))
    expect(stagedGenerations).toBe(1)

    // The save the race is made of: one more watcher event carrying bytes the
    // loop has already generated from. Nothing may be staged off it.
    change?.()
    await until(() => said.join('\n').includes('Config saved with no change'))
    expect(stagedGenerations).toBe(1)
    expect(said.join('\n'), 'the skip names the way out').toContain('still parked')
    expect(said.join('\n')).toContain('pnpm db:update')

    log.mockRestore()
    child.emit('exit', 0, null)
    await pendingLoop
  })

  it('retries an identical re-save after a reconcile that failed', async () => {
    child.hold = true

    const { paths: live } = resolveOutputPaths(tempDir)
    const staged = stageWritePaths(live, path.join(tempDir, '.opensaas', 'staged'))

    let stagedGenerations = 0
    vi.mocked(generateCommand).mockImplementation(async (options = {}) => {
      if (options.stagingDir === undefined) {
        return {
          paths: live,
          livePaths: live,
          prismaConfig: live.prismaConfig,
          resolvedModules: [],
        }
      }
      stagedGenerations += 1
      return {
        paths: staged,
        livePaths: live,
        prismaConfig: staged.prismaConfig,
        resolvedModules: [],
      }
    })

    // Call 1 is the boot reconcile; call 2 is the first save's dry run, failed
    // the way a database briefly out of reach fails it.
    let prismaCalls = 0
    vi.mocked(runPrismaCli).mockImplementation(async () => {
      prismaCalls += 1
      if (prismaCalls === 2) {
        return { exitCode: 1, signal: null, output: 'database is not reachable', stdout: '' }
      }
      const plan = JSON.stringify({
        kind: 'result',
        envelope: { result: { plan: { operations: [] } } },
      })
      return { exitCode: 0, signal: null, output: plan, stdout: plan }
    })

    startLoop({ appCommand: ['node', 'server.mjs'] })

    await until(() => fs.existsSync(path.join(tempDir, CONTROL_FILE)))

    const change = watcherHandlers.get('change')
    editConfig()
    change?.()
    await until(() => prismaCalls === 2)
    expect(stagedGenerations).toBe(1)

    // The developer fixes the database and saves again without editing. The
    // config still differs from what the database and the live bundle carry,
    // so this must reconcile rather than report that nothing changed.
    change?.()
    await until(() => stagedGenerations === 2)
    expect(prismaCalls).toBeGreaterThan(2)

    child.emit('exit', 0, null)
    await pendingLoop
  })

  it('puts the migration refs back when the config change stages nothing', async () => {
    child.hold = true

    const refsDir = path.join(tempDir, 'migrations', 'app', 'refs')
    fs.mkdirSync(refsDir, { recursive: true })
    fs.writeFileSync(path.join(refsDir, 'db.json'), JSON.stringify({ hash: 'before' }), 'utf-8')

    const { paths: live } = resolveOutputPaths(tempDir)

    let refusals = 0
    vi.mocked(generateCommand).mockImplementation(async (options = {}) => {
      if (options.stagingDir === undefined) {
        return {
          paths: live,
          livePaths: live,
          prismaConfig: live.prismaConfig,
          resolvedModules: [],
        }
      }
      // Generation seeds each declared pack's contract space into
      // `migrations/` before it can refuse on the config surface.
      fs.writeFileSync(path.join(refsDir, 'db.json'), JSON.stringify({ hash: 'after' }), 'utf-8')
      fs.writeFileSync(path.join(refsDir, 'seeded.json'), JSON.stringify({ hash: 'new' }), 'utf-8')
      refusals += 1
      throw new Error('config surface invalid')
    })

    startLoop({ appCommand: ['node', 'server.mjs'] })

    await until(() => fs.existsSync(path.join(tempDir, CONTROL_FILE)))

    editConfig()
    watcherHandlers.get('change')?.()
    await until(() => refusals === 1)
    await until(() => !fs.existsSync(path.join(refsDir, 'seeded.json')))

    const restored: unknown = JSON.parse(fs.readFileSync(path.join(refsDir, 'db.json'), 'utf-8'))
    expect(restored).toEqual({ hash: 'before' })

    child.emit('exit', 0, null)
    await pendingLoop
  })

  it('does not start the app when reconciliation does not apply', async () => {
    vi.mocked(runPrismaCli).mockResolvedValueOnce({ exitCode: 2, signal: null, output: '' })

    await startLoop()

    expect(spawned).toHaveLength(0)
    expect(process.exitCode).toBe(1)
    expect(stop).toHaveBeenCalled()
  })

  describe('watching a split config (#1414)', () => {
    it('watches the modules the boot generation resolved, alongside the config file', async () => {
      const modulePath = path.join(tempDir, 'db-client.ts')
      fs.writeFileSync(modulePath, 'export const client = 1\n')

      const { paths: live } = resolveOutputPaths(tempDir)
      vi.mocked(generateCommand).mockImplementation(async (options = {}) => {
        if (options.stagingDir === undefined) {
          return {
            paths: live,
            livePaths: live,
            prismaConfig: live.prismaConfig,
            resolvedModules: [modulePath],
          }
        }
        return {
          paths: live,
          livePaths: live,
          prismaConfig: live.prismaConfig,
          resolvedModules: [],
        }
      })

      await startLoop()

      expect(watchCalls[0]?.[0]).toEqual([path.join(tempDir, 'opensaas.config.ts'), modulePath])
    })

    it('reconciles when a watched module changes even though the config bytes did not', async () => {
      child.hold = true
      const modulePath = path.join(tempDir, 'db-client.ts')
      fs.writeFileSync(modulePath, 'export const client = 1\n')

      const { paths: live } = resolveOutputPaths(tempDir)
      const staged = stageWritePaths(live, path.join(tempDir, '.opensaas', 'staged'))

      let stagedGenerations = 0
      vi.mocked(generateCommand).mockImplementation(async (options = {}) => {
        if (options.stagingDir === undefined) {
          return {
            paths: live,
            livePaths: live,
            prismaConfig: live.prismaConfig,
            resolvedModules: [modulePath],
          }
        }
        stagedGenerations += 1
        return {
          paths: staged,
          livePaths: live,
          prismaConfig: staged.prismaConfig,
          resolvedModules: [modulePath],
        }
      })
      vi.mocked(runPrismaCli).mockImplementation(async () => {
        const plan = JSON.stringify({
          kind: 'result',
          envelope: { result: { plan: { operations: [] } } },
        })
        return { exitCode: 0, signal: null, output: plan, stdout: plan }
      })

      startLoop({ appCommand: ['node', 'server.mjs'] })
      await until(() => fs.existsSync(path.join(tempDir, CONTROL_FILE)))

      // The config file itself is untouched — only the module it imports changes.
      fs.writeFileSync(modulePath, 'export const client = 2\n')
      watcherHandlers.get('change')?.()
      await until(() => stagedGenerations === 1)

      child.emit('exit', 0, null)
      await pendingLoop
    })

    it('still skips a watcher event when neither the config nor its modules changed', async () => {
      child.hold = true
      const said: string[] = []
      const log = vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
        said.push(parts.map((part) => String(part)).join(' '))
      })

      const modulePath = path.join(tempDir, 'db-client.ts')
      fs.writeFileSync(modulePath, 'export const client = 1\n')

      const { paths: live } = resolveOutputPaths(tempDir)
      let stagedGenerations = 0
      vi.mocked(generateCommand).mockImplementation(async (options = {}) => {
        if (options.stagingDir === undefined) {
          return {
            paths: live,
            livePaths: live,
            prismaConfig: live.prismaConfig,
            resolvedModules: [modulePath],
          }
        }
        stagedGenerations += 1
        return {
          paths: live,
          livePaths: live,
          prismaConfig: live.prismaConfig,
          resolvedModules: [],
        }
      })

      startLoop({ appCommand: ['node', 'server.mjs'] })
      await until(() => fs.existsSync(path.join(tempDir, CONTROL_FILE)))

      // Neither the config nor the module changed — a spurious watcher event.
      watcherHandlers.get('change')?.()
      await until(() => said.join('\n').includes('Config saved with no change'))
      expect(stagedGenerations).toBe(0)

      log.mockRestore()
      child.emit('exit', 0, null)
      await pendingLoop
    })

    it('adds a newly resolved module and stops watching one no longer imported', async () => {
      child.hold = true
      const moduleA = path.join(tempDir, 'a.ts')
      const moduleB = path.join(tempDir, 'b.ts')
      fs.writeFileSync(moduleA, 'export const a = 1\n')

      const { paths: live } = resolveOutputPaths(tempDir)
      const staged = stageWritePaths(live, path.join(tempDir, '.opensaas', 'staged'))

      let stagedGenerations = 0
      vi.mocked(generateCommand).mockImplementation(async (options = {}) => {
        if (options.stagingDir === undefined) {
          return {
            paths: live,
            livePaths: live,
            prismaConfig: live.prismaConfig,
            resolvedModules: [moduleA],
          }
        }
        stagedGenerations += 1
        fs.writeFileSync(moduleB, 'export const b = 1\n')
        return {
          paths: staged,
          livePaths: live,
          prismaConfig: staged.prismaConfig,
          resolvedModules: [moduleB],
        }
      })
      vi.mocked(runPrismaCli).mockImplementation(async () => {
        const plan = JSON.stringify({
          kind: 'result',
          envelope: { result: { plan: { operations: [] } } },
        })
        return { exitCode: 0, signal: null, output: plan, stdout: plan }
      })

      startLoop({ appCommand: ['node', 'server.mjs'] })
      await until(() => fs.existsSync(path.join(tempDir, CONTROL_FILE)))

      editConfig()
      watcherHandlers.get('change')?.()
      await until(() => stagedGenerations === 1)

      expect(watcherApi.add).toHaveBeenCalledWith([moduleB])
      expect(watcherApi.unwatch).toHaveBeenCalledWith([moduleA])

      child.emit('exit', 0, null)
      await pendingLoop
    })
  })
})
