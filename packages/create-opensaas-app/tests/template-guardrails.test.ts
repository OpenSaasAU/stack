import { describe, it, expect } from 'vitest'
import fs from 'fs-extra'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../../examples/starter-auth')

interface LintMessage {
  ruleId: string | null
}

interface Linter {
  lintText(code: string, options: { filePath: string }): Promise<{ messages: LintMessage[] }[]>
}

type LinterConstructor = new (options: { cwd: string }) => Linter

function isLinterConstructor(value: unknown): value is LinterConstructor {
  return typeof value === 'function'
}

function loadLinter(): Linter {
  const eslintModule: unknown = createRequire(path.join(root, 'package.json'))('eslint')
  if (typeof eslintModule !== 'object' || eslintModule === null || !('ESLint' in eslintModule)) {
    throw new Error('examples/starter-auth does not install eslint')
  }
  const { ESLint } = eslintModule
  if (!isLinterConstructor(ESLint)) throw new Error('eslint exports no ESLint class')
  return new ESLint({ cwd: root })
}

async function rulesHit(filePath: string, code: string): Promise<(string | null)[]> {
  const [result] = await loadLinter().lintText(code, { filePath: path.join(root, filePath) })
  return result?.messages.map((message) => message.ruleId) ?? []
}

const restrictedImport = 'no-restricted-imports'
const restrictedSyntax = 'no-restricted-syntax'

describe('starter-auth guardrails (the with-auth template)', () => {
  it('ships its lint config and runs it from `pnpm lint`', () => {
    expect(fs.existsSync(path.join(root, 'eslint.config.js'))).toBe(true)
    const manifest = fs.readJSONSync(path.join(root, 'package.json'))
    expect(manifest.scripts.lint).toContain('eslint .')
  })

  describe('the context factory', () => {
    it.each([
      ['app/page.tsx', "import { getContext } from '@/.opensaas/context'\n"],
      ['app/posts/page.tsx', "import { getContext } from '../../.opensaas/context.ts'\n"],
      ['lib/procedures.ts', "export { getContext } from '@/.opensaas/context'\n"],
      ['app/page.tsx', "import { rawOpensaasContext } from '@/.opensaas/context'\n"],
      ['lib/auth.ts', "import { getContext } from '@/.opensaas/context'\n"],
      ['lib/server.ts', "import { rawOpensaasContext } from '@/.opensaas/context'\n"],
      ['lib/probe.js', "import { getContext } from '../.opensaas/context.ts'\n"],
      ['lib/probe.mjs', "import { getContext } from '@/.opensaas/context'\n"],
    ])('refuses an import in %s: %s', async (filePath, code) => {
      expect(await rulesHit(filePath, code)).toContain(restrictedImport)
    })

    it.each([
      ['lib/server.ts', "import { getContext, config } from '@/.opensaas/context'\n"],
      ['lib/auth.ts', "import { rawOpensaasContext } from '@/.opensaas/context'\n"],
      ['app/page.tsx', "import { config } from '@/.opensaas/context'\n"],
      ['lib/procedures.ts', "import { procedure } from '@/.opensaas/procedures'\n"],
    ])('allows %s: %s', async (filePath, code) => {
      expect(await rulesHit(filePath, code)).not.toContain(restrictedImport)
    })
  })

  describe("'use server'", () => {
    it.each([
      ['lib/posts.ts', "'use server'\nexport async function a() {}\n"],
      ['app/posts/page.tsx', "export async function a() {\n  'use server'\n}\n"],
      ['lib/actions/nested/posts.ts', "'use server'\nexport async function a() {}\n"],
      ['app/posts/[id]/page.tsx', "export async function a() {\n  'use server'\n}\n"],
      ['lib/probe.js', "'use server'\nexport async function a() {}\n"],
      ['app/probe.mjs', "export async function a() {\n  'use server'\n}\n"],
    ])('is refused in %s', async (filePath, code) => {
      expect(await rulesHit(filePath, code)).toContain(restrictedSyntax)
    })

    it.each([
      ['lib/actions/posts.ts', "'use server'\nexport async function a() {}\n"],
      ['lib/actions/auth.ts', "'use server'\nexport async function a() {}\n"],
      ['app/admin/[[...admin]]/page.tsx', "export async function a() {\n  'use server'\n}\n"],
    ])('is allowed in %s', async (filePath, code) => {
      expect(await rulesHit(filePath, code)).not.toContain(restrictedSyntax)
    })
  })

  describe('switching the session in a server action', () => {
    it.each([
      [
        'lib/actions/probe.ts',
        "'use server'\nexport async function a(userId: string) {\n  return (await getServerContext()).withSession({ userId })\n}\n",
      ],
      [
        'lib/actions/probe.ts',
        "'use server'\nexport async function a() {\n  return (await getServerContext()).sudo()\n}\n",
      ],
      [
        'lib/actions/probe.ts',
        "'use server'\nexport async function a(userId: string) {\n  const context = await getServerContext()\n  return context?.['withSession']({ userId })\n}\n",
      ],
      [
        'app/admin/[[...admin]]/page.tsx',
        "async function a() {\n  'use server'\n  return (await getServerContext()).sudo()\n}\n",
      ],
    ])('is refused in %s', async (filePath, code) => {
      expect(await rulesHit(filePath, code)).toContain(restrictedSyntax)
    })

    it('leaves a call through callProcedure alone', async () => {
      const code =
        "'use server'\nexport async function a(id: string) {\n  return callProcedure('publishPost', { id })\n}\n"
      expect(await rulesHit('lib/actions/probe.ts', code)).toEqual([])
    })
  })

  it('passes over the template as committed', async () => {
    const files = [
      'lib/server.ts',
      'lib/auth.ts',
      'lib/actions/posts.ts',
      'lib/actions/auth.ts',
      'app/posts/page.tsx',
      'app/admin/[[...admin]]/page.tsx',
    ]
    for (const file of files) {
      const code = fs.readFileSync(path.join(root, file), 'utf-8')
      expect(await rulesHit(file, code)).toEqual([])
    }
  })
})
