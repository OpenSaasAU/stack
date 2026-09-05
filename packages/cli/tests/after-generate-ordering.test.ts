import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

/**
 * A plugin's `afterGenerate` rewrite of the Contract module has to reach the
 * emitted artifacts.
 *
 * The hook is public API, and the module it rewrites is the one
 * `prisma contract emit` reads. Running the hook after emission would write the
 * rewrite to `prisma/contract.ts` while `contract.json` and `contract.d.ts`
 * kept describing the pre-hook module — the runtime executing a contract the
 * checked-in source does not describe, with nothing failing (#1134 review).
 *
 * This drives the real CLI over a scratch project, so it covers the pipeline
 * ordering rather than the individual writers.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cliEntry = path.join(packageRoot, 'bin', 'opensaas.js')
const scratchRoot = fs.mkdtempSync(path.join(packageRoot, 'tests', 'tmp-aftergen-'))

afterAll(() => {
  fs.rmSync(scratchRoot, { recursive: true, force: true })
})

const CONFIG = `
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import type { Plugin } from '@opensaas/stack-core/extend'

const rewriteDefault: Plugin = {
  name: 'rewrite-default',
  version: '0.0.0',
  init: () => {},
  afterGenerate: (files) => ({
    ...files,
    contractModule: files.contractModule.replace("default('before')", "default('after')"),
  }),
}

export default config({
  plugins: [rewriteDefault],
  db: { provider: 'postgresql' },
  lists: {
    Widget: list({ fields: { label: text({ defaultValue: 'before' }) } }),
  },
})
`

describe("a plugin's afterGenerate rewrite of the Contract module", () => {
  let projectDir: string
  let result: ReturnType<typeof spawnSync>

  beforeAll(() => {
    expect(
      fs.existsSync(path.join(packageRoot, 'dist', 'index.js')),
      'the CLI must be built before this test runs (turbo `test` dependsOn `build`)',
    ).toBe(true)

    projectDir = path.join(scratchRoot, 'project')
    fs.mkdirSync(projectDir, { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'opensaas.config.ts'), CONFIG, 'utf-8')

    result = spawnSync(process.execPath, [cliEntry, 'generate'], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }, 180_000)

  test('generate succeeds', () => {
    expect(`${result.stdout ?? ''}${result.stderr ?? ''}`).toContain('Generation complete')
    expect(result.status).toBe(0)
  })

  test('lands in the Contract module on disk', () => {
    const module = fs.readFileSync(path.join(projectDir, 'prisma', 'contract.ts'), 'utf-8')
    expect(module).toContain("default('after')")
    expect(module).not.toContain("default('before')")
  })

  test('lands in the emitted contract.json', () => {
    const emitted = fs.readFileSync(path.join(projectDir, 'prisma', 'contract.json'), 'utf-8')
    expect(emitted).toContain('after')
    expect(emitted).not.toContain('before')
  })
})
