import { describe, it, expect } from 'vitest'
import { renderPnpmWorkspace } from '../src/lib/pnpm-workspace.js'

describe('renderPnpmWorkspace', () => {
  it('allows the build scripts the scaffold depends on', () => {
    const yaml = renderPnpmWorkspace()
    expect(yaml).toContain('allowBuilds:')
    expect(yaml).toContain('  esbuild: true')
    expect(yaml).toContain('  workerd: true')
  })

  it('accepts the installed prisma for better-auth packages peering an older range', () => {
    const yaml = renderPnpmWorkspace({ withAuth: true })
    expect(yaml).toContain('peerDependencyRules:')
    expect(yaml).toContain("'prisma': '*'")
  })

  it('declares no peer rules without auth', () => {
    expect(renderPnpmWorkspace()).not.toContain('peerDependencyRules')
  })
})
