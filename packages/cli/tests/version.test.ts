import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, test } from 'vitest'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cliEntry = path.join(packageRoot, 'bin', 'opensaas.js')

describe('opensaas --version', () => {
  test("prints the package's own version", () => {
    expect(
      fs.existsSync(path.join(packageRoot, 'dist', 'index.js')),
      'the CLI must be built before this test runs (turbo `test` dependsOn `build`)',
    ).toBe(true)
    const manifest: { version: string } = JSON.parse(
      fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf-8'),
    )

    const result = spawnSync(process.execPath, [cliEntry, '--version'], { encoding: 'utf-8' })

    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe(manifest.version)
  })
})
