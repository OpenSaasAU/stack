import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { networkInterfaces, tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import pg from 'pg'
import type { QueryResult } from 'pg'
import { startDevDatabase, type DevDatabase } from './dev-database.js'
import { readDevDatabaseState, writeDevDatabaseState, type DevDatabaseState } from './state-file.js'
import { resolveDatabaseUrl } from './url.js'

const stateFileHook = vi.hoisted(() => {
  const hook: { onWrite?: (state: DevDatabaseState) => void } = {}
  return hook
})

vi.mock('./state-file.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./state-file.js')>()
  return {
    ...actual,
    writeDevDatabaseState: (filePath: string, state: DevDatabaseState): void => {
      stateFileHook.onWrite?.(state)
      actual.writeDevDatabaseState(filePath, state)
    },
  }
})

const BOOT_TIMEOUT = 60_000

const hasIpv6Loopback = Object.values(networkInterfaces()).some((addresses) =>
  addresses?.some(({ address }) => address === '::1'),
)

async function isPortFree(port: number, host: string): Promise<boolean> {
  return await new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, host, () => probe.close(() => resolve(true)))
  })
}

/**
 * A single connection, which is all the socket server's multiplexed session
 * tolerates (ADR-0063).
 */
async function ask(url: string, sql: string): Promise<QueryResult> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    return await client.query(sql)
  } finally {
    await client.end()
  }
}

const CONNECTION_VARIABLES = ['DATABASE_URL', 'DIRECT_DATABASE_URL'] as const

describe('startDevDatabase', () => {
  let projectRoot: string
  let started: DevDatabase[]
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'opensaas-dev-db-'))
    started = []
    saved = Object.fromEntries(CONNECTION_VARIABLES.map((name) => [name, process.env[name]]))
    for (const name of CONNECTION_VARIABLES) delete process.env[name]
  })

  afterEach(async () => {
    stateFileHook.onWrite = undefined
    for (const database of started) await database.stop()
    for (const name of CONNECTION_VARIABLES) {
      const value = saved[name]
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    rmSync(projectRoot, { recursive: true, force: true })
  })

  async function start(options: { cwd?: string } = {}): Promise<DevDatabase> {
    const database = await startDevDatabase({ cwd: options.cwd ?? projectRoot })
    started.push(database)
    return database
  }

  test(
    'two instances in one process take distinct ports and each answers select 1',
    async () => {
      const first = await start()
      const second = await start({ cwd: mkdtempSync(path.join(tmpdir(), 'opensaas-dev-db-')) })

      expect(first.port).not.toBe(second.port)
      expect((await ask(first.url, 'select 1 as one')).rows).toEqual([{ one: 1 }])
      expect((await ask(second.url, 'select 1 as one')).rows).toEqual([{ one: 1 }])
    },
    BOOT_TIMEOUT,
  )

  test(
    'the state file is written under the Generated bundle and rewritten on every boot',
    async () => {
      const first = await start()
      expect(first.stateFile).toBe(path.join(projectRoot, '.opensaas', 'dev-db.json'))
      expect(readDevDatabaseState({ cwd: projectRoot })).toEqual({
        url: first.url,
        pid: process.pid,
      })

      const second = await start()
      expect(readDevDatabaseState({ cwd: projectRoot })).toEqual({
        url: second.url,
        pid: process.pid,
      })
      expect(resolveDatabaseUrl({ cwd: projectRoot })).toEqual({
        url: second.url,
        provenance: 'dev-database',
      })
    },
    BOOT_TIMEOUT,
  )

  test('a state file left behind by a dead process is ignored', () => {
    writeDevDatabaseState(path.join(projectRoot, '.opensaas', 'dev-db.json'), {
      url: 'postgres://postgres@127.0.0.1:54999/postgres',
      pid: 2 ** 30,
    })

    expect(readDevDatabaseState({ cwd: projectRoot })).toBeUndefined()
  })

  test(
    'stopping drops this instance state file but not a newer one',
    async () => {
      const first = await start()
      await first.stop()
      expect(existsSync(first.stateFile)).toBe(false)

      const second = await start()
      writeDevDatabaseState(second.stateFile, { url: 'postgres://other', pid: process.pid })
      await second.stop()
      expect(readDevDatabaseState({ cwd: projectRoot })?.url).toBe('postgres://other')
    },
    BOOT_TIMEOUT,
  )

  test(
    'stopping releases the port, and stopping again is a quiet no-op',
    async () => {
      const database = await start()
      expect(await isPortFree(database.port, database.host)).toBe(false)

      await database.stop()
      expect(await isPortFree(database.port, database.host)).toBe(true)

      await expect(database.stop()).resolves.toBeUndefined()
      await expect(database.stop()).resolves.toBeUndefined()
      expect(await isPortFree(database.port, database.host)).toBe(true)
    },
    BOOT_TIMEOUT,
  )

  test(
    'a failure after the socket server has started leaves no port bound',
    async () => {
      let reported: string | undefined
      stateFileHook.onWrite = (state) => {
        reported = state.url
        throw new Error('the state file could not be written')
      }

      await expect(startDevDatabase({ cwd: projectRoot })).rejects.toThrow(
        'the state file could not be written',
      )

      if (reported === undefined) throw new Error('the socket server never reported a URL')
      const { port, hostname } = new URL(reported)
      expect(await isPortFree(Number(port), hostname)).toBe(true)
      expect(existsSync(path.join(projectRoot, '.opensaas', 'dev-db.json'))).toBe(false)
    },
    BOOT_TIMEOUT,
  )

  test(
    'an explicit host and connection ceiling are honoured',
    async () => {
      const database = await startDevDatabase({
        cwd: projectRoot,
        host: '127.0.0.1',
        maxConnections: 1,
      })
      started.push(database)

      expect(database.host).toBe('127.0.0.1')
      expect(database.url).toBe(`postgres://postgres@127.0.0.1:${database.port}/postgres`)
      expect((await ask(database.url, 'select 1 as one')).rows).toEqual([{ one: 1 }])
    },
    BOOT_TIMEOUT,
  )

  test.skipIf(!hasIpv6Loopback)(
    'an IPv6 host is bracketed into a parseable URL and listens on that address',
    async () => {
      const database = await startDevDatabase({ cwd: projectRoot, host: '::1' })
      started.push(database)

      expect(database.url).toBe(`postgres://postgres@[::1]:${database.port}/postgres`)
      expect(new URL(database.url).port).toBe(String(database.port))

      const client = new pg.Client({
        host: '::1',
        port: database.port,
        user: 'postgres',
        database: 'postgres',
      })
      await client.connect()
      try {
        expect((await client.query('select 1 as one')).rows).toEqual([{ one: 1 }])
      } finally {
        await client.end()
      }
    },
    BOOT_TIMEOUT,
  )

  test(
    'CREATE EXTENSION vector succeeds on an instance that requested it',
    async () => {
      const database = await startDevDatabase({ cwd: projectRoot, extensions: ['vector'] })
      started.push(database)

      await ask(database.url, 'create extension vector')
      const { rows } = await ask(
        database.url,
        "select extname from pg_extension where extname = 'vector'",
      )
      expect(rows).toEqual([{ extname: 'vector' }])
    },
    BOOT_TIMEOUT,
  )
})

const POSTGRES_SCHEMES = new Set(['postgres:', 'postgresql:'])

type Escape =
  | { kind: 'absent' }
  | { kind: 'postgres'; name: string; url: string }
  | { kind: 'unusable'; name: string; url: string; fault: string }

/**
 * `pg` parses any string it is handed, defaulting whatever it cannot read to
 * `localhost:5432`, so a connection string that names no Postgres surfaces as a
 * refused connection several frames from its cause. Classifying it here keeps
 * the misconfiguration named where it is made.
 */
function readEscape(): Escape {
  for (const name of ['DIRECT_DATABASE_URL', 'DATABASE_URL'] as const) {
    const url = process.env[name]
    if (url === undefined || url.length === 0) continue
    let scheme: string
    try {
      scheme = new URL(url).protocol
    } catch {
      return { kind: 'unusable', name, url, fault: 'is not a URL' }
    }
    if (!POSTGRES_SCHEMES.has(scheme))
      return { kind: 'unusable', name, url, fault: `names the \`${scheme}\` scheme, not Postgres` }
    return { kind: 'postgres', name, url }
  }
  return { kind: 'absent' }
}

/**
 * The escape: with a Postgres `DATABASE_URL` set this suite exercises whatever
 * server it names, so CI can run on a real one while a developer machine runs
 * with nothing installed. Set to anything else the variable is a
 * misconfiguration, and this suite says so rather than dialling it.
 */
describe('the resolved database', () => {
  const escape = readEscape()
  let projectRoot: string
  let database: DevDatabase | undefined

  beforeEach(async () => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'opensaas-dev-db-'))
    if (escape.kind === 'unusable')
      throw new Error(
        `${escape.name} is set to \`${escape.url}\`, which ${escape.fault}. This suite dials the ` +
          `URL the lookup reports, so leave the variable unset to exercise the dev database or ` +
          `point it at a Postgres server.`,
      )
    database = escape.kind === 'absent' ? await startDevDatabase({ cwd: projectRoot }) : undefined
  }, BOOT_TIMEOUT)

  afterEach(async () => {
    await database?.stop()
    database = undefined
    rmSync(projectRoot, { recursive: true, force: true })
  })

  test(
    'answers select 1 over the URL the lookup reports',
    async () => {
      const resolved = resolveDatabaseUrl({ cwd: projectRoot })
      expect(resolved.provenance).toBe(escape.kind === 'absent' ? 'dev-database' : 'env')
      expect((await ask(resolved.url, 'select 1 as one')).rows).toEqual([{ one: 1 }])
    },
    BOOT_TIMEOUT,
  )
})
