import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FeatureGenerator } from './feature-generator.js'
import type { Feature, FeatureImplementation } from '../types.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const cliSrc = path.resolve(here, '../../..')

function feature(id: string, category: Feature['category']): Feature {
  return { id, name: id, description: id, includes: [], questions: [], category }
}

function emittedStrings(implementation: FeatureImplementation): string[] {
  return [
    implementation.configUpdates,
    implementation.devGuideSection,
    ...implementation.files.map((file) => file.content),
    ...implementation.instructions,
    ...implementation.nextSteps,
  ]
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : []
  })
}

// `context.db` is keyed by the PascalCase list name (#1146). Code the CLI emits
// into a user's project is not covered by this repo's own type-checking, so a
// camelCase key there is only found at the user's first render.
const CAMEL_DB_KEY = /context\.db\.[a-z][A-Za-z0-9]*/g

describe('emitted context.db keys', () => {
  it('uses the PascalCase list key in the blog feature', () => {
    const implementation = new FeatureGenerator(feature('blog', 'content'), {}, {}).generate()
    const blogPage = implementation.files.find((file) => file.path === 'app/blog/page.tsx')
    const postPage = implementation.files.find((file) => file.path === 'app/blog/[slug]/page.tsx')

    expect(blogPage?.content).toContain('context.db.Post.findMany(')
    expect(postPage?.content).toContain('context.db.Post.findFirst(')
    for (const emitted of emittedStrings(implementation)) {
      expect(emitted.match(CAMEL_DB_KEY)).toBeNull()
    }
  })

  it('uses the PascalCase list key in the authentication feature', () => {
    const implementation = new FeatureGenerator(
      feature('authentication', 'authentication'),
      { 'auth-methods': ['Email and password'] },
      {},
    ).generate()

    expect(implementation.devGuideSection).toContain('context.db.User.findUnique(')
    for (const emitted of emittedStrings(implementation)) {
      expect(emitted.match(CAMEL_DB_KEY)).toBeNull()
    }
  })

  it('is not spelled camelCase anywhere the CLI emits source or guidance', () => {
    const offenders = sourceFiles(cliSrc)
      .map((file) => ({ file, matches: readFileSync(file, 'utf8').match(CAMEL_DB_KEY) }))
      .filter((entry) => entry.matches !== null)
      .map((entry) => `${path.relative(cliSrc, entry.file)}: ${entry.matches?.join(', ')}`)

    expect(offenders).toEqual([])
  })
})
