import * as path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

interface FakeChild {
  exitCode: number | null
  signalCode: string | null
  kill: (signal: string) => boolean
  once: (event: string, handler: (...args: unknown[]) => void) => FakeChild
  emit: (event: string, ...args: unknown[]) => void
}

interface SpawnCall {
  file: string
  args: readonly string[]
  options: { shell?: boolean; env?: typeof process.env }
}

const children = vi.hoisted(() => [] as FakeChild[])
const spawnCalls = vi.hoisted(() => [] as SpawnCall[])

vi.mock('child_process', () => ({
  spawn: (file: string, args: readonly string[], options: SpawnCall['options']) => {
    spawnCalls.push({ file, args, options })
    const handlers = new Map<string, ((...args: unknown[]) => void)[]>()
    const child: FakeChild = {
      exitCode: null,
      signalCode: null,
      kill: () => true,
      once(event, handler) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler])
        return child
      },
      emit(event, ...args) {
        for (const handler of handlers.get(event) ?? []) handler(...args)
      },
    }
    children.push(child)
    return child
  },
}))

describe('the dev loop app child', () => {
  it('replaces the child when the loop asks for a restart', async () => {
    children.length = 0
    const { createAppRunner } = await import('./app-runner.js')
    const app = createAppRunner({
      cwd: process.cwd(),
      command: ['node', 'app.mjs'],
      devDatabase: true,
    })

    const run = app.run()
    app.restart()
    children[0]?.emit('exit', null, 'SIGTERM')

    expect(children).toHaveLength(2)

    children[1]?.emit('exit', 0, null)
    expect(await run).toBe(0)
  })

  it('shuts down rather than respawning when a signal lands inside the restart window', async () => {
    children.length = 0
    const { createAppRunner } = await import('./app-runner.js')
    const app = createAppRunner({
      cwd: process.cwd(),
      command: ['node', 'app.mjs'],
      devDatabase: true,
    })

    const run = app.run()
    app.restart()
    app.kill('SIGINT')
    children[0]?.emit('exit', null, 'SIGINT')

    expect(children).toHaveLength(1)
    expect(await run).toBe(1)
  })

  it.skipIf(process.platform === 'win32')(
    'spawns the app child with no shell on POSIX',
    async () => {
      children.length = 0
      spawnCalls.length = 0
      const { createAppRunner } = await import('./app-runner.js')
      const app = createAppRunner({
        cwd: process.cwd(),
        command: ['node', 'app.mjs', '--flag'],
        devDatabase: true,
      })

      const run = app.run()
      expect(spawnCalls).toHaveLength(1)
      expect(spawnCalls[0]?.file).toBe('node')
      expect(spawnCalls[0]?.args).toEqual(['app.mjs', '--flag'])
      expect(spawnCalls[0]?.options.shell).toBe(false)

      children[0]?.emit('exit', 0, null)
      expect(await run).toBe(0)
    },
  )
})

describe('extendPathEnv', () => {
  it('extends an uppercase PATH under its own key', async () => {
    const { extendPathEnv } = await import('./app-runner.js')
    const result = extendPathEnv('/project', { PATH: '/usr/bin' })
    expect(result.key).toBe('PATH')
    expect(result.value.endsWith('/usr/bin')).toBe(true)
    expect(result.value).toContain('/project/node_modules/.bin')
  })

  it('extends a Windows-cased Path under its own key, introducing no PATH duplicate', async () => {
    const { extendPathEnv } = await import('./app-runner.js')
    const result = extendPathEnv('C:\\project', { Path: 'C:\\Windows' })
    expect(result.key).toBe('Path')
    expect(result.value).toContain('C:\\Windows')
  })

  it('defaults to PATH when the environment carries no path key at all', async () => {
    const { extendPathEnv } = await import('./app-runner.js')
    const result = extendPathEnv('/project', {})
    expect(result.key).toBe('PATH')
  })

  it('walks every node_modules/.bin up to the filesystem root', async () => {
    const { extendPathEnv } = await import('./app-runner.js')
    const result = extendPathEnv('/a/b', { PATH: '' })
    const entries = result.value.split(path.delimiter)
    expect(entries).toContain('/a/b/node_modules/.bin')
    expect(entries).toContain('/a/node_modules/.bin')
    expect(entries).toContain('/node_modules/.bin')
  })
})

describe('needsShell', () => {
  it('is false on POSIX regardless of the resolved file', async () => {
    const { needsShell } = await import('./app-runner.js')
    expect(needsShell('next', 'linux')).toBe(false)
    expect(needsShell('next.cmd', 'darwin')).toBe(false)
  })

  it('is true on Windows for an unresolved command name', async () => {
    const { needsShell } = await import('./app-runner.js')
    expect(needsShell('next', 'win32')).toBe(true)
  })

  it('is true on Windows for a .cmd or .bat shim', async () => {
    const { needsShell } = await import('./app-runner.js')
    expect(needsShell('next.cmd', 'win32')).toBe(true)
    expect(needsShell('next.bat', 'win32')).toBe(true)
    expect(needsShell('NEXT.CMD', 'win32')).toBe(true)
  })

  it('is false on Windows for a real executable', async () => {
    const { needsShell } = await import('./app-runner.js')
    expect(needsShell('node.exe', 'win32')).toBe(false)
  })
})
