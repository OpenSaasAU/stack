import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writeDevDatabaseState } from './state-file.js'
import { DatabaseUrlUnresolvedError, findDatabaseUrl, resolveDatabaseUrl } from './url.js'

const CONNECTION_VARIABLES = ['DATABASE_URL', 'DIRECT_DATABASE_URL'] as const

describe('resolveDatabaseUrl', () => {
  let projectRoot: string
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    vi.stubEnv('OPENSAAS_DEV_DATABASE_STATE_FILE', '')
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
    vi.unstubAllEnvs()
    rmSync(projectRoot, { recursive: true, force: true })
  })

  test('production does not discover a Dev database from the project root', () => {
    vi.stubEnv('NODE_ENV', 'production')
    writeDevDatabaseState(path.join(projectRoot, '.opensaas', 'dev-db.json'), {
      url: 'postgres://postgres@127.0.0.1:54999/postgres',
      pid: process.pid,
    })

    expect(findDatabaseUrl({ cwd: projectRoot })).toBeUndefined()
    expect(() => resolveDatabaseUrl({ cwd: projectRoot })).toThrow(DatabaseUrlUnresolvedError)
  })

  test.each(['option', 'environment'])(
    'production reads only the explicitly configured absolute %s state file',
    (source) => {
      vi.stubEnv('NODE_ENV', 'production')
      const stateFile = path.join(projectRoot, 'runtime', 'database.json')
      writeDevDatabaseState(stateFile, {
        url: 'postgres://postgres@127.0.0.1:54998/postgres',
        pid: process.pid,
      })
      writeDevDatabaseState(path.join(projectRoot, '.opensaas', 'dev-db.json'), {
        url: 'postgres://postgres@127.0.0.1:54999/postgres',
        pid: process.pid,
      })
      if (source === 'environment') vi.stubEnv('OPENSAAS_DEV_DATABASE_STATE_FILE', stateFile)

      expect(
        resolveDatabaseUrl({
          cwd: projectRoot,
          stateFile: source === 'option' ? stateFile : undefined,
        }),
      ).toEqual({
        url: 'postgres://postgres@127.0.0.1:54998/postgres',
        provenance: 'dev-database',
      })
    },
  )

  test.each(['option', 'environment'])('production rejects a relative %s state path', (source) => {
    vi.stubEnv('NODE_ENV', 'production')
    const stateFile = path.join(projectRoot, 'runtime', 'database.json')
    writeDevDatabaseState(stateFile, {
      url: 'postgres://postgres@127.0.0.1:54998/postgres',
      pid: process.pid,
    })
    const relativePath = path.relative(process.cwd(), stateFile)
    if (source === 'environment') vi.stubEnv('OPENSAAS_DEV_DATABASE_STATE_FILE', relativePath)

    expect(
      findDatabaseUrl({
        cwd: projectRoot,
        stateFile: source === 'option' ? relativePath : undefined,
      }),
    ).toBeUndefined()
  })

  test('production does not fall back when the explicitly configured state is unavailable', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('OPENSAAS_DEV_DATABASE_STATE_FILE', path.join(projectRoot, 'missing.json'))
    writeDevDatabaseState(path.join(projectRoot, '.opensaas', 'dev-db.json'), {
      url: 'postgres://postgres@127.0.0.1:54999/postgres',
      pid: process.pid,
    })

    expect(findDatabaseUrl({ cwd: projectRoot })).toBeUndefined()
  })

  test('production prefers an explicit database URL over configured Dev state', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const stateFile = path.join(projectRoot, 'runtime', 'database.json')
    vi.stubEnv('OPENSAAS_DEV_DATABASE_STATE_FILE', stateFile)
    writeDevDatabaseState(stateFile, {
      url: 'postgres://postgres@127.0.0.1:54998/postgres',
      pid: process.pid,
    })
    process.env.DATABASE_URL = 'postgres://pooler@example.test:6543/app'
    process.env.DIRECT_DATABASE_URL = 'postgres://direct@example.test:5432/app'

    expect(resolveDatabaseUrl({ cwd: projectRoot })).toEqual({
      url: 'postgres://direct@example.test:5432/app',
      provenance: 'env',
    })
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
