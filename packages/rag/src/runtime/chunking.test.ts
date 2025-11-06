import { describe, it, expect } from 'vitest'
import { chunkText, estimateTokenCount, mergeSmallChunks } from './chunking.js'

describe('chunkText', () => {
  describe('recursive strategy', () => {
    it('should chunk text at paragraph boundaries', () => {
      const text = 'Paragraph 1\n\nParagraph 2\n\nParagraph 3'
      const chunks = chunkText(text, {
        strategy: 'recursive',
        chunkSize: 15,
        chunkOverlap: 0,
      })

      expect(chunks).toHaveLength(3)
      expect(chunks[0].text).toBe('Paragraph 1\n\n')
      expect(chunks[1].text).toBe('Paragraph 2\n\n')
      expect(chunks[2].text).toBe('Paragraph 3')
    })

    it('should handle overlap between chunks', () => {
      const text = 'First chunk here. Second chunk here. Third chunk here.'
      const chunks = chunkText(text, {
        strategy: 'recursive',
        chunkSize: 20,
        chunkOverlap: 5,
      })

      expect(chunks.length).toBeGreaterThan(1)

      // Check that chunks have some overlap
      for (let i = 1; i < chunks.length; i++) {
        const prevChunk = chunks[i - 1].text
        const currChunk = chunks[i].text
        const overlap = prevChunk.slice(-5)
        // Overlap might not be exact due to sentence boundaries
        expect(currChunk).toContain(overlap.trim().split(' ')[0])
      }
    })

    it('should respect chunk size limits', () => {
      const text = 'A'.repeat(1000)
      const chunks = chunkText(text, {
        strategy: 'recursive',
        chunkSize: 100,
        chunkOverlap: 0,
      })

      for (const chunk of chunks) {
        expect(chunk.text.length).toBeLessThanOrEqual(100)
      }
    })

    it('should track chunk positions correctly', () => {
      const text = 'Start. Middle. End.'
      const chunks = chunkText(text, {
        strategy: 'recursive',
        chunkSize: 100,
        chunkOverlap: 0,
      })

      expect(chunks[0].start).toBe(0)
      expect(chunks[0].end).toBe(text.length)
      expect(chunks[0].text).toBe(text)
    })
  })

  describe('sentence strategy', () => {
    it('should preserve sentence boundaries', () => {
      const text = 'First sentence. Second sentence. Third sentence.'
      const chunks = chunkText(text, {
        strategy: 'sentence',
        chunkSize: 20,
        chunkOverlap: 0,
      })

      expect(chunks.length).toBeGreaterThan(1)

      // Each chunk should end with sentence punctuation
      for (const chunk of chunks) {
        expect(chunk.text.trim()).toMatch(/[.!?]$/)
      }
    })

    it('should handle text with no sentences', () => {
      const text = 'No sentence markers here'
      const chunks = chunkText(text, {
        strategy: 'sentence',
        chunkSize: 10,
        chunkOverlap: 0,
      })

      expect(chunks).toHaveLength(1)
      expect(chunks[0].text).toBe(text)
    })
  })

  describe('sliding-window strategy', () => {
    it('should create overlapping fixed-size chunks', () => {
      const text = 'A'.repeat(100)
      const chunks = chunkText(text, {
        strategy: 'sliding-window',
        chunkSize: 30,
        chunkOverlap: 10,
      })

      expect(chunks.length).toBeGreaterThan(1)

      // Check fixed size (except possibly last chunk)
      for (let i = 0; i < chunks.length - 1; i++) {
        expect(chunks[i].text.length).toBe(30)
      }

      // Check overlap
      for (let i = 1; i < chunks.length; i++) {
        const prevChunk = chunks[i - 1]
        const currChunk = chunks[i]
        expect(currChunk.start).toBe(prevChunk.start + 20) // step = chunkSize - overlap
      }
    })

    it('should skip empty chunks', () => {
      const text = '   ' // Just whitespace
      const chunks = chunkText(text, {
        strategy: 'sliding-window',
        chunkSize: 10,
        chunkOverlap: 0,
      })

      expect(chunks).toHaveLength(0)
    })
  })

  describe('token-aware strategy', () => {
    it('should estimate token limits', () => {
      const text = 'A'.repeat(400) // ~100 tokens at 4 chars/token
      const chunks = chunkText(text, {
        strategy: 'token-aware',
        tokenLimit: 50,
        chunkOverlap: 0,
      })

      expect(chunks.length).toBeGreaterThanOrEqual(2)

      // Each chunk should be roughly under token limit * 4 chars
      for (const chunk of chunks) {
        expect(chunk.text.length).toBeLessThanOrEqual(50 * 4)
      }
    })
  })

  describe('edge cases', () => {
    it('should handle empty text', () => {
      const chunks = chunkText('', { chunkSize: 100 })
      expect(chunks).toHaveLength(0)
    })

    it('should handle text smaller than chunk size', () => {
      const text = 'Small text'
      const chunks = chunkText(text, { chunkSize: 1000 })

      expect(chunks).toHaveLength(1)
      expect(chunks[0].text).toBe(text)
      expect(chunks[0].start).toBe(0)
      expect(chunks[0].end).toBe(text.length)
    })

    it('should throw error if overlap >= chunk size', () => {
      expect(() => {
        chunkText('text', { chunkSize: 10, chunkOverlap: 10 })
      }).toThrow('chunkOverlap must be less than chunkSize')
    })

    it('should assign correct chunk indexes', () => {
      const text = 'A'.repeat(300)
      const chunks = chunkText(text, { chunkSize: 100, chunkOverlap: 0 })

      chunks.forEach((chunk, i) => {
        expect(chunk.index).toBe(i)
      })
    })
  })
})

describe('estimateTokenCount', () => {
  it('should estimate token count', () => {
    const text = 'Hello world'
    const count = estimateTokenCount(text)

    // "Hello world" is 11 chars / 4 = ~3 tokens
    expect(count).toBe(3)
  })

  it('should handle empty text', () => {
    expect(estimateTokenCount('')).toBe(0)
  })

  it('should handle long text', () => {
    const text = 'A'.repeat(1000)
    const count = estimateTokenCount(text)

    expect(count).toBe(250) // 1000 / 4
  })
})

describe('mergeSmallChunks', () => {
  it('should merge chunks below minimum size', () => {
    const chunks = [
      { text: 'A', start: 0, end: 1, index: 0 },
      { text: 'B', start: 1, end: 2, index: 1 },
      { text: 'C', start: 2, end: 3, index: 2 },
    ]

    const merged = mergeSmallChunks(chunks, 2)

    expect(merged.length).toBeLessThan(chunks.length)
    expect(merged[0].text.length).toBeGreaterThanOrEqual(2)
  })

  it('should not merge chunks already above minimum size', () => {
    const chunks = [
      { text: 'AAA', start: 0, end: 3, index: 0 },
      { text: 'BBB', start: 3, end: 6, index: 1 },
    ]

    const merged = mergeSmallChunks(chunks, 2)

    expect(merged).toHaveLength(2)
  })

  it('should handle empty array', () => {
    const merged = mergeSmallChunks([], 10)
    expect(merged).toHaveLength(0)
  })

  it('should update chunk indexes after merge', () => {
    const chunks = [
      { text: 'A', start: 0, end: 1, index: 0 },
      { text: 'B', start: 1, end: 2, index: 1 },
    ]

    const merged = mergeSmallChunks(chunks, 5)

    merged.forEach((chunk, i) => {
      expect(chunk.index).toBe(i)
    })
  })

  it('should merge metadata from merged chunks', () => {
    const chunks = [
      { text: 'A', start: 0, end: 1, index: 0, metadata: { foo: 1 } },
      { text: 'B', start: 1, end: 2, index: 1, metadata: { bar: 2 } },
    ]

    const merged = mergeSmallChunks(chunks, 5)

    expect(merged[0].metadata).toEqual({ foo: 1, bar: 2 })
  })
})
