export const ALLOWED_BUILDS = ['esbuild', 'sharp', 'unrs-resolver', 'workerd'] as const

export function renderPnpmWorkspace(): string {
  return `allowBuilds:\n${ALLOWED_BUILDS.map((name) => `  ${name}: true`).join('\n')}\n`
}
