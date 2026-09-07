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
- `semanticSearch({ list, fieldName, query, provider, ... })` - Embed a query and rank through `nearest()`
- `findSimilar({ list, fieldName, itemId, ... })` - Rank by an item's own embedding
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
  // Postgres with pgvector is the only datasource RAG runs on: every column
  // the plugin emits is a pgvector column.
  db: { provider: 'postgresql', url: process.env.DATABASE_URL! },
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
await context.db.Article.create({
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
    minScore: 0.25,
  })

  return matches.map((match) => ({
    article: match.item,
    similarity: match.score,
  }))
}
```

`minScore` is read on the column's own distance function, not a normalised
0–1 scale: `cosine` scores the raw cosine on `[-1, 1]`, `l2` scores
`1 / (1 + distance)` on `(0, 1]`, and `inner_product` scores the dot product,
which is unbounded.

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

`ragPlugin()` extends every list holding an `embedding()` field that declares a
`sourceField` and `autoGenerate` with a **list-level `afterTransaction` hook**.
The config below is the whole of what an app author writes:

```typescript
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { ragPlugin, openaiEmbeddings } from '@opensaas/stack-rag'
import { embedding } from '@opensaas/stack-rag/fields'

export default config({
  db: { provider: 'postgresql' },
  plugins: [ragPlugin({ provider: openaiEmbeddings({ apiKey: process.env.OPENAI_API_KEY! }) })],
  lists: {
    Article: list({
      fields: {
        content: text(),
        contentEmbedding: embedding({ sourceField: 'content', autoGenerate: true }),
      },
    }),
  },
})
```

Once the write's own transaction has committed, that hook:

1. Reads the **persisted** source text off `item`, so a value a `resolveInput`
   hook derived is embedded like any other.
2. Hashes it and compares the hash with the `sourceHash` on the stored
   embedding's metadata. Equal means nothing to do — which is what stops the
   plugin's own write from re-entering, and what stops an unrelated field change
   from costing an API call.
3. Otherwise calls the provider and writes the vector and its metadata.

Generation runs after the commit, not on input, because calling a provider is a
network round trip that has no business holding a database connection open
inside a transaction (ADR-0045).

**The column is write-denied to application code.** A plain
`context.db.Article.update({ where, data: { contentEmbedding } })` throws
`Cannot update "contentEmbedding": field-level access denied.` — do not write
that. The plugin's own output reaches the column through a `sudo()` context
held behind a module-private symbol, which is on neither the package's exported
surface nor the generated `PluginServices` face. Application code that
maintains its own vectors declares `embedding({ allowManualWrites: true })` and
then writes the field like any other.

Known limits of the generation hook, all of them consequences of running after
the commit — none can abort the write:

- A nested record is never embedded: `afterTransaction` carries a persisted
  `item` for the top-level record only (#1271).
- A provider failure is logged, not thrown. The row keeps a null embedding and
  there is no regeneration path yet (#1271); `generation-failure.ts` classifies
  a throw as transient or standing and says a standing one once per field.
- On the `prisma-8` branch the sudo write cannot execute at all, because the
  secured write surface is not yet ported (#1124, #1127), so every embedding
  column stays null and searches return nothing.

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

## Provisioning pgvector

`ragPlugin` declares the pgvector extension pack, so the extension's own
migration is a generator emission (ADR-0065) and `pnpm db:update` enables the
extension. No DDL here is hand-written and there is no install script.

What the deployment owns is provisioning:

- pgvector must be **available** on the server. The Dev database and CI's
  container carry it; Neon, Supabase and RDS offer it.
- The migrating role needs the privilege to **create** it. pgvector is not a
  trusted extension, so that is superuser or a provider grant.
- Where a locked-down server offers neither, a DBA pre-creates the extension by
  hand once, as a superuser. Prisma's op carries a precheck, so the migration
  then records it as already satisfied and skips it.

A server without pgvector fails with Prisma's own error, naming the `pgvector`
space, the missing `vector.control` file and SQL state `58P01`.

The index is declared on the field, not written as SQL:

```typescript
contentEmbedding: embedding({
  sourceField: 'content',
  dimensions: 1536,
  distanceFunction: 'cosine',
  index: { method: 'hnsw', m: 16, efConstruction: 64 },
})
```

Known limits: `@prisma/orm-extension-pgvector@8.0.0-rc.8` registers no index
types, so an `index` declaration derives the column type and the operator class
and is not yet lowered to a `CREATE INDEX` (#1265).

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
2. **Index embeddings**: Declare `index` on the `embedding()` field rather than writing SQL
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
const keywordResults = await context.db.Article.findMany({
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
5. Run `pnpm generate` and `pnpm db:update` — the latter enables pgvector, which
   needs the extension available on the server and the create privilege (see
   "Provisioning pgvector" above)
6. Embeddings are generated from the source text on create and update

### Changing a field's dimension

The dimension is the column's type, so changing it is a migration:

```bash
pnpm generate
pnpm db:update
```

A stored vector of the old width does not survive it. Re-save each row's source
field so the plugin regenerates the embedding — there is no re-embedding
command (#1271).

### Coming from an app whose embeddings were JSON

Embeddings stored as JSON by an earlier version of this package are **not**
compatible and there is no conversion path. An embedding is now a pgvector
`vector(n)` column with a `jsonb` metadata sibling, and a JSON array is
readable as neither.

An embedding is derived data, so regenerate it from the text it came from
rather than converting it: reseed, or re-save each row's source field. Both RAG
examples (`examples/rag-openai-chatbot`, `examples/rag-ollama-demo`) reseed.

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
