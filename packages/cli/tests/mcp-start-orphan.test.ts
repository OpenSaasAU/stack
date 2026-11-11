import { describe, it, expect, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'opensaas.js')

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitDead(pid: number, ms: number): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (!alive(pid)) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return !alive(pid)
}

function childPids(parent: number): Promise<number[]> {
  return new Promise((resolve) => {
    const ps = spawn('pgrep', ['-P', String(parent)])
    let out = ''
    ps.stdout.on('data', (d) => (out += d))
    ps.on('close', () => resolve(out.split('\n').filter(Boolean).map(Number)))
  })
}

const cleanup: Array<() => void> = []

afterEach(() => {
  for (const fn of cleanup.splice(0)) fn()
})

async function startAndFindChild() {
  const parent = spawn(process.execPath, [bin, 'mcp', 'start'], { stdio: ['pipe', 'pipe', 'pipe'] })
  let pids: number[] = []
  cleanup.push(() => {
    parent.kill('SIGKILL')
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {}
    }
  })
  for (let i = 0; i < 100 && pids.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 100))
    pids = await childPids(parent.pid!)
  }
  expect(pids.length).toBeGreaterThan(0)
  return { parent, child: pids[0] }
}

describe('opensaas mcp start', () => {
  it('leaves no server process after SIGTERM to the parent', async () => {
    const { parent, child } = await startAndFindChild()
    parent.kill('SIGTERM')
    expect(await waitDead(child, 10000)).toBe(true)
  }, 30000)

  it('leaves no server process after stdin closes', async () => {
    const { parent, child } = await startAndFindChild()
    parent.stdin!.end()
    expect(await waitDead(child, 10000)).toBe(true)
  }, 30000)
})
