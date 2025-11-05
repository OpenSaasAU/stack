import { describe, it, expect } from 'vitest'
import { embedding } from './embedding.js'
import type { EmbeddingField } from './embedding.js'
import { z } from 'zod'

describe('Embedding Field', () => {
  describe('embedding field builder', () => {
    it('should create embedding field with default options', () => {
      const field = embedding()

      expect(field.type).toBe('embedding')
      expect(field.dimensions).toBe(1536) // Default OpenAI dimensions
      expect(field.autoGenerate).toBe(false) // No sourceField
    })

    it('should create embedding field with custom dimensions', () => {
      const field = embedding({ dimensions: 3072 })

      expect(field.dimensions).toBe(3072)
    })

    it('should set autoGenerate to true when sourceField is provided', () => {
      const field = embedding({ sourceField: 'content' })

      expect(field.autoGenerate).toBe(true)
      expect(field.sourceField).toBe('content')
    })

    it('should allow explicit autoGenerate override', () => {
      const field = embedding({ sourceField: 'content', autoGenerate: false })

      expect(field.autoGenerate).toBe(false)
      expect(field.sourceField).toBe('content')
    })

    it('should support provider configuration', () => {
      const field = embedding({ provider: 'openai' })

      expect(field.provider).toBe('openai')
    })

    it('should support chunking configuration', () => {
      const field = embedding({
        sourceField: 'content',
        chunking: {
          strategy: 'recursive',
          maxTokens: 500,
          overlap: 50,
        },
      })

      expect(field.chunking).toEqual({
        strategy: 'recursive',
        maxTokens: 500,
        overlap: 50,
      })
    })

    it('should support UI configuration', () => {
      const field = embedding({
        ui: {
          showVector: true,
          showMetadata: true,
        },
      })

      expect(field.ui).toEqual({
        showVector: true,
        showMetadata: true,
      })
    })
  })

  describe('getZodSchema', () => {
    it('should generate valid Zod schema', () => {
      const field = embedding({ dimensions: 3 })
      const schema = field.getZodSchema!('embedding', 'create')

      expect(schema).toBeDefined()
      expect(schema instanceof z.ZodType).toBe(true)
    })

    it('should validate correct embedding structure', () => {
      const field = embedding({ dimensions: 3 })
      const schema = field.getZodSchema!('embedding', 'create')

      const validEmbedding = {
        vector: [0.1, 0.2, 0.3],
        metadata: {
          model: 'text-embedding-3-small',
          provider: 'openai',
          dimensions: 3,
          generatedAt: new Date().toISOString(),
        },
      }

      expect(() => schema.parse(validEmbedding)).not.toThrow()
    })

    it('should accept null embedding', () => {
      const field = embedding({ dimensions: 3 })
      const schema = field.getZodSchema!('embedding', 'create')

      expect(() => schema.parse(null)).not.toThrow()
    })

    it('should accept undefined embedding', () => {
      const field = embedding({ dimensions: 3 })
      const schema = field.getZodSchema!('embedding', 'create')

      expect(() => schema.parse(undefined)).not.toThrow()
    })

    it('should reject incorrect vector dimensions', () => {
      const field = embedding({ dimensions: 3 })
      const schema = field.getZodSchema!('embedding', 'create')

      const invalidEmbedding = {
        vector: [0.1, 0.2], // Only 2 dimensions, expected 3
        metadata: {
          model: 'test',
          provider: 'test',
          dimensions: 2,
          generatedAt: new Date().toISOString(),
        },
      }

      expect(() => schema.parse(invalidEmbedding)).toThrow(/exactly 3 dimensions/)
    })

    it('should validate metadata structure', () => {
      const field = embedding({ dimensions: 3 })
      const schema = field.getZodSchema!('embedding', 'create')

      const invalidEmbedding = {
        vector: [0.1, 0.2, 0.3],
        metadata: {
          // Missing required fields
          model: 'test',
        },
      }

      expect(() => schema.parse(invalidEmbedding)).toThrow()
    })

    it('should accept optional sourceHash in metadata', () => {
      const field = embedding({ dimensions: 3 })
      const schema = field.getZodSchema!('embedding', 'create')

      const embeddingWithHash = {
        vector: [0.1, 0.2, 0.3],
        metadata: {
          model: 'test',
          provider: 'test',
          dimensions: 3,
          generatedAt: new Date().toISOString(),
          sourceHash: 'abc123',
        },
      }

      expect(() => schema.parse(embeddingWithHash)).not.toThrow()
    })

    it('should work for both create and update operations', () => {
      const field = embedding({ dimensions: 3 })

      const createSchema = field.getZodSchema!('embedding', 'create')
      const updateSchema = field.getZodSchema!('embedding', 'update')

      const validEmbedding = {
        vector: [0.1, 0.2, 0.3],
        metadata: {
          model: 'test',
          provider: 'test',
          dimensions: 3,
          generatedAt: new Date().toISOString(),
        },
      }

      expect(() => createSchema.parse(validEmbedding)).not.toThrow()
      expect(() => updateSchema.parse(validEmbedding)).not.toThrow()
    })
  })

  describe('getPrismaType', () => {
    it('should return Json type', () => {
      const field = embedding()
      const prismaType = field.getPrismaType!('embedding')

      expect(prismaType.type).toBe('Json')
    })

    it('should return optional modifier', () => {
      const field = embedding()
      const prismaType = field.getPrismaType!('embedding')

      expect(prismaType.modifiers).toBe('?')
    })

    it('should work regardless of field options', () => {
      const field1 = embedding()
      const field2 = embedding({ dimensions: 3072, provider: 'openai' })

      const type1 = field1.getPrismaType!('embedding')
      const type2 = field2.getPrismaType!('embedding')

      expect(type1).toEqual(type2)
      expect(type1.type).toBe('Json')
      expect(type1.modifiers).toBe('?')
    })
  })

  describe('getTypeScriptType', () => {
    it('should return StoredEmbedding type', () => {
      const field = embedding()
      const tsType = field.getTypeScriptType!()

      expect(tsType.type).toBe('StoredEmbedding | null')
    })

    it('should be optional', () => {
      const field = embedding()
      const tsType = field.getTypeScriptType!()

      expect(tsType.optional).toBe(true)
    })

    it('should work regardless of field options', () => {
      const field1 = embedding()
      const field2 = embedding({ dimensions: 3072, provider: 'openai' })

      const type1 = field1.getTypeScriptType!()
      const type2 = field2.getTypeScriptType!()

      expect(type1).toEqual(type2)
      expect(type1.type).toBe('StoredEmbedding | null')
      expect(type1.optional).toBe(true)
    })
  })

  describe('Field configuration combinations', () => {
    it('should support manual embedding storage', () => {
      const field = embedding({
        dimensions: 1536,
        provider: 'openai',
      })

      expect(field.autoGenerate).toBe(false)
      expect(field.sourceField).toBeUndefined()
      expect(field.dimensions).toBe(1536)
      expect(field.provider).toBe('openai')
    })

    it('should support automatic embedding generation', () => {
      const field = embedding({
        sourceField: 'content',
        provider: 'openai',
        dimensions: 1536,
        autoGenerate: true,
      })

      expect(field.autoGenerate).toBe(true)
      expect(field.sourceField).toBe('content')
      expect(field.dimensions).toBe(1536)
      expect(field.provider).toBe('openai')
    })

    it('should support chunking for long documents', () => {
      const field = embedding({
        sourceField: 'content',
        chunking: {
          strategy: 'recursive',
          maxTokens: 500,
          overlap: 50,
        },
      })

      expect(field.chunking?.strategy).toBe('recursive')
      expect(field.chunking?.maxTokens).toBe(500)
      expect(field.chunking?.overlap).toBe(50)
    })

    it('should support multiple providers via provider name', () => {
      const openaiField = embedding({ provider: 'openai' })
      const ollamaField = embedding({ provider: 'ollama' })

      expect(openaiField.provider).toBe('openai')
      expect(ollamaField.provider).toBe('ollama')
    })
  })

  describe('Field type conformance', () => {
    it('should conform to BaseFieldConfig interface', () => {
      const field: EmbeddingField = embedding()

      expect(field).toHaveProperty('type')
      expect(field).toHaveProperty('getZodSchema')
      expect(field).toHaveProperty('getPrismaType')
      expect(field).toHaveProperty('getTypeScriptType')
    })

    it('should have all required builder methods', () => {
      const field = embedding()

      expect(typeof field.getZodSchema).toBe('function')
      expect(typeof field.getPrismaType).toBe('function')
      expect(typeof field.getTypeScriptType).toBe('function')
    })

    it('should return consistent types across methods', () => {
      const field = embedding({ dimensions: 1536 })

      const zodSchema = field.getZodSchema!('embedding', 'create')
      const prismaType = field.getPrismaType!('embedding')
      const tsType = field.getTypeScriptType!()

      // All methods should be callable and return valid results
      expect(zodSchema).toBeDefined()
      expect(prismaType).toBeDefined()
      expect(tsType).toBeDefined()

      // Types should be consistent (Json in Prisma, StoredEmbedding in TS)
      expect(prismaType.type).toBe('Json')
      expect(tsType.type).toContain('StoredEmbedding')
    })
  })

  describe('UI configuration', () => {
    it('should default to hiding vector display', () => {
      const field = embedding()

      expect(field.ui?.showVector).toBeUndefined()
    })

    it('should allow showing vector in UI', () => {
      const field = embedding({
        ui: { showVector: true },
      })

      expect(field.ui?.showVector).toBe(true)
    })

    it('should default to showing metadata', () => {
      const field = embedding()

      expect(field.ui?.showMetadata).toBeUndefined()
    })

    it('should allow customizing metadata display', () => {
      const field = embedding({
        ui: { showMetadata: false },
      })

      expect(field.ui?.showMetadata).toBe(false)
    })
  })

  describe('Edge cases', () => {
    it('should handle very large dimensions', () => {
      const field = embedding({ dimensions: 10000 })

      expect(field.dimensions).toBe(10000)

      const schema = field.getZodSchema!('embedding', 'create')
      const largeVector = Array(10000).fill(0.1)

      const validEmbedding = {
        vector: largeVector,
        metadata: {
          model: 'test',
          provider: 'test',
          dimensions: 10000,
          generatedAt: new Date().toISOString(),
        },
      }

      expect(() => schema.parse(validEmbedding)).not.toThrow()
    })

    it('should handle minimum dimensions', () => {
      const field = embedding({ dimensions: 1 })

      expect(field.dimensions).toBe(1)

      const schema = field.getZodSchema!('embedding', 'create')
      const validEmbedding = {
        vector: [0.5],
        metadata: {
          model: 'test',
          provider: 'test',
          dimensions: 1,
          generatedAt: new Date().toISOString(),
        },
      }

      expect(() => schema.parse(validEmbedding)).not.toThrow()
    })

    it('should handle empty sourceField gracefully', () => {
      const field = embedding({ sourceField: '' })

      expect(field.sourceField).toBe('')
      // Empty string is truthy (it's a defined value), so autoGenerate will be true
      // unless explicitly set to false
      expect(field.autoGenerate).toBe(true)
    })
  })
})
