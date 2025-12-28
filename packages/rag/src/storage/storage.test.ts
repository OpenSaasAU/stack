import { describe, it, expect, beforeEach, vi } from 'vitest'
import { JsonVectorStorage } from './json.js'
import { createVectorStorage } from './index.js'
import { cosineSimilarity, dotProduct, l2Distance } from './types.js'
import type { StoredEmbedding } from '../config/types.js'
import type { AccessContext } from '@opensaas/stack-core'

// Helper to create mock context
function createMockContext(dbOverrides: Record<string, unknown> = {}): AccessContext<unknown> {
  return {
    db: dbOverrides,
    session: null,
    sudo: vi.fn(),
    prisma: {} as unknown,
    storage: {} as unknown,
    plugins: {},
    _isSudo: false,
    _resolveOutputCounter: { depth: 0 },
  } as AccessContext<unknown>
}

describe('Vector Storage', () => {
  describe('JsonVectorStorage', () => {
    let storage: JsonVectorStorage

    beforeEach(() => {
      storage = new JsonVectorStorage()
    })

    describe('constructor', () => {
      it('should initialize with correct type', () => {
        expect(storage.type).toBe('json')
      })
    })

    describe('search', () => {
      it('should throw error for non-existent list', async () => {
        const mockContext = createMockContext({})

        const queryVector = [0.1, 0.2, 0.3]

        await expect(
          storage.search('NonExistentList', 'embedding', queryVector, {
            context: mockContext,
          }),
        ).rejects.toThrow(/List 'NonExistentList' not found/)
      })

      it('should return empty results when no items match', async () => {
        const mockContext = createMockContext({
          article: {
            findMany: vi.fn().mockResolvedValue([]),
          },
        })

        const queryVector = [0.1, 0.2, 0.3]

        const results = await storage.search('Article', 'embedding', queryVector, {
          context: mockContext,
        })

        expect(results).toEqual([])
      })

      it('should filter items with null embeddings', async () => {
        const mockItems = [
          {
            id: '1',
            title: 'Article 1',
            embedding: null,
          },
          {
            id: '2',
            title: 'Article 2',
            embedding: {
              vector: [0.1, 0.2, 0.3],
              metadata: {
                model: 'test',
                provider: 'test',
                dimensions: 3,
                generatedAt: new Date().toISOString(),
              },
            },
          },
        ]

        const mockContext = createMockContext({
          article: {
            findMany: vi.fn().mockResolvedValue(mockItems),
          },
        })

        const queryVector = [0.1, 0.2, 0.3]

        const results = await storage.search('Article', 'embedding', queryVector, {
          context: mockContext,
        })

        expect(results).toHaveLength(1)
        expect((results[0].item as { id: string }).id).toBe('2')
      })

      it('should calculate cosine similarity correctly', async () => {
        const embedding1: StoredEmbedding = {
          vector: [1.0, 0.0, 0.0],
          metadata: {
            model: 'test',
            provider: 'test',
            dimensions: 3,
            generatedAt: new Date().toISOString(),
          },
        }

        const embedding2: StoredEmbedding = {
          vector: [0.0, 1.0, 0.0],
          metadata: {
            model: 'test',
            provider: 'test',
            dimensions: 3,
            generatedAt: new Date().toISOString(),
          },
        }

        const embedding3: StoredEmbedding = {
          vector: [1.0, 0.0, 0.0],
          metadata: {
            model: 'test',
            provider: 'test',
            dimensions: 3,
            generatedAt: new Date().toISOString(),
          },
        }

        const mockItems = [
          { id: '1', embedding: embedding1 },
          { id: '2', embedding: embedding2 },
          { id: '3', embedding: embedding3 },
        ]

        const mockContext = createMockContext({
          article: {
            findMany: vi.fn().mockResolvedValue(mockItems),
          },
        })

        const queryVector = [1.0, 0.0, 0.0] // Same as embedding1 and embedding3

        const results = await storage.search('Article', 'embedding', queryVector, {
          context: mockContext,
          limit: 10,
        })

        expect(results).toHaveLength(3)
        // Items 1 and 3 should have perfect similarity (score = 1.0)
        expect(results[0].score).toBeCloseTo(1.0, 5)
        expect(results[1].score).toBeCloseTo(1.0, 5)
        // Item 2 should have perpendicular vectors (cosine similarity normalized to 0.5)
        expect(results[2].score).toBeCloseTo(0.5, 5)
      })

      it('should respect limit parameter', async () => {
        const mockItems = Array.from({ length: 20 }, (_, i) => ({
          id: String(i + 1),
          embedding: {
            vector: [Math.random(), Math.random(), Math.random()],
            metadata: {
              model: 'test',
              provider: 'test',
              dimensions: 3,
              generatedAt: new Date().toISOString(),
            },
          },
        }))

        const mockContext = createMockContext({
          article: {
            findMany: vi.fn().mockResolvedValue(mockItems),
          },
        })

        const queryVector = [0.5, 0.5, 0.5]

        const results = await storage.search('Article', 'embedding', queryVector, {
          context: mockContext,
          limit: 5,
        })

        expect(results).toHaveLength(5)
      })

      it('should respect minScore parameter', async () => {
        const mockItems = [
          {
            id: '1',
            embedding: {
              vector: [1.0, 0.0, 0.0], // Perfect match
              metadata: {
                model: 'test',
                provider: 'test',
                dimensions: 3,
                generatedAt: new Date().toISOString(),
              },
            },
          },
          {
            id: '2',
            embedding: {
              vector: [0.0, 1.0, 0.0], // No match (perpendicular)
              metadata: {
                model: 'test',
                provider: 'test',
                dimensions: 3,
                generatedAt: new Date().toISOString(),
              },
            },
          },
        ]

        const mockContext = createMockContext({
          article: {
            findMany: vi.fn().mockResolvedValue(mockItems),
          },
        })

        const queryVector = [1.0, 0.0, 0.0]

        const results = await storage.search('Article', 'embedding', queryVector, {
          context: mockContext,
          minScore: 0.9, // Only items with >90% similarity
        })

        expect(results).toHaveLength(1)
        expect((results[0].item as { id: string }).id).toBe('1')
      })

      it('should sort results by score descending', async () => {
        const mockItems = [
          {
            id: '1',
            score: 0.5,
            embedding: {
              vector: [0.5, 0.5, 0.5],
              metadata: {
                model: 'test',
                provider: 'test',
                dimensions: 3,
                generatedAt: new Date().toISOString(),
              },
            },
          },
          {
            id: '2',
            score: 0.9,
            embedding: {
              vector: [0.9, 0.9, 0.9],
              metadata: {
                model: 'test',
                provider: 'test',
                dimensions: 3,
                generatedAt: new Date().toISOString(),
              },
            },
          },
          {
            id: '3',
            score: 0.7,
            embedding: {
              vector: [0.7, 0.7, 0.7],
              metadata: {
                model: 'test',
                provider: 'test',
                dimensions: 3,
                generatedAt: new Date().toISOString(),
              },
            },
          },
        ]

        const mockContext = createMockContext({
          article: {
            findMany: vi.fn().mockResolvedValue(mockItems),
          },
        })

        const queryVector = [1.0, 1.0, 1.0]

        const results = await storage.search('Article', 'embedding', queryVector, {
          context: mockContext,
        })

        // Results should be sorted by similarity score descending
        expect(results[0].score).toBeGreaterThanOrEqual(results[1].score)
        expect(results[1].score).toBeGreaterThanOrEqual(results[2].score)
      })

      it('should skip items with dimension mismatch', async () => {
        const mockItems = [
          {
            id: '1',
            embedding: {
              vector: [0.1, 0.2], // 2 dimensions
              metadata: {
                model: 'test',
                provider: 'test',
                dimensions: 2,
                generatedAt: new Date().toISOString(),
              },
            },
          },
          {
            id: '2',
            embedding: {
              vector: [0.1, 0.2, 0.3], // 3 dimensions - correct
              metadata: {
                model: 'test',
                provider: 'test',
                dimensions: 3,
                generatedAt: new Date().toISOString(),
              },
            },
          },
        ]

        const mockContext = createMockContext({
          article: {
            findMany: vi.fn().mockResolvedValue(mockItems),
          },
        })

        const queryVector = [0.1, 0.2, 0.3] // 3 dimensions

        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const results = await storage.search('Article', 'embedding', queryVector, {
          context: mockContext,
        })

        expect(results).toHaveLength(1)
        expect((results[0].item as { id: string }).id).toBe('2')
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Vector dimension mismatch'),
        )

        consoleWarnSpy.mockRestore()
      })

      it('should pass through where clause to Prisma', async () => {
        const mockContext = createMockContext({
          article: {
            findMany: vi.fn().mockResolvedValue([]),
          },
        })

        const queryVector = [0.1, 0.2, 0.3]
        const whereClause = { published: true }

        await storage.search('Article', 'embedding', queryVector, {
          context: mockContext,
          where: whereClause,
        })

        expect(
          (mockContext.db as Record<string, { findMany: (args: unknown) => void }>).article
            .findMany,
        ).toHaveBeenCalledWith({
          where: {
            published: true,
            embedding: { not: null },
          },
        })
      })

      it('should include distance in results', async () => {
        const mockItems = [
          {
            id: '1',
            embedding: {
              vector: [1.0, 0.0, 0.0],
              metadata: {
                model: 'test',
                provider: 'test',
                dimensions: 3,
                generatedAt: new Date().toISOString(),
              },
            },
          },
        ]

        const mockContext = createMockContext({
          article: {
            findMany: vi.fn().mockResolvedValue(mockItems),
          },
        })

        const queryVector = [1.0, 0.0, 0.0]

        const results = await storage.search('Article', 'embedding', queryVector, {
          context: mockContext,
        })

        expect(results[0]).toHaveProperty('distance')
        expect(results[0].distance).toBeCloseTo(0.0, 5) // distance = 1 - score, perfect match = 0 distance
      })
    })

    describe('cosineSimilarity', () => {
      it('should calculate similarity for identical vectors', () => {
        const vec1 = [1.0, 2.0, 3.0]
        const vec2 = [1.0, 2.0, 3.0]

        const similarity = storage.cosineSimilarity(vec1, vec2)
        expect(similarity).toBeCloseTo(1.0, 5)
      })

      it('should calculate similarity for perpendicular vectors', () => {
        const vec1 = [1.0, 0.0, 0.0]
        const vec2 = [0.0, 1.0, 0.0]

        const similarity = storage.cosineSimilarity(vec1, vec2)
        // Cosine similarity is normalized to 0-1 range in the implementation
        // Perpendicular vectors have cosine 0, which becomes 0.5 after normalization
        expect(similarity).toBeCloseTo(0.5, 5)
      })

      it('should calculate similarity for opposite vectors', () => {
        const vec1 = [1.0, 0.0, 0.0]
        const vec2 = [-1.0, 0.0, 0.0]

        const similarity = storage.cosineSimilarity(vec1, vec2)
        // Cosine similarity is normalized to 0-1 range in the implementation
        // Opposite vectors have cosine -1, which becomes 0.0 after normalization
        expect(similarity).toBeCloseTo(0.0, 5)
      })
    })
  })

  describe('Similarity utility functions', () => {
    describe('cosineSimilarity', () => {
      it('should calculate cosine similarity correctly', () => {
        const vec1 = [1.0, 0.0, 0.0]
        const vec2 = [1.0, 0.0, 0.0]
        expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(1.0, 5)
      })

      it('should handle zero vectors', () => {
        const vec1 = [0.0, 0.0, 0.0]
        const vec2 = [1.0, 0.0, 0.0]
        expect(cosineSimilarity(vec1, vec2)).toBe(0)
      })

      it('should throw for mismatched dimensions', () => {
        const vec1 = [1.0, 0.0]
        const vec2 = [1.0, 0.0, 0.0]
        expect(() => cosineSimilarity(vec1, vec2)).toThrow('Vector dimension mismatch')
      })
    })

    describe('dotProduct', () => {
      it('should calculate dot product correctly', () => {
        const vec1 = [1.0, 2.0, 3.0]
        const vec2 = [4.0, 5.0, 6.0]
        // 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
        expect(dotProduct(vec1, vec2)).toBe(32)
      })

      it('should return 0 for perpendicular vectors', () => {
        const vec1 = [1.0, 0.0, 0.0]
        const vec2 = [0.0, 1.0, 0.0]
        expect(dotProduct(vec1, vec2)).toBe(0)
      })

      it('should throw for mismatched dimensions', () => {
        const vec1 = [1.0, 0.0]
        const vec2 = [1.0, 0.0, 0.0]
        expect(() => dotProduct(vec1, vec2)).toThrow('Vector dimension mismatch')
      })
    })

    describe('l2Distance', () => {
      it('should calculate L2 distance correctly', () => {
        const vec1 = [0.0, 0.0, 0.0]
        const vec2 = [3.0, 4.0, 0.0]
        // sqrt((3-0)^2 + (4-0)^2 + (0-0)^2) = sqrt(9 + 16) = 5
        expect(l2Distance(vec1, vec2)).toBe(5)
      })

      it('should return 0 for identical vectors', () => {
        const vec1 = [1.0, 2.0, 3.0]
        const vec2 = [1.0, 2.0, 3.0]
        expect(l2Distance(vec1, vec2)).toBe(0)
      })

      it('should throw for mismatched dimensions', () => {
        const vec1 = [1.0, 0.0]
        const vec2 = [1.0, 0.0, 0.0]
        expect(() => l2Distance(vec1, vec2)).toThrow('Vector dimension mismatch')
      })
    })
  })

  describe('createVectorStorage factory', () => {
    it('should create JSON storage', () => {
      const storage = createVectorStorage({ type: 'json' })
      expect(storage).toBeInstanceOf(JsonVectorStorage)
      expect(storage.type).toBe('json')
    })

    it('should throw error for unknown storage type', () => {
      expect(() => {
        createVectorStorage({ type: 'unknown' as 'json' })
      }).toThrow(/Unknown vector storage type/)
    })
  })

  describe('Storage interface compliance', () => {
    it('JSON storage should implement VectorStorage interface', () => {
      const storage = new JsonVectorStorage()

      expect(storage).toHaveProperty('type')
      expect(storage).toHaveProperty('search')
      expect(typeof storage.search).toBe('function')
    })
  })
})
