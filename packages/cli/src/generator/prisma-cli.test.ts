import { describe, expect, test, vi } from 'vitest'
import * as path from 'path'
import { fileURLToPath } from 'url'

const spawnCalls = vi.hoisted(() => {
  const calls: { command: string; args: string[]; options: { stdio?: unknown } }[] = []
  return calls
})

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    spawn: (command: string, args: string[], options: { stdio?: unknown }) => {
      spawnCalls.push({ command, args, options })
      return actual.spawn(command, args, options)
    },
  }
})

const { runPrismaCli } = await import('./prisma-cli.js')

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('runPrismaCli', () => {
  test('keeps the event loop turning while the CLI runs', async () => {
    const order: string[] = []

    const run = runPrismaCli(packageRoot, ['--version']).then((result) => {
      order.push('prisma')
      return result
    })
    const timer = new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() => {
      order.push('timer')
    })

    const [result] = await Promise.all([run, timer])

    // A `spawnSync` here would block the event loop the Dev database's socket
    // server is served on, and deadlock the loop's first `db update`
    // (ADR-0063) — a timer that never got to run is what that looks like.
    expect(order).toEqual(['timer', 'prisma'])
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('8.0.0-rc')
  }, 120_000)

  test('closes stdin on a captured run and inherits it on an interactive one', async () => {
    spawnCalls.length = 0

    await runPrismaCli(packageRoot, ['--version'])
    await runPrismaCli(packageRoot, ['--version'], 'interactive')

    expect(spawnCalls).toHaveLength(2)
    expect(spawnCalls[0]?.options.stdio).toEqual(['ignore', 'pipe', 'pipe'])
    expect(spawnCalls[1]?.options.stdio).toBe('inherit')
  }, 120_000)
})
