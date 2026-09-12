import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { afterAll, describe, expect, it } from 'vitest'
import { OpenSaasDocumentationProvider } from './documentation-provider.js'

/**
 * The custom-field snippet the MCP server hands an agent is the canonical
 * example for the contract-shaped builder surface, so it has to compile as
 * written. `tsc` runs inside this package, where `@opensaas/stack-core` and
 * `zod` resolve the way they would in a consumer's project.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const scratchRoot = fs.mkdtempSync(path.join(packageRoot, 'tests', 'tmp-doc-snippet-'))

afterAll(() => {
  fs.rmSync(scratchRoot, { recursive: true, force: true })
})

function compile(source: string): string {
  const entry = path.join(scratchRoot, 'snippet.ts')
  fs.writeFileSync(entry, source, 'utf-8')
  const tsconfig = path.join(scratchRoot, 'tsconfig.json')
  fs.writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        lib: ['ES2022'],
        moduleResolution: 'bundler',
        strict: true,
        skipLibCheck: true,
        noEmit: true,
      },
      include: ['snippet.ts'],
    }),
    'utf-8',
  )

  const result = spawnSync(path.join(packageRoot, 'node_modules', '.bin', 'tsc'), [
    '--project',
    tsconfig,
  ])
  if (result.error !== undefined) throw new Error(`tsc could not be run: ${result.error.message}`)
  const output = `${result.stdout?.toString() ?? ''}${result.stderr?.toString() ?? ''}`.trim()
  if (output === '' && result.status !== 0) {
    throw new Error(`tsc exited with status ${String(result.status)} and no diagnostics`)
  }
  return output
}

describe('the custom-field example the MCP serves', () => {
  it('compiles as written', { timeout: 300_000 }, async () => {
    const example = await new OpenSaasDocumentationProvider().getExampleConfig('custom-fields')

    expect(example).not.toBeNull()
    expect(compile(example?.code ?? '')).toBe('')
  })
})
