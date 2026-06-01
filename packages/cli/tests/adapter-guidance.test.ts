import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Regression guard for the database-adapter guidance.
 *
 * The installed `@prisma/adapter-better-sqlite3` exports `PrismaBetterSqlite3`
 * and is constructed with `{ url }`. An earlier, outdated form
 * (`PrismaBetterSQLite3` imported alongside `better-sqlite3` and constructed
 * with a `new Database(...)` instance) does not match the installed package, so
 * any code an LLM copied from it would not run. This test scans the guidance
 * surfaces (docs, specs, CLAUDE.md files, the migration plugin, and the
 * generator/migration source that emits example code) and fails if the
 * outdated pattern reappears.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')

// Curated guidance surfaces — the places a user or LLM reads to learn the API.
const SCAN_ROOTS = [
  'CLAUDE.md',
  'docs/content',
  'specs',
  'claude-plugins',
  'packages/cli/src',
  'packages/cli/CLAUDE.md',
  'packages/core/src',
  'packages/core/CLAUDE.md',
]

const SCAN_EXTENSIONS = new Set(['.md', '.ts'])
const ADAPTER_PACKAGE = '@prisma/adapter-better-sqlite3'
// Built by concatenation so this test file does not match its own scan.
const WRONG_CLASS_NAME = 'PrismaBetter' + 'SQLite3'
const MANUAL_DB_INSTANCE = 'new ' + 'Database('

function collectFiles(absRoot: string): string[] {
  if (!fs.existsSync(absRoot)) return []
  const stat = fs.statSync(absRoot)
  if (stat.isFile()) return SCAN_EXTENSIONS.has(path.extname(absRoot)) ? [absRoot] : []
  const out: string[] = []
  for (const entry of fs.readdirSync(absRoot, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const full = path.join(absRoot, entry.name)
    if (entry.isDirectory()) out.push(...collectFiles(full))
    else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) out.push(full)
  }
  return out
}

const files = SCAN_ROOTS.flatMap((root) => collectFiles(path.join(repoRoot, root)))
  // Exclude this guard so its needles don't flag itself.
  .filter((file) => file !== fileURLToPath(import.meta.url))

describe('database-adapter guidance stays current', () => {
  it('scans a non-trivial set of guidance files', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('never uses the wrong adapter class name', () => {
    const offenders = files.filter((file) =>
      fs.readFileSync(file, 'utf-8').includes(WRONG_CLASS_NAME),
    )
    expect(offenders.map((f) => path.relative(repoRoot, f))).toEqual([])
  })

  it('never constructs the SQLite adapter from a manual Database instance', () => {
    const offenders = files.filter((file) => {
      const content = fs.readFileSync(file, 'utf-8')
      return content.includes(ADAPTER_PACKAGE) && content.includes(MANUAL_DB_INSTANCE)
    })
    expect(offenders.map((f) => path.relative(repoRoot, f))).toEqual([])
  })
})
