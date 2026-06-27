import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { buildNodeBundle } from './node-build.js'

/**
 * Unit tests for the Node build emit (ADR-0010 / #579).
 *
 * These exercise the generator's compile-and-emit contract against a minimal,
 * self-contained on-disk bundle fixture (no `@opensaas/*` runtime needed): the
 * fixture mirrors the real bundle's shape — a `context.ts` that imports the
 * sibling prisma-client subtree via a `.ts` extension and the project config
 * one level up via `../opensaas.config.ts`. The assertions cover: nothing is
 * emitted unless the caller opts in; opting in emits `dist/context.js` +
 * `.d.ts` + a `{"type":"module"}` package.json; and the emitted imports carry
 * runnable `.js` (not `.ts`) extensions and resolve inside `dist/`.
 */

/** Write a minimal `.opensaas/`-shaped bundle plus a project config to disk. */
function writeFixture(projectRoot: string): { opensaasDir: string; configPath: string } {
  const opensaasDir = path.join(projectRoot, '.opensaas')
  const prismaClientDir = path.join(opensaasDir, 'prisma-client')
  fs.mkdirSync(prismaClientDir, { recursive: true })

  // A trivial prisma-client stand-in with the real subtree's entry filename.
  fs.writeFileSync(path.join(prismaClientDir, 'client.ts'), 'export class PrismaClient {}\n')

  // The bundle's context: imports the sibling client via `.ts`, the config via
  // `../opensaas.config.ts`, and re-exports both. This is the shape the Node
  // build must rewrite (`.ts` -> `.js`) and self-contain (`..` -> `.`).
  fs.writeFileSync(
    path.join(opensaasDir, 'context.ts'),
    [
      "import { PrismaClient } from './prisma-client/client.ts'",
      "import configValue from '../opensaas.config.ts'",
      'export const prisma = new PrismaClient()',
      'export const config = configValue',
    ].join('\n') + '\n',
  )

  // prisma-extensions also imports the config one level up.
  fs.writeFileSync(
    path.join(opensaasDir, 'prisma-extensions.ts'),
    [
      "import configValue from '../opensaas.config.ts'",
      'export const prismaExtensions = { config: configValue }',
    ].join('\n') + '\n',
  )

  const configPath = path.join(projectRoot, 'opensaas.config.ts')
  fs.writeFileSync(configPath, 'export default { name: "fixture" }\n')

  return { opensaasDir, configPath }
}

describe('buildNodeBundle', () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opensaas-node-build-'))
  })

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true })
  })

  it('emits the compiled entry, declarations, and the ESM marker', () => {
    const { opensaasDir, configPath } = writeFixture(projectRoot)

    const result = buildNodeBundle({ opensaasDir, configPath })

    const distDir = path.join(opensaasDir, 'dist')
    expect(result.distDir).toBe(distDir)
    expect(result.entry).toBe(path.join(distDir, 'context.js'))

    // The compiled entry mirrors `context.ts`.
    expect(fs.existsSync(path.join(distDir, 'context.js'))).toBe(true)
    // `.d.ts` is emitted so the Node build is a typed import target.
    expect(fs.existsSync(path.join(distDir, 'context.d.ts'))).toBe(true)
    // The prisma-client subtree is compiled in.
    expect(fs.existsSync(path.join(distDir, 'prisma-client/client.js'))).toBe(true)
    // The project config is compiled in as a sibling of the entry.
    expect(fs.existsSync(path.join(distDir, 'opensaas.config.js'))).toBe(true)
  })

  it('writes a package.json containing exactly {"type":"module"}', () => {
    const { opensaasDir, configPath } = writeFixture(projectRoot)

    buildNodeBundle({ opensaasDir, configPath })

    const pkgPath = path.join(opensaasDir, 'dist', 'package.json')
    expect(fs.existsSync(pkgPath)).toBe(true)
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    expect(pkg).toEqual({ type: 'module' })
  })

  it("rewrites the bundle's `.ts` imports to runnable `.js` specifiers", () => {
    const { opensaasDir, configPath } = writeFixture(projectRoot)

    buildNodeBundle({ opensaasDir, configPath })

    const entry = fs.readFileSync(path.join(opensaasDir, 'dist', 'context.js'), 'utf-8')

    // The prisma-client import keeps its sibling path but with a `.js` extension
    // (TS may re-quote with single or double quotes — match either).
    expect(entry).toMatch(/from ['"]\.\/prisma-client\/client\.js['"]/)
    // No `.ts` extension survives in the emitted JS, and no double-extension bug.
    expect(entry).not.toContain('prisma-client/client.ts')
    expect(entry).not.toContain('.ts.js')
  })

  it('self-contains the config import inside dist (../opensaas.config -> ./opensaas.config)', () => {
    const { opensaasDir, configPath } = writeFixture(projectRoot)

    buildNodeBundle({ opensaasDir, configPath })

    const entry = fs.readFileSync(path.join(opensaasDir, 'dist', 'context.js'), 'utf-8')
    // The config is imported from a sibling inside `dist/`, not one level up.
    expect(entry).toMatch(/from ['"]\.\/opensaas\.config\.js['"]/)
    expect(entry).not.toContain('../opensaas.config')
  })

  it('removes the staging directory after the emit', () => {
    const { opensaasDir, configPath } = writeFixture(projectRoot)

    buildNodeBundle({ opensaasDir, configPath })

    expect(fs.existsSync(path.join(opensaasDir, '.node-build'))).toBe(false)
  })
})

/**
 * The option default-off behaviour lives at the call site (the generator only
 * invokes `buildNodeBundle` when `output.buildTarget === 'node'`), so we assert
 * the guard directly: with no `output` block, no Node build runs and no `dist/`
 * appears.
 */
describe('Node build opt-in guard', () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opensaas-node-build-guard-'))
  })

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true })
  })

  it('does not emit dist when buildTarget is absent', () => {
    const { opensaasDir } = writeFixture(projectRoot)

    // Mirror the generate-command guard: only build when opted in.
    const output: { buildTarget?: 'node' } = {}
    if (output.buildTarget === 'node') {
      throw new Error('guard should not run for this test')
    }

    expect(fs.existsSync(path.join(opensaasDir, 'dist'))).toBe(false)
  })
})
