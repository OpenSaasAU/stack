import { spawnSync } from 'child_process'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, test } from 'vitest'
import { nodeVersionError } from '../bin/node-guard.js'

const guardModule = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../bin/node-guard.js',
)

describe('nodeVersionError', () => {
  test.each(['20.12.2', '22.12.0', '22.17.9', '18.0.0'])('rejects %s', (version) => {
    expect(nodeVersionError(version)).toContain('22.18.0')
  })

  test.each(['22.18.0', '22.18.1', '23.0.0', '24.3.0'])('accepts %s', (version) => {
    expect(nodeVersionError(version)).toBeNull()
  })

  test('the entry point exits 1 naming the floor on an old Node', () => {
    const script = `import(${JSON.stringify(guardModule)}).then(({ nodeVersionError }) => {
      const p = nodeVersionError('20.12.2'); if (p) { console.error(p); process.exit(1) } })`
    const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf-8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('22.18.0')
  })
})
