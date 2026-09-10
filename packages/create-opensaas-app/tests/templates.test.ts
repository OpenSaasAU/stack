import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs-extra'
import os from 'node:os'
import path from 'node:path'
import {
  copyTemplate,
  isExcludedFromTemplate,
  templateFiles,
  UnusableTemplateError,
} from '../src/lib/templates.js'

const roots: string[] = []

/**
 * A checkout root whose own path carries the words the exclusion patterns
 * name. `prisma-8` is this repo's own integration branch, and its worktrees
 * live under paths of exactly this shape.
 */
async function checkoutRoot(): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'copy-templates-'))
  const root = path.join(base, 'prisma-8', 'migrations-work')
  await fs.ensureDir(root)
  roots.push(base)
  return root
}

async function seedExample(root: string, name: string): Promise<string> {
  const source = path.join(root, 'examples', name)
  await fs.outputJSON(path.join(source, 'package.json'), { name })
  await fs.outputFile(path.join(source, 'opensaas.config.ts'), 'export default {}\n')
  await fs.outputFile(path.join(source, 'app', 'page.tsx'), 'export default () => null\n')
  await fs.outputFile(path.join(source, 'lib', 'prisma-helpers.ts'), 'export const x = 1\n')
  await fs.outputFile(path.join(source, 'prisma.config.ts'), 'export default {}\n')
  await fs.outputFile(path.join(source, 'prisma', 'schema.prisma'), 'generator client {}\n')
  await fs.outputFile(path.join(source, 'migrations', 'app', 'refs', 'db.json'), '{}\n')
  await fs.outputFile(path.join(source, 'next-env.d.ts'), '\n')
  await fs.outputFile(path.join(source, 'node_modules', '.bin', 'next'), '\n')
  await fs.outputFile(path.join(source, '.next', 'build-manifest.json'), '{}\n')
  return source
}

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.remove(root)
})

describe('isExcludedFromTemplate', () => {
  it('keeps the example root itself', () => {
    expect(isExcludedFromTemplate('')).toBe(false)
  })

  it('excludes a generated directory wherever it sits', () => {
    expect(isExcludedFromTemplate('prisma/schema.prisma')).toBe(true)
    expect(isExcludedFromTemplate('migrations/app/refs/db.json')).toBe(true)
    expect(isExcludedFromTemplate('node_modules/.bin/next')).toBe(true)
    expect(isExcludedFromTemplate('.next/build-manifest.json')).toBe(true)
  })

  it('excludes a generated file by its own name', () => {
    expect(isExcludedFromTemplate('prisma.config.ts')).toBe(true)
    expect(isExcludedFromTemplate('next-env.d.ts')).toBe(true)
  })

  it('keeps a source file whose name merely begins with a pattern', () => {
    expect(isExcludedFromTemplate('lib/prisma-helpers.ts')).toBe(false)
    expect(isExcludedFromTemplate('app/migrations-guide.mdx')).toBe(false)
  })
})

describe('copyTemplate from a checkout whose path contains prisma and migrations', () => {
  it('populates both templates', async () => {
    const root = await checkoutRoot()
    expect(root).toContain('prisma')
    expect(root).toContain('migrations')

    const basic = path.join(root, 'templates', 'basic')
    const withAuth = path.join(root, 'templates', 'with-auth')
    const basicFiles = await copyTemplate(await seedExample(root, 'starter'), basic)
    const authFiles = await copyTemplate(await seedExample(root, 'starter-auth'), withAuth)

    for (const files of [basicFiles, authFiles]) {
      expect(files).toContain('package.json')
      expect(files).toContain(path.join('app', 'page.tsx'))
      expect(files).toContain(path.join('lib', 'prisma-helpers.ts'))
      expect(files).not.toContain('prisma.config.ts')
      expect(files).not.toContain(path.join('prisma', 'schema.prisma'))
      expect(files).not.toContain(path.join('migrations', 'app', 'refs', 'db.json'))
      expect(files).not.toContain('next-env.d.ts')
    }
    expect(await templateFiles(basic)).toEqual(basicFiles)
  })

  it('refuses a template that came out empty', async () => {
    const root = await checkoutRoot()
    const source = path.join(root, 'examples', 'empty-example')
    await fs.ensureDir(source)

    await expect(
      copyTemplate(source, path.join(root, 'templates', 'basic')),
    ).rejects.toBeInstanceOf(UnusableTemplateError)
  })

  it('refuses a template with no package.json', async () => {
    const root = await checkoutRoot()
    const source = path.join(root, 'examples', 'manifestless')
    await fs.outputFile(path.join(source, 'app', 'page.tsx'), 'export default () => null\n')

    await expect(copyTemplate(source, path.join(root, 'templates', 'basic'))).rejects.toThrow(
      /no package\.json/,
    )
  })
})
