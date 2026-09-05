import { describe, it, expect } from 'vitest'
import fs from 'fs-extra'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The Generated bundle loads under plain Node only while it is erasable
 * TypeScript, and that holds for the app's own `opensaas.config.ts` and what it
 * imports too — a requirement ADR-0054 documents rather than enforces. The
 * scaffolded tsconfig carries both flags so the type-checker reports a
 * violation before Node does.
 *
 * The assertion runs against `examples/starter` / `examples/starter-auth`
 * because `copy-templates.ts` copies the templates from there verbatim; the
 * built `templates/` directory is a build artifact and is not committed.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const examplesDir = path.resolve(here, '../../../examples')

describe.each([
  ['basic', 'starter'],
  ['with-auth', 'starter-auth'],
])('the %s template tsconfig', (_template, example) => {
  const tsconfig = fs.readJSONSync(path.join(examplesDir, example, 'tsconfig.json'))

  it('sets erasableSyntaxOnly', () => {
    expect(tsconfig.compilerOptions.erasableSyntaxOnly).toBe(true)
  })

  it('sets verbatimModuleSyntax', () => {
    expect(tsconfig.compilerOptions.verbatimModuleSyntax).toBe(true)
  })

  it('keeps allowImportingTsExtensions, the one requirement the bundle places on a consumer', () => {
    expect(tsconfig.compilerOptions.allowImportingTsExtensions).toBe(true)
  })
})
