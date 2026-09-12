import { spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { afterAll, describe, expect, test } from 'vitest'
import { startDevDatabase, type DevDatabase } from '@opensaas/stack-core/dev-database'

/**
 * The dev loop as a user runs it: the real `opensaas dev` binary on a real
 * project, observed through the database it brings up and the app it spawns —
 * never through the watcher's internals (ADR-0063).
 *
 * The scratch tree lives inside this package so the fixture's imports and the
 * probes' `pg` resolve, and outside `node_modules` so type stripping applies.
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
const scratchRoot = fs.mkdtempSync(path.join(packageRoot, 'tests', 'tmp-dev-loop-'))

const CONNECTION_VARIABLES = ['DATABASE_URL', 'DIRECT_DATABASE_URL'] as const

/** Reports the lookup's verdict, then reads and writes rows over one connection. */
const ROW_PROBE = `import pg from 'pg'
import { resolveDatabaseUrl } from '@opensaas/stack-core'

const { url, provenance } = resolveDatabaseUrl()
console.log(\`PROVENANCE \${provenance}\`)
console.log(\`INJECTED_DATABASE_URL \${process.env.DATABASE_URL ?? 'none'}\`)

const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  await client.query('insert into "Note" ("id", "title") values ($1, $2)', [
    crypto.randomUUID(),
    'read by the app',
  ])
  const notes = await client.query('select "title" from "Note"')
  console.log(\`ROWS \${notes.rowCount}: \${notes.rows.map((row) => row.title).join(', ')}\`)
  const extension = await client.query("select extname from pg_extension where extname = 'vector'")
  console.log(\`EXTENSION \${extension.rowCount}\`)
} finally {
  await client.end()
}
`

/** Reports the port the loop's sidecar bound, and that the app ran at all. */
const PORT_PROBE = `import { resolveDatabaseUrl } from '@opensaas/stack-core'

const { url, provenance } = resolveDatabaseUrl()
console.log(\`PORT \${new URL(url).port} \${provenance}\`)
`

/** Leaves a file behind, so a run that never starts the app is visible on disk. */
const MARKER_PROBE = `import { writeFileSync } from 'node:fs'

writeFileSync('app-started', 'yes')
console.log('APP_STARTED')
`

interface DevRun {
  exitCode: number | null
  output: string
}

function createProject(name: string, probe: string): string {
  const projectDir = path.join(scratchRoot, name)
  fs.mkdirSync(projectDir, { recursive: true })
  fs.copyFileSync(fixtureConfig, path.join(projectDir, 'opensaas.config.ts'))
  fs.writeFileSync(path.join(projectDir, 'probe.mjs'), probe, 'utf-8')
  return projectDir
}

/**
 * Run `opensaas dev -- node probe.mjs` to completion. The loop stops when its
 * app child exits, so the probe is both the app and the end of the run.
 */
async function runDevLoop(projectDir: string, env: typeof process.env = {}): Promise<DevRun> {
  const childEnv: typeof process.env = { ...process.env, ...env }
  for (const name of CONNECTION_VARIABLES) {
    if (env[name] === undefined) delete childEnv[name]
  }

  return await new Promise<DevRun>((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry, 'dev', '--', 'node', 'probe.mjs'], {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv,
    })

    let output = ''
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf-8')
      stream.on('data', (chunk: string) => {
        output += chunk
      })
    }

    const timer = setTimeout(() => child.kill('SIGKILL'), 240_000)
    child.once('error', reject)
    child.once('close', (exitCode) => {
      clearTimeout(timer)
      resolve({ exitCode, output })
    })
  })
}

const escapes: DevDatabase[] = []

afterAll(async () => {
  for (const escape of escapes) await escape.stop()
  fs.rmSync(scratchRoot, { recursive: true, force: true })
})

describe('opensaas dev', () => {
  test('starts the dev database, reconciles, and runs an app that reads rows through the lookup', async () => {
    const projectDir = createProject('reads-rows', ROW_PROBE)

    const run = await runDevLoop(projectDir)

    expect(run.output, run.output).toContain('PROVENANCE dev-database')
    expect(run.output, run.output).toContain('INJECTED_DATABASE_URL none')
    expect(run.output, run.output).toContain('ROWS 1: read by the app')
    expect(run.output, run.output).toContain('EXTENSION 1')
    expect(run.exitCode, run.output).toBe(0)

    expect(fs.existsSync(path.join(projectDir, '.opensaas', 'dev-db'))).toBe(true)
    expect(fs.existsSync(path.join(projectDir, '.opensaas', 'dev-db.json'))).toBe(false)
  }, 300_000)

  test('a destructive plan on boot stops at the consent point and never starts the app', async () => {
    const projectDir = createProject('destructive-boot', MARKER_PROBE)

    const first = await runDevLoop(projectDir)
    expect(first.output, first.output).toContain('APP_STARTED')
    expect(first.exitCode, first.output).toBe(0)
    fs.rmSync(path.join(projectDir, 'app-started'))

    const configPath = path.join(projectDir, 'opensaas.config.ts')
    fs.writeFileSync(
      configPath,
      fs
        .readFileSync(configPath, 'utf-8')
        .replace('title: text({ validation: { isRequired: true } }),', 'body: text(),'),
      'utf-8',
    )

    const second = await runDevLoop(projectDir)

    // Prisma's consent gate, reached with the loop's stdio: interactive it is
    // the prompt, and with no terminal to ask it is this refusal. Either way
    // the loop goes no further.
    expect(second.output, second.output).toContain('Drop column')
    expect(second.output, second.output).toContain('CONSENT_REQUIRED')
    expect(second.output, second.output).not.toContain('APP_STARTED')
    expect(fs.existsSync(path.join(projectDir, 'app-started'))).toBe(false)
    expect(second.exitCode, second.output).not.toBe(0)
  }, 300_000)

  test('a database URL in the environment is the escape: no dev database starts', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opensaas-escape-'))
    const escape = await startDevDatabase({
      stateFile: path.join(stateDir, 'dev-db.json'),
      extensions: ['vector'],
    })
    escapes.push(escape)

    const projectDir = createProject('escape', ROW_PROBE)
    const run = await runDevLoop(projectDir, { DATABASE_URL: escape.url })

    expect(run.output, run.output).toContain('PROVENANCE env')
    expect(run.output, run.output).toContain(`INJECTED_DATABASE_URL ${escape.url}`)
    expect(run.output, run.output).toContain('ROWS 1: read by the app')
    expect(run.exitCode, run.output).toBe(0)

    expect(fs.existsSync(path.join(projectDir, '.opensaas', 'dev-db'))).toBe(false)
    expect(fs.existsSync(path.join(projectDir, '.opensaas', 'dev-db.json'))).toBe(false)
  }, 300_000)

  test('a database URL in the project .env is the escape as well', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opensaas-escape-dotenv-'))
    const escape = await startDevDatabase({
      stateFile: path.join(stateDir, 'dev-db.json'),
      extensions: ['vector'],
    })
    escapes.push(escape)

    const projectDir = createProject('escape-dotenv', ROW_PROBE)
    fs.writeFileSync(path.join(projectDir, '.env'), `DATABASE_URL=${escape.url}\n`, 'utf-8')

    const run = await runDevLoop(projectDir)

    expect(run.output, run.output).toContain('PROVENANCE env')
    expect(run.output, run.output).toContain('ROWS 1: read by the app')
    expect(run.exitCode, run.output).toBe(0)

    expect(fs.existsSync(path.join(projectDir, '.opensaas', 'dev-db'))).toBe(false)
    expect(fs.existsSync(path.join(projectDir, '.opensaas', 'dev-db.json'))).toBe(false)
  }, 300_000)

  test('twelve projects started at once get twelve distinct ports', async () => {
    const projects = Array.from({ length: 12 }, (_, index) =>
      createProject(`concurrent-${index}`, PORT_PROBE),
    )

    const runs = await Promise.all(projects.map((projectDir) => runDevLoop(projectDir)))

    const ports = runs.map((run) => {
      expect(run.exitCode, run.output).toBe(0)
      const reported = /PORT (\d+) (\w[\w-]*)/.exec(run.output)
      expect(reported, run.output).not.toBeNull()
      expect(reported?.[2], run.output).toBe('dev-database')
      return reported?.[1]
    })

    expect(new Set(ports).size).toBe(12)
    for (const projectDir of projects) {
      expect(fs.existsSync(path.join(projectDir, '.opensaas', 'dev-db'))).toBe(true)
      expect(fs.existsSync(path.join(projectDir, '.opensaas', 'dev-db.json'))).toBe(false)
    }
  }, 600_000)
})
