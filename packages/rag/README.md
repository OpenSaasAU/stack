# @opensaas/stack-rag

RAG (Retrieval-Augmented Generation) and AI embeddings integration for OpenSaas Stack.

Turn your OpenSaas app into a knowledge base with semantic search capabilities powered by vector embeddings.

## Features

- 🤖 **Multiple Embedding Providers**: OpenAI, Ollama (local), or bring your own
- 🗄️ **Flexible Storage**: pgvector, SQLite VSS, or JSON-based (for development)
- 🔍 **Semantic Search**: Natural language queries with relevance scoring
- 🔐 **Access Control**: All searches respect your existing access control rules
- ⚡ **Automatic Embeddings**: Auto-generate embeddings when content changes
- 🛠️ **MCP Integration**: Semantic search tools for AI assistants
- 📊 **Multiple Abstraction Levels**: From automatic "magic" to low-level control
- ✂️ **Text Chunking**: Multiple strategies for splitting long documents
- 🚀 **Batch Processing**: Rate-limited batch embedding generation with progress tracking

## Installation

```bash
pnpm add @opensaas/stack-rag

# Install your chosen embedding provider
pnpm add openai  # For OpenAI embeddings
# OR use Ollama (no package needed - just run Ollama locally)
```

## Quick Start

### 1. Configure RAG in your OpenSaas app

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { ragPlugin, openaiEmbeddings, pgvectorStorage } from '@opensaas/stack-rag'
import { embedding } from '@opensaas/stack-rag/fields'

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
        content: text({ validation: { isRequired: true } }),
        // Embedding field with automatic generation
        contentEmbedding: embedding({
          sourceField: 'content', // Auto-embed when content changes
          provider: 'openai',
          dimensions: 1536,
          autoGenerate: true,
        }),
      },
    }),
  },
})
```

### 2. Generate schema and push to database

```bash
pnpm generate
pnpm db:push
```

### 3. Create content (embeddings generated automatically)

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

### 4. Perform semantic search

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

## Local Development with Ollama

For local development without API costs:

```typescript
import { config, list } from '@opensaas/stack-core'
import { ragPlugin, ollamaEmbeddings, jsonStorage } from '@opensaas/stack-rag'

export default config({
  plugins: [
    ragPlugin({
      provider: ollamaEmbeddings({
        baseURL: 'http://localhost:11434',
        model: 'nomic-embed-text',
      }),
      storage: jsonStorage(), // No database extensions needed
    }),
  ],
  // ... rest of config
})
```

First, install and run Ollama:

```bash
# Install Ollama from https://ollama.ai
ollama pull nomic-embed-text
ollama serve
```

## Storage Backends

### JSON Storage (Development)

Good for development and small datasets. No database extensions needed.

```typescript
storage: jsonStorage()
```

### pgvector (Production PostgreSQL)

Best for production apps using PostgreSQL. Requires pgvector extension.

```typescript
storage: pgvectorStorage({ distanceFunction: 'cosine' })
```

Setup:

```sql
CREATE EXTENSION vector;
```

### SQLite VSS (SQLite)

Good for SQLite-based apps. Requires sqlite-vss extension.

```typescript
storage: sqliteVssStorage({ distanceFunction: 'cosine' })
```

## MCP Integration

Automatic semantic search tools for AI assistants:

```typescript
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { ragPlugin, openaiEmbeddings } from '@opensaas/stack-rag'
import { embedding } from '@opensaas/stack-rag/fields'

export default config({
  plugins: [
    ragPlugin({
      provider: openaiEmbeddings({ apiKey: process.env.OPENAI_API_KEY! }),
      enableMcpTools: true, // Enables semantic_search_article tool
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

## Runtime Utilities

The `@opensaas/stack-rag/runtime` package provides high-level utilities for common RAG operations.

### Semantic Search

Simplified API that handles embedding generation and search in one call:

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

Find items similar to a given item by ID:

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

Split long documents into smaller chunks for embedding:

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

Process large batches of texts with automatic rate limiting:

```typescript
import { batchProcess } from '@opensaas/stack-rag/runtime'

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

### Generate Embeddings with Chunking

Generate embeddings for long texts with automatic chunking:

```typescript
import { generateEmbedding } from '@opensaas/stack-rag/runtime'

// Single embedding
const embedding = await generateEmbedding({
  provider: createEmbeddingProvider({ type: 'openai', apiKey: process.env.OPENAI_API_KEY! }),
  text: 'Short text',
})

// Chunked embeddings for long documents
const chunkedEmbeddings = await generateEmbedding({
  provider: createEmbeddingProvider({ type: 'openai', apiKey: process.env.OPENAI_API_KEY! }),
  text: veryLongDocument,
  enableChunking: true,
  chunking: { chunkSize: 1000, chunkOverlap: 200 },
})

// Each chunk has its embedding
for (const { chunk, embedding } of chunkedEmbeddings) {
  console.log(`Chunk ${chunk.index}: ${chunk.text.substring(0, 50)}...`)
  await saveChunkEmbedding(chunk, embedding)
}
```

## API Reference

### Main Exports (`@opensaas/stack-rag`)

- `ragPlugin(config)` - RAG plugin for OpenSaas Stack (v0.2.0+)
- `openaiEmbeddings(config)` - OpenAI embedding provider helper
- `ollamaEmbeddings(config)` - Ollama embedding provider helper
- `pgvectorStorage(config)` - pgvector storage helper
- `sqliteVssStorage(config)` - SQLite VSS storage helper
- `jsonStorage()` - JSON-based storage helper

### Field Types (`@opensaas/stack-rag/fields`)

- `embedding(options)` - Vector embedding field type

### Providers (`@opensaas/stack-rag/providers`)

- `createEmbeddingProvider(config)` - Factory for creating embedding providers
- `registerEmbeddingProvider(type, factory)` - Register custom providers

### Storage (`@opensaas/stack-rag/storage`)

- `createVectorStorage(config)` - Factory for creating storage backends
- `registerVectorStorage(type, factory)` - Register custom storage backends

### Runtime Utilities (`@opensaas/stack-rag/runtime`)

- `semanticSearch(options)` - High-level semantic search
- `findSimilar(options)` - Find similar items by ID
- `chunkText(text, options)` - Text chunking utilities
- `generateEmbedding(options)` - Generate embeddings with chunking support
- `generateEmbeddings(options)` - Batch embedding generation
- `batchProcess(options)` - Batch processing with rate limiting
- `RateLimiter` - Rate limiting utility class
- `ProcessingQueue` - Concurrent processing queue

## Documentation

See [CLAUDE.md](./CLAUDE.md) for comprehensive documentation including:

- All abstraction levels (high-level to low-level)
- Custom embedding providers
- Custom storage backends
- Text chunking strategies
- Performance optimization
- Testing patterns
- Migration guides

## Examples

See `examples/rag-demo` for a complete working example with:

- Document search
- Chatbot with knowledge base
- MCP integration
- Multiple embedding providers

## Repository

- **GitHub**: https://github.com/OpenSaasAU/stack
- **Docs**: https://stack.opensaas.au/
- **Issues**: https://github.com/OpenSaasAU/stack/issues

## License

MIT
