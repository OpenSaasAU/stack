import { describe, it, expect } from 'vitest'
import fs from 'fs-extra'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The built `templates/` directory is not committed and is copied from the
 * examples, so the assertion runs against the examples.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const examplesDir = path.resolve(here, '../../../examples')

const loadingFile = (example: string) =>
  path.join(examplesDir, example, 'app/admin/[[...admin]]/loading.tsx')

const examplesWithLoading = fs
  .readdirSync(examplesDir)
  .filter((example) => fs.existsSync(loadingFile(example)))

describe('the admin route loading state', () => {
  it('covers both templates', () => {
    expect(examplesWithLoading).toEqual(expect.arrayContaining(['starter', 'starter-auth']))
  })

  it.each(examplesWithLoading)('%s renders the shared AdminLoading', (example) => {
    const source = fs.readFileSync(loadingFile(example), 'utf-8')

    expect(source).toContain("import { AdminLoading } from '@opensaas/stack-ui'")
    expect(source).toContain('<AdminLoading />')
    expect(source).not.toContain('className')
  })
})
