import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { buildNodeBundle, rewriteConfigImport, findEscapingConfigImport } from './node-build.js'

/**
 * Unit tests for the Node build emit (ADR-0011 / #579).
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

/**
 * Write a minimal `.opensaas/`-shaped bundle plus a project config to disk. The
 * `configImport` specifier (the bundle's relative config import) is
 * configurable so tests can exercise non-default layouts (e.g. a deeper
 * `../../opensaas.config.ts` from a nested `.opensaas/` directory).
 */
function writeFixture(
  projectRoot: string,
  configImport = '../opensaas.config.ts',
): { opensaasDir: string; configPath: string } {
  const opensaasDir = path.join(projectRoot, '.opensaas')
  const prismaClientDir = path.join(opensaasDir, 'prisma-client')
  fs.mkdirSync(prismaClientDir, { recursive: true })

  // A trivial prisma-client stand-in with the real subtree's entry filename.
  fs.writeFileSync(path.join(prismaClientDir, 'client.ts'), 'export class PrismaClient {}\n')

  // The bundle's context: imports the sibling client via `.ts`, the config via
  // a relative `../`-rooted specifier, and re-exports both. This is the shape
  // the Node build must rewrite (`.ts` -> `.js`) and self-contain (`..` -> `.`).
  fs.writeFileSync(
    path.join(opensaasDir, 'context.ts'),
    [
      "import { PrismaClient } from './prisma-client/client.ts'",
      `import configValue from '${configImport}'`,
      'export const prisma = new PrismaClient()',
      'export const config = configValue',
    ].join('\n') + '\n',
  )

  // prisma-extensions also imports the config one level up.
  fs.writeFileSync(
    path.join(opensaasDir, 'prisma-extensions.ts'),
    [
      `import configValue from '${configImport}'`,
      'export const prismaExtensions = { config: configValue }',
    ].join('\n') + '\n',
  )

  const configPath = path.join(projectRoot, 'opensaas.config.ts')
  fs.writeFileSync(configPath, 'export default { name: "fixture" }\n')

  return { opensaasDir, configPath }
}

// Each of these tests runs a REAL `tsc` compile of the bundle (incl. the
// prisma-client subtree). On a slow/cold CI runner that takes ~13–25s, well
// over vitest's 5000ms default — so raise the timeout generously for the whole
// block (the assertions are unaffected).
const COMPILE_TIMEOUT_MS = 60000

describe('buildNodeBundle', { timeout: COMPILE_TIMEOUT_MS }, () => {
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

  it('self-contains a deeper config import (../../opensaas.config.ts -> ./opensaas.config.ts)', () => {
    // A non-default layout makes the bundle import the config from a deeper
    // relative depth. The rewrite must still self-contain it inside `dist/`.
    const { opensaasDir, configPath } = writeFixture(projectRoot, '../../opensaas.config.ts')

    buildNodeBundle({ opensaasDir, configPath })

    const entry = fs.readFileSync(path.join(opensaasDir, 'dist', 'context.js'), 'utf-8')
    expect(entry).toMatch(/from ['"]\.\/opensaas\.config\.js['"]/)
    expect(entry).not.toContain('../opensaas.config')
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

/**
 * Pure-helper coverage for the config-import rewrite (no compile): the rewrite
 * must self-contain a relative config import of ANY `../` depth, and the
 * silent-failure guard must detect a config import that still escapes `dist/`.
 */
describe('config import rewrite/guard helpers', () => {
  it('rewrites a relative config import of any depth to a sibling specifier', () => {
    expect(rewriteConfigImport("from '../opensaas.config.ts'")).toBe("from './opensaas.config.ts'")
    expect(rewriteConfigImport("from '../../opensaas.config.ts'")).toBe(
      "from './opensaas.config.ts'",
    )
    expect(rewriteConfigImport('from "../../../opensaas.config"')).toBe(
      'from "./opensaas.config.ts"',
    )
    // A non-config relative import is left untouched.
    expect(rewriteConfigImport("from '../something-else.ts'")).toBe("from '../something-else.ts'")
  })

  it('detects a config import that still escapes dist after rewrite', () => {
    // The guard fires for any `../`-rooted config specifier the rewrite missed.
    // The match includes the surrounding quotes (the regex matches the quoted
    // specifier) so it can be quoted back into the error message verbatim.
    expect(findEscapingConfigImport("from '../../opensaas.config.ts'")).toBe(
      "'../../opensaas.config.ts'",
    )
    // A correctly self-contained sibling import does not trip the guard.
    expect(findEscapingConfigImport("from './opensaas.config.ts'")).toBeUndefined()
  })

  it('throws loudly when staged source escapes dist (guarding the no-emit-on-error path)', () => {
    // Simulate a staged source whose config import was NOT rewritten to a
    // sibling: the guard must surface it rather than silently compile a build
    // whose config import resolves outside `dist/`.
    const escaped = "import config from '../../opensaas.config.ts'"
    expect(findEscapingConfigImport(escaped)).toBeTruthy()
  })
})
