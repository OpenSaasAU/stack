import { describe, it, expect } from 'vitest'
import { renderPnpmWorkspace } from '../src/lib/pnpm-workspace.js'

describe('renderPnpmWorkspace', () => {
  it('allows the build scripts the scaffold depends on', () => {
    const yaml = renderPnpmWorkspace()
    expect(yaml).toContain('allowBuilds:')
    expect(yaml).toContain('  esbuild: true')
    expect(yaml).toContain('  workerd: true')
  })
})
