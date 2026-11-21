import { spawn, type ChildProcess } from 'node:child_process'
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

async function waitForServer(url: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let exited: number | null | undefined
  child.once('exit', (code) => {
    exited = code
  })
  while (Date.now() < deadline) {
    if (exited !== undefined) throw new Error(`The app exited with ${exited} before it served.`)
    try {
      const response = await fetch(url)
      if (response.status < 500) return
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`${url} did not serve within ${timeoutMs} ms.`)
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) return
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  process.kill(-child.pid, 'SIGTERM')
  await exited
}

/**
 * A starter-auth server on `port` over a database no request has touched, so
 * the first thing a test sends is the process's first database touch. Production
 * mode serves the build the Playwright webServer already made.
 */
export async function startFreshApp(mode: FreshAppMode, port: number): Promise<FreshApp> {
  const database: DevDatabase = await startDevDatabase({ extensions: ['vector'] })
  const baseURL = `http://localhost:${port}`
  const env: typeof process.env = {
    ...process.env,
    ...Object.fromEntries(REQUIRED_ENV),
    DATABASE_URL: database.url,
    DIRECT_DATABASE_URL: '',
    BETTER_AUTH_URL: baseURL,
    DISABLE_RATE_LIMITING: 'true',
  }
  let child: ChildProcess | undefined
  try {
    const priorUrl = process.env.DATABASE_URL
    const priorDirect = process.env.DIRECT_DATABASE_URL
    process.env.DATABASE_URL = database.url
    process.env.DIRECT_DATABASE_URL = ''
    try {
      const update = await runPrismaCli(exampleDir, ['db', 'update'])
      if (update.exitCode !== 0) throw new Error(`prisma db update failed.\n${update.output}`)
    } finally {
      if (priorUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = priorUrl
      if (priorDirect === undefined) delete process.env.DIRECT_DATABASE_URL
      else process.env.DIRECT_DATABASE_URL = priorDirect
    }

    child = spawn('pnpm', ['exec', 'next', mode === 'dev' ? 'dev' : 'start', '-p', String(port)], {
      cwd: exampleDir,
      env,
      stdio: 'inherit',
      detached: true,
    })
    await waitForServer(`${baseURL}/sign-in`, child, 150_000)
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
