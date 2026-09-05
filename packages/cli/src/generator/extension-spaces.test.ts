import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import type { ContractData } from '@opensaas/stack-core'
import { seedExtensionContractSpaces, ExtensionSubpathError } from './extension-spaces.js'

const PGVECTOR_HASH = '3d2c56a2944685bd21b05bc8a8d73164397df51c014201902932fbe7e80ff1b8'
const PGVECTOR_PACKAGE = '20260601T0000_install_vector_extension'

// The scratch projects live inside the package so node resolution walks up to
// its node_modules and finds the declared packs.
const testsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests')

const scratchDirs: string[] = []

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function scratchProject(): string {
  const dir = fs.mkdtempSync(path.join(testsDir, 'tmp-seed-'))
  scratchDirs.push(dir)
  return dir
}

function contract(extensions: ContractData['extensions'] = []): ContractData {
  return { models: [], namespaces: [], enums: [], extensions }
}

const pgvector = { name: 'pgvector', from: '@prisma/orm-extension-pgvector' }

function readSpaceFiles(cwd: string): string[] {
  const root = path.join(cwd, 'migrations')
  if (!fs.existsSync(root)) return []
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort()) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else files.push(path.relative(root, full))
    }
  }
  walk(root)
  return files.sort()
}

describe('seedExtensionContractSpaces', () => {
  it('does nothing and touches no disk when no pack is declared', async () => {
    const cwd = scratchProject()

    const result = await seedExtensionContractSpaces(cwd, contract())

    expect(result.seeded).toEqual([])
    expect(fs.existsSync(path.join(cwd, 'migrations'))).toBe(false)
  })

  it('materialises the pack, head ref and snapshot for a declared pack', async () => {
    const cwd = scratchProject()

    const result = await seedExtensionContractSpaces(cwd, contract([pgvector]))

    expect(result.seeded).toEqual([
      {
        pack: 'pgvector',
        spaceId: 'pgvector',
        action: 'updated',
        migrationDirs: [PGVECTOR_PACKAGE],
      },
    ])
    expect(readSpaceFiles(cwd)).toEqual([
      path.join('pgvector', PGVECTOR_PACKAGE, 'migration.json'),
      path.join('pgvector', PGVECTOR_PACKAGE, 'ops.json'),
      path.join('pgvector', 'refs', 'head.json'),
      path.join('snapshots', PGVECTOR_HASH, 'contract.d.ts'),
      path.join('snapshots', PGVECTOR_HASH, 'contract.json'),
    ])
  })

  it('pins the head ref at the installed pack version', async () => {
    const cwd = scratchProject()

    await seedExtensionContractSpaces(cwd, contract([pgvector]))

    const head = JSON.parse(
      fs.readFileSync(path.join(cwd, 'migrations/pgvector/refs/head.json'), 'utf-8'),
    )
    expect(head.hash).toBe(PGVECTOR_HASH)
    expect(head.invariants).toEqual(['pgvector:install-vector-v1'])
  })

  // The load-bearing property: `generate` runs on every build, so a second run
  // must leave the committed space byte-identical or CI's dirty-tree check
  // fails on every unrelated PR.
  it('is byte-identical on a second run and reports the space unchanged', async () => {
    const cwd = scratchProject()

    await seedExtensionContractSpaces(cwd, contract([pgvector]))
    const before = readSpaceFiles(cwd).map((file) =>
      fs.readFileSync(path.join(cwd, 'migrations', file), 'utf-8'),
    )

    const second = await seedExtensionContractSpaces(cwd, contract([pgvector]))

    expect(second.seeded[0].action).toBe('unchanged')
    expect(second.seeded[0].migrationDirs).toEqual([])
    const after = readSpaceFiles(cwd).map((file) =>
      fs.readFileSync(path.join(cwd, 'migrations', file), 'utf-8'),
    )
    expect(after).toEqual(before)
  })

  // A pack upgrade ships a different head hash, which must surface as a
  // rewritten head.json — i.e. as a generate diff, not a silent no-op.
  it('rewrites a stale head ref, so a pack version bump shows up as a diff', async () => {
    const cwd = scratchProject()
    await seedExtensionContractSpaces(cwd, contract([pgvector]))

    const headPath = path.join(cwd, 'migrations/pgvector/refs/head.json')
    const stale = { hash: 'a'.repeat(64), invariants: ['pgvector:install-vector-v0'] }
    fs.writeFileSync(headPath, JSON.stringify(stale))

    const result = await seedExtensionContractSpaces(cwd, contract([pgvector]))

    expect(result.seeded[0].action).toBe('updated')
    expect(JSON.parse(fs.readFileSync(headPath, 'utf-8')).hash).toBe(PGVECTOR_HASH)
  })

  it('refuses a pack that does not publish /control, naming both', async () => {
    const cwd = scratchProject()
    const packageDir = path.join(cwd, 'node_modules', '@fake', 'no-control')
    fs.mkdirSync(packageDir, { recursive: true })
    fs.writeFileSync(path.join(packageDir, 'pack.mjs'), 'export default {}\n')
    fs.writeFileSync(path.join(packageDir, 'runtime.mjs'), 'export default {}\n')
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({
        name: '@fake/no-control',
        version: '1.0.0',
        type: 'module',
        exports: { './pack': './pack.mjs', './runtime': './runtime.mjs' },
      }),
    )

    const declaration = contract([{ name: 'broken', from: '@fake/no-control' }])

    await expect(seedExtensionContractSpaces(cwd, declaration)).rejects.toThrow(
      ExtensionSubpathError,
    )
    await expect(seedExtensionContractSpaces(cwd, declaration)).rejects.toThrow(
      /"broken".*"@fake\/no-control\/control"/s,
    )
    expect(fs.existsSync(path.join(cwd, 'migrations'))).toBe(false)
  })

  it('refuses a pack that is not installed at all', async () => {
    const cwd = scratchProject()

    await expect(
      seedExtensionContractSpaces(cwd, contract([{ name: 'ghost', from: '@fake/not-installed' }])),
    ).rejects.toThrow(ExtensionSubpathError)
  })
})
