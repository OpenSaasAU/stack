import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPlanArgs, MultipleMigrationHeadsError, resolveMigrationHead } from './db-plan.js'

let cwd: string

function writePackage(name: string, from: string, to: string, createdAt?: string): void {
  const dir = path.join(cwd, 'migrations', 'app', name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'migration.json'), JSON.stringify({ from, to, createdAt }))
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'db-plan-'))
})

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true })
})

describe('resolveMigrationHead', () => {
  it('is null with no migration packages, with or without a db ref', () => {
    expect(resolveMigrationHead(cwd)).toBeNull()
    fs.mkdirSync(path.join(cwd, 'migrations', 'app', 'refs'), { recursive: true })
    fs.writeFileSync(path.join(cwd, 'migrations', 'app', 'refs', 'db.json'), '{"hash":"a"}')
    expect(resolveMigrationHead(cwd)).toBeNull()
  })

  it('follows baseline → change → change to the last target regardless of the db ref', () => {
    writePackage('1_init', 'empty', 'a')
    writePackage('2_pin', 'a', 'b')
    expect(resolveMigrationHead(cwd)).toBe('b')
    writePackage('3_star', 'b', 'c')
    expect(resolveMigrationHead(cwd)).toBe('c')
  })

  it('plans from the latest package after add, remove, add (a cycle)', () => {
    writePackage('0720_init', 'empty', 'a', '2026-07-20T09:00:00Z')
    writePackage('0720_add_archived', 'a', 'b', '2026-07-20T09:05:10Z')
    writePackage('0720_drop_star', 'b', 'a', '2026-07-20T09:05:30Z')
    expect(resolveMigrationHead(cwd)).toBe('a')
    writePackage('0721_add_again', 'a', 'b', '2026-07-21T09:00:00Z')
    expect(resolveMigrationHead(cwd)).toBe('b')
  })

  it('walks the chain from the baseline when a manifest has no createdAt', () => {
    writePackage('1_init', 'empty', 'a')
    writePackage('2_add', 'a', 'b')
    writePackage('3_drop', 'b', 'a')
    expect(resolveMigrationHead(cwd)).toBe('a')
  })

  it('names the --from that works when no origin can be found', () => {
    writePackage('1_a', 'a', 'b')
    writePackage('2_b', 'b', 'a')
    expect(() => resolveMigrationHead(cwd)).toThrow(/--from a/)
  })

  it('names a malformed manifest', () => {
    const dir = path.join(cwd, 'migrations', 'app', '1_bad')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'migration.json'), '{')
    expect(() => resolveMigrationHead(cwd)).toThrow(/1_bad/)
  })

  it('refuses a fork, naming directories and a working --from', () => {
    writePackage('1_init', 'empty', 'a', '2026-07-20T09:00:00Z')
    writePackage('2_x', 'a', 'b', '2026-07-20T10:00:00Z')
    writePackage('2_y', 'a', 'c', '2026-07-20T11:00:00Z')
    const error = (() => {
      try {
        resolveMigrationHead(cwd)
      } catch (e) {
        return e
      }
    })()
    expect(error).toBeInstanceOf(MultipleMigrationHeadsError)
    expect(String(error)).toMatch(/2_y.*2_x/)
    expect(String(error)).toMatch(/--from c/)
    expect(buildPlanArgs(cwd, ['--from', 'b'])).toEqual(['migration', 'plan', '--from', 'b'])
  })

  it('names the newer fork first and says the other must be removed or joined', () => {
    writePackage('1_x', 'a', 'b', '2026-07-20T10:00:00Z')
    writePackage('2_y', 'a', 'c', '2026-07-20T11:00:00Z')
    expect(() => resolveMigrationHead(cwd)).toThrow(/--from c.*1_x must then be removed or joined/)
  })

  it('treats a fork as resolved once a later package exists, warning about the leaf', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writePackage('1_a', 'a', 'b', '2026-07-20T09:00:00Z')
    writePackage('2_b', 'a', 'c', '2026-07-20T10:00:00Z')
    writePackage('3_merge', 'b', 'd', '2026-07-20T11:00:00Z')
    expect(resolveMigrationHead(cwd)).toBe('d')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('2_b'))
    writePackage('4_next', 'd', 'e', '2026-07-20T12:00:00Z')
    expect(resolveMigrationHead(cwd)).toBe('e')
    warn.mockRestore()
  })

  it('is not fooled by a package stamped ahead of a later one', () => {
    writePackage('1_init', 'empty', 'a', '2026-07-20T09:00:00Z')
    writePackage('2_add', 'a', 'b', '2026-07-25T09:00:00Z')
    writePackage('3_drop', 'b', 'a', '2026-07-21T09:00:00Z')
    expect(resolveMigrationHead(cwd)).toBe('a')
  })

  it('resolves a fork a sibling branch continues past even without timestamps', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writePackage('1_init', 'empty', 'a')
    writePackage('2_x', 'a', 'b')
    writePackage('2_y', 'a', 'c')
    writePackage('3_merge', 'b', 'd')
    expect(resolveMigrationHead(cwd)).toBe('d')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('2_y'))
    warn.mockRestore()
  })

  it('names the package it chose when walking without timestamps', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writePackage('1_init', 'empty', 'a')
    writePackage('2_add', 'a', 'b')
    writePackage('3_drop', 'b', 'a')
    expect(resolveMigrationHead(cwd)).toBe('a')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('3_drop'))
    warn.mockRestore()
  })

  it('refuses a fork when walking the chain without timestamps', () => {
    writePackage('1_init', 'empty', 'a')
    writePackage('2_x', 'a', 'b')
    writePackage('2_y', 'a', 'c')
    expect(() => resolveMigrationHead(cwd)).toThrow(/2_y.*2_x/)
  })
})

describe('buildPlanArgs', () => {
  it('passes the head as --from and forwards the rest', () => {
    writePackage('1_init', 'empty', 'a')
    expect(buildPlanArgs(cwd, ['--name', 'x'])).toEqual([
      'migration',
      'plan',
      '--from',
      'a',
      '--name',
      'x',
    ])
  })

  it('plans the baseline with no packages', () => {
    expect(buildPlanArgs(cwd, ['--name', 'init'])).toEqual(['migration', 'plan', '--name', 'init'])
  })

  it('keeps a --from=<hash> and ignores one after --', () => {
    writePackage('1_init', 'empty', 'a')
    expect(buildPlanArgs(cwd, ['--from=z'])).toEqual(['migration', 'plan', '--from=z'])
    expect(buildPlanArgs(cwd, ['--', '--from'])).toEqual([
      'migration',
      'plan',
      '--from',
      'a',
      '--',
      '--from',
    ])
  })

  it('keeps a caller-supplied --from', () => {
    writePackage('1_init', 'empty', 'a')
    expect(buildPlanArgs(cwd, ['--from', 'z'])).toEqual(['migration', 'plan', '--from', 'z'])
  })
})
