import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildPlanArgs, MultipleMigrationHeadsError, resolveMigrationHead } from './db-plan.js'

let cwd: string

function writePackage(name: string, from: string, to: string): void {
  const dir = path.join(cwd, 'migrations', 'app', name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'migration.json'), JSON.stringify({ from, to }))
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

  it('refuses a graph with no head', () => {
    writePackage('1_a', 'a', 'b')
    writePackage('2_b', 'b', 'a')
    expect(() => resolveMigrationHead(cwd)).toThrow(/no head/)
  })

  it('names a malformed manifest', () => {
    const dir = path.join(cwd, 'migrations', 'app', '1_bad')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'migration.json'), '{')
    expect(() => resolveMigrationHead(cwd)).toThrow(/1_bad/)
  })

  it('refuses when the graph has several heads', () => {
    writePackage('1_init', 'empty', 'a')
    writePackage('2_x', 'a', 'b')
    writePackage('2_y', 'a', 'c')
    expect(() => resolveMigrationHead(cwd)).toThrow(MultipleMigrationHeadsError)
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
