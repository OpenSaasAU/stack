# @opensaas/stack-rag

RAG (Retrieval-Augmented Generation) and AI embeddings integration for OpenSaas Stack. Turn your OpenSaas app into a knowledge base with semantic search capabilities.

## Purpose

Adds vector embeddings and semantic search to OpenSaas Stack apps with minimal configuration. Supports multiple embedding providers (OpenAI, Ollama) over a native pgvector column.

## Key Features

- **Multiple abstraction levels**: From automatic "magic" RAG to low-level primitives
- **Embedding providers**: OpenAI, Ollama (local), extensible for custom providers
- **Native vector column**: `embedding()` emits a pgvector column with its index and distance function declared on the field
- **MCP integration**: Automatic semantic search tools for AI assistants
- **Access control**: All searches respect existing access control rules
- **Automatic embedding generation**: Via hooks when source fields change

## Package Structure

```
packages/rag/
├── src/
│   ├── config/         # ragPlugin(), provider helpers
│   ├── fields/         # embedding() field type
│   ├── providers/      # OpenAI, Ollama embedding providers
│   ├── runtime/        # generateEmbeddings(), semanticSearch()
│   └── mcp/            # MCP tool generators
```

## Package Exports

### Main exports (`@opensaas/stack-rag`)

- `ragPlugin({ ... })` - Plugin added to `config({ plugins: [...] })` that wires RAG into your config
- `openaiEmbeddings({ ... })` - OpenAI provider config helper
- `ollamaEmbeddings({ ... })` - Ollama provider config helper (`dimensions` is required)

### Fields (`@opensaas/stack-rag/fields`)

- `embedding({ ... })` - Vector embedding field type

### Providers (`@opensaas/stack-rag/providers`)

- `createEmbeddingProvider(config)` - Factory for embedding providers
- `OpenAIEmbeddingProvider` - OpenAI implementation
- `OllamaEmbeddingProvider` - Ollama implementation
- `registerEmbeddingProvider(type, factory)` - Register custom providers

### Runtime (`@opensaas/stack-rag/runtime`)

- `generateEmbeddings(config, text, provider)` - Generate embeddings
- `semanticSearch({ listKey, fieldName, query, provider, context, ... })` - Embed a query and rank through `nearest()`
- `findSimilar({ listKey, fieldName, itemId, context, ... })` - Rank by an item's own embedding
- `chunkText(text, strategy)` - Text chunking utilities

### MCP (`@opensaas/stack-rag/mcp`)

- Auto-generated semantic search tools for MCP server

## Usage Patterns

### Basic Setup with OpenAI

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { ragPlugin, openaiEmbeddings } from '@opensaas/stack-rag'
import { embedding } from '@opensaas/stack-rag/fields'

export default config({
  db: {
    provider: 'postgresql',
    url: process.env.DATABASE_URL!,
  },
  lists: {
    Article: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
        content: text({ validation: { isRequired: true } }),
        contentEmbedding: embedding({
          sourceField: 'content',
          provider: 'openai',
          dimensions: 1536,
          autoGenerate: true,
        }),
      },
    }),
  },
  plugins: [
    ragPlugin({
      provider: openaiEmbeddings({
        apiKey: process.env.OPENAI_API_KEY!,
        model: 'text-embedding-3-small',
      }),
    }),
  ],
})
```

### Local Development with Ollama

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { ragPlugin, ollamaEmbeddings } from '@opensaas/stack-rag'
import { embedding } from '@opensaas/stack-rag/fields'

export default config({
  db: { provider: 'sqlite', url: 'file:./dev.db' },
  lists: {
    Document: list({
      fields: {
        text: text(),
        embedding: embedding({
          sourceField: 'text',
          provider: 'ollama',
          autoGenerate: true,
        }),
      },
    }),
  },
  plugins: [
    ragPlugin({
      provider: ollamaEmbeddings({
        baseURL: 'http://localhost:11434',
        model: 'nomic-embed-text',
        dimensions: 768,
      }),
    }),
  ],
})
```

### Multiple Providers

```typescript
ragPlugin({
  providers: {
    openai: openaiEmbeddings({
      apiKey: process.env.OPENAI_API_KEY!,
      model: 'text-embedding-3-small',
    }),
    ollama: ollamaEmbeddings({
      model: 'nomic-embed-text',
      dimensions: 768,
    }),
  },
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

### Manual Embedding Storage (Low-Level)

```typescript
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'
import { getContext } from '@/.opensaas/context'

// Generate embeddings manually
const provider = createEmbeddingProvider({
  type: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
})

const vector = await provider.embed('Hello world')

// Store manually
const context = await getContext()
await context.db.article.create({
  data: {
    title: 'Hello',
    contentEmbedding: {
      vector,
      metadata: {
        model: provider.model,
        provider: provider.type,
        dimensions: provider.dimensions,
        generatedAt: new Date().toISOString(),
      },
    },
  },
})
```

### Semantic Search (Runtime)

```typescript
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'
import { getContext } from '@/.opensaas/context'

// Server action or API route
export async function searchArticles(query: string) {
  const context = await getContext()

  const provider = createEmbeddingProvider({
    type: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
  })
  const queryVector = await provider.embed(query)

  // `nearest()` is a core-owned terminal: the access filter, the minScore
  // bound and the ranking are all inside one scoped query (ADR-0045).
  const matches = await context.db.Article.nearest('contentEmbedding', queryVector, {
    limit: 10,
    minScore: 0.7,
  })

  return matches.map((match) => ({
    article: match.item,
    similarity: match.score,
  }))
}
```

### MCP Integration (Automatic)

When RAG is enabled with MCP, semantic search tools are automatically generated:

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { authPlugin } from '@opensaas/stack-auth'
import { ragPlugin, openaiEmbeddings } from '@opensaas/stack-rag'
import { embedding } from '@opensaas/stack-rag/fields'

export default config({
  db: { provider: 'postgresql', url: process.env.DATABASE_URL! },
  mcp: {
    enabled: true,
    auth: { type: 'better-auth', loginPage: '/sign-in' },
  },
  lists: {
    Article: list({
      fields: {
        content: text(),
        contentEmbedding: embedding({ sourceField: 'content' }),
      },
    }),
  },
  plugins: [
    authPlugin({ emailAndPassword: { enabled: true } }),
    ragPlugin({
      provider: openaiEmbeddings({ apiKey: process.env.OPENAI_API_KEY! }),
      enableMcpTools: true, // Auto-generates semantic_search_article tool
    }),
  ],
})
```

AI assistants can then use:

```json
{
  "name": "semantic_search_article",
  "arguments": {
    "query": "articles about machine learning",
    "limit": 5
  }
}
```

## Architecture Patterns

### Automatic Embedding Generation

The `ragPlugin()` injects hooks into fields with `sourceField` set:

```typescript
// User config
contentEmbedding: embedding({
  sourceField: 'content',
  autoGenerate: true
})

// ragPlugin() automatically adds:
contentEmbedding: embedding({
  hooks: {
    afterOperation: async ({ operation, value, item, context }) => {
      if (operation === 'create' || operation === 'update') {
        // Check if source field changed
        const sourceText = item.content
        const currentEmbedding = item.contentEmbedding

        // Generate embedding if needed
        if (shouldRegenerate(sourceText, currentEmbedding)) {
          const provider = getEmbeddingProvider(ragConfig)
          const vector = await provider.embed(sourceText)

          await context.db.article.update({
            where: { id: item.id },
            data: {
              contentEmbedding: {
                vector,
                metadata: { ... }
              }
            }
          })
        }
      }
    }
  }
})
```

### Access Control Integration

All searches use the access-controlled context:

```typescript
// Search respects access control
const context = await getContext({ userId: 'user-123' })

const matches = await context.db.Article.where({ published: { equals: true } }).nearest(
  'contentEmbedding',
  queryVector,
)

// Users only see articles they have access to
```

### The vector column

There is no storage backend to choose. `embedding()` emits a native pgvector
column, and the field owns its dimension, its distance function and its index:

```typescript
contentEmbedding: embedding({
  sourceField: 'content',
  dimensions: 1536,
  distanceFunction: 'cosine',
  index: { method: 'hnsw', m: 16, efConstruction: 64 },
})
```

`ragPlugin` declares the pgvector extension pack itself, so no config names it.

### Embedding Providers

Providers are pluggable and extensible:

```typescript
// Register custom provider
import { registerEmbeddingProvider } from '@opensaas/stack-rag/providers'

registerEmbeddingProvider('custom', (config) => {
  return {
    type: 'custom',
    model: config.model,
    dimensions: config.dimensions,
    async embed(text) {
      // Your implementation
      return [/* vector */]
    },
    async embedBatch(texts) {
      // Batch implementation
      return [[/* vectors */]]
    },
  }
})
```

## Database Setup

### PostgreSQL with pgvector

```sql
-- Enable pgvector extension
CREATE EXTENSION vector;

-- Prisma will generate schema with Json fields
-- For optimal performance, create indexes:
CREATE INDEX article_embedding_vector_idx
ON "Article" USING ivfflat (("contentEmbedding"->>'vector')::vector(1536))
WITH (lists = 100);
```

### SQLite with VSS

```sql
-- Load VSS extension (depends on your SQLite setup)
-- Embeddings stored as JSON, VSS used for search
```

### Any Database with JSON Storage

No special setup needed. Embeddings stored as JSON, similarity computed in JavaScript.

## Type Safety

All operations are fully typed:

```typescript
import type { SearchResult, StoredEmbedding } from '@opensaas/stack-rag'

const matches = await context.db.Article.nearest('contentEmbedding', queryVector)

const embedding: StoredEmbedding = {
  vector: [0.1, 0.2, 0.3],
  metadata: {
    model: 'text-embedding-3-small',
    provider: 'openai',
    dimensions: 1536,
    generatedAt: new Date().toISOString(),
  },
}
```

## Performance Considerations

1. **Batch embedding generation**: Use `embedBatch()` for multiple texts
2. **Index embeddings**: Create vector indexes in production (pgvector)
3. **Chunking strategy**: Configure chunking for long texts
4. **Rate limiting**: Configure `rateLimit` in RAG config to avoid API limits
5. **Caching**: Hash source text to avoid regenerating unchanged embeddings

## Common Patterns

### Text Chunking for Long Documents

```typescript
import { chunkText } from '@opensaas/stack-rag/runtime'

const chunks = chunkText(longDocument, {
  strategy: 'recursive',
  maxTokens: 500,
  overlap: 50,
})

// Generate embeddings for each chunk
const vectors = await provider.embedBatch(chunks)
```

### Hybrid Search (Keyword + Semantic)

```typescript
// Combine traditional search with semantic search
const keywordResults = await context.db.article.findMany({
  where: {
    OR: [{ title: { contains: query } }, { content: { contains: query } }],
  },
})

const semanticResults = await context.db.Article.nearest('contentEmbedding', queryVector)

// Merge and deduplicate results
```

### Find Similar Items

```typescript
// Find articles similar to a given article
const article = await context.db.Article.where({ id: { equals: id } }).first()
const queryVector = article.contentEmbedding.vector

const similar = await context.db.Article.where({ id: { not: id } }).nearest(
  'contentEmbedding',
  queryVector,
  { limit: 5 },
)
```

## Testing

```typescript
// packages/rag/__tests__/providers.test.ts
import { describe, it, expect } from 'vitest'
import { createOpenAIProvider } from '../src/providers/openai'

describe('OpenAIEmbeddingProvider', () => {
  it('should generate embeddings', async () => {
    const provider = createOpenAIProvider({
      type: 'openai',
      apiKey: process.env.OPENAI_API_KEY!,
    })

    const embedding = await provider.embed('Hello world')

    expect(embedding).toHaveLength(1536)
    expect(embedding[0]).toBeTypeOf('number')
  })
})
```

## Migration Guide

### Adding RAG to Existing App

1. Install package: `pnpm add @opensaas/stack-rag`
2. Install provider: `pnpm add openai` (for OpenAI)
3. Add `ragPlugin()` to your config's `plugins` array
4. Add `embedding()` fields to lists
5. Run `pnpm generate` and `pnpm db:push`
6. Embeddings will be generated automatically on create/update

### Changing a field's dimension

The dimension is the column's type, so changing it is a migration:

```bash
pnpm generate
pnpm db:push
```

Existing embeddings in JSON format are compatible.

## Limitations

- **Dimensions must match**: Provider and field dimensions must match
- **No automatic re-embedding**: Changing provider/model requires manual re-embedding
- **Access control bypass**: Raw Prisma queries bypass access control (handled in implementation)

## Future Enhancements

- Automatic re-embedding when provider changes
- Built-in chunking strategies for fields
- Hybrid search utilities (keyword + semantic)
- Pinecone, Qdrant, Weaviate integrations
- Embedding caching and deduplication
- Advanced distance metrics
