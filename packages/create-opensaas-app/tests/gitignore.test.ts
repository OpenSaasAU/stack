import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'fs-extra'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyTemplate, restoreGitignore } from '../src/lib/templates.js'

const packageDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('gitignore packaging', () => {
  it('stores a template .gitignore as gitignore and restores it on scaffold', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gitignore-'))
    try {
      const source = path.join(root, 'src')
      const target = path.join(root, 'tpl')
      await fs.outputFile(path.join(source, 'package.json'), '{}')
      await fs.outputFile(path.join(source, '.gitignore'), '.env\n')

      await copyTemplate(source, target)
      expect(await fs.pathExists(path.join(target, '.gitignore'))).toBe(false)
      expect(await fs.readFile(path.join(target, 'gitignore'), 'utf-8')).toBe('.env\n')

      await restoreGitignore(target)
      expect(await fs.readFile(path.join(target, '.gitignore'), 'utf-8')).toBe('.env\n')
    } finally {
      await fs.remove(root)
    }
  })

  it.skipIf(!fs.pathExistsSync(path.join(packageDir, 'templates', 'basic')))(
    'the packed tarball includes a gitignore for every template',
    () => {
      const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
        cwd: packageDir,
        encoding: 'utf-8',
      })
      const files = (JSON.parse(out) as { files: { path: string }[] }[])[0]!.files.map(
        (f) => f.path,
      )
      expect(files).toContain('templates/basic/gitignore')
      expect(files).toContain('templates/with-auth/gitignore')
    },
  )
})
