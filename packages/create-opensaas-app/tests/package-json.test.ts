import { describe, it, expect } from 'vitest'
import {
  applyProjectName,
  replaceWorkspaceVersions,
  rewriteReadmeHeading,
} from '../src/lib/package-json.js'

describe('applyProjectName', () => {
  it('sets the name and preserves every other field', () => {
    const pkg = { name: 'opensaas-starter-example', version: '0.1.0', scripts: { dev: 'next dev' } }
    const result = applyProjectName(pkg, 'my-app')
    expect(result.name).toBe('my-app')
    expect(result.version).toBe('0.1.0')
    expect(result.scripts).toEqual({ dev: 'next dev' })
  })
})

describe('replaceWorkspaceVersions', () => {
  it('rewrites @opensaas workspace ranges to the published version', () => {
    const pkg = {
      dependencies: {
        '@opensaas/stack-core': 'workspace:*',
        '@opensaas/stack-ui': 'workspace:*',
        next: '^16.1.6',
      },
      devDependencies: { '@opensaas/stack-cli': 'workspace:*', typescript: '^5.9.3' },
    }
    const result = replaceWorkspaceVersions(pkg, '1.2.3')
    expect(result.dependencies?.['@opensaas/stack-core']).toBe('^1.2.3')
    expect(result.dependencies?.['@opensaas/stack-ui']).toBe('^1.2.3')
    expect(result.devDependencies?.['@opensaas/stack-cli']).toBe('^1.2.3')
  })

  it('leaves non-opensaas dependencies untouched', () => {
    const pkg = { dependencies: { next: '^16.1.6', react: '^19.2.4' } }
    const result = replaceWorkspaceVersions(pkg, '1.2.3')
    expect(result.dependencies).toEqual({ next: '^16.1.6', react: '^19.2.4' })
  })

  it('only rewrites the workspace:* specifier, not pinned @opensaas ranges', () => {
    const pkg = { dependencies: { '@opensaas/stack-core': '^0.1.0' } }
    const result = replaceWorkspaceVersions(pkg, '1.2.3')
    expect(result.dependencies?.['@opensaas/stack-core']).toBe('^0.1.0')
  })

  it('leaves no remaining workspace:* for @opensaas dependencies', () => {
    const pkg = {
      dependencies: { '@opensaas/stack-core': 'workspace:*' },
      devDependencies: { '@opensaas/stack-cli': 'workspace:*' },
    }
    const result = replaceWorkspaceVersions(pkg, '9.9.9')
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('workspace:*')
  })
})

describe('rewriteReadmeHeading', () => {
  it('replaces only the first H1', () => {
    const readme = '# OpenSaas Stack Starter\n\nIntro\n\n# Not a title\n'
    const result = rewriteReadmeHeading(readme, 'my-app')
    expect(result).toContain('# my-app')
    expect(result).toContain('# Not a title')
    expect(result.indexOf('# my-app')).toBe(0)
  })
})
