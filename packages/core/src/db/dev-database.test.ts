import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import type { QueryResult } from 'pg'
import { startDevDatabase, type DevDatabase } from './dev-database.js'
import { readDevDatabaseState, writeDevDatabaseState } from './state-file.js'
import { resolveDatabaseUrl } from './url.js'

const BOOT_TIMEOUT = 60_000

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
      started = started.filter((database) => database !== first)
      expect(existsSync(first.stateFile)).toBe(false)

      const second = await start()
      writeDevDatabaseState(second.stateFile, { url: 'postgres://other', pid: process.pid })
      await second.stop()
      started = started.filter((database) => database !== second)
      expect(readDevDatabaseState({ cwd: projectRoot })?.url).toBe('postgres://other')
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

/**
 * The escape: with `DATABASE_URL` set this suite exercises whatever Postgres it
 * names, so CI runs on a real server while a developer machine runs with
 * nothing installed.
 */
describe('the resolved database', () => {
  const envUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL
  let projectRoot: string
  let database: DevDatabase | undefined

  beforeEach(async () => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'opensaas-dev-db-'))
    database = envUrl === undefined ? await startDevDatabase({ cwd: projectRoot }) : undefined
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
      expect(resolved.provenance).toBe(envUrl === undefined ? 'dev-database' : 'env')
      expect((await ask(resolved.url, 'select 1 as one')).rows).toEqual([{ one: 1 }])
    },
    BOOT_TIMEOUT,
  )
})
