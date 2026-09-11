import { describe, it, expect } from 'vitest'
import { embedding } from './embedding.js'
import type { EmbeddingField } from './embedding.js'
import { z } from 'zod'
import { validateFieldConfig } from '@opensaas/stack-core'
import type { OpenSaasConfig } from '@opensaas/stack-core'

/** `getContractField` takes the full config; an embedding column reads nothing from it. */
const CONFIG: OpenSaasConfig = { db: { provider: 'postgresql' }, lists: {} }

describe('Embedding Field', () => {
  describe('embedding field builder', () => {
    it('should create embedding field with default options', () => {
      const field = embedding()

      expect(field.type).toBe('embedding')
      // Left undeclared, so ragPlugin can resolve it from the provider; the
      // column falls back to OpenAI's 1536 when nothing declares one.
      expect(field.dimensions).toBeUndefined()
      const descriptor = field.getContractField!('contentEmbedding', 'Article', CONFIG)
      if (descriptor.kind !== 'columns') throw new Error('an embedding emits columns')
      expect(descriptor.columns[0].type).toEqual({
        pack: 'pgvector',
        type: 'Vector',
        args: [1536],
      })
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

      expect(field.ui).toMatchObject({
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

  describe('the self-containment gate', () => {
    it('passes the check `pnpm generate` runs over every stored field', () => {
      expect(
        validateFieldConfig(
          embedding({ sourceField: 'content' }),
          'contentEmbedding',
          'Article',
          CONFIG,
        ),
      ).toEqual([])
    })

    /**
     * The gate is what stands between a multi-column field and an `unknown`
     * everywhere it is read (#1292), so the passing case above only means
     * something if the failing one is reachable.
     */
    it('is the check that would catch a dropped outputType', () => {
      const field = embedding({ sourceField: 'content' })
      delete field.outputType

      expect(
        validateFieldConfig(field, 'contentEmbedding', 'Article', CONFIG).map(
          (e) => e.missingMember,
        ),
      ).toEqual(['outputType'])
    })

    it('passes it on the contract and its own TypeScript face', () => {
      const field = embedding({ sourceField: 'content' })

      // One field, two columns of different types — no single column type
      // describes it, so the gate takes the descriptor plus a declared face.
      expect(typeof field.getContractField).toBe('function')
      expect(field.outputType).toBe("import('@opensaas/stack-rag').StoredEmbedding | null")
      expect(field.getColumnNames?.('contentEmbedding')).toEqual([
        'contentEmbedding',
        'contentEmbeddingMetadata',
      ])
    })
  })

  describe('getContractField', () => {
    it('emits a vector column and a jsonb metadata column beside it', () => {
      const field = embedding({ dimensions: 1536 })

      expect(field.getContractField!('contentEmbedding', 'Article', CONFIG)).toEqual({
        kind: 'columns',
        columns: [
          {
            name: 'contentEmbedding',
            type: { pack: 'pgvector', type: 'Vector', args: [1536] },
            nullable: true,
          },
          {
            name: 'contentEmbeddingMetadata',
            type: { pack: 'pg', type: 'jsonb' },
            nullable: true,
          },
        ],
      })
    })

    it('leaves an unindexed column vector at any dimension', () => {
      const field = embedding({ dimensions: 3072 })
      const descriptor = field.getContractField!('embedding', 'Doc', CONFIG)

      expect(descriptor.kind).toBe('columns')
      expect(descriptor.kind === 'columns' && descriptor.columns[0].type).toEqual({
        pack: 'pgvector',
        type: 'Vector',
        args: [3072],
      })
    })

    it('emits halfvec for an indexed column over the vector index cap', () => {
      const field = embedding({ dimensions: 3072, index: { method: 'hnsw' } })
      const descriptor = field.getContractField!('embedding', 'Doc', CONFIG)

      expect(descriptor.kind === 'columns' && descriptor.columns[0].type).toEqual({
        pack: 'pgvector',
        type: 'HalfVector',
        args: [3072],
      })
    })

    it('keeps vector for an indexed column at the vector index cap', () => {
      const field = embedding({ dimensions: 2000, index: { method: 'ivfflat' } })
      const descriptor = field.getContractField!('embedding', 'Doc', CONFIG)

      expect(descriptor.kind === 'columns' && descriptor.columns[0].type).toEqual({
        pack: 'pgvector',
        type: 'Vector',
        args: [2000],
      })
    })

    it('refuses an index over the halfvec cap, naming the list and field', () => {
      const field = embedding({ dimensions: 4001, index: { method: 'hnsw' } })

      expect(() => field.getContractField!('embedding', 'Doc', CONFIG)).toThrow(
        'embedding field "Doc.embedding" declares a hnsw index over 4001 dimensions. ' +
          'pgvector indexes vector to 2000 dimensions and halfvec to 4000, so no index can be ' +
          'built over this column. Drop the index option to keep an unindexed vector(4001) ' +
          'column, or reduce the dimension.',
      )
    })

    it('refuses an operator class that disagrees with the distance function', () => {
      const field = embedding({
        dimensions: 3,
        distanceFunction: 'l2',
        index: { method: 'hnsw', opclass: 'vector_cosine_ops' },
      })

      expect(() => field.getContractField!('embedding', 'Doc', CONFIG)).toThrow(
        'embedding field "Doc.embedding" declares the operator class "vector_cosine_ops", but a ' +
          'l2 distance over a vector column is measured by "vector_l2_ops". Remove the opclass ' +
          'option to take the derived one, or change the distanceFunction the index is built for.',
      )
    })
  })

  describe('getVectorColumn', () => {
    it('names the vector column, its dimension and its distance function', () => {
      const field = embedding({ dimensions: 768, distanceFunction: 'inner_product' })

      expect(field.getVectorColumn!('bodyEmbedding')).toEqual({
        column: 'bodyEmbedding',
        dimensions: 768,
        distanceFunction: 'inner_product',
      })
    })

    it('defaults the distance function to cosine', () => {
      expect(embedding().getVectorColumn!('embedding').distanceFunction).toBe('cosine')
    })
  })

  describe('getVectorIndex', () => {
    it('is undefined when no index is declared', () => {
      expect(embedding({ dimensions: 1536 }).getVectorIndex!('embedding')).toBeUndefined()
    })

    it('derives the operator class from the distance function and column type', () => {
      const hnsw = embedding({
        dimensions: 1536,
        distanceFunction: 'l2',
        index: { method: 'hnsw', m: 16, efConstruction: 64 },
      })

      expect(hnsw.getVectorIndex!('embedding')).toEqual({
        method: 'hnsw',
        opclass: 'vector_l2_ops',
        columnType: 'vector',
        parameters: { m: 16, ef_construction: 64 },
      })
    })

    it('derives a halfvec operator class when the dimension forces halfvec', () => {
      const field = embedding({
        dimensions: 3072,
        distanceFunction: 'inner_product',
        index: { method: 'ivfflat', lists: 100 },
      })

      expect(field.getVectorIndex!('embedding')).toEqual({
        method: 'ivfflat',
        opclass: 'halfvec_ip_ops',
        columnType: 'halfvec',
        parameters: { lists: 100 },
      })
    })

    it('accepts a declared operator class that agrees', () => {
      const field = embedding({
        dimensions: 3,
        index: { method: 'hnsw', opclass: 'vector_cosine_ops' },
      })

      expect(field.getVectorIndex!('embedding')?.opclass).toBe('vector_cosine_ops')
    })
  })

  describe('write denial', () => {
    it('denies create and update to application code by default', async () => {
      const field = embedding()

      expect(await field.access?.create?.({} as never)).toBe(false)
      expect(await field.access?.update?.({} as never)).toBe(false)
    })

    it('leaves writes open when allowManualWrites is set', () => {
      const field = embedding({ allowManualWrites: true })

      expect(field.access?.create).toBeUndefined()
      expect(field.access?.update).toBeUndefined()
    })

    it('keeps a caller-declared read rule while denying writes', async () => {
      const field = embedding({ access: { read: () => false } })

      expect(await field.access?.read?.({} as never)).toBe(false)
      expect(await field.access?.create?.({} as never)).toBe(false)
    })
  })

  describe('column assembly', () => {
    it('names both of its columns', () => {
      expect(embedding().getColumnNames!('contentEmbedding')).toEqual([
        'contentEmbedding',
        'contentEmbeddingMetadata',
      ])
    })

    it('assembles the stored value from the two columns', () => {
      const field = embedding({ dimensions: 3 })
      const metadata = {
        model: 'text-embedding-3-small',
        provider: 'openai',
        dimensions: 3,
        generatedAt: '2026-01-01T00:00:00.000Z',
      }

      expect(
        field.assembleColumns!('embedding', {
          embedding: [1, 2, 3],
          embeddingMetadata: metadata,
        }),
      ).toEqual({ vector: [1, 2, 3], metadata })
    })

    it('assembles null when the vector column is empty', () => {
      expect(
        embedding().assembleColumns!('embedding', { embedding: null, embeddingMetadata: null }),
      ).toBeNull()
    })

    it('splits the stored value back into its columns', () => {
      const metadata = {
        model: 'nomic-embed-text',
        provider: 'ollama',
        dimensions: 3,
        generatedAt: '2026-01-01T00:00:00.000Z',
      }

      expect(embedding().splitColumns!('embedding', { vector: [1, 2, 3], metadata })).toEqual({
        embedding: [1, 2, 3],
        embeddingMetadata: metadata,
      })
    })

    it('splits a cleared value into two nulls', () => {
      expect(embedding().splitColumns!('embedding', null)).toEqual({
        embedding: null,
        embeddingMetadata: null,
      })
    })
  })

  describe('TypeScript face', () => {
    it('reads and writes as StoredEmbedding', () => {
      const field = embedding()

      expect(field.outputType).toBe("import('@opensaas/stack-rag').StoredEmbedding | null")
      expect(field.inputType).toBe("import('@opensaas/stack-rag').StoredEmbedding | null")
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
      expect(field).toHaveProperty('getContractField')
      expect(field).toHaveProperty('getVectorColumn')
    })

    it('should have all required builder methods', () => {
      const field = embedding()

      expect(typeof field.getZodSchema).toBe('function')
      expect(typeof field.getContractField).toBe('function')
      expect(typeof field.getVectorColumn).toBe('function')
      expect(typeof field.getColumnNames).toBe('function')
      expect(typeof field.assembleColumns).toBe('function')
      expect(typeof field.splitColumns).toBe('function')
    })

    it('agrees between its contract column and its vector descriptor', () => {
      const field = embedding({ dimensions: 1536 })

      const descriptor = field.getContractField!('embedding', 'Doc', CONFIG)
      const vector = field.getVectorColumn!('embedding')

      expect(descriptor.kind === 'columns' && descriptor.columns[0].name).toBe(vector.column)
      expect(descriptor.kind === 'columns' && descriptor.columns[0].type.args).toEqual([
        vector.dimensions,
      ])
    })
  })

  describe('UI configuration', () => {
    it('should default to hiding vector display', () => {
      const field = embedding()

      expect(field.ui?.showVector).toBe(false)
    })

    it('should allow showing vector in UI', () => {
      const field = embedding({
        ui: { showVector: true },
      })

      expect(field.ui?.showVector).toBe(true)
    })

    it('should default to showing metadata', () => {
      const field = embedding()

      expect(field.ui?.showMetadata).toBe(true)
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
