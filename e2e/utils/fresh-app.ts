import { spawn, type ChildProcess } from 'node:child_process'
import * as net from 'node:net'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { startDevDatabase, type DevDatabase } from '@opensaas/stack-core/dev-database'
import { runPrismaCli } from '@opensaas/stack-cli/generator'
import { REQUIRED_ENV } from './required-env.js'

export type FreshAppMode = 'production' | 'dev'

export interface FreshApp {
  readonly baseURL: string
  stop(): Promise<void>
}

const exampleDir = path.join(process.cwd(), 'examples', 'starter-auth')

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

async function waitForServer(port: number, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let exited: number | null | undefined
  child.once('exit', (code) => {
    exited = code
  })
  while (Date.now() < deadline) {
    if (exited !== undefined) throw new Error(`The app exited with ${exited} before it served.`)
    if (await canConnect(port)) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Nothing listened on port ${port} within ${timeoutMs} ms.`)
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    return
  }
  await exited
}

/**
 * A starter-auth server on `port` over a database no request has touched, so
 * the first thing a test sends is the process's first database touch. Production
 * mode serves the build the Playwright webServer already made.
 */
export async function startFreshApp(mode: FreshAppMode, port: number): Promise<FreshApp> {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opensaas-fresh-app-'))
  const stateFile = path.join(stateDir, 'dev-db.json')
  const database: DevDatabase = await startDevDatabase({ extensions: ['vector'], stateFile })
  const baseURL = `http://localhost:${port}`
  const lookup = {
    OPENSAAS_DEV_DATABASE_STATE_FILE: stateFile,
    DATABASE_URL: '',
    DIRECT_DATABASE_URL: '',
  }
  const env: typeof process.env = {
    ...process.env,
    ...Object.fromEntries(REQUIRED_ENV),
    ...lookup,
    BETTER_AUTH_URL: baseURL,
    DISABLE_RATE_LIMITING: 'true',
  }
  let child: ChildProcess | undefined
  try {
    const prior = Object.fromEntries(Object.keys(lookup).map((key) => [key, process.env[key]]))
    Object.assign(process.env, lookup)
    try {
      const update = await runPrismaCli(exampleDir, ['db', 'update'])
      if (update.exitCode !== 0) throw new Error(`prisma db update failed.\n${update.output}`)
    } finally {
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }

    child = spawn('pnpm', ['exec', 'next', mode === 'dev' ? 'dev' : 'start', '-p', String(port)], {
      cwd: exampleDir,
      env,
      stdio: 'inherit',
      detached: true,
    })
    await waitForServer(port, child, 150_000)
  } catch (error) {
    if (child !== undefined) await stopProcess(child)
    await database.stop()
    fs.rmSync(stateDir, { recursive: true, force: true })
    throw error
  }
  const started = child
  return {
    baseURL,
    stop: async () => {
      await stopProcess(started)
      await database.stop()
      fs.rmSync(stateDir, { recursive: true, force: true })
    },
  }
}
