import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  resolveOutputPaths,
  stageWritePaths,
  STAGED_ROOT_PRISMA_CONFIG,
} from '../generator/output-paths.js'
import {
  PartialPromotionError,
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

  it('leaves a new space’s own ref alone, since the snapshot never knew it', () => {
    // Taken before the run seeds "pgvector" for the first time — exactly what
    // `onConfigChange` does, per the comment at its own `snapshotMigrationRefs` call.
    const snapshot = snapshotMigrationRefs(cwd)

    const newSpaceRef = path.join(cwd, 'migrations', 'pgvector', 'refs', 'head.json')
    fs.mkdirSync(path.dirname(newSpaceRef), { recursive: true })
    fs.writeFileSync(newSpaceRef, JSON.stringify({ hash: 'seeded', invariants: [] }), 'utf-8')

    restoreMigrationRefs(cwd, snapshot)

    expect(fs.existsSync(newSpaceRef)).toBe(true)
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

  it('promotes a file a plugin’s afterGenerate wrote into the staged bundle', () => {
    const { paths: live } = resolveOutputPaths(cwd)
    const stagingDir = path.join(cwd, '.opensaas', 'staged')
    const staged = stageWritePaths(live, stagingDir)

    fs.mkdirSync(staged.opensaasDir, { recursive: true })
    fs.writeFileSync(staged.types, 'next', 'utf-8')
    fs.writeFileSync(path.join(staged.opensaasDir, 'auth-types.ts'), 'from the plugin', 'utf-8')

    promoteStagedGeneration(staged, live, stagingDir)

    expect(fs.readFileSync(path.join(live.opensaasDir, 'auth-types.ts'), 'utf-8')).toBe(
      'from the plugin',
    )
  })

  it('leaves no temp file behind, so the bundle only ever holds promoted files', () => {
    const { paths: live } = resolveOutputPaths(cwd)
    const stagingDir = path.join(cwd, '.opensaas', 'staged')
    const staged = stageWritePaths(live, stagingDir)

    fs.mkdirSync(staged.opensaasDir, { recursive: true })
    fs.writeFileSync(staged.types, 'next', 'utf-8')
    fs.writeFileSync(staged.context, 'next', 'utf-8')

    promoteStagedGeneration(staged, live, stagingDir)

    expect(fs.readdirSync(live.opensaasDir).sort()).toEqual(['context.ts', 'types.ts'])
  })

  it('replaces the live file rather than rewriting it, so an open reader keeps whole bytes', () => {
    const { paths: live } = resolveOutputPaths(cwd)
    const stagingDir = path.join(cwd, '.opensaas', 'staged')
    const staged = stageWritePaths(live, stagingDir)

    fs.mkdirSync(live.opensaasDir, { recursive: true })
    fs.writeFileSync(live.types, 'previous', 'utf-8')
    fs.mkdirSync(staged.opensaasDir, { recursive: true })
    fs.writeFileSync(staged.types, 'next', 'utf-8')

    // A second name for the live inode stands in for a reader holding it open:
    // a rename leaves that inode untouched, an in-place copy rewrites it.
    const heldOpen = path.join(cwd, 'held-open')
    fs.linkSync(live.types, heldOpen)
    const inodeBefore = fs.statSync(live.types).ino

    promoteStagedGeneration(staged, live, stagingDir)

    expect(fs.readFileSync(live.types, 'utf-8')).toBe('next')
    expect(fs.readFileSync(heldOpen, 'utf-8')).toBe('previous')
    expect(fs.statSync(live.types).ino).not.toBe(inodeBefore)
  })

  it('promotes the held-back project-root prisma.config.ts', () => {
    const { paths: live } = resolveOutputPaths(cwd)
    const stagingDir = path.join(cwd, '.opensaas', 'staged')
    const staged = stageWritePaths(live, stagingDir)

    fs.writeFileSync(live.prismaConfig, 'previous', 'utf-8')
    fs.mkdirSync(stagingDir, { recursive: true })
    fs.writeFileSync(path.join(stagingDir, STAGED_ROOT_PRISMA_CONFIG), 'next', 'utf-8')
    fs.writeFileSync(staged.prismaConfig, 'the staged run’s own config', 'utf-8')

    promoteStagedGeneration(staged, live, stagingDir)

    expect(fs.readFileSync(live.prismaConfig, 'utf-8')).toBe('next')
  })

  it('lands tables.ts right after the contract artifacts, and prisma.config.ts last of all', () => {
    const { paths: live } = resolveOutputPaths(cwd)
    const stagingDir = path.join(cwd, '.opensaas', 'staged')
    const staged = stageWritePaths(live, stagingDir)

    for (const file of [
      staged.contractModule,
      staged.contractJson,
      staged.contractTypes,
      staged.tables,
      staged.types,
      staged.context,
    ]) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, 'next', 'utf-8')
    }
    fs.mkdirSync(stagingDir, { recursive: true })
    fs.writeFileSync(path.join(stagingDir, STAGED_ROOT_PRISMA_CONFIG), 'next', 'utf-8')

    // A directory where prisma.config.ts belongs forces promotion to stop
    // there, and `PartialPromotionError.promoted` — the accumulator built in
    // swap order — is then the whole promotion order up to that point: proof
    // that tables.ts (ADR-0051's pairing with the Contract module) and every
    // other bundle file all land before the root config does, not just proof
    // of a single pairing.
    fs.mkdirSync(live.prismaConfig, { recursive: true })

    let thrown: unknown
    try {
      promoteStagedGeneration(staged, live, stagingDir)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(PartialPromotionError)
    const promoted = thrown instanceof PartialPromotionError ? thrown.promoted : []
    expect(promoted.slice(0, 4)).toEqual([
      live.contractModule,
      live.contractJson,
      live.contractTypes,
      live.tables,
    ])
    expect(promoted).toHaveLength(6)
    expect(promoted).toEqual(expect.arrayContaining([live.types, live.context]))
    expect(thrown instanceof PartialPromotionError ? thrown.failedOn : undefined).toBe(
      live.prismaConfig,
    )
  })

  it('names the split when promotion stops after the first file', () => {
    const { paths: live } = resolveOutputPaths(cwd)
    const stagingDir = path.join(cwd, '.opensaas', 'staged')
    const staged = stageWritePaths(live, stagingDir)

    fs.mkdirSync(path.dirname(staged.contractModule), { recursive: true })
    fs.writeFileSync(staged.contractModule, 'next', 'utf-8')
    fs.mkdirSync(staged.opensaasDir, { recursive: true })
    fs.writeFileSync(staged.types, 'next', 'utf-8')

    // A directory where the bundle file belongs: the copy through the sibling
    // temp name fails, standing in for the ENOSPC/EACCES/lock this reports.
    fs.mkdirSync(live.types, { recursive: true })

    let thrown: unknown
    try {
      promoteStagedGeneration(staged, live, stagingDir)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(PartialPromotionError)
    expect(thrown).toBeInstanceOf(Error)
    const message = thrown instanceof Error ? thrown.message : ''
    expect(message).toContain(live.types)
    expect(message).toContain('opensaas generate')
    expect(fs.readFileSync(live.contractModule, 'utf-8')).toBe('next')
    expect(fs.existsSync(stagingDir)).toBe(true)
  })
})
