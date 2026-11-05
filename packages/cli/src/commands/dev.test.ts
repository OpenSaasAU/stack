import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DevDatabaseInUseError, startDevDatabase } from '@opensaas/stack-core/dev-database'
import { findDatabaseConnection } from '@opensaas/stack-core/internal'
import { CONTROL_FILE, requestDatabaseUpdate } from '../dev/control.js'
import { loadOpenSaasConfig as loadConfigFromDisk } from '../generator/config-load.js'
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
  DevDatabaseInUseError: class DevDatabaseInUseError extends Error {
    constructor(dataDir: string, pid: number) {
      super(`${dataDir} is already open in another process (pid ${pid})`)
    }
  },
  startDevDatabase: vi.fn().mockResolvedValue({
    url: 'postgres://postgres@127.0.0.1:54321/postgres',
    host: '127.0.0.1',
    port: 54321,
    dataDir: undefined,
    stateFile: 'dev-db.json',
    stop,
  }),
}))

vi.mock('@opensaas/stack-core/internal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opensaas/stack-core/internal')>()
  return {
    connectionStringFault: actual.connectionStringFault,
    findDatabaseConnection: vi.fn(() => undefined),
  }
})

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
    runPrismaCli: vi.fn().mockResolvedValue({ exitCode: 0, signal: null, output: '', stdout: '' }),
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

    // realpath'd: the watched-module paths this suite asserts on come back
    // canonicalized, and on macOS os.tmpdir() is under a symlink (/var ->
    // /private/var) — comparing against the un-resolved path would fail on
    // every mac, never on CI's Linux.
    tempDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dev-test-'))
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
    vi.unstubAllEnvs()
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

  it('runs the command given after `--`, and hands the child a blank database URL', async () => {
    process.env.DATABASE_URL = 'postgres://someone@example.test:5432/inherited'
    await startLoop({ appCommand: ['node', 'server.mjs'] })

    expect(spawned[0]?.file).toBe('node')
    expect(spawned[0]?.args).toEqual(['server.mjs'])
    expect(spawned[0]?.env.DATABASE_URL).toBe('')
    expect(stop).toHaveBeenCalled()
  })

  it('starts no dev database and passes the environment through when a URL is already resolved', async () => {
    vi.mocked(findDatabaseConnection).mockReturnValueOnce({
      url: 'postgres://someone@example.test:5432/inherited',
      provenance: 'env',
    })
    process.env.DATABASE_URL = 'postgres://someone@example.test:5432/inherited'

    await startLoop({ appCommand: ['node', 'server.mjs'], yes: true })

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

    await startLoop({ appCommand: ['node', 'server.mjs'], yes: true })

    expect(startDevDatabase).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
    expect(spawned[0]?.env.DATABASE_URL).toBe('postgres://someone@example.test:5432/from-dotenv')
  })

  it('takes the escape from a DATABASE_URL in .env.local and names the file', async () => {
    fs.writeFileSync(
      path.join(tempDir, '.env.local'),
      'DATABASE_URL=postgres://someone@example.test:5432/from-local\n',
    )
    vi.mocked(findDatabaseConnection).mockImplementationOnce(() => {
      const url = process.env.DATABASE_URL
      return url === undefined || url.length === 0 ? undefined : { url, provenance: 'env' as const }
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await startLoop({ appCommand: ['node', 'server.mjs'] })

    expect(startDevDatabase).not.toHaveBeenCalled()
    expect(log.mock.calls.flat().join('\n')).toContain('DATABASE_URL from .env.local')
    log.mockRestore()
  })

  it('names DIRECT_DATABASE_URL when it outranks a DATABASE_URL from .env.local', async () => {
    fs.writeFileSync(
      path.join(tempDir, '.env.local'),
      'DATABASE_URL=postgres://someone@example.test:5432/a\nDIRECT_DATABASE_URL=postgres://someone@example.test:5432/b\n',
    )
    vi.mocked(findDatabaseConnection).mockImplementationOnce(() => {
      const url = process.env.DIRECT_DATABASE_URL
      return url === undefined ? undefined : { url, provenance: 'env' as const }
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await startLoop({ appCommand: ['node', 'server.mjs'] })

    expect(log.mock.calls.flat().join('\n')).toContain('DIRECT_DATABASE_URL from .env.local')
    log.mockRestore()
    delete process.env.DIRECT_DATABASE_URL
  })

  it('keeps the plain message for a DATABASE_URL from .env', async () => {
    fs.writeFileSync(
      path.join(tempDir, '.env'),
      'DATABASE_URL=postgres://someone@example.test:5432/from-dotenv\n',
    )
    vi.mocked(findDatabaseConnection).mockImplementationOnce(() => {
      const url = process.env.DATABASE_URL
      return url === undefined || url.length === 0 ? undefined : { url, provenance: 'env' as const }
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await startLoop({ appCommand: ['node', 'server.mjs'] })

    const output = log.mock.calls.flat().join('\n')
    expect(output).toContain('DATABASE_URL is set: using it')
    expect(output).not.toContain('DATABASE_URL from')
    log.mockRestore()
  })

  it('refuses a non-Postgres connection variable before starting anything', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubEnv('DATABASE_URL', 'file:./dev.db')

    await expect(startLoop()).rejects.toThrow('process.exit(1)')

    const printed = error.mock.calls.flat().join('\n')
    error.mockRestore()
    expect(printed).toContain('DATABASE_URL')
    expect(printed).toContain('file:')
    expect(startDevDatabase).not.toHaveBeenCalled()
    expect(spawned).toHaveLength(0)
  })

  it('stops the dev database when the boot sequence fails before the app starts', async () => {
    vi.mocked(runPrismaCli).mockRejectedValueOnce(new Error('The `prisma` CLI is not installed'))

    await expect(startLoop()).rejects.toThrow('The `prisma` CLI is not installed')
    expect(spawned).toHaveLength(0)
    expect(stop).toHaveBeenCalled()
  })

  it('prints a second loop refusal as a plain message, not the error object', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(startDevDatabase).mockRejectedValueOnce(new DevDatabaseInUseError('/data', 4242))

    await startLoop()

    const printed = error.mock.calls.flat()
    error.mockRestore()
    expect(printed).toHaveLength(1)
    expect(typeof printed[0]).toBe('string')
    expect(printed[0]).toContain('Another `opensaas dev` already holds the dev database')
    expect(process.exitCode).toBe(1)
    expect(spawned).toHaveLength(0)
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
          accessChanges: [],
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
    const ok = await requestDatabaseUpdate(tempDir, 'abc', (message) => said.push(message))

    expect(ok).toBe(false)
    expect(said.join('\n')).toContain('Nothing was staged')
    expect(fs.existsSync(live.contractModule)).toBe(false)

    child.emit('exit', 0, null)
    await pendingLoop
  })

  it('refuses a pack the running Dev database did not load, before planning', async () => {
    child.hold = true
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    startLoop({ appCommand: ['node', 'server.mjs'] })
    await until(() => fs.existsSync(path.join(tempDir, CONTROL_FILE)))

    const withPack = {
      db: {
        provider: 'postgresql',
        extensions: [{ name: 'pgvector', from: '@prisma/orm-extension-pgvector' }],
      },
      lists: {},
    } as never
    vi.mocked(generateCommand).mockImplementationOnce(async (options) => {
      options?.checkConfig?.(withPack)
      throw new Error('generation should have been refused')
    })
    vi.mocked(runPrismaCli).mockClear()

    editConfig()
    watcherHandlers.get('change')?.()
    await until(() => log.mock.calls.some((call) => String(call[0]).includes('Restart')))

    expect(runPrismaCli).not.toHaveBeenCalled()

    child.emit('exit', 0, null)
    await pendingLoop
  })

  it('applies a parked destructive plan only when `db update` names its id', async () => {
    child.hold = true
    const said: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
      said.push(parts.map((part) => String(part)).join(' '))
    })

    const { paths: live } = resolveOutputPaths(tempDir)
    const stagingDir = path.join(tempDir, '.opensaas', 'staged')
    const staged = stageWritePaths(live, stagingDir)
    vi.mocked(generateCommand).mockImplementation(async (options = {}) => {
      if (options.stagingDir === undefined) {
        return {
          paths: live,
          livePaths: live,
          prismaConfig: live.prismaConfig,
          resolvedModules: [],
        }
      }
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
          accessChanges: [],
          dataLoss: [{ text: 'Post.title' }],
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

    editConfig()
    watcherHandlers.get('change')?.()
    await until(() => said.join('\n').includes('db:update --plan'))
    const id = /db:update --plan ([0-9a-f]+)/.exec(said.join('\n'))?.[1]
    expect(id).toBeDefined()
    expect(said.join('\n')).not.toContain('--delete')

    const applyCalls = (): string[][] =>
      vi
        .mocked(runPrismaCli)
        .mock.calls.map(([, args]) => [...args])
        .filter((args) => !args.includes('--dry-run') && args.includes('--no-interactive'))

    const refusedWithoutId: string[] = []
    expect(await requestDatabaseUpdate(tempDir, undefined, (m) => refusedWithoutId.push(m))).toBe(
      false,
    )
    expect(refusedWithoutId.join('\n')).toContain(`--plan ${id}`)

    const refusedWrongId: string[] = []
    expect(await requestDatabaseUpdate(tempDir, 'deadbeef', (m) => refusedWrongId.push(m))).toBe(
      false,
    )
    expect(applyCalls()).toHaveLength(0)
    expect(fs.existsSync(live.contractModule)).toBe(false)

    expect(await requestDatabaseUpdate(tempDir, id, () => {})).toBe(true)
    const applied = applyCalls()
    expect(applied).toHaveLength(1)
    expect(applied[0]).toEqual(expect.arrayContaining(['--delete', 'Post.title']))

    child.emit('exit', 0, null)
    await new Promise((resolve) => setTimeout(resolve, 50))
    child.emit('exit', 0, null)
    await pendingLoop
  })

  /**
   * The loop over the real config loader: a staged generation is whatever the
   * config on disk evaluates to, and the plan is a drop whenever that lost
   * `title` — so a stale load is visible as a stale contract (#2169).
   */
  describe('generating from what is on disk', () => {
    const planFor = (operations: { label: string; operationClass: string }[]): string =>
      JSON.stringify({
        kind: 'result',
        envelope: {
          result: {
            accessChanges: [],
            dataLoss: operations
              .filter((operation) => operation.operationClass === 'destructive')
              .map((operation) => ({ text: operation.label })),
            plan: { operations },
          },
        },
      })

    let said: string[]
    let live: ReturnType<typeof resolveOutputPaths>['paths']
    let staged: ReturnType<typeof stageWritePaths>
    let stagedGenerations: number
    let dropped: boolean
    let beforeLoad: (() => void) | undefined
    let duringGeneration: (() => void) | undefined
    let duringDryRun: (() => void) | undefined
    let duringApply: (() => void) | undefined

    const configFile = (): string => path.join(tempDir, 'opensaas.config.ts')

    const saveFields = (fields: readonly string[]): void => {
      fs.writeFileSync(configFile(), `export default { fields: ${JSON.stringify(fields)} }\n`)
    }

    const listsFile = (): string => path.join(tempDir, 'lists.ts')

    const saveLists = (fields: readonly string[]): void => {
      fs.writeFileSync(listsFile(), `export const fields = ${JSON.stringify(fields)}\n`)
    }

    const splitConfigSource = "import { fields } from './lists.js'\nexport default { fields }\n"

    /** Moves the config onto `lists.ts` through a watched save, so the module is in the graph. */
    const splitTheConfig = async (): Promise<void> => {
      saveLists(['title'])
      await save(() => fs.writeFileSync(configFile(), splitConfigSource))
    }

    /** Fires a save and waits for the reconcile it started to settle. */
    const save = async (write: () => void): Promise<void> => {
      const before = said.length
      write()
      watcherHandlers.get('change')?.()
      await until(() =>
        said
          .slice(before)
          .some((line) => /promoted|Plan id:|keeps serving the contract/.test(line)),
      )
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    const destructiveApplies = (): string[][] =>
      vi
        .mocked(runPrismaCli)
        .mock.calls.map(([, args]) => [...args])
        .filter((args) => args.includes('--delete'))

    const parkedId = (): string | undefined => /Plan id: ([0-9a-f]+)/.exec(said.join('\n'))?.[1]

    beforeEach(async () => {
      child.hold = true
      said = []
      stagedGenerations = 0
      dropped = false
      beforeLoad = undefined
      duringGeneration = undefined
      duringDryRun = undefined
      duringApply = undefined
      vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
        said.push(parts.map((part) => String(part)).join(' '))
      })

      live = resolveOutputPaths(tempDir).paths
      staged = stageWritePaths(live, path.join(tempDir, '.opensaas', 'staged'))

      vi.mocked(generateCommand).mockImplementation(async (options = {}) => {
        if (options.stagingDir === undefined) {
          return {
            paths: live,
            livePaths: live,
            prismaConfig: live.prismaConfig,
            resolvedModules: [],
          }
        }
        const load = beforeLoad
        beforeLoad = undefined
        load?.()
        const { config, resolvedModules } = await loadConfigFromDisk(tempDir, configFile())
        stagedGenerations += 1
        const hook = duringGeneration
        duringGeneration = undefined
        hook?.()
        fs.mkdirSync(path.dirname(staged.contractModule), { recursive: true })
        fs.writeFileSync(staged.contractModule, JSON.stringify(config), 'utf-8')
        fs.mkdirSync(path.dirname(staged.contractJson), { recursive: true })
        fs.writeFileSync(staged.contractJson, JSON.stringify(config), 'utf-8')
        return {
          paths: staged,
          livePaths: live,
          prismaConfig: staged.prismaConfig,
          resolvedModules,
        }
      })

      vi.mocked(runPrismaCli).mockImplementation(async (_cwd, args) => {
        const contract = fs.existsSync(staged.contractModule)
          ? fs.readFileSync(staged.contractModule, 'utf-8')
          : 'title'
        const stdout = planFor(
          contract.includes('title') || dropped
            ? []
            : [
                { label: 'drop Post.title', operationClass: 'destructive' },
                ...(contract.includes('wider')
                  ? [{ label: 'drop Post.wider', operationClass: 'destructive' }]
                  : []),
              ],
        )
        if (args.includes('--dry-run')) {
          const hook = duringDryRun
          duringDryRun = undefined
          hook?.()
        } else if (args.includes('--no-interactive')) {
          const hook = duringApply
          duringApply = undefined
          hook?.()
          if (args.includes('--delete')) dropped = true
        }
        return { exitCode: 0, signal: null, output: stdout, stdout }
      })

      saveFields(['title'])
      startLoop({ appCommand: ['node', 'server.mjs'] })
      await until(() => fs.existsSync(path.join(tempDir, CONTROL_FILE)))
    })

    it('keeps following the config after a save that failed to load', async () => {
      const contract = (): string => fs.readFileSync(live.contractModule, 'utf-8')

      await save(() => fs.writeFileSync(configFile(), 'export default {{{\n'))
      expect(said.join('\n')).toContain('Generation failed')

      await save(() => saveFields(['title', 'c']))
      expect(contract()).toContain('"c"')

      await save(() => saveFields(['title', 'c', 'd']))
      expect(contract()).toContain('"d"')

      await save(() => saveFields(['title', 'c', 'd', 'e']))
      expect(contract()).toContain('"e"')
    })

    it('cancels a parked drop when the config is reverted', async () => {
      const original = fs.readFileSync(configFile(), 'utf-8')

      await save(() => fs.writeFileSync(configFile(), "throw new Error('boom')\n"))
      await save(() => saveFields(['body']))
      const id = parkedId()
      expect(id).toBeDefined()

      said.length = 0
      await save(() => fs.writeFileSync(configFile(), original))
      expect(said.join('\n')).not.toContain('Plan id:')
      expect(fs.readFileSync(live.contractModule, 'utf-8')).toContain('title')

      const replied: string[] = []
      expect(await requestDatabaseUpdate(tempDir, id, (message) => replied.push(message))).toBe(
        false,
      )
      expect(replied.join('\n')).toContain('no longer current')
      expect(destructiveApplies()).toHaveLength(0)
      expect(fs.readFileSync(live.contractModule, 'utf-8')).toContain('title')
    })

    it('refuses a parked plan whose revert the watcher has not reported yet', async () => {
      const original = fs.readFileSync(configFile(), 'utf-8')

      await save(() => saveFields(['body']))
      const id = parkedId()
      expect(id).toBeDefined()

      fs.writeFileSync(configFile(), original)

      const generationsBefore = stagedGenerations
      expect(await requestDatabaseUpdate(tempDir, id, () => {})).toBe(false)
      expect(stagedGenerations).toBe(generationsBefore + 1)
      expect(destructiveApplies()).toHaveLength(0)
      expect(fs.existsSync(live.contractModule)).toBe(false)
    })

    it('refuses a parked plan whose revert inside a split config the watcher has not reported yet', async () => {
      await splitTheConfig()
      await save(() => saveLists(['body']))
      const id = parkedId()
      expect(id).toBeDefined()

      saveLists(['title'])

      expect(await requestDatabaseUpdate(tempDir, id, () => {})).toBe(false)
      expect(destructiveApplies()).toHaveLength(0)
    })

    it('does not take a module revert during the dry run for reconciled, when the watcher parks', async () => {
      await splitTheConfig()
      said.length = 0
      duringDryRun = () => saveLists(['title'])
      await save(() => saveLists(['body']))
      const id = parkedId()
      expect(id).toBeDefined()

      said.length = 0
      await save(() => {})
      expect(said.join('\n')).toContain('promoted')

      expect(await requestDatabaseUpdate(tempDir, id, () => {})).toBe(false)
      expect(destructiveApplies()).toHaveLength(0)
    })

    it('does not take a module revert during generation for reconciled', async () => {
      await splitTheConfig()
      said.length = 0
      duringGeneration = () => saveLists(['title'])
      await save(() => saveLists(['body']))
      const id = parkedId()
      expect(id).toBeDefined()

      expect(await requestDatabaseUpdate(tempDir, id, () => {})).toBe(false)
      expect(destructiveApplies()).toHaveLength(0)
    })

    it('does not take a module revert during the dry run for reconciled, when a request parks', async () => {
      await splitTheConfig()
      saveLists(['body'])
      duringDryRun = () => saveLists(['title'])

      const parking: string[] = []
      expect(await requestDatabaseUpdate(tempDir, undefined, (m) => parking.push(m))).toBe(false)
      const id = /Plan id: ([0-9a-f]+)/.exec(parking.join('\n'))?.[1]
      expect(id).toBeDefined()

      expect(await requestDatabaseUpdate(tempDir, id, () => {})).toBe(false)
      expect(destructiveApplies()).toHaveLength(0)
    })

    it.each([
      ['the watcher', true],
      ['a request', false],
    ])(
      'refuses a drop parked by %s from a new module reverted once it was read',
      async (_, watched) => {
        const v2 = path.join(tempDir, 'lists-v2.ts')
        const writeV2 = (fields: readonly string[]): void => {
          fs.writeFileSync(v2, `export const fields = ${JSON.stringify(fields)}\n`)
        }
        const importV2 = (): void => {
          fs.writeFileSync(
            configFile(),
            "import { fields } from './lists-v2.js'\nexport default { fields }\n",
          )
        }
        writeV2(['body'])
        duringGeneration = () => writeV2(['title'])

        let id: string | undefined
        if (watched) {
          await save(importV2)
          id = parkedId()
        } else {
          importV2()
          const parking: string[] = []
          expect(await requestDatabaseUpdate(tempDir, undefined, (m) => parking.push(m))).toBe(
            false,
          )
          id = /Plan id: ([0-9a-f]+)/.exec(parking.join('\n'))?.[1]
        }
        expect(id).toBeDefined()

        expect(await requestDatabaseUpdate(tempDir, id, () => {})).toBe(false)
        expect(destructiveApplies()).toHaveLength(0)
      },
    )

    it.each([
      ['the config', async (): Promise<(fields: readonly string[]) => void> => saveFields],
      [
        'a module',
        async (): Promise<(fields: readonly string[]) => void> => {
          await splitTheConfig()
          return saveLists
        },
      ],
    ])(
      'refuses a drop generation read from %s between two saves of one staging',
      async (_, prepare) => {
        const write = await prepare()
        write(['title', 'x'])
        beforeLoad = () => write(['body'])
        duringGeneration = () => write(['title', 'x'])

        said.length = 0
        watcherHandlers.get('change')?.()
        await until(() => said.join('\n').includes('Plan id:'))
        const id = parkedId()

        expect(await requestDatabaseUpdate(tempDir, id, () => {})).toBe(false)
        expect(destructiveApplies()).toHaveLength(0)
      },
    )

    it('refuses to apply when a module is reverted during the dry run', async () => {
      await splitTheConfig()
      await save(() => saveLists(['body']))
      const id = parkedId()
      duringDryRun = () => saveLists(['title'])

      const replied: string[] = []
      expect(await requestDatabaseUpdate(tempDir, id, (m) => replied.push(m))).toBe(false)

      expect(replied.join('\n')).toContain('config changed')
      expect(destructiveApplies()).toHaveLength(0)
    })

    it('refuses to apply when the config is reverted during the dry run', async () => {
      const original = fs.readFileSync(configFile(), 'utf-8')
      await save(() => saveFields(['body']))
      const id = parkedId()
      duringDryRun = () => fs.writeFileSync(configFile(), original)

      const replied: string[] = []
      expect(await requestDatabaseUpdate(tempDir, id, (m) => replied.push(m))).toBe(false)

      expect(replied.join('\n')).toContain('config changed')
      expect(destructiveApplies()).toHaveLength(0)
    })

    it('refuses to apply when a module this request first reached is reverted during the dry run', async () => {
      await save(() => saveFields(['body']))
      const id = parkedId()

      saveLists(['body'])
      fs.writeFileSync(configFile(), splitConfigSource)
      duringDryRun = () => saveLists(['title'])

      const replied: string[] = []
      expect(await requestDatabaseUpdate(tempDir, id, (m) => replied.push(m))).toBe(false)

      expect(replied.join('\n')).toContain('config changed')
      expect(destructiveApplies()).toHaveLength(0)
    })

    it('does not refuse a request whose inputs did not move', async () => {
      await splitTheConfig()
      await save(() => saveLists(['body']))

      const replied: string[] = []
      expect(await requestDatabaseUpdate(tempDir, parkedId(), (m) => replied.push(m))).toBe(true)
      expect(replied.join('\n')).not.toContain('config changed')

      child.emit('exit', 0, null)
      await new Promise((resolve) => setTimeout(resolve, 50))
      child.emit('exit', 0, null)
      await pendingLoop
    })

    it('watches a module first reached by a generation a request parked', async () => {
      saveLists(['body'])
      fs.writeFileSync(configFile(), splitConfigSource)
      const parking: string[] = []
      expect(await requestDatabaseUpdate(tempDir, undefined, (m) => parking.push(m))).toBe(false)
      const id = /Plan id: ([0-9a-f]+)/.exec(parking.join('\n'))?.[1]
      expect(watcherApi.add).toHaveBeenCalledWith([listsFile()])

      saveLists(['title'])

      expect(await requestDatabaseUpdate(tempDir, id, () => {})).toBe(false)
      expect(destructiveApplies()).toHaveLength(0)
    })

    it.each([
      ['the config', () => saveFields(['title', 'late'])],
      ['a module', () => saveLists(['title', 'late'])],
    ])('reconciles a save to %s that lands during a request apply', async (_, write) => {
      await splitTheConfig()
      saveLists(['title', 'first'])
      duringApply = write

      expect(await requestDatabaseUpdate(tempDir, undefined, () => {})).toBe(true)

      said.length = 0
      await save(() => {})
      expect(fs.readFileSync(live.contractModule, 'utf-8')).toContain('late')
    })

    it('reconciles a module save that lands during a watched generation', async () => {
      await splitTheConfig()
      duringGeneration = () => saveLists(['title', 'late'])
      await save(() => saveLists(['title', 'first']))

      said.length = 0
      await save(() => {})
      expect(fs.readFileSync(live.contractModule, 'utf-8')).toContain('late')
    })

    it('reconciles a module save that lands during a watched apply', async () => {
      await splitTheConfig()
      duringApply = () => saveLists(['title', 'late'])
      await save(() => saveLists(['title', 'first']))

      said.length = 0
      await save(() => {})
      expect(fs.readFileSync(live.contractModule, 'utf-8')).toContain('late')
    })

    describe('after an apply that could not promote', () => {
      const blockPromotion = (): void => {
        fs.mkdirSync(live.contractJson, { recursive: true })
      }
      const unblockPromotion = (): void => {
        fs.rmSync(live.contractJson, { recursive: true, force: true })
      }

      const failedApply = async (): Promise<{ id: string | undefined; replied: string }> => {
        await save(() => saveFields(['body']))
        const id = parkedId()
        blockPromotion()
        const replied: string[] = []
        expect(await requestDatabaseUpdate(tempDir, id, (m) => replied.push(m))).toBe(false)
        expect(destructiveApplies()).toHaveLength(1)
        expect(dropped).toBe(true)
        return { id, replied: replied.join('\n') }
      }

      const expectRecovered = async (): Promise<void> => {
        expect(fs.readFileSync(live.contractJson, 'utf-8')).toContain('body')
        expect(fs.existsSync(path.join(tempDir, '.opensaas', 'staged'))).toBe(false)

        const spawnedBefore = spawned.length
        child.emit('exit', 0, null)
        await until(() => spawned.length === spawnedBefore + 1)
        child.emit('exit', 0, null)
        await pendingLoop
      }

      it('names the route that recovers, and that route works', async () => {
        const { replied } = await failedApply()
        expect(replied).toContain('pnpm db:update')
        expect(replied).not.toContain('opensaas generate')

        unblockPromotion()
        expect(await requestDatabaseUpdate(tempDir, undefined, () => {})).toBe(true)
        await expectRecovered()
      })

      it('recovers when the same --plan is retried', async () => {
        const { id } = await failedApply()

        unblockPromotion()
        const replied: string[] = []
        expect(await requestDatabaseUpdate(tempDir, id, (m) => replied.push(m))).toBe(true)
        expect(replied.join('\n')).toContain('Applied, promoted')
        expect(await requestDatabaseUpdate(tempDir, id, () => {})).toBe(false)

        const afterwards: string[] = []
        expect(await requestDatabaseUpdate(tempDir, undefined, (m) => afterwards.push(m))).toBe(
          true,
        )
        expect(afterwards.join('\n')).not.toContain('Restarting the app')
        await expectRecovered()
      })

      it('still recovers through the same --plan after a second failure', async () => {
        const { id } = await failedApply()

        expect(await requestDatabaseUpdate(tempDir, id, () => {})).toBe(false)

        unblockPromotion()
        expect(await requestDatabaseUpdate(tempDir, id, () => {})).toBe(true)
        await expectRecovered()
      })

      it('restarts the app when a watched save finishes the promote', async () => {
        await failedApply()

        unblockPromotion()
        said.length = 0
        await save(() => saveFields(['body', 'next']))
        expect(said.join('\n')).toContain('Restarting the app')
        expect(fs.readFileSync(live.contractJson, 'utf-8')).toContain('next')

        const spawnedBefore = spawned.length
        child.emit('exit', 0, null)
        await until(() => spawned.length === spawnedBefore + 1)
        child.emit('exit', 0, null)
        await pendingLoop
      })

      it('refuses the old id once the config wants something else', async () => {
        const { id } = await failedApply()

        unblockPromotion()
        const additive = planFor([{ label: 'add Post.sku', operationClass: 'additive' }])
        vi.mocked(runPrismaCli).mockImplementation(async () => ({
          exitCode: 0,
          signal: null,
          output: additive,
          stdout: additive,
        }))
        vi.mocked(runPrismaCli).mockClear()

        expect(await requestDatabaseUpdate(tempDir, id, () => {})).toBe(false)
        expect(
          vi.mocked(runPrismaCli).mock.calls.filter(([, args]) => !args.includes('--dry-run')),
        ).toHaveLength(0)
      })

      it('still refuses any other id', async () => {
        await failedApply()

        unblockPromotion()
        expect(await requestDatabaseUpdate(tempDir, 'deadbeef', () => {})).toBe(false)
        expect(fs.statSync(live.contractModule).isFile()).toBe(true)
        expect(fs.existsSync(live.contractJson)).toBe(false)
      })
    })

    it('stops advertising a parked id once the plan has moved', async () => {
      await save(() => saveFields(['body']))
      const id = parkedId()
      dropped = true

      expect(await requestDatabaseUpdate(tempDir, id, () => {})).toBe(false)

      expect(fs.existsSync(path.join(tempDir, '.opensaas', 'staged'))).toBe(false)

      said.length = 0
      await save(() => {})
      expect(said.join('\n')).not.toContain('--plan')
    })

    it('refuses a parked id when the config now wants a different drop, and names the new one', async () => {
      await save(() => saveFields(['body']))
      const id = parkedId()

      saveFields(['body', 'wider'])

      const replied: string[] = []
      expect(await requestDatabaseUpdate(tempDir, id, (message) => replied.push(message))).toBe(
        false,
      )
      expect(destructiveApplies()).toHaveLength(0)
      const current = /--plan ([0-9a-f]+)/.exec(replied.join('\n'))?.[1]
      expect(current).toBeDefined()
      expect(current).not.toBe(id)
    })

    it('applies a parked plan when the config still wants it', async () => {
      await save(() => saveFields(['body']))
      const id = parkedId()

      expect(await requestDatabaseUpdate(tempDir, id, () => {})).toBe(true)
      expect(destructiveApplies()).toHaveLength(1)
      expect(fs.readFileSync(live.contractModule, 'utf-8')).toContain('body')

      child.emit('exit', 0, null)
      await new Promise((resolve) => setTimeout(resolve, 50))
      child.emit('exit', 0, null)
      await pendingLoop
    })

    it('refuses an id that is not the current plan even when the plan is additive', async () => {
      const additive = planFor([{ label: 'add Post.body', operationClass: 'additive' }])
      vi.mocked(runPrismaCli).mockImplementation(async () => ({
        exitCode: 0,
        signal: null,
        output: additive,
        stdout: additive,
      }))
      vi.mocked(runPrismaCli).mockClear()

      const replied: string[] = []
      expect(
        await requestDatabaseUpdate(tempDir, 'deadbeef', (message) => replied.push(message)),
      ).toBe(false)

      expect(replied.join('\n')).toContain('not the current plan')
      expect(
        vi.mocked(runPrismaCli).mock.calls.filter(([, args]) => !args.includes('--dry-run')),
      ).toHaveLength(0)
      expect(fs.existsSync(path.join(tempDir, '.opensaas', 'staged'))).toBe(false)
      expect(await requestDatabaseUpdate(tempDir, undefined, () => {})).toBe(true)
    })
  })

  describe('an additive mid-session change against an environment database', () => {
    const additivePlan = JSON.stringify({
      kind: 'result',
      envelope: {
        result: { plan: { operations: [{ label: 'add Item.sku', operationClass: 'additive' }] } },
      },
    })
    const emptyPlan = JSON.stringify({
      kind: 'result',
      envelope: { result: { plan: { operations: [] } } },
    })

    const runChange = async (yes: boolean): Promise<{ said: string; applies: number }> => {
      child.hold = true
      vi.stubEnv('OPENSAAS_DEV_YES', '')
      vi.mocked(findDatabaseConnection).mockReturnValueOnce({
        url: 'postgres://someone@example.test:5432/inherited',
        provenance: 'env',
      })
      process.env.DATABASE_URL = 'postgres://someone@example.test:5432/inherited'
      const said: string[] = []
      vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
        said.push(parts.map((part) => String(part)).join(' '))
      })
      const { paths: live } = resolveOutputPaths(tempDir)
      const staged = stageWritePaths(live, path.join(tempDir, '.opensaas', 'staged'))
      vi.mocked(generateCommand).mockImplementation(async (options = {}) => {
        const paths = options.stagingDir === undefined ? live : staged
        return { paths, livePaths: live, prismaConfig: paths.prismaConfig, resolvedModules: [] }
      })
      let startupPlanned = false
      let applies = 0
      vi.mocked(runPrismaCli).mockImplementation(async (_cwd, args) => {
        const dry = args.includes('--dry-run')
        if (!dry) applies += 1
        const output = dry && !startupPlanned && !yes ? emptyPlan : additivePlan
        if (dry) startupPlanned = true
        return { exitCode: 0, signal: null, output, stdout: output }
      })

      startLoop({ appCommand: ['node', 'server.mjs'], yes })
      await until(() => fs.existsSync(path.join(tempDir, CONTROL_FILE)))
      const appliesAtBoot = applies
      editConfig()
      watcherHandlers.get('change')?.()
      await until(() => /Database updated|db:update --plan/.test(said.join('\n')))
      const result = { said: said.join('\n'), applies: applies - appliesAtBoot }
      child.emit('exit', 0, null)
      await new Promise((resolve) => setTimeout(resolve, 50))
      child.emit('exit', 0, null)
      await pendingLoop
      return result
    }

    it('applies a parked plan through the route the loop printed', async () => {
      child.hold = true
      vi.stubEnv('OPENSAAS_DEV_YES', '')
      vi.mocked(findDatabaseConnection).mockReturnValueOnce({
        url: 'postgres://someone@example.test:5432/inherited',
        provenance: 'env',
      })
      process.env.DATABASE_URL = 'postgres://someone@example.test:5432/inherited'
      const said: string[] = []
      vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
        said.push(parts.map((part) => String(part)).join(' '))
      })
      const { paths: live } = resolveOutputPaths(tempDir)
      const staged = stageWritePaths(live, path.join(tempDir, '.opensaas', 'staged'))
      vi.mocked(generateCommand).mockImplementation(async (options = {}) => {
        const paths = options.stagingDir === undefined ? live : staged
        return { paths, livePaths: live, prismaConfig: paths.prismaConfig, resolvedModules: [] }
      })
      let startupPlanned = false
      let applies = 0
      vi.mocked(runPrismaCli).mockImplementation(async (_cwd, args) => {
        const dry = args.includes('--dry-run')
        if (args.includes('--no-interactive') && !dry) applies += 1
        const output = dry && !startupPlanned ? emptyPlan : additivePlan
        if (dry) startupPlanned = true
        return { exitCode: 0, signal: null, output, stdout: output }
      })

      startLoop({ appCommand: ['node', 'server.mjs'] })
      await until(() => fs.existsSync(path.join(tempDir, CONTROL_FILE)))
      editConfig()
      watcherHandlers.get('change')?.()
      await until(() => said.join('\n').includes('db:update --plan'))
      const id = /db:update --plan ([0-9a-f]+)/.exec(said.join('\n'))?.[1]
      expect(applies).toBe(0)

      expect(await requestDatabaseUpdate(tempDir, 'deadbeef', () => {})).toBe(false)
      expect(applies).toBe(0)

      expect(await requestDatabaseUpdate(tempDir, id, () => {})).toBe(true)
      expect(applies).toBe(1)

      child.emit('exit', 0, null)
      await pendingLoop
    })

    it('parks the plan when the session was not started with --yes', async () => {
      const { said, applies } = await runChange(false)
      expect(said).toContain('db:update --plan')
      expect(said).not.toContain('Database updated')
      expect(applies).toBe(0)
    })

    it('applies the plan when the session was started with --yes', async () => {
      const { said, applies } = await runChange(true)
      expect(said).toContain('Database updated')
      expect(applies).toBe(1)
    })
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
          accessChanges: [],
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
        envelope: { result: { accessChanges: [], plan: { operations: [] } } },
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
    vi.mocked(runPrismaCli).mockResolvedValueOnce({
      exitCode: 2,
      signal: null,
      output: '',
      stdout: '',
    })

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
          envelope: { result: { accessChanges: [], plan: { operations: [] } } },
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
          envelope: { result: { accessChanges: [], plan: { operations: [] } } },
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

    it('captures the boot module snapshot before the interactive reconcile can block on it', async () => {
      child.hold = true
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

      let releaseReconcile: () => void = () => {}
      const reconcileGate = new Promise<void>((resolve) => {
        releaseReconcile = resolve
      })
      vi.mocked(runPrismaCli).mockImplementation(async () => {
        await reconcileGate
        return { exitCode: 0, signal: null, output: '', stdout: '' }
      })

      startLoop({ appCommand: ['node', 'server.mjs'] })

      // The boot reconcile is now blocked — standing in for Prisma's real
      // destructive-change consent prompt. Edit the watched module while it
      // waits, the way a developer could during that prompt.
      await new Promise((resolve) => setTimeout(resolve, 20))
      fs.writeFileSync(modulePath, 'export const client = 2\n')
      releaseReconcile()

      await until(() => fs.existsSync(path.join(tempDir, CONTROL_FILE)))

      const said: string[] = []
      const log = vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
        said.push(parts.map((part) => String(part)).join(' '))
      })

      // The module changed while boot was still blocked on the prompt, so
      // this event must reconcile — not report nothing changed.
      watcherHandlers.get('change')?.()
      await until(() => said.length > 0)

      expect(said.join('\n')).not.toContain('Config saved with no change')

      log.mockRestore()
      child.emit('exit', 0, null)
      await pendingLoop
    })

    it('does not move the watched module set onto a generation whose dry run failed', async () => {
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
      // The boot reconcile succeeds; the staged generation's dry run fails.
      let prismaCalls = 0
      vi.mocked(runPrismaCli).mockImplementation(async () => {
        prismaCalls += 1
        if (prismaCalls === 1) return { exitCode: 0, signal: null, output: '', stdout: '' }
        return { exitCode: 1, signal: null, output: 'database is not reachable', stdout: '' }
      })

      const said: string[] = []
      const error = vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
        said.push(parts.map((part) => String(part)).join(' '))
      })

      startLoop({ appCommand: ['node', 'server.mjs'] })
      await until(() => fs.existsSync(path.join(tempDir, CONTROL_FILE)))

      editConfig()
      watcherHandlers.get('change')?.()
      await until(() => said.join('\n').includes('did not apply'))
      expect(stagedGenerations).toBe(1)

      // The staged generation named moduleB, but its dry run never applied —
      // the live watch must still be exactly what it was at boot.
      expect(watcherApi.add).not.toHaveBeenCalled()
      expect(watcherApi.unwatch).not.toHaveBeenCalled()

      error.mockRestore()
      child.emit('exit', 0, null)
      await pendingLoop
    })

    it('syncs the watched module set when `db update` runs its own fresh generation', async () => {
      child.hold = true
      const moduleA = path.join(tempDir, 'a.ts')
      const moduleB = path.join(tempDir, 'b.ts')
      fs.writeFileSync(moduleA, 'export const a = 1\n')

      const { paths: live } = resolveOutputPaths(tempDir)
      const staged = stageWritePaths(live, path.join(tempDir, '.opensaas', 'staged'))

      vi.mocked(generateCommand).mockImplementation(async (options = {}) => {
        if (options.stagingDir === undefined) {
          return {
            paths: live,
            livePaths: live,
            prismaConfig: live.prismaConfig,
            resolvedModules: [moduleA],
          }
        }
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
          envelope: { result: { accessChanges: [], plan: { operations: [] } } },
        })
        return { exitCode: 0, signal: null, output: plan, stdout: plan }
      })

      startLoop({ appCommand: ['node', 'server.mjs'] })
      await until(() => fs.existsSync(path.join(tempDir, CONTROL_FILE)))

      // No prior config edit — `staged` is undefined, so this drives its own
      // fresh stage rather than reusing a parked one.
      const ok = await requestDatabaseUpdate(tempDir, undefined, () => {})
      expect(ok).toBe(true)

      expect(watcherApi.add).toHaveBeenCalledWith([moduleB])
      expect(watcherApi.unwatch).toHaveBeenCalledWith([moduleA])

      child.emit('exit', 0, null)
      await pendingLoop
    })
  })
})
