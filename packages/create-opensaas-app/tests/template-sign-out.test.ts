import { describe, it, expect } from 'vitest'
import fs from 'fs-extra'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * `examples/starter-auth` is the `with-auth` template (`copy-templates.ts`), and
 * the built `templates/` directory is not committed, so the assertion runs
 * against the examples.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const examplesDir = path.resolve(here, '../../../examples')

const authExamples = fs.readdirSync(examplesDir).filter((example) => {
  const manifest = path.join(examplesDir, example, 'package.json')
  if (!fs.existsSync(manifest)) return false
  return '@opensaas/stack-auth' in (fs.readJSONSync(manifest).dependencies ?? {})
})

describe('sign-out wiring', () => {
  it('covers the with-auth template', () => {
    expect(authExamples).toContain('starter-auth')
  })

  describe.each(authExamples)('%s', (example) => {
    const root = path.join(examplesDir, example)

    it('owns a server action that confirms sign-out via signOutAndConfirm, then redirects', () => {
      const actions = fs.readFileSync(path.join(root, 'lib/actions/auth.ts'), 'utf-8')

      expect(actions.startsWith("'use server'")).toBe(true)
      expect(actions).toContain('export async function signOutAction(): Promise<void>')
      expect(actions).toContain(
        "signOutAndConfirm(auth, await headers())\n  redirect(logoutUrl ?? '/sign-in')",
      )
    })

    it('passes it to AdminUI', () => {
      const page = fs.readFileSync(path.join(root, 'app/admin/[[...admin]]/page.tsx'), 'utf-8')

      expect(page).toContain("import { signOutAction } from '@/lib/actions/auth'")
      expect(page).toContain('onSignOut={signOutAction}')
    })
  })
})
