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

/**
 * `CONCURRENCY` is the queue depth this load presents to the Dev database's
 * one connection, and that is the only thing it has to be: above 1 so cycles
 * genuinely interleave on the shared session, and low enough that the last
 * worker of a round is still inside the 20 s `connectionTimeoutMillis` the
 * runtime binds that pool with (`DEV_CONNECTION_TIMEOUT_MS`,
 * `packages/core/src/db/client.ts`), which pg-pool applies to a *queued*
 * checkout and not only to dialling. Raising it past that ceiling does not
 * test the binding harder; it converts a busy CI runner into a red build. Add
 * total load with `ROUNDS`, which costs time rather than tail latency.
 */
const ROUNDS = 8
const CONCURRENCY = 8
const SECOND_PROCESS_UPDATES = 3

/**
 * The lower bound on cycles that must have completed while a `db update` child
 * was alive. Without it the test passes on a run where the load and the second
 * process never met — the one arrangement it exists to rule out. One round's
 * worth is far below what an overlapping run produces and far above the zero a
 * non-overlapping one produces.
 */
const MIN_OVERLAPPING_CYCLES = CONCURRENCY

const LOAD_DEADLINE_MS = 420_000
const BATCH_TIMEOUT_MS = 120_000
const DB_UPDATE_TIMEOUT_MS = 180_000
const COMPLETED_TIMEOUT_MS = 30_000

/**
 * The app: the generated bundle's context, and a `/` that runs `rounds`
 * rounds of `concurrency` create/edit/delete cycles. Each cycle writes both
 * sides of a relation inside `context.transaction`, joins them back with
 * `.include()`, edits, re-reads, deletes and confirms the row is gone — so a
 * corrupted session shows up as a wrong answer and not only as a thrown error.
 *
 * `/completed` reports the running count of cycles that finished clean, which
 * is what the test samples either side of a `db update` to prove the two
 * actually overlapped.
 */
const APP = `import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'

const { getContext } = await import('./.opensaas/context.ts')
const context = await getContext()
const authors = () => context.unsafe.orm.public.Author
const notes = () => context.unsafe.orm.public.Note

let completed = 0

async function cycle(tag, result) {
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
    if (joined === null) return result.failures.push(\`\${tag}: the committed author was not readable\`)
    if (joined.notes.length !== 1) {
      return result.failures.push(\`\${tag}: expected 1 note, read \${joined.notes.length}\`)
    }
    if (joined.notes[0].title !== \`note \${tag}\`) {
      return result.failures.push(\`\${tag}: read back "\${joined.notes[0].title}"\`)
    }

    await notes().where({ id: note.id }).update({ title: \`edited \${tag}\` })
    const edited = await authors().where({ id: author.id }).include('notes').first()
    if (edited?.notes[0]?.title !== \`edited \${tag}\`) {
      return result.failures.push(\`\${tag}: the edit read back as "\${edited?.notes[0]?.title}"\`)
    }

    await notes().where({ id: note.id }).delete()
    await authors().where({ id: author.id }).delete()
    const gone = await authors().where({ id: author.id }).include('notes').first()
    if (gone !== null) return result.failures.push(\`\${tag}: the deleted author is still readable\`)

    completed += 1
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // pg-pool's checkout ceiling, not the shared session going wrong: with
    // \`max: 1\` a cycle can wait out the whole round for the connection on a
    // loaded machine. Recorded apart from the failures so a busy runner never
    // reads as the corruption this test hunts.
    if (message.includes('timeout exceeded when trying to connect')) {
      result.timeouts.push(\`\${tag}: \${message}\`)
    } else {
      result.failures.push(\`\${tag}: \${message}\`)
    }
  }
}

async function load(rounds, concurrency) {
  const result = { cycles: rounds * concurrency, failures: [], timeouts: [] }
  for (let round = 0; round < rounds; round++) {
    await Promise.all(
      Array.from({ length: concurrency }, (_, worker) =>
        cycle(\`\${Date.now()}-\${round}-\${worker}\`, result),
      ),
    )
  }
  return result
}

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  const send = (status, body) => {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
  }

  if (url.pathname === '/completed') return send(200, { completed })

  load(Number(url.searchParams.get('rounds')), Number(url.searchParams.get('concurrency')))
    .then((result) => send(200, result))
    .catch((error) => send(500, { cycles: 0, failures: [String(error)], timeouts: [] }))
})

server.listen(0, '127.0.0.1', () => {
  writeFileSync('app-port', String(server.address().port))
})
`

interface LoadResult {
  cycles: number
  failures: string[]
  timeouts: string[]
}

interface CompletedResult {
  completed: number
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
      // A signal-killed child reports `exitCode === null` and carries the
      // signal in `signalCode`, so exit code alone does not answer "already
      // gone" — and `close` will never fire again to settle the promise below.
      if (child.exitCode !== null || child.signalCode !== null) return
      await new Promise<void>((resolve) => {
        // Inside vitest's default 10 s hook timeout: a wedged sidecar must not
        // turn a reported failure into an unexplained hook timeout on top of it.
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          resolve()
        }, 5_000)
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
    const timer = setTimeout(() => {
      output += `\n[the test killed this run after ${DB_UPDATE_TIMEOUT_MS} ms]\n`
      child.kill('SIGKILL')
    }, DB_UPDATE_TIMEOUT_MS)
    child.once('error', (error: Error) => {
      clearTimeout(timer)
      resolve({ exitCode: null, output: `${output}\n${error.message}` })
    })
    child.once('close', (exitCode) => {
      clearTimeout(timer)
      resolve({ exitCode, output })
    })
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

async function drive(
  port: string,
  rounds: number,
  concurrency: number,
  timeoutMs: number = BATCH_TIMEOUT_MS,
): Promise<LoadResult> {
  const response = await fetch(
    `http://127.0.0.1:${port}/?rounds=${rounds}&concurrency=${concurrency}`,
    { signal: AbortSignal.timeout(timeoutMs) },
  )
  return await response.json()
}

async function readCompleted(port: string): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${port}/completed`, {
    signal: AbortSignal.timeout(COMPLETED_TIMEOUT_MS),
  })
  const body: CompletedResult = await response.json()
  return body.completed
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
    const observed: LoadResult = { cycles: 0, failures: [], timeouts: [] }
    let overlappingCycles = 0
    let updatesFinished = false
    let secondProcessFailure: Error | undefined

    const secondProcess = (async () => {
      for (let index = 0; index < SECOND_PROCESS_UPDATES; index++) {
        const before = await readCompleted(port)
        updates.push(await runDbUpdate(projectDir))
        overlappingCycles += (await readCompleted(port)) - before
      }
    })()
      .catch((error: unknown) => {
        secondProcessFailure = error instanceof Error ? error : new Error(String(error))
      })
      .finally(() => {
        updatesFinished = true
      })

    const diagnose = (message: string): Error =>
      new Error(
        `${message}\n\n${updates.length} of ${SECOND_PROCESS_UPDATES} \`db update\` runs ` +
          `finished, ${observed.cycles} cycles driven, ${observed.failures.length} failed, ` +
          `${observed.timeouts.length} timed out waiting for the pool.\n\n` +
          `${updates.map((update) => update.output).join('\n')}\n\n${loop.output()}`,
      )

    // Batches rather than one fixed run, so the load and the second process
    // overlap whichever finishes first — a sized load that ended before the
    // first `db update` connected would assert nothing about the two together.
    const deadline = Date.now() + LOAD_DEADLINE_MS
    while (!updatesFinished) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        throw diagnose(`The second process did not finish within ${LOAD_DEADLINE_MS} ms.`)
      }
      const batch = await drive(
        port,
        ROUNDS,
        CONCURRENCY,
        Math.min(remaining, BATCH_TIMEOUT_MS),
      ).catch((error: unknown) => {
        throw diagnose(
          `A load batch never returned: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
      observed.cycles += batch.cycles
      observed.failures.push(...batch.failures)
      observed.timeouts.push(...batch.timeouts)
    }
    await secondProcess
    if (secondProcessFailure !== undefined) throw secondProcessFailure

    expect(
      observed.failures.slice(0, 10),
      `${observed.failures.length} of ${observed.cycles} cycles failed ` +
        `(${observed.timeouts.length} timed out waiting for the pool, which is not ` +
        `corruption)\n\n${loop.output()}`,
    ).toEqual([])

    expect(
      overlappingCycles,
      `only ${overlappingCycles} cycles completed while a \`db update\` child was alive, ` +
        `so this run did not exercise the two together — the property the test is named ` +
        `for went unasserted (${observed.timeouts.length} cycles timed out waiting for ` +
        `the pool)\n\n${loop.output()}`,
    ).toBeGreaterThanOrEqual(MIN_OVERLAPPING_CYCLES)

    for (const update of updates) {
      expect(update.exitCode, update.output).toBe(0)
    }
    expect(updates).toHaveLength(SECOND_PROCESS_UPDATES)

    const afterwards = await drive(port, 1, CONCURRENCY)
    expect(afterwards.failures, loop.output()).toEqual([])
  }, 600_000)
})
