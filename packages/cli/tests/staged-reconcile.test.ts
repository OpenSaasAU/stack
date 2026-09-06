import { spawn, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { afterAll, describe, expect, test } from 'vitest'

/**
 * The staged reconcile as a user meets it: a real `opensaas dev` loop, a real
 * config edit, and a real app that answers over HTTP with the contract it
 * loaded and the columns the database actually has (ADR-0063). Nothing here
 * observes the watcher's internals.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureConfig = path.join(
  packageRoot,
  'tests',
  'fixtures',
  'dev-loop-project',
  'opensaas.config.ts',
)
const cliEntry = path.join(packageRoot, 'bin', 'opensaas.js')
const scratchRoot = fs.mkdtempSync(path.join(packageRoot, 'tests', 'tmp-staged-'))

const CONNECTION_VARIABLES = ['DATABASE_URL', 'DIRECT_DATABASE_URL'] as const

/**
 * The app: one connection to the Dev database (the sidecar multiplexes every
 * connection onto one backend, so a pool would corrupt itself), a line in
 * `starts.log` per process, and a reply carrying both what the on-disk
 * contract says and what the database has.
 */
const APP = `import { createServer } from 'node:http'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import pg from 'pg'
import { resolveDatabaseUrl } from '@opensaas/stack-core'

appendFileSync('starts.log', process.pid + '\\n')

const client = new pg.Client({ connectionString: resolveDatabaseUrl().url })
await client.connect()

const server = createServer((request, response) => {
  client
    .query(
      "select column_name from information_schema.columns where table_name = 'Note' order by column_name",
    )
    .then((columns) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          pid: process.pid,
          contract: readFileSync('prisma/contract.json', 'utf8'),
          columns: columns.rows.map((row) => row.column_name),
        }),
      )
    })
    .catch((error) => {
      response.writeHead(500)
      response.end(String(error))
    })
})

server.listen(0, '127.0.0.1', () => {
  writeFileSync('app-port', String(server.address().port))
})
`

interface AppState {
  pid: number
  contract: string
  columns: string[]
}

function createProject(name: string): string {
  const projectDir = path.join(scratchRoot, name)
  fs.mkdirSync(projectDir, { recursive: true })
  fs.copyFileSync(fixtureConfig, path.join(projectDir, 'opensaas.config.ts'))
  fs.writeFileSync(path.join(projectDir, 'app.mjs'), APP, 'utf-8')
  return projectDir
}

function cleanEnvironment(): typeof process.env {
  const env: typeof process.env = { ...process.env }
  for (const name of CONNECTION_VARIABLES) delete env[name]
  return env
}

interface Loop {
  output(): string
  stop(): Promise<void>
}

function startLoop(projectDir: string): Loop {
  const child = spawn(process.execPath, [cliEntry, 'dev', '--', 'node', 'app.mjs'], {
    cwd: projectDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: cleanEnvironment(),
  })

  let output = ''
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf-8')
    stream.on('data', (chunk: string) => {
      output += chunk
    })
  }

  return {
    output: () => output,
    stop: async () => {
      if (child.exitCode !== null) return
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 20_000)
        child.once('close', () => {
          clearTimeout(timer)
          resolve()
        })
        child.kill('SIGINT')
      })
    },
  }
}

async function runCli(projectDir: string, args: readonly string[]): Promise<ChildProcess> {
  return spawn(process.execPath, [cliEntry, ...args], {
    cwd: projectDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: cleanEnvironment(),
  })
}

async function captureCli(
  projectDir: string,
  args: readonly string[],
): Promise<{ exitCode: number | null; output: string }> {
  const child = await runCli(projectDir, args)
  let output = ''
  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding('utf-8')
    stream?.on('data', (chunk: string) => {
      output += chunk
    })
  }
  return await new Promise((resolve) => {
    child.once('close', (exitCode) => resolve({ exitCode, output }))
  })
}

const wait = async (ms: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, ms))

async function readState(projectDir: string): Promise<AppState | undefined> {
  let port: string
  try {
    port = fs.readFileSync(path.join(projectDir, 'app-port'), 'utf-8').trim()
  } catch {
    return undefined
  }
  if (port.length === 0) return undefined
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`)
    if (!response.ok) return undefined
    return await response.json()
  } catch {
    return undefined
  }
}

/** Polls the served app until it answers the way `predicate` wants. */
async function waitForState(
  projectDir: string,
  loop: Loop,
  predicate: (state: AppState) => boolean,
  what: string,
  timeoutMs = 120_000,
): Promise<AppState> {
  const deadline = Date.now() + timeoutMs
  let last: AppState | undefined
  while (Date.now() < deadline) {
    const state = await readState(projectDir)
    if (state !== undefined) {
      last = state
      if (predicate(state)) return state
    }
    await wait(500)
  }
  throw new Error(
    `Timed out waiting for ${what}. Last state: ${JSON.stringify(last)}\n\n${loop.output()}`,
  )
}

async function waitForOutput(loop: Loop, needle: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (loop.output().includes(needle)) return
    await wait(500)
  }
  throw new Error(`Timed out waiting for "${needle}" in the loop's output:\n\n${loop.output()}`)
}

function writeConfig(projectDir: string, extraField: string): void {
  const configPath = path.join(projectDir, 'opensaas.config.ts')
  const source = fs.readFileSync(fixtureConfig, 'utf-8')
  fs.writeFileSync(
    configPath,
    source.replace(
      'title: text({ validation: { isRequired: true } }),',
      `title: text({ validation: { isRequired: true } }),${extraField}`,
    ),
    'utf-8',
  )
}

const loops: Loop[] = []

afterAll(async () => {
  for (const loop of loops) await loop.stop()
  fs.rmSync(scratchRoot, { recursive: true, force: true })
})

describe('staged reconcile under opensaas dev', () => {
  test('an additive edit goes live without a restart; a destructive one waits for `db update`', async () => {
    const projectDir = createProject('staged')
    const loop = startLoop(projectDir)
    loops.push(loop)

    const booted = await waitForState(projectDir, loop, (state) => state.columns.length > 0, 'boot')
    expect(booted.columns).toContain('title')
    expect(booted.columns).not.toContain('note')

    writeConfig(projectDir, '\n        note: text(),')

    const promoted = await waitForState(
      projectDir,
      loop,
      (state) => state.columns.includes('note') && state.contract.includes('"note"'),
      'the additive edit to go live',
    )
    expect(promoted.pid, 'an additive promote must not restart the app').toBe(booted.pid)

    // Stamped so the next assertion can tell "left alone" from "rewritten
    // with the same bytes": the root config is contract-derived, and a change
    // the loop parks must not reach it.
    const rootPrismaConfig = path.join(projectDir, 'prisma.config.ts')
    fs.appendFileSync(rootPrismaConfig, '\n// held back until promotion\n', 'utf-8')

    writeConfig(projectDir, '')
    await waitForOutput(loop, 'pnpm db:update')

    expect(
      fs.readFileSync(rootPrismaConfig, 'utf-8'),
      'a parked generation must not rewrite the live root config',
    ).toContain('// held back until promotion')

    const serving = await waitForState(projectDir, loop, () => true, 'the app to answer')
    expect(serving.columns, 'the old schema keeps serving').toContain('note')
    expect(serving.contract, 'the bundle is not promoted either').toContain('"note"')
    expect(serving.pid).toBe(booted.pid)

    const update = await captureCli(projectDir, ['db', 'update', '--confirm', 'postgres'])
    expect(update.exitCode, update.output).toBe(0)

    const dropped = await waitForState(
      projectDir,
      loop,
      (state) => !state.columns.includes('note') && !state.contract.includes('"note"'),
      'the destructive change to be applied and promoted',
    )
    expect(dropped.pid, 'a destructive promote restarts the app').not.toBe(booted.pid)
    expect(
      fs.readFileSync(rootPrismaConfig, 'utf-8'),
      'promotion moves the held-back root config into place',
    ).not.toContain('// held back until promotion')

    const starts = fs.readFileSync(path.join(projectDir, 'starts.log'), 'utf-8').trim().split('\n')
    expect(starts).toHaveLength(2)

    // A second-terminal `db update` against the live sidecar, with nothing to
    // do: the app must still be answering afterwards.
    const noop = await captureCli(projectDir, ['db', 'update'])
    expect(noop.exitCode, noop.output).toBe(0)
    const stillServing = await waitForState(projectDir, loop, () => true, 'the app to answer')
    expect(stillServing.pid).toBe(dropped.pid)
    expect(stillServing.columns).toContain('title')
  }, 600_000)

  test('`db update` with no dev loop listening names `opensaas dev`', async () => {
    const projectDir = createProject('no-loop')

    const run = await captureCli(projectDir, ['db', 'update', '--confirm', 'postgres'])

    expect(run.exitCode, run.output).not.toBe(0)
    expect(run.output).toContain('opensaas dev')
  }, 60_000)
})
