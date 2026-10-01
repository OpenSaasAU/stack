import { describe, it, expect } from 'vitest'
import { simpleChunkText } from './build-time.js'

describe('simpleChunkText', () => {
  it('chunks with overlap', () => {
    expect(simpleChunkText('abcdefghij', 5, 2)).toEqual(['abcde', 'defgh', 'ghij', 'j'])
  })

  it('throws when overlap is not less than chunkSize', () => {
    expect(() => simpleChunkText('abcdefghij', 5, 5)).toThrow('overlap must be less than chunkSize')
  })

  it('throws when chunkSize is below 1', () => {
    expect(() => simpleChunkText('abc', 0, 0)).toThrow('chunkSize must be at least 1')
  })

  it('throws on negative or non-finite overlap and chunkSize', () => {
    expect(() => simpleChunkText('abc', 2, -1)).toThrow('overlap must be a non-negative integer')
    expect(() => simpleChunkText('abc', 2, NaN)).toThrow('overlap must be a non-negative integer')
    expect(() => simpleChunkText('abc', NaN, 0)).toThrow('chunkSize must be at least 1')
  })
})
