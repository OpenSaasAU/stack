import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveOutputPaths, stageWritePaths } from '../generator/output-paths.js'
import {
  promoteStagedGeneration,
  restoreMigrationRefs,
  snapshotMigrationRefs,
} from './staged-reconcile.js'

describe('the migrations refs the loop owns', () => {
  let cwd: string

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'opensaas-refs-'))
    fs.mkdirSync(path.join(cwd, 'migrations', 'app', 'refs'), { recursive: true })
    fs.writeFileSync(
      path.join(cwd, 'migrations', 'app', 'refs', 'db.json'),
      JSON.stringify({ hash: 'before', invariants: [] }),
      'utf-8',
    )
  })

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true })
  })

  it('puts an advanced ref back where it was', () => {
    const snapshot = snapshotMigrationRefs(cwd)

    fs.writeFileSync(
      path.join(cwd, 'migrations', 'app', 'refs', 'db.json'),
      JSON.stringify({ hash: 'after', invariants: [] }),
      'utf-8',
    )
    restoreMigrationRefs(cwd, snapshot)

    const restored = fs.readFileSync(
      path.join(cwd, 'migrations', 'app', 'refs', 'db.json'),
      'utf-8',
    )
    expect(JSON.parse(restored).hash).toBe('before')
  })

  it('removes a ref the discarded run introduced', () => {
    const snapshot = snapshotMigrationRefs(cwd)

    const introduced = path.join(cwd, 'migrations', 'app', 'refs', 'staged.json')
    fs.writeFileSync(introduced, JSON.stringify({ hash: 'ghost', invariants: [] }), 'utf-8')
    restoreMigrationRefs(cwd, snapshot)

    expect(fs.existsSync(introduced)).toBe(false)
  })

  it('reads nothing from a project that has no migrations directory yet', () => {
    fs.rmSync(path.join(cwd, 'migrations'), { recursive: true })
    expect(snapshotMigrationRefs(cwd)).toEqual([])
  })
})

describe('promoting a staged generation', () => {
  let cwd: string

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'opensaas-promote-'))
  })

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true })
  })

  it('writes the staged contract and bundle over the live ones and clears the staging', () => {
    const { paths: live } = resolveOutputPaths(cwd)
    const stagingDir = path.join(cwd, '.opensaas', 'staged')
    const staged = stageWritePaths(live, stagingDir)

    for (const file of [live.contractModule, live.contractJson, live.types, live.context]) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, 'previous', 'utf-8')
    }
    for (const file of [staged.contractModule, staged.contractJson, staged.types, staged.context]) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, 'next', 'utf-8')
    }

    promoteStagedGeneration(staged, live, stagingDir)

    expect(fs.readFileSync(live.contractModule, 'utf-8')).toBe('next')
    expect(fs.readFileSync(live.contractJson, 'utf-8')).toBe('next')
    expect(fs.readFileSync(live.types, 'utf-8')).toBe('next')
    expect(fs.readFileSync(live.context, 'utf-8')).toBe('next')
    expect(fs.existsSync(stagingDir)).toBe(false)
  })
})
