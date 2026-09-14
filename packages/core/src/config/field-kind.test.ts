import { readFileSync, readdirSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { FieldConfig, OpenSaasConfig } from './types.js'
import { isComputedField, readContractDescriptorKind } from './field-kind.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..', '..', '..')

const CONFIG: OpenSaasConfig = { db: { provider: 'postgresql' }, lists: {} }

function computedByDescriptor(): FieldConfig {
  return { type: 'thirdParty', getContractField: () => ({ kind: 'computed' }) }
}

describe('isComputedField', () => {
  it('is true for the `virtual` flag, with no descriptor read at all', () => {
    const field: FieldConfig = { type: 'text', virtual: true }
    expect(isComputedField(field, 'x', 'List', CONFIG)).toBe(true)
    // No getContractField to throw from — the flag alone decides.
    expect(isComputedField(field, 'x', undefined, undefined)).toBe(true)
  })

  it('is true for the `virtual` type discriminator', () => {
    expect(isComputedField({ type: 'virtual' }, 'x', 'List', CONFIG)).toBe(true)
  })

  it('is true for a `{ kind: "computed" }` descriptor with neither marker set (#1531)', () => {
    const field = computedByDescriptor()
    expect(field.virtual).toBeUndefined()
    expect(field.type).not.toBe('virtual')
    expect(isComputedField(field, 'x', 'List', CONFIG)).toBe(true)
  })

  it('is false for an ordinary stored field', () => {
    const field: FieldConfig = {
      type: 'text',
      getContractField: () => ({
        kind: 'column',
        name: 'x',
        type: { pack: 'pg', type: 'text' },
        nullable: true,
      }),
    }
    expect(isComputedField(field, 'x', 'List', CONFIG)).toBe(false)
  })

  it('swallows a throwing getContractField and answers false', () => {
    const field: FieldConfig = {
      type: 'thirdParty',
      getContractField: () => {
        throw new Error('boom')
      },
    }
    expect(isComputedField(field, 'x', 'List', CONFIG)).toBe(false)
  })

  it('trusts an already-read descriptorKind over reading again', () => {
    let calls = 0
    const field: FieldConfig = {
      type: 'thirdParty',
      getContractField: () => {
        calls++
        return { kind: 'column', name: 'x', type: { pack: 'pg', type: 'text' }, nullable: true }
      },
    }
    // The pre-fetched kind says "computed" even though the field's own
    // descriptor (were it re-read) would say otherwise — proves the fast
    // path is taken rather than re-invoking getContractField.
    expect(isComputedField(field, 'x', 'List', CONFIG, 'computed')).toBe(true)
    expect(calls).toBe(0)
  })

  it('without listKey/config, answers only from the flag — never calls getContractField', () => {
    let called = false
    const field: FieldConfig = {
      type: 'thirdParty',
      getContractField: () => {
        called = true
        return { kind: 'computed' }
      },
    }
    expect(isComputedField(field, 'x', undefined, undefined)).toBe(false)
    expect(called).toBe(false)
  })
})

describe('readContractDescriptorKind', () => {
  it('reads the kind off the descriptor', () => {
    expect(readContractDescriptorKind(computedByDescriptor(), 'x', 'List', CONFIG)).toBe('computed')
  })

  it('is undefined when the field declares no descriptor', () => {
    expect(readContractDescriptorKind({ type: 'thirdParty' }, 'x', 'List', CONFIG)).toBeUndefined()
  })

  it('swallows a throw and answers undefined', () => {
    const field: FieldConfig = {
      type: 'thirdParty',
      getContractField: () => {
        throw new Error('boom')
      },
    }
    expect(readContractDescriptorKind(field, 'x', 'List', CONFIG)).toBeUndefined()
  })
})

/**
 * Issue #1531: the "does this field store nothing" question — the `virtual`
 * flag/type OR a `{ kind: 'computed' }` descriptor — used to be answered by
 * three independent, hand-copied implementations (the CLI's type generator,
 * core's field-config validation, core's plugin-field-write path). This walks
 * every package's `src/` for a file that combines the flag check with a
 * `'computed'` comparison outside this module — the fingerprint of a
 * reimplementation rather than a call to {@link isComputedField}.
 */
describe('the flag-vs-descriptor predicate has exactly one implementation', () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { recursive: true })
      .filter((entry): entry is string => typeof entry === 'string')
      .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
      .filter((entry) => !entry.split(path.sep).includes('dist'))
      .map((entry) => path.join(dir, entry))
  }

  it('finds no other file testing both the virtual flag and a computed-kind comparison', () => {
    const packagesDir = path.join(repoRoot, 'packages')
    const offenders: string[] = []
    for (const pkg of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue
      const srcDir = path.join(packagesDir, pkg.name, 'src')
      let files: string[]
      try {
        files = sourceFiles(srcDir)
      } catch {
        continue
      }
      for (const file of files) {
        if (path.resolve(file) === path.resolve(here, 'field-kind.ts')) continue
        const source = readFileSync(file, 'utf8')
        if (source.includes('virtual === true') && source.includes("=== 'computed'")) {
          offenders.push(path.relative(repoRoot, file))
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
