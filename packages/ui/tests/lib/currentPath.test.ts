import { describe, it, expect } from 'vitest'
import { deriveCurrentPath } from '../../src/lib/currentPath.js'

describe('deriveCurrentPath', () => {
  it('returns an empty string for an empty params array', () => {
    expect(deriveCurrentPath([])).toBe('')
  })

  it('returns an empty string when params is omitted', () => {
    expect(deriveCurrentPath()).toBe('')
  })

  it('returns a leading-slash path for a single-segment route', () => {
    expect(deriveCurrentPath(['post'])).toBe('/post')
  })

  it('returns a leading-slash path for a multi-segment route', () => {
    expect(deriveCurrentPath(['post', 'create'])).toBe('/post/create')
    expect(deriveCurrentPath(['post', 'abc123'])).toBe('/post/abc123')
  })
})
