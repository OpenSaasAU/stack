# RAG Package

RAG (Retrieval-Augmented Generation) and AI embeddings integration for OpenSaas Stack. Turn your application into a knowledge base with semantic search capabilities powered by vector embeddings.

## Overview

The `@opensaas/stack-rag` package adds powerful semantic search and RAG capabilities to your OpenSaas Stack application with minimal configuration. It supports multiple embedding providers (OpenAI, Ollama), flexible storage backends (pgvector, SQLite VSS, JSON), and integrates seamlessly with the stack's access control system.

**Key Features:**

- 🤖 **Multiple Embedding Providers** - OpenAI, Ollama (local), or bring your own custom provider
- 🗄️ **Flexible Storage Backends** - pgvector (PostgreSQL), SQLite VSS, or JSON-based (for development)
- 🔍 **Semantic Search** - Natural language queries with relevance scoring
- 🔐 **Access Control Integration** - All searches respect your existing access control rules
- ⚡ **Automatic Embeddings** - Auto-generate embeddings when content changes with intelligent caching
- 🛠️ **MCP Integration** - Automatic semantic search tools for AI assistants
- 📊 **Multiple Abstraction Levels** - From automatic "magic" mode to low-level control
- ✂️ **Text Chunking** - Multiple strategies for splitting long documents (recursive, sentence, sliding-window, token-aware)
- 🚀 **Batch Processing** - Rate-limited batch embedding generation with progress tracking

## Installation

```bash
pnpm add @opensaas/stack-rag

# Install your chosen embedding provider
pnpm add openai  # For OpenAI embeddings
# OR use Ollama (no package needed - just run Ollama locally)
```

## Quick Start

Here's the fastest way to add semantic search to your OpenSaas Stack app:

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { ragPlugin, openaiEmbeddings, pgvectorStorage } from '@opensaas/stack-rag'
import { searchable } from '@opensaas/stack-rag/fields'

export default config({
  plugins: [
    ragPlugin({
      provider: openaiEmbeddings({
        apiKey: process.env.OPENAI_API_KEY!,
        model: 'text-embedding-3-small',
      }),
      storage: pgvectorStorage(),
    }),
  ],
  db: {
    provider: 'postgresql',
    url: process.env.DATABASE_URL!,
  },
  lists: {
    Article: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
        // Use searchable() wrapper for automatic embedding generation
        content: searchable(text({ validation: { isRequired: true } }), {
          provider: 'openai',
          dimensions: 1536,
        }),
      },
    }),
  },
})
```

**What's happening:**

1. The `ragPlugin()` configures embedding provider and storage backend
2. The `searchable()` wrapper automatically creates a `contentEmbedding` field
3. Embeddings are auto-generated whenever `content` changes
4. All searches respect your existing access control rules

Generate schema and push to database:

```bash
pnpm generate
pnpm db:push
```

Now create content (embeddings generated automatically):

```typescript
import { getContext } from '@/.opensaas/context'

const context = await getContext()

// Embedding is automatically generated from content
await context.db.article.create({
  data: {
    title: 'Introduction to AI',
    content: 'Artificial intelligence is...',
    // No need to manually create embedding - it's automatic!
  },
})
```

Perform semantic search:

```typescript
import { createEmbeddingProvider, createVectorStorage } from '@opensaas/stack-rag'

export async function searchArticles(query: string) {
  const context = await getContext()

  // Generate embedding for search query
  const provider = createEmbeddingProvider({
    type: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
  })
  const queryVector = await provider.embed(query)

  // Search for similar articles
  const storage = createVectorStorage({ type: 'json' })
  const results = await storage.search('Article', 'contentEmbedding', queryVector, {
    limit: 10,
    minScore: 0.7,
    context, // Access control enforced
  })

  return results
}
```

## Core Concepts

### Embedding Fields

Embedding fields store vector embeddings (arrays of numbers) that represent the semantic meaning of text. The RAG package provides two patterns for defining embedding fields:

#### High-Level: `searchable()` Wrapper (Recommended)

The easiest way to add semantic search to any text field:

```typescript
import { searchable } from '@opensaas/stack-rag/fields'

fields: {
  content: searchable(text({ validation: { isRequired: true } }), {
    provider: 'openai',
    dimensions: 1536,
  })
}
```

**Benefits:**

- Automatically creates a companion `contentEmbedding` field
- Automatically generates embeddings when content changes
- Clean, concise syntax
- Works with any base field type

**Options:**

```typescript
type SearchableOptions = {
  provider?: string // Embedding provider (e.g., 'openai', 'ollama')
  dimensions?: number // Vector dimensions (default: 1536)
  chunking?: ChunkingConfig // Text chunking configuration
  embeddingFieldName?: string // Custom embedding field name (default: `${fieldName}Embedding`)
}
```

#### Manual: `embedding()` Field

For advanced use cases where you need more control:

```typescript
import { embedding } from '@opensaas/stack-rag/fields'

fields: {
  content: text({ validation: { isRequired: true } }),
  contentEmbedding: embedding({
    sourceField: 'content',
    provider: 'openai',
    dimensions: 1536,
    autoGenerate: true,
  })
}
```

**When to use manual pattern:**

- Need direct access to the embedding field in your schema
- Want to store embeddings without a source field
- Building custom embedding pipelines
- Need field-level hooks on the embedding field

### Embedding Providers

The RAG package supports multiple embedding providers through a pluggable architecture:

#### OpenAI

Best for production applications. Uses OpenAI's embedding models:

```typescript
ragPlugin({
  provider: openaiEmbeddings({
    apiKey: process.env.OPENAI_API_KEY!,
    model: 'text-embedding-3-small', // or 'text-embedding-3-large'
    dimensions: 1536, // 1536 for small, 3072 for large
  }),
})
```

**Models:**

- `text-embedding-3-small` - 1536 dimensions, fast, cost-effective
- `text-embedding-3-large` - 3072 dimensions, higher quality, more expensive

#### Ollama

Best for local development. No API costs, runs locally:

```typescript
ragPlugin({
  provider: ollamaEmbeddings({
    baseURL: 'http://localhost:11434',
    model: 'nomic-embed-text',
  }),
})
```

**Setup:**

```bash
# Install Ollama from https://ollama.ai
ollama pull nomic-embed-text
ollama serve
```

#### Multiple Providers

You can configure multiple providers and choose which to use per field:

```typescript
ragPlugin({
  providers: {
    openai: openaiEmbeddings({
      apiKey: process.env.OPENAI_API_KEY!,
      model: 'text-embedding-3-small',
    }),
    ollama: ollamaEmbeddings({
      model: 'nomic-embed-text',
    }),
  },
  storage: pgvectorStorage(),
})

// In fields
fields: {
  titleEmbedding: embedding({
    sourceField: 'title',
    provider: 'ollama', // Use local Ollama for titles
  }),
  contentEmbedding: embedding({
    sourceField: 'content',
    provider: 'openai', // Use OpenAI for content
  })
}
```

### Storage Backends

The RAG package supports multiple vector storage backends:

#### JSON Storage (Development)

Good for development and small datasets. No database extensions needed.

```typescript
ragPlugin({
  storage: jsonStorage(),
})
```

**Characteristics:**

- No setup required
- Works with any database
- Similarity computed in JavaScript
- Good for development and <10k documents
- O(n) search complexity

#### pgvector (Production PostgreSQL)

Best for production applications using PostgreSQL. Requires pgvector extension.

```typescript
ragPlugin({
  storage: pgvectorStorage({
    distanceFunction: 'cosine', // 'cosine', 'l2', or 'innerProduct'
  }),
})
```

**Setup:**

```sql
-- Enable pgvector extension
CREATE EXTENSION vector;

-- Optional: Create index for faster search
CREATE INDEX article_embedding_idx
ON "Article" USING ivfflat ((("contentEmbedding"->>'vector')::vector(1536)))
WITH (lists = 100);
```

**Characteristics:**

- Sub-second search for millions of vectors
- Efficient binary storage
- Index support for fast search
- Production-ready

#### SQLite VSS (SQLite)

Good for SQLite-based applications. Requires sqlite-vss extension.

```typescript
ragPlugin({
  storage: sqliteVssStorage({
    distanceFunction: 'cosine',
  }),
})
```

**Characteristics:**

- Good for SQLite apps
- Efficient vector search
- Requires VSS extension

### Automatic Embedding Generation

The RAG plugin automatically generates embeddings when content changes using intelligent caching:

**How it works:**

1. You create or update an item with searchable content
2. The RAG plugin detects if the source field changed (via hash comparison)
3. If changed, it generates a new embedding using the configured provider
4. The embedding is stored with metadata (provider, model, dimensions, source hash)
5. Future updates only regenerate if the source text actually changed

**Source Hash Comparison:**

The plugin stores a SHA-256 hash of the source text in the embedding metadata. This prevents unnecessary API calls when:

- Updating other fields on the same item
- Re-saving with identical content
- Running database migrations

### Access Control Integration

All semantic searches automatically respect your existing access control rules. This ensures users can only search content they have permission to view.

```typescript
// Search respects access control
const context = await getContext({ userId: 'user-123' })

const results = await storage.search('Article', 'contentEmbedding', queryVector, {
  context, // Access control applied automatically
  where: { published: true }, // Additional filters
})

// Users only see articles they have access to
```

The search operates through the access-controlled context, so all operation-level, filter-level, and field-level access controls are enforced.

## Configuration Options

### RAG Plugin Configuration

The `ragPlugin()` function accepts comprehensive configuration options:

```typescript
ragPlugin({
  // Single provider
  provider: openaiEmbeddings({
    apiKey: process.env.OPENAI_API_KEY!,
    model: 'text-embedding-3-small',
  }),

  // OR multiple providers
  providers: {
    openai: openaiEmbeddings({ /* ... */ }),
    ollama: ollamaEmbeddings({ /* ... */ }),
  },

  // Storage backend
  storage: pgvectorStorage({
    distanceFunction: 'cosine',
  }),

  // Enable MCP semantic search tools
  enableMcpTools: true,

  // Default rate limiting
  rateLimit: 100, // Requests per minute
})
```

### Field Configuration

#### searchable() Wrapper

```typescript
content: searchable(text(), {
  provider: 'openai', // Provider to use
  dimensions: 1536, // Vector dimensions
  embeddingFieldName: 'customEmbedding', // Custom field name
  chunking: { // Text chunking for long content
    strategy: 'recursive',
    chunkSize: 1000,
    chunkOverlap: 200,
  },
})
```

#### embedding() Field

```typescript
contentEmbedding: embedding({
  sourceField: 'content', // Field to generate embeddings from
  provider: 'openai', // Provider to use
  dimensions: 1536, // Vector dimensions
  autoGenerate: true, // Auto-generate on changes
  chunking: { // Text chunking configuration
    strategy: 'sentence',
    chunkSize: 500,
  },
})
```

## Package Exports

### Main Exports (`@opensaas/stack-rag`)

**Plugin and configuration:**

- `ragPlugin(config)` - RAG plugin for OpenSaas Stack
- `openaiEmbeddings(config)` - OpenAI embedding provider helper
- `ollamaEmbeddings(config)` - Ollama embedding provider helper
- `pgvectorStorage(config)` - pgvector storage helper
- `sqliteVssStorage(config)` - SQLite VSS storage helper
- `jsonStorage()` - JSON-based storage helper

### Field Types (`@opensaas/stack-rag/fields`)

- `embedding(options)` - Vector embedding field type
- `searchable(baseField, options)` - High-level wrapper for automatic RAG

### Providers (`@opensaas/stack-rag/providers`)

- `createEmbeddingProvider(config)` - Factory for creating embedding providers
- `registerEmbeddingProvider(type, factory)` - Register custom providers
- `EmbeddingProvider` - TypeScript interface for custom providers

### Storage (`@opensaas/stack-rag/storage`)

- `createVectorStorage(config)` - Factory for creating storage backends
- `registerVectorStorage(type, factory)` - Register custom storage backends
- `VectorStorage` - TypeScript interface for custom storage
- `cosineSimilarity()`, `dotProduct()`, `l2Distance()` - Similarity utilities

### Runtime Utilities (`@opensaas/stack-rag/runtime`)

**High-level utilities:**

- `semanticSearch(options)` - Simplified semantic search API
- `findSimilar(options)` - Find similar items by ID
- `generateEmbedding(options)` - Generate embeddings with chunking support
- `generateEmbeddings(options)` - Batch embedding generation
- `chunkText(text, options)` - Text chunking utilities
- `batchProcess(options)` - Batch processing with rate limiting

**Utility classes:**

- `RateLimiter` - Rate limiting utility
- `ProcessingQueue` - Concurrent processing queue

**Helper functions:**

- `hashText()` - Generate SHA-256 hash of text
- `validateEmbeddingDimensions()` - Validate embedding dimensions
- `mergeEmbeddings()` - Merge multiple embeddings

## MCP Integration

The RAG plugin automatically generates semantic search tools for the Model Context Protocol when enabled:

```typescript
export default config({
  plugins: [
    ragPlugin({
      provider: openaiEmbeddings({ apiKey: process.env.OPENAI_API_KEY! }),
      enableMcpTools: true, // Enable semantic_search_article tool
    }),
  ],
  mcp: {
    enabled: true,
    auth: { type: 'better-auth', loginPage: '/sign-in' },
  },
  lists: {
    Article: list({
      fields: {
        content: text(),
        contentEmbedding: embedding({
          sourceField: 'content',
          autoGenerate: true,
        }),
      },
    }),
  },
})
```

AI assistants can then use semantic search:

```json
{
  "name": "semantic_search_article",
  "arguments": {
    "query": "articles about machine learning",
    "limit": 5
  }
}
```

The MCP tools automatically:

- Generate query embeddings
- Perform semantic search
- Respect access control rules
- Return results with similarity scores

## Data Model

### StoredEmbedding Type

Embeddings are stored as JSON with metadata:

```typescript
type StoredEmbedding = {
  vector: number[] // The embedding vector
  metadata: {
    model: string // e.g., 'text-embedding-3-small'
    provider: string // e.g., 'openai'
    dimensions: number // e.g., 1536
    generatedAt: string // ISO timestamp
    sourceHash?: string // SHA-256 of source text (for change detection)
  }
}
```

**Prisma schema:**

```prisma
model Article {
  id                String  @id @default(cuid())
  content           String
  contentEmbedding  Json?   // Stores StoredEmbedding
}
```

### SearchResult Type

Search results include the item and similarity metrics:

```typescript
type SearchResult<T> = {
  item: T // The matching record
  score: number // Similarity score (0-1, higher is more similar)
  distance: number // Distance metric (depends on backend)
}
```

## Examples

### Basic Semantic Search

```typescript
import { createEmbeddingProvider, createVectorStorage } from '@opensaas/stack-rag'
import { getContext } from '@/.opensaas/context'

export async function searchArticles(query: string) {
  const context = await getContext()

  // Generate query embedding
  const provider = createEmbeddingProvider({
    type: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
  })
  const queryVector = await provider.embed(query)

  // Search
  const storage = createVectorStorage({ type: 'pgvector' })
  const results = await storage.search('Article', 'contentEmbedding', queryVector, {
    limit: 10,
    minScore: 0.7,
    context,
  })

  return results.map((r) => ({
    article: r.item,
    similarity: r.score,
  }))
}
```

### High-Level Semantic Search API

```typescript
import { semanticSearch } from '@opensaas/stack-rag/runtime'
import { createEmbeddingProvider, createVectorStorage } from '@opensaas/stack-rag'
import { getContext } from '@/.opensaas/context'

const results = await semanticSearch({
  listKey: 'Article',
  fieldName: 'contentEmbedding',
  query: 'articles about machine learning',
  provider: createEmbeddingProvider({ type: 'openai', apiKey: process.env.OPENAI_API_KEY! }),
  storage: createVectorStorage({ type: 'pgvector' }),
  context: await getContext(),
  limit: 10,
  minScore: 0.7,
})
```

### Find Similar Items

```typescript
import { findSimilar } from '@opensaas/stack-rag/runtime'

const similar = await findSimilar({
  listKey: 'Article',
  fieldName: 'contentEmbedding',
  itemId: 'article-123',
  storage: createVectorStorage({ type: 'pgvector' }),
  context: await getContext(),
  limit: 5,
  excludeSelf: true, // Don't include the source article
})
```

### Text Chunking

```typescript
import { chunkText } from '@opensaas/stack-rag/runtime'

// Recursive chunking (respects paragraph/sentence boundaries)
const chunks = chunkText(longDocument, {
  strategy: 'recursive',
  chunkSize: 1000,
  chunkOverlap: 200,
})

// Sentence-based chunking (preserves sentences)
const chunks = chunkText(document, {
  strategy: 'sentence',
  chunkSize: 500,
  chunkOverlap: 100,
})

// Token-aware chunking (for token limits)
const chunks = chunkText(document, {
  strategy: 'token-aware',
  tokenLimit: 500, // ~500 tokens per chunk
  chunkOverlap: 50,
})
```

### Batch Processing with Rate Limiting

```typescript
import { batchProcess } from '@opensaas/stack-rag/runtime'
import { createEmbeddingProvider } from '@opensaas/stack-rag'

const result = await batchProcess({
  provider: createEmbeddingProvider({ type: 'openai', apiKey: process.env.OPENAI_API_KEY! }),
  texts: largeArrayOfTexts,
  batchSize: 10,
  rateLimit: 60, // 60 requests per minute
  onProgress: (progress) => {
    console.log(`Progress: ${progress.percentage}% (${progress.processed}/${progress.total})`)
  },
})

console.log(`Successfully processed: ${result.stats.successful}`)
console.log(`Failed: ${result.stats.failed}`)
```

## Working Examples

- **[RAG OpenAI Chatbot](https://github.com/OpenSaasAU/stack/tree/main/examples/rag-openai-chatbot)** - Production-ready chatbot with knowledge base, streaming responses, and source citations
- **[RAG Ollama Demo](https://github.com/OpenSaasAU/stack/tree/main/examples/rag-ollama-demo)** - Local development with Ollama embeddings and SQLite VSS

## Next Steps

- **[RAG Setup Guide](/docs/guides/rag-setup)** - Comprehensive setup instructions, database configuration, and example walkthroughs
- **[RAG Advanced Patterns](/docs/guides/rag-advanced)** - Architecture deep dive, custom providers, performance optimization, and advanced use cases
- **[MCP Integration Guide](/docs/guides/mcp)** - Model Context Protocol integration with semantic search tools

## Further Reading

- [OpenAI Embeddings Guide](https://platform.openai.com/docs/guides/embeddings)
- [pgvector Documentation](https://github.com/pgvector/pgvector)
- [Ollama Documentation](https://ollama.ai)
