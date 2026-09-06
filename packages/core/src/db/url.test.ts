import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { writeDevDatabaseState } from './state-file.js'
import { DatabaseUrlUnresolvedError, findDatabaseUrl, resolveDatabaseUrl } from './url.js'

const CONNECTION_VARIABLES = ['DATABASE_URL', 'DIRECT_DATABASE_URL'] as const

describe('resolveDatabaseUrl', () => {
  let projectRoot: string
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'opensaas-url-'))
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

  test('reports env provenance for DATABASE_URL', () => {
    process.env.DATABASE_URL = 'postgres://someone@example.test:5432/app'

    expect(resolveDatabaseUrl({ cwd: projectRoot })).toEqual({
      url: 'postgres://someone@example.test:5432/app',
      provenance: 'env',
    })
  })

  test('prefers DIRECT_DATABASE_URL over DATABASE_URL', () => {
    process.env.DATABASE_URL = 'postgres://pooler@example.test:6543/app'
    process.env.DIRECT_DATABASE_URL = 'postgres://direct@example.test:5432/app'

    expect(resolveDatabaseUrl({ cwd: projectRoot }).url).toBe(
      'postgres://direct@example.test:5432/app',
    )
  })

  test('reports dev-database provenance from the state file', () => {
    writeDevDatabaseState(path.join(projectRoot, '.opensaas', 'dev-db.json'), {
      url: 'postgres://postgres@127.0.0.1:54999/postgres',
      pid: process.pid,
    })

    expect(resolveDatabaseUrl({ cwd: projectRoot })).toEqual({
      url: 'postgres://postgres@127.0.0.1:54999/postgres',
      provenance: 'dev-database',
    })
  })

  test('an environment variable wins over a running dev database', () => {
    writeDevDatabaseState(path.join(projectRoot, '.opensaas', 'dev-db.json'), {
      url: 'postgres://postgres@127.0.0.1:54999/postgres',
      pid: process.pid,
    })
    process.env.DATABASE_URL = 'postgres://someone@example.test:5432/app'

    expect(resolveDatabaseUrl({ cwd: projectRoot }).provenance).toBe('env')
  })

  test('ignores a state file whose pid is gone', () => {
    writeDevDatabaseState(path.join(projectRoot, '.opensaas', 'dev-db.json'), {
      url: 'postgres://postgres@127.0.0.1:54999/postgres',
      pid: 2 ** 30,
    })

    expect(findDatabaseUrl({ cwd: projectRoot })).toBeUndefined()
    expect(() => resolveDatabaseUrl({ cwd: projectRoot })).toThrow(DatabaseUrlUnresolvedError)
  })

  test('throws naming both remedies when nothing is set', () => {
    expect(() => resolveDatabaseUrl({ cwd: projectRoot })).toThrow(/DATABASE_URL/)
    expect(() => resolveDatabaseUrl({ cwd: projectRoot })).toThrow(/opensaas dev/)
  })

  test('findDatabaseUrl stays non-throwing for the offline Prisma commands', () => {
    expect(findDatabaseUrl({ cwd: projectRoot })).toBeUndefined()
  })
})
