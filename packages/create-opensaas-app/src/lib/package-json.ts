/**
 * Pure transforms applied to a scaffolded project's files.
 *
 * Extracted from the CLI orchestrator so each transform — naming the package,
 * resolving workspace versions, retitling the README — can be unit-tested
 * without touching the filesystem.
 */

export interface PackageJsonLike {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  // Other fields are preserved untouched.
  [key: string]: unknown
}

/** Set the project's package name without disturbing any other field. */
export function applyProjectName(pkg: PackageJsonLike, projectName: string): PackageJsonLike {
  return { ...pkg, name: projectName }
}

/**
 * Replace `@opensaas/*` `workspace:*` ranges with a concrete published range.
 * Runs at build time when templates are copied out of the monorepo, so the
 * published templates never carry an unresolvable `workspace:*` specifier.
 */
export function replaceWorkspaceVersions(
  pkg: PackageJsonLike,
  stackVersion: string,
): PackageJsonLike {
  const result: PackageJsonLike = { ...pkg }
  for (const field of ['dependencies', 'devDependencies'] as const) {
    const deps = result[field]
    if (!deps) continue
    const updated: Record<string, string> = { ...deps }
    for (const [name, version] of Object.entries(updated)) {
      if (name.startsWith('@opensaas/') && version === 'workspace:*') {
        updated[name] = `^${stackVersion}`
      }
    }
    result[field] = updated
  }
  return result
}

/**
 * Resolve better-auth's optional `prisma` peer (capped below Prisma 8) to the
 * version the project installs, so `npm install` does not fail with ERESOLVE.
 */
export function applyPeerOverrides(pkg: PackageJsonLike): PackageJsonLike {
  const prisma = pkg.devDependencies?.prisma ?? pkg.dependencies?.prisma
  if (!prisma || !pkg.dependencies?.['better-auth']) return pkg
  const existing = typeof pkg.overrides === 'object' && pkg.overrides !== null ? pkg.overrides : {}
  return { ...pkg, overrides: { ...existing, 'better-auth': { prisma } } }
}

/** Replace the first Markdown H1 with the project name, leaving the rest. */
export function rewriteReadmeHeading(readme: string, projectName: string): string {
  return readme.replace(/^# .+$/m, `# ${projectName}`)
}
