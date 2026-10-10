import { describe, expect, it } from 'vitest'
import fs from 'fs-extra'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')

interface Manifest {
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const readManifest = (...segments: string[]): Promise<Manifest> =>
  fs.readJSON(path.join(repoRoot, ...segments, 'package.json'))

const PGLITE_PACKAGES = ['@electric-sql/pglite', '@electric-sql/pglite-socket']

describe.each(['starter', 'starter-auth'])('%s template', (example) => {
  it("pins pglite to the versions stack-core's optional peers name", async () => {
    const core = await readManifest('packages', 'core')
    const template = await readManifest('examples', example)
    for (const name of PGLITE_PACKAGES) {
      expect(template.devDependencies?.[name]).toBe(core.peerDependencies?.[name])
    }
  })
})
