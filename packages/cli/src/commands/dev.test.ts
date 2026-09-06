import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    setTimeout(() => child.emit('exit', 0, null), 0)
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

vi.mock('./generate.js', () => ({ generateCommand: vi.fn().mockResolvedValue(undefined) }))

vi.mock('../generator/index.js', () => ({
  loadOpenSaasConfig: vi.fn().mockResolvedValue({
    config: { db: { provider: 'postgresql' }, lists: {} },
    aliasWarnings: [],
  }),
  runPrismaCli: vi.fn().mockResolvedValue({ exitCode: 0, signal: null, output: '' }),
}))

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({ on: vi.fn(), close: vi.fn().mockResolvedValue(undefined) })),
  },
}))

describe('devCommand', () => {
  let tempDir: string
  let originalCwd: string
  let exitCode: number | undefined
  let originalExit: typeof process.exit
  let originalDatabaseUrl: string | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    spawned.length = 0

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

  afterEach(() => {
    process.chdir(originalCwd)
    process.exit = originalExit
    process.exitCode = 0
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = originalDatabaseUrl
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('refuses a directory with no opensaas.config.ts', async () => {
    fs.unlinkSync(path.join(tempDir, 'opensaas.config.ts'))
    const { devCommand } = await import('./dev.js')

    await expect(devCommand()).rejects.toThrow('process.exit(1)')
    expect(exitCode).toBe(1)
  })

  it('runs `next dev` when the invocation names no command', async () => {
    const { devCommand } = await import('./dev.js')

    await devCommand()

    expect(spawned).toHaveLength(1)
    expect(spawned[0]?.file).toBe('next')
    expect(spawned[0]?.args).toEqual(['dev'])
  })

  it('runs the command given after `--`, and hands the child no database URL', async () => {
    process.env.DATABASE_URL = 'postgres://someone@example.test:5432/inherited'
    const { devCommand } = await import('./dev.js')

    await devCommand({ appCommand: ['node', 'server.mjs'] })

    expect(spawned[0]?.file).toBe('node')
    expect(spawned[0]?.args).toEqual(['server.mjs'])
    expect(spawned[0]?.env.DATABASE_URL).toBeUndefined()
    expect(stop).toHaveBeenCalled()
  })

  it('starts no dev database and passes the environment through when a URL is already resolved', async () => {
    const { findDatabaseConnection } = await import('@opensaas/stack-core/internal')
    vi.mocked(findDatabaseConnection).mockReturnValueOnce({
      url: 'postgres://someone@example.test:5432/inherited',
      provenance: 'env',
    })
    const { startDevDatabase } = await import('@opensaas/stack-core/dev-database')
    process.env.DATABASE_URL = 'postgres://someone@example.test:5432/inherited'

    const { devCommand } = await import('./dev.js')
    await devCommand({ appCommand: ['node', 'server.mjs'] })

    expect(startDevDatabase).not.toHaveBeenCalled()
    expect(spawned[0]?.env.DATABASE_URL).toBe('postgres://someone@example.test:5432/inherited')
  })

  it('does not start the app when reconciliation does not apply', async () => {
    const { runPrismaCli } = await import('../generator/index.js')
    vi.mocked(runPrismaCli).mockResolvedValueOnce({ exitCode: 2, signal: null, output: '' })

    const { devCommand } = await import('./dev.js')
    await devCommand()

    expect(spawned).toHaveLength(0)
    expect(process.exitCode).toBe(1)
    expect(stop).toHaveBeenCalled()
  })
})
