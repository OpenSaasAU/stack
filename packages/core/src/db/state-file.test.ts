import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { identifiesLiveProcess, processStartTime } from './process-identity.js'
import {
  clearDevDatabaseState,
  devDatabaseStatePath,
  readDevDatabaseState,
  writeDevDatabaseState,
} from './state-file.js'

vi.mock('./process-identity.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./process-identity.js')>()
  return {
    ...actual,
    processStartTime: vi.fn(actual.processStartTime),
    identifiesLiveProcess: vi.fn(actual.identifiesLiveProcess),
  }
})

const mockedProcessStartTime = vi.mocked(processStartTime)
const mockedIdentifiesLiveProcess = vi.mocked(identifiesLiveProcess)

describe('state-file', () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'opensaas-state-file-'))
    mockedProcessStartTime.mockReset().mockReturnValue(undefined)
    mockedIdentifiesLiveProcess.mockReset().mockReturnValue(true)
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  test('devDatabaseStatePath honours an explicit cwd, defaulting to process.cwd()', () => {
    expect(devDatabaseStatePath({ cwd: projectRoot })).toBe(
      path.join(projectRoot, '.opensaas', 'dev-db.json'),
    )
    expect(devDatabaseStatePath()).toBe(path.join(process.cwd(), '.opensaas', 'dev-db.json'))
  })

  test('devDatabaseStatePath resolves an explicit stateFile absolutely, bypassing cwd', () => {
    const relative = path.join('nested', 'state.json')
    expect(devDatabaseStatePath({ cwd: projectRoot, stateFile: relative })).toBe(
      path.resolve(relative),
    )
  })

  test('writing stamps startedAt from the recorded pid, when this platform can supply one', () => {
    mockedProcessStartTime.mockImplementation((pid) => (pid === 4242 ? 1_234 : undefined))

    const file = devDatabaseStatePath({ cwd: projectRoot })
    writeDevDatabaseState(file, { url: 'postgres://postgres@127.0.0.1:5432/postgres', pid: 4242 })

    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      url: 'postgres://postgres@127.0.0.1:5432/postgres',
      pid: 4242,
      startedAt: 1_234,
    })
  })

  test('writing omits startedAt when this platform cannot supply one', () => {
    mockedProcessStartTime.mockReturnValue(undefined)

    const file = devDatabaseStatePath({ cwd: projectRoot })
    writeDevDatabaseState(file, { url: 'postgres://postgres@127.0.0.1:5432/postgres', pid: 4242 })

    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      url: 'postgres://postgres@127.0.0.1:5432/postgres',
      pid: 4242,
    })
  })

  test('no file at all reads as undefined', () => {
    expect(readDevDatabaseState({ cwd: projectRoot })).toBeUndefined()
  })

  test('unreadable JSON reads as undefined', () => {
    const file = devDatabaseStatePath({ cwd: projectRoot })
    writeDevDatabaseState(file, { url: 'postgres://x', pid: 4242 })
    // Corrupt it after the fact, past writeDevDatabaseState's own validation.
    rmSync(file)
    writeFileSync(file, 'not json', 'utf8')

    expect(readDevDatabaseState({ cwd: projectRoot })).toBeUndefined()
  })

  test('a shape that is not the state file schema reads as undefined', () => {
    const file = devDatabaseStatePath({ cwd: projectRoot })
    writeDevDatabaseState(file, { url: 'postgres://x', pid: 4242 })
    writeFileSync(file, JSON.stringify({ url: 'postgres://x' }), 'utf8') // no pid
    expect(readDevDatabaseState({ cwd: projectRoot })).toBeUndefined()
  })

  test('defers staleness entirely to identifiesLiveProcess', () => {
    const file = devDatabaseStatePath({ cwd: projectRoot })
    writeDevDatabaseState(file, { url: 'postgres://x', pid: 4242 })

    mockedIdentifiesLiveProcess.mockReturnValue(false)
    expect(readDevDatabaseState({ cwd: projectRoot })).toBeUndefined()

    mockedIdentifiesLiveProcess.mockReturnValue(true)
    expect(readDevDatabaseState({ cwd: projectRoot })?.url).toBe('postgres://x')
  })

  test('passes the parsed record, startedAt included, to identifiesLiveProcess', () => {
    mockedProcessStartTime.mockReturnValue(5_000)
    const file = devDatabaseStatePath({ cwd: projectRoot })
    writeDevDatabaseState(file, { url: 'postgres://x', pid: 4242 })

    readDevDatabaseState({ cwd: projectRoot })

    expect(mockedIdentifiesLiveProcess).toHaveBeenCalledWith({
      url: 'postgres://x',
      pid: 4242,
      startedAt: 5_000,
    })
  })

  test('clearDevDatabaseState removes the file only while it still names url', () => {
    const file = devDatabaseStatePath({ cwd: projectRoot })
    writeDevDatabaseState(file, { url: 'postgres://mine', pid: 4242 })

    clearDevDatabaseState(file, 'postgres://someone-else')
    expect(existsSync(file)).toBe(true)

    clearDevDatabaseState(file, 'postgres://mine')
    expect(existsSync(file)).toBe(false)
  })
})
