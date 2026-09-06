import { existsSync, readFileSync, readdirSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = path.resolve(here, '..')

interface Edge {
  typeOnly: boolean
  specifier: string
}

/**
 * `import`/`export ... from '…'` and bare `import '…'`. A `type` immediately
 * after the keyword marks an edge that is erased at build time and therefore
 * pulls nothing into the module graph; a lazy `import('…')` call is not
 * matched, which is the point — the invariant is about the STATIC graph.
 */
const EDGE = /(?:^|\n)\s*(?:import|export)(\s+type)?\s+(?:[^'";]*?\s+from\s+)?'([^']+)'/g

function edges(source: string): Edge[] {
  return [...source.matchAll(EDGE)].map((match) => ({
    typeOnly: match[1] !== undefined,
    specifier: match[2],
  }))
}

/** Every file reachable from `roots` by a runtime relative import. */
function graph(roots: readonly string[]): { files: Set<string>; orm: string[] } {
  const files = new Set<string>()
  const orm: string[] = []
  const stack = [...roots]
  while (stack.length > 0) {
    const file = stack.pop()
    if (file === undefined || files.has(file)) continue
    files.add(file)
    for (const { typeOnly, specifier } of edges(readFileSync(file, 'utf8'))) {
      if (typeOnly) continue
      if (!specifier.startsWith('.')) {
        if (specifier.startsWith('@prisma/')) orm.push(`${path.relative(src, file)} → ${specifier}`)
        continue
      }
      const resolved = path.resolve(path.dirname(file), specifier.replace(/\.js$/, '.ts'))
      expect(existsSync(resolved), `${file} imports ${specifier}, which resolves nowhere`).toBe(
        true,
      )
      stack.push(resolved)
    }
  }
  return { files, orm }
}

function sources(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => path.join(dir, name))
}

/**
 * The filter engine is the pure boundary the URL grammar is unit-tested
 * through (ADR-0017), and ADR-0055 keeps it that way by making its condition
 * type a Where vocabulary value rather than an ORM fragment. The vocabulary
 * module it names is held to the same rule, so both are walked as one graph
 * rather than checked file by file — a new module added to either is covered
 * the moment something imports it.
 */
describe('the pure boundary', () => {
  const roots = [
    ...sources(here),
    path.join(src, 'secured', 'vocabulary.ts'),
    path.join(src, 'secured', 'operators.ts'),
    path.join(src, 'secured', 'vector.ts'),
  ]

  it('imports nothing from the ORM, anywhere in its real import graph', () => {
    const { files, orm } = graph(roots)
    expect(orm).toEqual([])
    // Not vacuous: the walk followed the boundary's edges out of the module,
    // so an empty result above is the invariant holding rather than a walk
    // that visited only the roots it was handed.
    expect(files.size).toBeGreaterThan(roots.length)
  })

  it('the walk detects an ORM import: the contract builder carries one', () => {
    expect(graph([path.join(src, 'contract', 'prisma.ts')]).orm.length).toBeGreaterThan(0)
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
