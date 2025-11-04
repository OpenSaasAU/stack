# RAG Integration Specification

**Status**: Implemented (Core foundation complete)
**Package**: `@opensaas/stack-rag`
**Version**: 0.1.0

## Overview

This document specifies the RAG (Retrieval-Augmented Generation) integration for OpenSaas Stack, enabling developers to easily add vector embeddings and semantic search to their applications.

## Goals

1. **Easy integration**: Add semantic search with minimal configuration
2. **Multiple abstraction levels**: From automatic to manual control
3. **Provider flexibility**: Support OpenAI, Ollama, and custom providers
4. **Storage flexibility**: Support pgvector, SQLite VSS, and JSON storage
5. **MCP integration**: Automatic semantic search tools for AI assistants
6. **Access control**: Respect existing access control rules in all searches

## Implementation Status

### ✅ Completed

1. **Core Configuration System** (`packages/rag/src/config/`)
   - `withRAG()` config wrapper following auth pattern
   - `ragConfig()` builder with provider and storage configuration
   - Helper functions: `openaiEmbeddings()`, `ollamaEmbeddings()`, `pgvectorStorage()`, etc.
   - Type-safe configuration with normalization

2. **Embedding Providers** (`packages/rag/src/providers/`)
   - `EmbeddingProvider` interface
   - `OpenAIEmbeddingProvider` - Full OpenAI embeddings API support
   - `OllamaEmbeddingProvider` - Local Ollama integration
   - Provider registry for custom providers
   - Factory pattern: `createEmbeddingProvider(config)`

3. **Vector Storage Backends** (`packages/rag/src/storage/`)
   - `VectorStorage` interface
   - `JsonVectorStorage` - JavaScript-based similarity search (development)
   - `PgVectorStorage` - PostgreSQL pgvector integration
   - `SqliteVssStorage` - SQLite VSS integration
   - Storage registry for custom backends
   - Factory pattern: `createVectorStorage(config)`
   - Utility functions: `cosineSimilarity()`, `dotProduct()`, `l2Distance()`

4. **Field Types** (`packages/rag/src/fields/`)
   - `embedding()` field type with:
     - Prisma JSON type generation
     - TypeScript type generation
     - Zod schema validation
     - Auto-generation from source fields
     - Chunking configuration
     - Provider selection

5. **Documentation**
   - Comprehensive CLAUDE.md with architecture patterns
   - User-friendly README.md with quick start
   - This specification document

6. **Package Infrastructure**
   - TypeScript build configuration
   - Package.json with proper exports
   - Peer dependencies (openai as optional)
   - Monorepo integration

### 🚧 Remaining Work

1. **Runtime Utilities** (`packages/rag/src/runtime/`)
   - `generateEmbeddings()` - High-level embedding generation
   - `semanticSearch()` - Simplified search API
   - `findSimilar()` - Find similar items by ID
   - `chunkText()` - Text chunking strategies (recursive, sentence, sliding-window)
   - Batch processing utilities
   - Rate limiting utilities

2. **Automatic Hooks**
   - Inject `afterOperation` hooks into embedding fields with `sourceField`
   - Detect source field changes (hash comparison)
   - Automatic embedding regeneration
   - Batch embedding generation for multiple items

3. **MCP Integration** (`packages/rag/src/mcp/`)
   - `createRagMcpTools()` - Generate semantic search tools
   - Per-list tool generation (e.g., `semantic_search_article`)
   - Integration with core MCP runtime
   - Access control in MCP tools

4. **High-Level Field Wrapper**
   - `searchable(field, options)` wrapper for automatic RAG
   - Example: `searchable(text(), { provider: 'openai' })`
   - Automatically adds embedding field + hooks

5. **Example Application** (`examples/rag-demo/`)
   - Document search interface
   - Chatbot with knowledge base
   - MCP server integration
   - Multiple provider demonstration

6. **Testing**
   - Provider tests (OpenAI, Ollama)
   - Storage tests (JSON, pgvector, sqlite-vss)
   - Field type tests
   - Integration tests
   - MCP tool tests

7. **CLI Integration**
   - Update `@opensaas/cli init` to include RAG option
   - Generate boilerplate RAG configuration
   - Install required dependencies

## Architecture

### Config Wrapper Pattern

Following the `withAuth()` pattern:

```typescript
export function withRAG(opensaasConfig: OpenSaasConfig, ragConfig: RAGConfig): OpenSaasConfig {
  const normalized = normalizeRAGConfig(ragConfig)

  // Attach RAG config for runtime use
  const result: OpenSaasConfig & { __ragConfig?: NormalizedRAGConfig } = {
    ...opensaasConfig,
  }
  result.__ragConfig = normalized

  // TODO: Inject hooks into fields with autoGenerate: true

  return result
}
```

### Embedding Field Architecture

Embedding fields are self-contained following stack patterns:

```typescript
export function embedding(options): EmbeddingField {
  return {
    type: 'embedding',
    ...options,

    // Validation
    getZodSchema: () => z.object({ vector, metadata }).nullable().optional(),

    // Database storage (JSON for portability)
    getPrismaType: () => ({ type: 'Json', modifiers: '?' }),

    // TypeScript types
    getTypeScriptType: () => ({ type: 'StoredEmbedding | null', optional: true }),
  }
}
```

### Provider Registry Pattern

Extensible provider system:

```typescript
const providerFactories = new Map<string, Factory>()

providerFactories.set('openai', (config) => new OpenAIEmbeddingProvider(config))
providerFactories.set('ollama', (config) => new OllamaEmbeddingProvider(config))

// Users can register custom providers
export function registerEmbeddingProvider(type, factory) {
  providerFactories.set(type, factory)
}
```

### Storage Registry Pattern

Similar to providers:

```typescript
const storageFactories = new Map<string, Factory>()

storageFactories.set('json', () => new JsonVectorStorage())
storageFactories.set('pgvector', (config) => new PgVectorStorage(config))
storageFactories.set('sqlite-vss', (config) => new SqliteVssStorage(config))

export function registerVectorStorage(type, factory) {
  storageFactories.set(type, factory)
}
```

### Access Control Integration

All searches go through access-controlled context:

```typescript
async search(listKey, fieldName, queryVector, options) {
  const { context, where = {} } = options
  const dbKey = getDbKey(listKey)
  const model = context.db[dbKey]

  // Access control applied automatically via context
  const items = await model.findMany({ where })

  // Calculate similarity and return results
}
```

## Data Model

### StoredEmbedding Type

```typescript
type StoredEmbedding = {
  vector: number[]
  metadata: {
    model: string        // e.g., 'text-embedding-3-small'
    provider: string     // e.g., 'openai'
    dimensions: number   // e.g., 1536
    generatedAt: string  // ISO timestamp
    sourceHash?: string  // SHA-256 of source text (for change detection)
  }
}
```

Stored as JSON in Prisma:

```prisma
model Article {
  id                String  @id @default(cuid())
  content           String
  contentEmbedding  Json?
}
```

### SearchResult Type

```typescript
type SearchResult<T> = {
  item: T           // The matching record
  score: number     // Similarity score (0-1, higher is more similar)
  distance: number  // Distance metric (depends on backend)
}
```

## Usage Examples

### Basic Setup

```typescript
import { withRAG, ragConfig, openaiEmbeddings } from '@opensaas/stack-rag'
import { embedding } from '@opensaas/stack-rag/fields'

export default withRAG(
  config({
    lists: {
      Article: list({
        fields: {
          content: text(),
          contentEmbedding: embedding({
            sourceField: 'content',
            provider: 'openai',
            dimensions: 1536,
            autoGenerate: true,
          }),
        },
      }),
    },
  }),
  ragConfig({
    provider: openaiEmbeddings({ apiKey: process.env.OPENAI_API_KEY! }),
    storage: pgvectorStorage(),
  })
)
```

### Semantic Search

```typescript
import { createEmbeddingProvider, createVectorStorage } from '@opensaas/stack-rag'

const provider = createEmbeddingProvider({
  type: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
})

const queryVector = await provider.embed('articles about AI')

const storage = createVectorStorage({ type: 'pgvector' })
const results = await storage.search('Article', 'contentEmbedding', queryVector, {
  limit: 10,
  minScore: 0.7,
  context,
})
```

### Local Development with Ollama

```typescript
ragConfig({
  provider: ollamaEmbeddings({
    baseURL: 'http://localhost:11434',
    model: 'nomic-embed-text',
  }),
  storage: jsonStorage(), // No DB extensions needed
})
```

## Database Considerations

### PostgreSQL with pgvector

Best for production deployments:

```sql
-- Enable extension
CREATE EXTENSION vector;

-- Optional: Create index for faster search
CREATE INDEX article_embedding_idx
ON "Article" USING ivfflat (("contentEmbedding"->>'vector')::vector(1536))
WITH (lists = 100);
```

### SQLite with VSS

Good for SQLite-based apps:

```sql
-- Load VSS extension (method depends on SQLite setup)
```

### JSON Storage

No setup needed. Embeddings stored as JSON, similarity computed in JavaScript. Good for:
- Development
- Small datasets (<10k documents)
- Any database (no extensions required)

## Performance Considerations

1. **Embedding Generation**
   - Use `embedBatch()` for multiple texts
   - Implement rate limiting (default: 100 req/min)
   - Cache embeddings using source hash

2. **Vector Search**
   - pgvector with indexes: Sub-second for millions of vectors
   - JSON storage: O(n) search, acceptable for <10k vectors
   - Consider chunking for long documents

3. **Storage**
   - JSON: ~6KB per 1536-dimensional embedding
   - pgvector: More compact binary storage
   - Consider separate embeddings table for very large datasets

## Future Enhancements

1. **Chunking Strategies**
   - Recursive text splitter
   - Sentence-based chunking
   - Sliding window chunking
   - Token-aware chunking

2. **Additional Providers**
   - Cohere embeddings
   - HuggingFace transformers
   - Local transformers.js
   - Voyage AI

3. **Additional Storage**
   - Pinecone integration
   - Qdrant integration
   - Weaviate integration
   - Chroma integration

4. **Advanced Features**
   - Hybrid search (keyword + semantic)
   - Re-ranking
   - Embedding caching layer
   - Automatic re-embedding on provider change
   - Multi-vector per document
   - Cross-encoder re-ranking

5. **UI Components**
   - Semantic search input
   - Similarity visualization
   - Embedding inspection
   - Vector space visualization

## Migration Path

### For Existing Apps

1. Install package: `pnpm add @opensaas/stack-rag openai`
2. Wrap config with `withRAG()`
3. Add `embedding()` fields
4. Run `pnpm generate && pnpm db:push`
5. Embeddings auto-generated on create/update

### Storage Backend Changes

Embeddings are stored as portable JSON, so changing backends is seamless:

```typescript
// From JSON to pgvector
storage: pgvectorStorage() // Update config

pnpm generate
pnpm db:push

// Existing embeddings work immediately
```

## Testing Strategy

1. **Unit Tests**
   - Provider tests with mocked APIs
   - Storage tests with test database
   - Field type generation tests
   - Utility function tests

2. **Integration Tests**
   - Full RAG workflow (embed → store → search)
   - Access control enforcement
   - MCP tool generation and execution

3. **E2E Tests**
   - Example app with real providers
   - Semantic search accuracy
   - Performance benchmarks

## Security Considerations

1. **API Keys**
   - Store in environment variables
   - Never commit to repository
   - Rotate regularly

2. **Access Control**
   - All searches respect access control
   - No direct Prisma access bypassing context
   - Session validation in MCP tools

3. **Input Validation**
   - Zod schemas validate all inputs
   - Vector dimension validation
   - Rate limiting on embedding generation

## Dependencies

### Required
- `@opensaas/stack-core` (workspace)
- `zod` (validation)

### Optional Peer Dependencies
- `openai` (for OpenAI provider)

### Dev Dependencies
- `typescript`
- `vitest`
- `@vitest/ui`
- `@vitest/coverage-v8`

## Conclusion

The core RAG integration is now complete with:
- ✅ Config system
- ✅ Embedding providers (OpenAI, Ollama)
- ✅ Vector storage (pgvector, sqlite-vss, JSON)
- ✅ Field types
- ✅ Documentation

Remaining work focuses on:
- Runtime utilities for easier usage
- Automatic hooks for embedding generation
- MCP integration
- Examples and testing

The architecture follows OpenSaas Stack patterns and is fully extensible for custom providers and storage backends.
