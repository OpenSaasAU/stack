import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import pg from 'pg'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { startDevDatabase } from './dev-database.js'

const BOOT_TIMEOUT = 60_000

function collectUncaught(): { errors: unknown[]; stop: () => void } {
  const errors: unknown[] = []
  const listener = (error: unknown): void => {
    errors.push(error)
  }
  process.on('uncaughtException', listener)
  process.on('unhandledRejection', listener)
  return {
    errors,
    stop: () => {
      process.off('uncaughtException', listener)
      process.off('unhandledRejection', listener)
    },
  }
}

async function nextImmediates(count: number): Promise<void> {
  for (let i = 0; i < count; i++) await new Promise((resolve) => setImmediate(resolve))
}

describe('stopping the Dev database', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), 'opensaas-dev-db-shutdown-'))
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  test(
    'leaves no socket cleanup pending after a client disconnects and stop resolves',
    async () => {
      const uncaught = collectUncaught()
      try {
        for (let round = 0; round < 3; round++) {
          const database = await startDevDatabase({ cwd })
          const client = new pg.Client({ connectionString: database.url })
          await client.connect()
          await client.query('select 1')
          await client.end()
          await database.stop()
          await nextImmediates(5)
          expect(existsSync(database.stateFile)).toBe(false)
        }
        expect(uncaught.errors).toEqual([])
      } finally {
        uncaught.stop()
      }
    },
    BOOT_TIMEOUT,
  )

  test(
    'stops cleanly when a client socket closes in the same turn as stop',
    async () => {
      const uncaught = collectUncaught()
      try {
        for (let round = 0; round < 8; round++) {
          const database = await startDevDatabase({ cwd })
          const client = new pg.Client({ connectionString: database.url })
          client.on('error', () => {})
          await client.connect()
          await client.query('select 1')
          client.connection.stream.destroy()
          await nextImmediates(round)
          await database.stop()
          await nextImmediates(5)
        }
        expect(uncaught.errors).toEqual([])
      } finally {
        uncaught.stop()
      }
    },
    BOOT_TIMEOUT,
  )

  test(
    'stops cleanly with clients still connected, including one inside a transaction',
    async () => {
      const uncaught = collectUncaught()
      try {
        const database = await startDevDatabase({ cwd })
        const idle = new pg.Client({ connectionString: database.url })
        const busy = new pg.Client({ connectionString: database.url })
        idle.on('error', () => {})
        busy.on('error', () => {})
        await idle.connect()
        await busy.connect()
        await busy.query('begin')
        await busy.query('select 1')
        await database.stop()
        await database.stop()
        await nextImmediates(5)
        expect(uncaught.errors).toEqual([])
      } finally {
        uncaught.stop()
      }
    },
    BOOT_TIMEOUT,
  )

  test(
    'releases the data directory so the same directory can start again',
    async () => {
      const uncaught = collectUncaught()
      try {
        const dataDir = path.join(cwd, 'data')
        for (let round = 0; round < 2; round++) {
          const database = await startDevDatabase({ cwd, dataDir })
          const client = new pg.Client({ connectionString: database.url })
          await client.connect()
          await client.end()
          await database.stop()
        }
        await nextImmediates(5)
        expect(uncaught.errors).toEqual([])
      } finally {
        uncaught.stop()
      }
    },
    BOOT_TIMEOUT,
  )
})
