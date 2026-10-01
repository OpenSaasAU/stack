import { describe, it, expect } from 'vitest'
import { resolveQueryField } from './query-validation.js'
import { text } from '../fields/index.js'

describe('resolveQueryField', () => {
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty', 'constructorId'])(
    'refuses the inherited name %s',
    (name) => {
      expect(resolveQueryField(name, { title: text() })).toBeUndefined()
    },
  )

  it('resolves a declared field', () => {
    expect(resolveQueryField('title', { title: text() })?.isRelationship).toBe(false)
  })
})
