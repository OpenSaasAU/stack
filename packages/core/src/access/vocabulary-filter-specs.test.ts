import { describe, expect, test } from 'vitest'
import { text } from '../fields/index.js'
import type { OpenSaasConfig } from '../config/types.js'
import type { SessionVocabulary } from './session-vocabulary.js'
import { filterSpecsOf, withFilterSpecs } from './vocabulary-filter-specs.js'

const config: OpenSaasConfig = { db: { provider: 'postgresql' }, lists: {} }

function vocabulary(): SessionVocabulary {
  return {
    listKey: 'Post',
    operations: { query: 'allow', create: 'allow', update: 'allow', delete: 'allow' },
    fields: new Map(),
  }
}

describe('filterSpecsOf', () => {
  test('is empty for a vocabulary the resolver did not build', () => {
    expect(filterSpecsOf(vocabulary()).size).toBe(0)
  })

  test('returns the specs the vocabulary was built with', () => {
    const spec = text().getFilterSpec?.('title', 'Post', config)
    if (spec === undefined) throw new Error('text() has no Filter spec')
    const specs = new Map([['title', spec]])
    expect(filterSpecsOf(withFilterSpecs(vocabulary(), specs))).toBe(specs)
  })
})
