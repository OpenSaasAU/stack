import { describe, it, expect, vi } from 'vitest'
import {
  generateEmbedding,
  generateEmbeddings,
  shouldRegenerateEmbedding,
  hashText,
  validateEmbeddingDimensions,
  mergeEmbeddings,
} from './embeddings.js'
import type { EmbeddingProvider } from '../providers/types.js'
import type { StoredEmbedding } from '../config/types.js'

// Mock embedding provider
function createMockProvider(): EmbeddingProvider {
  return {
    type: 'mock',
    model: 'mock-model',
    dimensions: 3,
    embed: vi.fn(async (text: string) => {
      // Return simple mock vector based on text length
      return [text.length / 10, text.length / 20, text.length / 30]
    }),
    embedBatch: vi.fn(async (texts: string[]) => {
      return texts.map((text) => [text.length / 10, text.length / 20, text.length / 30])
    }),
  }
}

describe('generateEmbedding', () => {
  it('should generate single embedding without chunking', async () => {
    const provider = createMockProvider()
    const embedding = await generateEmbedding({
      provider,
      text: 'Hello world',
      enableChunking: false,
    })

    expect(embedding).toHaveProperty('vector')
    expect(embedding).toHaveProperty('metadata')
    expect(embedding.vector).toHaveLength(3)
    expect(embedding.metadata.model).toBe('mock-model')
    expect(embedding.metadata.provider).toBe('mock')
    expect(embedding.metadata.dimensions).toBe(3)
    expect(embedding.metadata.sourceHash).toBeDefined()
  })

  it('should generate chunked embeddings with chunking enabled', async () => {
    const provider = createMockProvider()
    const longText = 'A'.repeat(1000)

    const chunkedEmbeddings = await generateEmbedding({
      provider,
      text: longText,
      enableChunking: true,
      chunking: { chunkSize: 200, chunkOverlap: 0 },
    })

    expect(Array.isArray(chunkedEmbeddings)).toBe(true)
    expect(chunkedEmbeddings.length).toBeGreaterThan(1)

    for (const chunked of chunkedEmbeddings) {
      expect(chunked).toHaveProperty('chunk')
      expect(chunked).toHaveProperty('embedding')
      expect(chunked.embedding.vector).toHaveLength(3)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((chunked.embedding.metadata as any).chunkIndex).toBeDefined()
    }
  })

  it('should include source hash when enabled', async () => {
    const provider = createMockProvider()
    const text = 'Test text'

    const embedding = await generateEmbedding({
      provider,
      text,
      includeSourceHash: true,
    })

    expect(embedding.metadata.sourceHash).toBeDefined()
    expect(typeof embedding.metadata.sourceHash).toBe('string')
    expect(embedding.metadata.sourceHash).toHaveLength(64) // SHA-256 hex
  })

  it('should exclude source hash when disabled', async () => {
    const provider = createMockProvider()
    const text = 'Test text'

    const embedding = await generateEmbedding({
      provider,
      text,
      includeSourceHash: false,
    })

    expect(embedding.metadata.sourceHash).toBeUndefined()
  })

  it('should include additional metadata', async () => {
    const provider = createMockProvider()

    const embedding = await generateEmbedding({
      provider,
      text: 'Test',
      metadata: { customField: 'customValue' },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((embedding.metadata as any).customField).toBe('customValue')
  })

  it('should call provider.embed for single embedding', async () => {
    const provider = createMockProvider()

    await generateEmbedding({
      provider,
      text: 'Test',
      enableChunking: false,
    })

    expect(provider.embed).toHaveBeenCalledWith('Test')
  })

  it('should call provider.embedBatch for chunked embedding', async () => {
    const provider = createMockProvider()

    await generateEmbedding({
      provider,
      text: 'A'.repeat(1000),
      enableChunking: true,
      chunking: { chunkSize: 200, chunkOverlap: 50 },
    })

    expect(provider.embedBatch).toHaveBeenCalled()
  })
})

describe('generateEmbeddings', () => {
  it('should generate embeddings for multiple texts', async () => {
    const provider = createMockProvider()
    const texts = ['Text 1', 'Text 2', 'Text 3']

    const embeddings = await generateEmbeddings({
      provider,
      texts,
    })

    expect(embeddings).toHaveLength(3)

    for (const embedding of embeddings) {
      expect(embedding.vector).toHaveLength(3)
      expect(embedding.metadata.model).toBe('mock-model')
    }
  })

  it('should process texts in batches', async () => {
    const provider = createMockProvider()
    const texts = Array(25).fill('Test')

    await generateEmbeddings({
      provider,
      texts,
      batchSize: 10,
    })

    // Should be called 3 times (10 + 10 + 5)
    expect(provider.embedBatch).toHaveBeenCalledTimes(3)
  })

  it('should include source hashes for all embeddings', async () => {
    const provider = createMockProvider()
    const texts = ['Text 1', 'Text 2', 'Text 3']

    const embeddings = await generateEmbeddings({
      provider,
      texts,
      includeSourceHash: true,
    })

    for (const embedding of embeddings) {
      expect(embedding.metadata.sourceHash).toBeDefined()
    }
  })

  it('should handle empty text array', async () => {
    const provider = createMockProvider()

    const embeddings = await generateEmbeddings({
      provider,
      texts: [],
    })

    expect(embeddings).toHaveLength(0)
  })
})

describe('shouldRegenerateEmbedding', () => {
  it('should return true when no existing embedding', () => {
    const result = shouldRegenerateEmbedding('New text', null)
    expect(result).toBe(true)
  })

  it('should return true when source text changed', () => {
    const embedding: StoredEmbedding = {
      vector: [1, 2, 3],
      metadata: {
        model: 'test',
        provider: 'test',
        dimensions: 3,
        generatedAt: new Date().toISOString(),
        sourceHash: hashText('Old text'),
      },
    }

    const result = shouldRegenerateEmbedding('New text', embedding)
    expect(result).toBe(true)
  })

  it('should return false when source text unchanged', () => {
    const text = 'Same text'
    const embedding: StoredEmbedding = {
      vector: [1, 2, 3],
      metadata: {
        model: 'test',
        provider: 'test',
        dimensions: 3,
        generatedAt: new Date().toISOString(),
        sourceHash: hashText(text),
      },
    }

    const result = shouldRegenerateEmbedding(text, embedding)
    expect(result).toBe(false)
  })

  it('should return false when no source hash in metadata', () => {
    const embedding: StoredEmbedding = {
      vector: [1, 2, 3],
      metadata: {
        model: 'test',
        provider: 'test',
        dimensions: 3,
        generatedAt: new Date().toISOString(),
      },
    }

    const result = shouldRegenerateEmbedding('Any text', embedding)
    expect(result).toBe(false) // Conservative: don't regenerate if we can't tell
  })
})

describe('hashText', () => {
  it('should generate consistent hash for same text', () => {
    const text = 'Test text'
    const hash1 = hashText(text)
    const hash2 = hashText(text)

    expect(hash1).toBe(hash2)
  })

  it('should generate different hashes for different text', () => {
    const hash1 = hashText('Text 1')
    const hash2 = hashText('Text 2')

    expect(hash1).not.toBe(hash2)
  })

  it('should generate SHA-256 hex string', () => {
    const hash = hashText('Test')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should be case-sensitive', () => {
    const hash1 = hashText('Test')
    const hash2 = hashText('test')

    expect(hash1).not.toBe(hash2)
  })
})

describe('validateEmbeddingDimensions', () => {
  it('should pass validation for correct dimensions', () => {
    const embedding: StoredEmbedding = {
      vector: [1, 2, 3],
      metadata: {
        model: 'test',
        provider: 'test',
        dimensions: 3,
        generatedAt: new Date().toISOString(),
      },
    }

    expect(() => {
      validateEmbeddingDimensions(embedding, 3)
    }).not.toThrow()
  })

  it('should throw error for dimension mismatch', () => {
    const embedding: StoredEmbedding = {
      vector: [1, 2, 3],
      metadata: {
        model: 'test',
        provider: 'test',
        dimensions: 3,
        generatedAt: new Date().toISOString(),
      },
    }

    expect(() => {
      validateEmbeddingDimensions(embedding, 5)
    }).toThrow('Embedding dimension mismatch: expected 5, got 3')
  })

  it('should throw error for metadata dimension mismatch', () => {
    const embedding: StoredEmbedding = {
      vector: [1, 2, 3],
      metadata: {
        model: 'test',
        provider: 'test',
        dimensions: 5, // Wrong metadata
        generatedAt: new Date().toISOString(),
      },
    }

    expect(() => {
      validateEmbeddingDimensions(embedding, 3)
    }).toThrow('Embedding metadata dimension mismatch')
  })
})

describe('mergeEmbeddings', () => {
  it('should merge embeddings using average pooling', () => {
    const embeddings: StoredEmbedding[] = [
      {
        vector: [1, 2, 3],
        metadata: {
          model: 'test',
          provider: 'test',
          dimensions: 3,
          generatedAt: new Date().toISOString(),
        },
      },
      {
        vector: [3, 4, 5],
        metadata: {
          model: 'test',
          provider: 'test',
          dimensions: 3,
          generatedAt: new Date().toISOString(),
        },
      },
    ]

    const merged = mergeEmbeddings(embeddings, 'average')

    expect(merged.vector).toEqual([2, 3, 4]) // Average of [1,2,3] and [3,4,5]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((merged.metadata as any).mergedFrom).toBe(2)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((merged.metadata as any).mergeMethod).toBe('average')
  })

  it('should merge embeddings using max pooling', () => {
    const embeddings: StoredEmbedding[] = [
      {
        vector: [1, 5, 3],
        metadata: {
          model: 'test',
          provider: 'test',
          dimensions: 3,
          generatedAt: new Date().toISOString(),
        },
      },
      {
        vector: [4, 2, 6],
        metadata: {
          model: 'test',
          provider: 'test',
          dimensions: 3,
          generatedAt: new Date().toISOString(),
        },
      },
    ]

    const merged = mergeEmbeddings(embeddings, 'max')

    expect(merged.vector).toEqual([4, 5, 6]) // Max of each dimension
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((merged.metadata as any).mergeMethod).toBe('max')
  })

  it('should return single embedding if array has one item', () => {
    const embeddings: StoredEmbedding[] = [
      {
        vector: [1, 2, 3],
        metadata: {
          model: 'test',
          provider: 'test',
          dimensions: 3,
          generatedAt: new Date().toISOString(),
        },
      },
    ]

    const merged = mergeEmbeddings(embeddings)

    expect(merged).toBe(embeddings[0])
  })

  it('should throw error for empty array', () => {
    expect(() => {
      mergeEmbeddings([])
    }).toThrow('Cannot merge empty array of embeddings')
  })

  it('should throw error for dimension mismatch', () => {
    const embeddings: StoredEmbedding[] = [
      {
        vector: [1, 2, 3],
        metadata: {
          model: 'test',
          provider: 'test',
          dimensions: 3,
          generatedAt: new Date().toISOString(),
        },
      },
      {
        vector: [1, 2], // Different dimensions
        metadata: {
          model: 'test',
          provider: 'test',
          dimensions: 2,
          generatedAt: new Date().toISOString(),
        },
      },
    ]

    expect(() => {
      mergeEmbeddings(embeddings)
    }).toThrow('Cannot merge embeddings with different dimensions')
  })
})
