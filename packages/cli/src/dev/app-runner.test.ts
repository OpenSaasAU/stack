import { describe, expect, it, vi } from 'vitest'

interface FakeChild {
  exitCode: number | null
  signalCode: string | null
  kill: (signal: string) => boolean
  once: (event: string, handler: (...args: unknown[]) => void) => FakeChild
  emit: (event: string, ...args: unknown[]) => void
}

const children = vi.hoisted(() => [] as FakeChild[])

vi.mock('child_process', () => ({
  spawn: () => {
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
})
