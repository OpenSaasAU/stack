export const ALLOWED_BUILDS = ['esbuild', 'sharp', 'unrs-resolver', 'workerd'] as const

export function renderPnpmWorkspace(options: { withAuth?: boolean } = {}): string {
  const builds = `allowBuilds:\n${ALLOWED_BUILDS.map((name) => `  ${name}: true`).join('\n')}\n`
  if (!options.withAuth) return builds
  return `${builds}peerDependencyRules:\n  allowedVersions:\n    'prisma': '*'\n`
}
