import fs from 'fs-extra'
import path from 'path'

/**
 * Directory names an example never contributes to a template, matched as a
 * whole path segment at any depth below the example's root.
 */
const EXCLUDED_DIRECTORIES = [
  'node_modules',
  '.next',
  '.turbo',
  '.opensaas',
  'prisma',
  'migrations',
]

/** File names an example never contributes to a template, at any depth. */
const EXCLUDED_FILES = [
  'prisma.config.ts',
  'tsconfig.tsbuildinfo',
  'next-env.d.ts',
  'pnpm-lock.yaml',
]

/**
 * Whether one entry of an example is left out of the template it seeds.
 *
 * The argument is the entry's path **relative to the example's root**, and
 * every pattern is a whole path segment: an absolute path carries whatever
 * the checkout happens to be called, and a substring test against it excludes
 * every file in the tree whenever a parent directory is named after one of
 * the patterns. The segment rule is also what keeps a legitimate
 * `lib/prisma-helpers.ts` — which no pattern names — in the template.
 *
 * The empty string is the example's own root, which is never excluded.
 */
export function isExcludedFromTemplate(relativePath: string): boolean {
  const segments = relativePath.split(/[\\/]/).filter((segment) => segment.length > 0)
  if (segments.length === 0) return false
  if (segments.some((segment) => EXCLUDED_DIRECTORIES.includes(segment))) return true
  const name = segments[segments.length - 1]
  return name !== undefined && EXCLUDED_FILES.includes(name)
}

/** Every file under `dir`, relative to it. */
export async function templateFiles(dir: string): Promise<string[]> {
  if (!(await fs.pathExists(dir))) return []
  const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
}

/**
 * Thrown when a template came out of {@link copyTemplate} unusable. Nothing
 * downstream reads a template before it is published, so a template that is
 * empty or has no manifest has to fail the build that produced it.
 */
export class UnusableTemplateError extends Error {
  constructor(
    readonly template: string,
    reason: string,
  ) {
    super(`Template "${template}" ${reason}. Refusing to publish a scaffolder that cannot run.`)
    this.name = 'UnusableTemplateError'
  }
}

/**
 * Copy one example into one template directory, and refuse to return a
 * template a scaffold could not use.
 *
 * @throws {UnusableTemplateError} when the copy produced no files, or no
 * `package.json`.
 */
export async function copyTemplate(
  source: string,
  target: string,
  onSkip?: (relativePath: string) => void,
): Promise<string[]> {
  await fs.copy(source, target, {
    filter: (src) => {
      const relativePath = path.relative(source, src)
      if (!isExcludedFromTemplate(relativePath)) return true
      onSkip?.(relativePath)
      return false
    },
  })

  const files = await templateFiles(target)
  if (files.length === 0) throw new UnusableTemplateError(target, 'came out empty')
  if (!files.includes('package.json')) {
    throw new UnusableTemplateError(target, 'has no package.json')
  }
  return files
}
