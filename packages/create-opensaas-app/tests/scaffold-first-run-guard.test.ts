import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'fs-extra'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Isolated first-run guard for the documented onboarding flow.
 *
 * Unlike the old in-place smoke test, this never touches `examples/starter`: it
 * invokes the **real built `create-opensaas-app` binary** to scaffold a project
 * into an OS temp dir (`os.tmpdir()`), then runs `generate` and asserts the
 * project reaches a Generated bundle. This guards the onboarding promise —
 * scaffolding needs no database, and reaches `pnpm dev` with no manual edits —
 * end-to-end. See ADR-0002 and ADR-0063.
 *
 * ## How the toolchain is resolved offline (no networked install)
 *
 * A project scaffolded into a temp dir has no `node_modules`, and a real
 * `pnpm install` would hit the npm registry — which this guard must not do on
 * the PR gate. Instead we **symlink the workspace example's already-installed
 * `node_modules`** (`examples/starter/node_modules`, populated by the repo's own
 * `pnpm install` during CI setup) into the temp project. That gives the project
 * the exact toolchain the working example resolves — the `opensaas` CLI,
 * Prisma, `jiti`, `dotenv` — entirely from deps that are already on disk. We
 * then run `generate` via the project's `node_modules/.bin`, so no registry
 * round-trip happens.
 *
 * The guard is skipped when its prerequisites aren't present — the built CLI
 * binary, the built `opensaas` CLI the scaffolded project's `generate` script
 * invokes, and an installed example `node_modules` to borrow. A bare `vitest`
 * run without a prior `pnpm install && pnpm build` therefore skips rather than
 * fails spuriously.
 *
 * It is also gated behind `RUN_SCAFFOLD_GUARD=1` so it stays out of the fast
 * unit lane (`turbo run test`) and runs only in the heavier `e2e` CI job, where
 * `pnpm install` + `pnpm build` have run first. See ADR-0002 for why this is an
 * `e2e` guard rather than a unit test.
 */

const run = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')

/** The real binary the guard exercises (built by `pnpm build`). */
const createCli = path.join(repoRoot, 'packages/create-opensaas-app/dist/index.js')
/** The `opensaas` CLI the scaffolded project's `generate` script invokes. */
const opensaasCli = path.join(repoRoot, 'packages/cli/dist/index.js')

/**
 * The basic template comes from `examples/starter`; its installed
 * `node_modules` is the offline toolchain we lend to the scaffolded project.
 * Fall back to `starter-auth` if only that example is installed.
 */
const toolchainNodeModules = [
  path.join(repoRoot, 'examples/starter/node_modules'),
  path.join(repoRoot, 'examples/starter-auth/node_modules'),
].find((dir) => fs.existsSync(path.join(dir, '.bin', 'opensaas')))

/**
 * Opt-in flag set by the `e2e` CI job. Keeps this slow guard out of the fast
 * unit lane (`turbo run test`), where the built artifacts also happen to exist.
 */
const guardEnabled = process.env.RUN_SCAFFOLD_GUARD === '1'

const prerequisitesPresent =
  guardEnabled &&
  fs.existsSync(createCli) &&
  fs.existsSync(opensaasCli) &&
  toolchainNodeModules !== undefined

/** `git status --porcelain` output, the set of paths git reports as changed. */
async function gitPorcelain(): Promise<string> {
  const { stdout } = await run('git', ['status', '--porcelain'], { cwd: repoRoot })
  return stdout.trim()
}

describe.skipIf(!prerequisitesPresent)('scaffold first-run guard (isolated)', () => {
  let tmpRoot = ''
  let projectDir = ''
  let treeBefore = ''

  beforeAll(async () => {
    // Snapshot the working tree before the run so we can prove the guard itself
    // introduces no changes — without assuming the tree was already pristine
    // (during local dev there are usually uncommitted edits; in CI it's clean).
    treeBefore = await gitPorcelain()

    // A fresh OS temp dir, never the repo tree, so a mid-run crash can't dirty
    // `examples/starter` or anything tracked.
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'opensaas-scaffold-'))

    // Scaffold the basic (no-auth) template fully non-interactively:
    // `--no-auth`/`--no-ai` skip the auth/AI prompts (and `--no-ai` its networked
    // MCP install); `--no-install` skips the CLI's auto install → generate so we
    // drive that step ourselves against the workspace toolchain.
    await run('node', [createCli, 'myapp', '--no-auth', '--no-ai', '--no-install'], {
      cwd: tmpRoot,
    })
    projectDir = path.join(tmpRoot, 'myapp')

    // Lend the workspace example's installed toolchain to the scaffolded
    // project (see the file header for why this avoids a network install).
    if (toolchainNodeModules) {
      await fs.symlink(toolchainNodeModules, path.join(projectDir, 'node_modules'))
    }
  }, 120_000)

  afterAll(async () => {
    // Remove the symlink before deleting the temp dir so we never recurse into
    // (or delete) the real workspace `node_modules` it points at.
    if (projectDir) {
      const linkPath = path.join(projectDir, 'node_modules')
      if (await fs.pathExists(linkPath)) {
        await fs.unlink(linkPath)
      }
    }
    if (tmpRoot) {
      await fs.remove(tmpRoot)
    }
  })

  it('scaffolds into a temp dir and generates with no database and no manual edits', async () => {
    // The CLI produced a project outside the repo tree whose `.env` sets no
    // DATABASE_URL, so the first `pnpm dev` starts the Dev database for it.
    expect(projectDir.startsWith(os.tmpdir())).toBe(true)
    const env = await fs.readFile(path.join(projectDir, '.env'), 'utf-8')
    const activeEnv = env
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n')
    expect(activeEnv).not.toContain('DATABASE_URL')

    // The documented setup step, run via the borrowed toolchain with no
    // DATABASE_URL and no database anywhere.
    const binDir = path.join(projectDir, 'node_modules', '.bin')
    const setupEnv = { ...process.env }
    delete setupEnv.DATABASE_URL
    await run(path.join(binDir, 'opensaas'), ['generate'], { cwd: projectDir, env: setupEnv })

    // The onboarding promise: a Generated bundle, and nothing that needed a
    // database to produce it.
    expect(await fs.pathExists(path.join(projectDir, '.opensaas/context.ts'))).toBe(true)
    expect(await fs.pathExists(path.join(projectDir, '.opensaas/dev-db'))).toBe(false)
  }, 180_000)

  it('never mutates the repo working tree', async () => {
    // The whole point of running in a temp dir: the run leaves the tracked tree
    // exactly as it found it. Comparing against the pre-run snapshot means a
    // clean CI checkout asserts a clean tree, while a developer's in-progress
    // edits don't produce a false failure.
    const treeAfter = await gitPorcelain()
    expect(treeAfter).toBe(treeBefore)
  }, 30_000)
})

// Surface, in a normal unit run, why the heavier guard was skipped: either it
// wasn't opted into (`RUN_SCAFFOLD_GUARD=1`) or its built prerequisites are
// missing (run `pnpm install && pnpm build` first).
describe.runIf(!prerequisitesPresent)('scaffold first-run guard (skipped)', () => {
  it('runs only in the e2e job (set RUN_SCAFFOLD_GUARD=1 after install + build)', () => {
    expect(prerequisitesPresent).toBe(false)
  })
})
