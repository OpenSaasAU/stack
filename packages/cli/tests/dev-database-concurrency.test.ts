import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { afterAll, describe, expect, test } from 'vitest'

/**
 * The Dev database under the load its design rests on: a real `opensaas dev`
 * loop, a real app driving create/edit/delete through the generated bundle's
 * own client, and a second-process `opensaas db update` against the same
 * sidecar while that load is in flight.
 *
 * `pglite-socket` multiplexes every TCP connection onto one PGlite backend —
 * one Postgres session, whose unnamed prepared statement, unnamed portal and
 * transaction are all session-global. That is why the generated runtime binds
 * the Dev database to a `pg` pool of `max: 1` (ADR-0063, 2026-09-03
 * amendment). Raise it and this test reports `portal "" does not exist`,
 * `unnamed prepared statement does not exist`, and committed rows that read
 * back as another worker's — which is the point of driving it under load
 * rather than one request at a time.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureConfig = path.join(
  packageRoot,
  'tests',
  'fixtures',
  'concurrency-project',
  'opensaas.config.ts',
)
const cliEntry = path.join(packageRoot, 'bin', 'opensaas.js')
const scratchRoot = fs.mkdtempSync(path.join(packageRoot, 'tests', 'tmp-concurrency-'))

const CONNECTION_VARIABLES = ['DATABASE_URL', 'DIRECT_DATABASE_URL'] as const

const ROUNDS = 4
const CONCURRENCY = 16
const SECOND_PROCESS_UPDATES = 3

/**
 * The app: the generated bundle's context, and a `/` that runs `rounds`
 * rounds of `concurrency` create/edit/delete cycles. Each cycle writes both
 * sides of a relation inside `context.transaction`, joins them back with
 * `.include()`, edits, re-reads, deletes and confirms the row is gone — so a
 * corrupted session shows up as a wrong answer and not only as a thrown error.
 */
const APP = `import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'

const { getContext } = await import('./.opensaas/context.ts')
const context = await getContext()
const authors = () => context.unsafe.orm.public.Author
const notes = () => context.unsafe.orm.public.Note

async function cycle(tag, failures) {
  try {
    const { author, note } = await context.transaction(async (tx) => {
      const author = await tx.unsafe.orm.public.Author.create({ name: \`author \${tag}\` })
      const note = await tx.unsafe.orm.public.Note.create({
        title: \`note \${tag}\`,
        authorId: author.id,
      })
      return { author, note }
    })

    const joined = await authors().where({ id: author.id }).include('notes').first()
    if (joined === null) return failures.push(\`\${tag}: the committed author was not readable\`)
    if (joined.notes.length !== 1) {
      return failures.push(\`\${tag}: expected 1 note, read \${joined.notes.length}\`)
    }
    if (joined.notes[0].title !== \`note \${tag}\`) {
      return failures.push(\`\${tag}: read back "\${joined.notes[0].title}"\`)
    }

    await notes().where({ id: note.id }).update({ title: \`edited \${tag}\` })
    const edited = await authors().where({ id: author.id }).include('notes').first()
    if (edited?.notes[0]?.title !== \`edited \${tag}\`) {
      return failures.push(\`\${tag}: the edit read back as "\${edited?.notes[0]?.title}"\`)
    }

    await notes().where({ id: note.id }).delete()
    await authors().where({ id: author.id }).delete()
    const gone = await authors().where({ id: author.id }).include('notes').first()
    if (gone !== null) return failures.push(\`\${tag}: the deleted author is still readable\`)
  } catch (error) {
    failures.push(\`\${tag}: \${error instanceof Error ? error.message : String(error)}\`)
  }
}

async function load(rounds, concurrency) {
  const failures = []
  for (let round = 0; round < rounds; round++) {
    await Promise.all(
      Array.from({ length: concurrency }, (_, worker) =>
        cycle(\`\${Date.now()}-\${round}-\${worker}\`, failures),
      ),
    )
  }
  return { cycles: rounds * concurrency, failures }
}

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  load(Number(url.searchParams.get('rounds')), Number(url.searchParams.get('concurrency')))
    .then((result) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(result))
    })
    .catch((error) => {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ cycles: 0, failures: [String(error)] }))
    })
})

server.listen(0, '127.0.0.1', () => {
  writeFileSync('app-port', String(server.address().port))
})
`

interface LoadResult {
  cycles: number
  failures: string[]
}

interface CliRun {
  exitCode: number | null
  output: string
}

interface Loop {
  output(): string
  stop(): Promise<void>
}

function cleanEnvironment(): typeof process.env {
  const env: typeof process.env = { ...process.env }
  for (const name of CONNECTION_VARIABLES) delete env[name]
  return env
}

function createProject(name: string): string {
  const projectDir = path.join(scratchRoot, name)
  fs.mkdirSync(projectDir, { recursive: true })
  fs.copyFileSync(fixtureConfig, path.join(projectDir, 'opensaas.config.ts'))
  fs.writeFileSync(path.join(projectDir, 'app.mjs'), APP, 'utf-8')
  return projectDir
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
        // Inside vitest's default 10 s hook timeout: a wedged sidecar must not
        // turn a reported failure into an unexplained hook timeout on top of it.
        const timer = setTimeout(() => child.kill('SIGKILL'), 5_000)
        child.once('close', () => {
          clearTimeout(timer)
          resolve()
        })
        child.kill('SIGINT')
      })
    },
  }
}

async function runDbUpdate(projectDir: string): Promise<CliRun> {
  const child = spawn(process.execPath, [cliEntry, 'db', 'update'], {
    cwd: projectDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: cleanEnvironment(),
  })

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

async function waitForPort(projectDir: string, loop: Loop): Promise<string> {
  const deadline = Date.now() + 240_000
  while (Date.now() < deadline) {
    try {
      const port = fs.readFileSync(path.join(projectDir, 'app-port'), 'utf-8').trim()
      if (port.length > 0) return port
    } catch {
      // The app has not listened yet.
    }
    await wait(500)
  }
  throw new Error(`The app never reported a port:\n\n${loop.output()}`)
}

async function drive(port: string, rounds: number, concurrency: number): Promise<LoadResult> {
  const response = await fetch(
    `http://127.0.0.1:${port}/?rounds=${rounds}&concurrency=${concurrency}`,
  )
  return await response.json()
}

const loops: Loop[] = []

afterAll(async () => {
  for (const loop of loops) await loop.stop()
  fs.rmSync(scratchRoot, { recursive: true, force: true })
})

describe('the Dev database under app load and a concurrent second-process db update', () => {
  test('neither the app nor the second process corrupts the shared backend', async () => {
    const projectDir = createProject('under-load')
    const loop = startLoop(projectDir)
    loops.push(loop)

    const port = await waitForPort(projectDir, loop)

    const updates: CliRun[] = []
    let updatesFinished = false
    const secondProcess = (async () => {
      for (let index = 0; index < SECOND_PROCESS_UPDATES; index++) {
        updates.push(await runDbUpdate(projectDir))
      }
      updatesFinished = true
    })()

    // Batches rather than one fixed run, so the load and the second process
    // overlap whichever finishes first — a sized load that ended before the
    // first `db update` connected would assert nothing about the two together.
    const observed: LoadResult = { cycles: 0, failures: [] }
    while (!updatesFinished) {
      const batch = await drive(port, ROUNDS, CONCURRENCY)
      observed.cycles += batch.cycles
      observed.failures.push(...batch.failures)
    }
    await secondProcess

    expect(
      observed.failures.slice(0, 10),
      `${observed.failures.length} of ${observed.cycles} cycles failed\n\n${loop.output()}`,
    ).toEqual([])
    expect(observed.cycles).toBeGreaterThanOrEqual(ROUNDS * CONCURRENCY)

    for (const update of updates) {
      expect(update.exitCode, update.output).toBe(0)
    }
    expect(updates).toHaveLength(SECOND_PROCESS_UPDATES)

    const afterwards = await drive(port, 1, CONCURRENCY)
    expect(afterwards.failures, loop.output()).toEqual([])
  }, 600_000)
})
