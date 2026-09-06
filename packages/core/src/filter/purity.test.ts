import { readFileSync, readdirSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * The filter engine is the pure boundary the URL grammar is unit-tested
 * through (ADR-0017), and ADR-0055 keeps it that way by making its condition
 * type a Where vocabulary value rather than an ORM fragment. The vocabulary
 * module it names is therefore held to the same rule.
 */
function sources(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => path.join(dir, name))
}

describe('the pure boundary', () => {
  it('imports nothing from the ORM', () => {
    const files = [
      ...sources(here),
      path.join(here, '..', 'secured', 'vocabulary.ts'),
      path.join(here, '..', 'secured', 'operators.ts'),
    ]
    const offenders = files.filter((file) => readFileSync(file, 'utf8').includes('@prisma/'))
    expect(offenders).toEqual([])
  })

  it('names the count-filter symbols nowhere: they are deletions (ADR-0055)', () => {
    const source = sources(here)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n')
    for (const symbol of [
      'RELATIONSHIP_COUNT_FILTER_KEY',
      'RelationshipCountFilterMarker',
      'resolveRelationshipCountFilters',
      'resolveRelationshipLabelFilters',
    ]) {
      expect(source).not.toContain(symbol)
    }
  })
})
