import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

/**
 * `generateCommand()` itself throws `GenerationFailedError` rather than
 * exiting (#1223, so a caller like the dev loop can catch it and clean up) —
 * the `process.exit(1)` on a refusal is wiring in `src/index.ts`'s CLI
 * action, verified nowhere but by reading it. This drives the real `opensaas
 * generate` binary over a scratch project whose config fails field
 * validation, so the exit code the CLI actually reports is the subject.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cliEntry = path.join(packageRoot, 'bin', 'opensaas.js')
const scratchRoot = fs.mkdtempSync(path.join(packageRoot, 'tests', 'tmp-exitcode-'))

afterAll(() => {
  fs.rmSync(scratchRoot, { recursive: true, force: true })
})

const REFUSING_CONFIG = `
export default {
  db: { provider: 'postgresql' },
  lists: { Bad: { fields: { broken: { type: 'broken' } } } },
}
`

describe('opensaas generate on a refusing config', () => {
  let result: ReturnType<typeof spawnSync>

  beforeAll(() => {
    expect(
      fs.existsSync(path.join(packageRoot, 'dist', 'index.js')),
      'the CLI must be built before this test runs (turbo `test` dependsOn `build`)',
    ).toBe(true)

    const projectDir = path.join(scratchRoot, 'project')
    fs.mkdirSync(projectDir, { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'opensaas.config.ts'), REFUSING_CONFIG, 'utf-8')

    result = spawnSync(process.execPath, [cliEntry, 'generate'], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }, 60_000)

  test('exits non-zero', () => {
    expect(result.status).not.toBe(0)
  })

  test('reports the refusal rather than a stack trace', () => {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    expect(output).toContain('getContractField')
    expect(output).not.toContain('at Object.')
  })

  test('writes no contract artifacts', () => {
    expect(fs.existsSync(path.join(scratchRoot, 'project', 'prisma', 'contract.ts'))).toBe(false)
  })
})
