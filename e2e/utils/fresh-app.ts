import { spawn, type ChildProcess } from 'node:child_process'
import * as net from 'node:net'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { startDevDatabase, type DevDatabase } from '@opensaas/stack-core/dev-database'
import { runPrismaCli } from '@opensaas/stack-cli/generator'
import pg from 'pg'
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

function externalPostgresUrl(): string | undefined {
  const base = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL
  return base !== undefined && /^postgres(ql)?:\/\//.test(base) ? base : undefined
}

/**
 * `next dev` finds a Dev database only through the project's own state file,
 * which the shared server may already hold, so under it a fresh database needs
 * a Postgres named by `DATABASE_URL`.
 */
export function canStartFreshApp(mode: FreshAppMode): boolean {
  return mode === 'production' || externalPostgresUrl() !== undefined
}

interface Provisioned {
  readonly databaseUrl: string
  readonly env: Record<string, string>
  stop(): Promise<void>
}

async function provisionExternal(base: string, port: number): Promise<Provisioned> {
  const name = `first_touch_${port}_${Date.now()}`
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  try {
    await admin.query(`create database "${name}"`)
  } finally {
    await admin.end()
  }
  const url = new URL(base)
  url.pathname = `/${name}`
  return {
    databaseUrl: url.toString(),
    env: { DATABASE_URL: url.toString(), DIRECT_DATABASE_URL: '' },
    stop: async () => {
      const dropper = new pg.Client({ connectionString: base })
      await dropper.connect()
      try {
        await dropper.query(`drop database if exists "${name}" with (force)`)
      } finally {
        await dropper.end()
      }
    },
  }
}

async function provisionSidecar(): Promise<Provisioned> {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opensaas-fresh-app-'))
  const stateFile = path.join(stateDir, 'dev-db.json')
  const database: DevDatabase = await startDevDatabase({ extensions: ['vector'], stateFile })
  return {
    databaseUrl: database.url,
    env: {
      NODE_ENV: 'production',
      OPENSAAS_DEV_DATABASE_STATE_FILE: stateFile,
      DATABASE_URL: '',
      DIRECT_DATABASE_URL: '',
    },
    stop: async () => {
      await database.stop()
      fs.rmSync(stateDir, { recursive: true, force: true })
    },
  }
}

/**
 * A starter-auth server on `port` over a database no request has touched, so
 * the first thing a test sends is the process's first database touch. Production
 * mode serves the build the Playwright webServer already made.
 */
export async function startFreshApp(mode: FreshAppMode, port: number): Promise<FreshApp> {
  const external = externalPostgresUrl()
  const database =
    external !== undefined ? await provisionExternal(external, port) : await provisionSidecar()
  const baseURL = `http://localhost:${port}`
  const env: typeof process.env = {
    ...process.env,
    ...Object.fromEntries(REQUIRED_ENV),
    ...database.env,
    BETTER_AUTH_URL: baseURL,
    DISABLE_RATE_LIMITING: 'true',
  }
  let child: ChildProcess | undefined
  try {
    const update = await runPrismaCli(exampleDir, ['db', 'update', '--db', database.databaseUrl])
    if (update.exitCode !== 0) throw new Error(`prisma db update failed.\n${update.output}`)

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
    throw error
  }
  const started = child
  return {
    baseURL,
    stop: async () => {
      await stopProcess(started)
      await database.stop()
    },
  }
}
