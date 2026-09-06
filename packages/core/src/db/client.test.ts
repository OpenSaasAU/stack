import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { DatabaseClientConfig } from '../config/types.js'
import { startDevDatabase, type DevDatabase } from './dev-database.js'
import { writeDevDatabaseState } from './state-file.js'
import { resolveRuntimeConnection } from './client.js'
import { DatabaseUrlUnresolvedError } from './url.js'

const CONNECTION_VARIABLES = ['DATABASE_URL', 'DIRECT_DATABASE_URL'] as const

/** The bound handle, narrowed to the pool whose ceiling this decision sets. */
function boundPool(binding: unknown): Pool {
  if (!(binding instanceof Pool)) throw new Error('the resolved connection carried no pg pool')
  return binding
}

describe('resolveRuntimeConnection', () => {
  let projectRoot: string
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'opensaas-client-'))
    saved = Object.fromEntries(CONNECTION_VARIABLES.map((name) => [name, process.env[name]]))
    for (const name of CONNECTION_VARIABLES) delete process.env[name]
  })

  afterEach(() => {
    for (const name of CONNECTION_VARIABLES) {
      const value = saved[name]
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    rmSync(projectRoot, { recursive: true, force: true })
  })

  function runningDevDatabase(url: string): void {
    writeDevDatabaseState(path.join(projectRoot, '.opensaas', 'dev-db.json'), {
      url,
      pid: process.pid,
    })
  }

  test('an env URL takes Prisma’s defaults: no pool of ours, no marker suppression', () => {
    process.env.DATABASE_URL = 'postgres://someone@example.test:5432/app'

    const connection = resolveRuntimeConnection(undefined, { cwd: projectRoot })

    expect(connection).toEqual({ url: 'postgres://someone@example.test:5432/app' })
    expect(connection.pg).toBeUndefined()
    expect(connection.verifyMarker).toBeUndefined()
  })

  test('an env URL carries db.client.poolOptions through to the runtime’s own pool', () => {
    process.env.DATABASE_URL = 'postgres://someone@example.test:5432/app'

    const connection = resolveRuntimeConnection(
      { poolOptions: { connectionTimeoutMillis: 250 } },
      { cwd: projectRoot },
    )

    expect(connection.poolOptions).toEqual({ connectionTimeoutMillis: 250 })
  })

  test('dev-database provenance binds one connection with the marker check off', () => {
    runningDevDatabase('postgres://postgres@127.0.0.1:54999/postgres')

    const connection = resolveRuntimeConnection(undefined, { cwd: projectRoot })

    expect(connection.verifyMarker).toBe(false)
    expect(connection.url).toBeUndefined()
    expect(boundPool(connection.pg).options.max).toBe(1)
  })

  test('the dev pool waits Prisma’s 20 s for a connection, not pg’s forever', () => {
    runningDevDatabase('postgres://postgres@127.0.0.1:54999/postgres')

    const connection = resolveRuntimeConnection(undefined, { cwd: projectRoot })

    expect(boundPool(connection.pg).options.connectionTimeoutMillis).toBe(20_000)
  })

  test('the same URL from the environment gets neither workaround', () => {
    process.env.DATABASE_URL = 'postgres://postgres@127.0.0.1:54999/postgres'
    runningDevDatabase('postgres://postgres@127.0.0.1:54999/postgres')

    const connection = resolveRuntimeConnection(undefined, { cwd: projectRoot })

    expect(connection).toEqual({ url: 'postgres://postgres@127.0.0.1:54999/postgres' })
  })

  test('db.client.pg wins, is called once, and consults no URL lookup', () => {
    const handle = new Pool({ max: 7 })
    let calls = 0
    const client: DatabaseClientConfig = {
      pg: () => {
        calls += 1
        return handle
      },
    }

    const connection = resolveRuntimeConnection(client, { cwd: projectRoot })

    expect(calls).toBe(1)
    expect(connection.pg).toBe(handle)
    expect(connection.url).toBeUndefined()
    expect(connection.verifyMarker).toBeUndefined()
  })

  test('a supplied pool displacing the dev database’s binding says so', () => {
    runningDevDatabase('postgres://postgres@127.0.0.1:54999/postgres')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      resolveRuntimeConnection({ pg: () => new Pool({ max: 7 }) }, { cwd: projectRoot })

      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]?.[0]).toMatch(/ADR-0063/)
    } finally {
      warn.mockRestore()
    }
  })

  test('a supplied pool over an env URL is not warned about', () => {
    process.env.DATABASE_URL = 'postgres://someone@example.test:5432/app'
    runningDevDatabase('postgres://postgres@127.0.0.1:54999/postgres')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      resolveRuntimeConnection({ pg: () => new Pool({ max: 7 }) }, { cwd: projectRoot })

      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  test('a missing URL throws the lookup’s error, naming both remedies', () => {
    expect(() => resolveRuntimeConnection(undefined, { cwd: projectRoot })).toThrow(
      DatabaseUrlUnresolvedError,
    )
    expect(() => resolveRuntimeConnection(undefined, { cwd: projectRoot })).toThrow(/opensaas dev/)
  })

  describe('against a running dev database', () => {
    let database: DevDatabase

    beforeEach(async () => {
      database = await startDevDatabase({ cwd: projectRoot })
    }, 60_000)

    afterEach(async () => {
      await database.stop()
    })

    test('the bound pool reaches the sidecar and returns rows', async () => {
      const pool = boundPool(resolveRuntimeConnection(undefined, { cwd: projectRoot }).pg)

      try {
        const result = await pool.query('select 1 as one')
        expect(result.rows).toEqual([{ one: 1 }])
      } finally {
        await pool.end()
      }
    }, 60_000)
  })
})
