# @opensaas/stack-rag

RAG (Retrieval-Augmented Generation) and AI embeddings integration for OpenSaas Stack.

Turn your OpenSaas app into a knowledge base with semantic search capabilities powered by vector embeddings.

## Features

- 🤖 **Multiple Embedding Providers**: OpenAI, Ollama (local), or bring your own
- 🗄️ **Native Vector Column**: a pgvector `vector(n)` column declared by the field
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
import { ragPlugin, openaiEmbeddings } from '@opensaas/stack-rag'
import { searchable } from '@opensaas/stack-rag/fields'

export default config({
  plugins: [
    ragPlugin({
      provider: openaiEmbeddings({
        apiKey: process.env.OPENAI_API_KEY!,
        model: 'text-embedding-3-small',
      }),
    }),
  ],
  db: { provider: 'postgresql' },
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

- The `searchable()` wrapper automatically creates a `contentEmbedding` field
- Embeddings are auto-generated whenever `content` changes
- The embedding field respects all your existing access control rules

### 2. Generate the schema and update the database

```bash
pnpm generate
pnpm db:update
```

`opensaas db update` opens no connection of its own: it hands the request to a
running `opensaas dev` loop and exits non-zero when none is listening. So keep
`pnpm dev` running in another terminal — or just save `opensaas.config.ts` with
the loop up, which reconciles without a second command. In a deployment there is
no loop; plan and apply the change with `prisma migration plan` and
`prisma db migrate` instead.

Either route enables pgvector along the way — see
[Provisioning pgvector](#provisioning-pgvector) for what the server has to
offer for that to succeed.

### 3. Create content (embeddings generated automatically)

```typescript
import { getContext } from '@/.opensaas/context'

const context = await getContext()

// Embedding is automatically generated from content
await context.db.Article.create({
  data: {
    title: 'Introduction to AI',
    content: 'Artificial intelligence is...',
    // No need to manually create embedding - it's automatic!
  },
})
```

### 4. Perform semantic search

```typescript
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'
import { getContext } from '@/.opensaas/context'

export async function searchArticles(query: string) {
  const context = await getContext()

  // Generate embedding for search query
  const provider = createEmbeddingProvider({
    type: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
  })
  const queryVector = await provider.embed(query)

  // Ranked inside one scoped query — the Access Filter and Field Visibility
  // apply exactly as they do to any other read.
  return await context.db.Article.nearest('contentEmbedding', queryVector, {
    limit: 10,
    minScore: 0.25,
  })
}
```

## Local Development with Ollama

For local development without API costs:

```typescript
import { config, list } from '@opensaas/stack-core'
import { ragPlugin, ollamaEmbeddings } from '@opensaas/stack-rag'

export default config({
  plugins: [
    ragPlugin({
      provider: ollamaEmbeddings({
        baseURL: 'http://localhost:11434',
        model: 'nomic-embed-text',
        // Required: generation must not depend on a running Ollama, and
        // Ollama reports its output size only from a live embed call.
        dimensions: 768,
      }),
    }),
  ],
  db: { provider: 'postgresql' },
  // ... lists
})
```

First, install and run Ollama:

```bash
# Install Ollama from https://ollama.ai
ollama pull nomic-embed-text
ollama serve
```

## Storage

Embeddings live in a native pgvector column beside the row, with their metadata
in a `jsonb` column next to it. There is no storage backend to select: the
column, its dimension and its distance function are declared on the field, and
`ragPlugin` names the pgvector extension pack so no app config has to.

```typescript
contentEmbedding: embedding({
  sourceField: 'content',
  dimensions: 1536,
  distanceFunction: 'cosine',
})
```

### Provisioning pgvector

`ragPlugin` declares the pgvector extension pack, so `pnpm generate` seeds that
pack's contract space under `migrations/` — it writes no app migration of its
own — and the dev loop enables the extension when it reconciles. There is no
install step to run and no SQL to paste.

What the server has to offer is the extension itself:

- pgvector must be **available** on the Postgres server — installed as a server
  extension, or bundled, as it is on the Dev database and on Neon, Supabase and
  RDS.
- The role that runs the migration needs the privilege to **create** it.
  pgvector is not a trusted extension, so that means superuser or a provider
  grant. Managed Postgres services generally grant it to the app role.

Where neither is on offer, a DBA pre-creates the extension by hand once, as a
superuser. The migration then records it as already satisfied — Prisma prechecks
for the extension before creating it and skips the step. Either route arrives in
the same place.

A server without pgvector at all fails the migration with Prisma's own error,
naming the `pgvector` space and SQL state `58P01`.

## Field Configuration Patterns

### High-Level: `searchable()` Wrapper (Recommended)

The easiest way to add semantic search to any field:

```typescript
import { text } from '@opensaas/stack-core/fields'
import { searchable } from '@opensaas/stack-rag/fields'

fields: {
  content: searchable(text({ validation: { isRequired: true } }), {
    provider: 'openai',
    dimensions: 1536,
  })
}
```

**What it does:**

- Automatically creates a companion `contentEmbedding` field
- Links it to the source field (`content`)
- Auto-generates embeddings when content changes
- Clean, concise syntax

**Options:**

```typescript
type SearchableOptions = {
  provider?: string // Embedding provider (e.g., 'openai', 'ollama')
  dimensions?: number // Vector dimensions (default: 1536)
  chunking?: ChunkingConfig // Text chunking configuration
  embeddingFieldName?: string // Custom embedding field name (default: `${fieldName}Embedding`)
}
```

**Custom embedding field name:**

```typescript
fields: {
  body: searchable(text(), {
    provider: 'openai',
    embeddingFieldName: 'bodyVector', // Instead of 'bodyEmbedding'
  })
}
```

### Low-Level: Manual `embedding()` Field

For advanced use cases where you need more control:

```typescript
import { text } from '@opensaas/stack-core/fields'
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

- Need access to the embedding field in your schema
- Want to store embeddings without a source field
- Building custom embedding pipelines
- Need field-level hooks on the embedding field

Both patterns are fully supported and can be used interchangeably.

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
  db: { provider: 'postgresql' },
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
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'
import { getContext } from '@/.opensaas/context'

const context = await getContext()

const results = await semanticSearch({
  list: context.db.Article,
  fieldName: 'contentEmbedding',
  query: 'articles about machine learning',
  provider: createEmbeddingProvider({ type: 'openai', apiKey: process.env.OPENAI_API_KEY! }),
  limit: 10,
  minScore: 0.25,
})
```

`minScore` is a bound on the column's own distance function, not on a
normalised 0–1 scale. A `cosine` column scores the raw cosine on `[-1, 1]`, an
`l2` column scores `1 / (1 + distance)` on `(0, 1]`, and an `inner_product`
column scores the dot product, which is unbounded.

### Find Similar Items

Find items similar to a given item by ID:

```typescript
import { findSimilar } from '@opensaas/stack-rag/runtime'
import { getContext } from '@/.opensaas/context'

const context = await getContext()

const similar = await findSimilar({
  list: context.db.Article,
  fieldName: 'contentEmbedding',
  itemId: 'article-123',
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
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'

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
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'

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
- `ollamaEmbeddings(config)` - Ollama embedding provider helper (`dimensions` is required)

### Field Types (`@opensaas/stack-rag/fields`)

- `embedding(options)` - Vector embedding field type

### Providers (`@opensaas/stack-rag/providers`)

- `createEmbeddingProvider(config)` - Factory for creating embedding providers
- `registerEmbeddingProvider(type, factory)` - Register custom providers

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
- Text chunking strategies
- Performance optimization
- Testing patterns
- Migration guides

## Examples

Two complete working examples:

- `examples/rag-ollama-demo` — semantic search over the sample documents its
  `pnpm test:rag` script creates, embedded locally by Ollama, with no API key
- `examples/rag-openai-chatbot` — a chatbot answering from a knowledge base seeded by
  `pnpm db:seed`, embedded by OpenAI, with source citations

## Repository

- **GitHub**: https://github.com/OpenSaasAU/stack
- **Docs**: https://stack.opensaas.au/
- **Issues**: https://github.com/OpenSaasAU/stack/issues

## License

MIT
