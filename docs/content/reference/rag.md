# RAG Package

RAG (Retrieval-Augmented Generation) and AI embeddings integration for Stack. Turn your application into a knowledge base with semantic search capabilities powered by vector embeddings.

## Overview

The `@opensaas/stack-rag` package adds semantic search and RAG capabilities to your Stack application with minimal configuration. It supports multiple embedding providers (OpenAI, Ollama), stores embeddings in a native pgvector column, and integrates with the stack's access control system.

**Key Features:**

- 🤖 **Multiple Embedding Providers** - OpenAI, Ollama (local), or bring your own custom provider
- 🗄️ **Native Vector Column** - a pgvector `vector(n)` column with its dimension, distance function and index declared on the field
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

Here's the fastest way to add semantic search to your Stack app:

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

1. The `ragPlugin()` configures the embedding provider and declares the pgvector extension pack
2. The `searchable()` wrapper automatically creates a `contentEmbedding` field
3. Embeddings are auto-generated whenever `content` changes
4. All searches respect your existing access control rules

Generate the schema contract:

```bash
pnpm generate
```

`pnpm dev` applies it to the database.

Now create content. You never write the embedding — the plugin derives it from
`content` on the way in, and `create` returns `null` when access is denied:

```typescript
import { getContext } from '@/.opensaas/context'

const context = await getContext()

const article = await context.db.Article.create({
  data: {
    title: 'Introduction to AI',
    content: 'Artificial intelligence is...',
  },
})

if (article === null) {
  throw new Error('Not allowed to create an article')
}
```

Perform semantic search. The ranking, the `minScore` bound, the Access Filter and
Field Visibility all live inside the one `nearest()` query:

```typescript
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'
import { getContext } from '@/.opensaas/context'

export async function searchArticles(query: string) {
  const context = await getContext()

  const provider = createEmbeddingProvider({
    type: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
  })
  const queryVector = await provider.embed(query)

  return await context.db.Article.nearest('contentEmbedding', queryVector, {
    limit: 10,
    minScore: 0.25,
  })
}
```

## Core Concepts

### Embedding Fields

Embedding fields store vector embeddings (arrays of numbers) that represent the semantic meaning of text. The RAG package provides two patterns for defining embedding fields:

#### High-Level: `searchable()` Wrapper (Recommended)

The easiest way to add semantic search to any text field:

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
    dimensions: 768,
  }),
})
```

`dimensions` is **required** for Ollama. The dimension is a column's type, so
generation has to know it — and Ollama reports its model's output size only from
a live embed call, which `pnpm generate` must not depend on. Omitting it fails
generation with a message naming the provider.

**Setup:**

```bash
# Install Ollama from https://ollama.ai
ollama pull nomic-embed-text
ollama serve
```

### Environment Variables

`createProviderFromEnv()` and `getProviderConfigFromEnv()` in
`@opensaas/stack-rag/runtime` build a provider from the environment, for scripts
and build steps that have no config to read:

| Variable                      | Applies to | Default                  | Notes                                                                                  |
| ----------------------------- | ---------- | ------------------------ | -------------------------------------------------------------------------------------- |
| `EMBEDDING_PROVIDER`          | both       | `openai`                 | `openai` or `ollama`                                                                   |
| `OPENAI_API_KEY`              | OpenAI     | —                        | Required when the provider is `openai`                                                 |
| `OLLAMA_BASE_URL`             | Ollama     | `http://localhost:11434` |                                                                                        |
| `OLLAMA_EMBEDDING_DIMENSIONS` | Ollama     | `768`                    | The model's output size. The default is `nomic-embed-text`'s; set it for another model |

`OLLAMA_EMBEDDING_DIMENSIONS` is read rather than discovered for the same reason
`ollamaEmbeddings({ dimensions })` is required: it is a schema fact, and Ollama
only reports it from a live embed call. A value that is not a positive integer
throws rather than silently falling back — the wrong width produces a column
that no query vector fits.

`ragPlugin` itself takes its provider from your config, not from these; these
are for standalone scripts.

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

### The Vector Column

There is no storage backend to choose. `embedding()` emits a native pgvector
`vector(n)` column with its metadata in a `jsonb` column beside it, and the
field owns the dimension, the distance function and the index:

```typescript
contentEmbedding: embedding({
  sourceField: 'content',
  dimensions: 1536,
  distanceFunction: 'cosine', // 'cosine', 'l2', or 'inner_product'
  index: { method: 'hnsw', m: 16, efConstruction: 64 },
})
```

Because every column the plugin emits is a pgvector column, `postgresql` is the
only datasource RAG runs on — `pnpm generate` refuses any other one.

#### Provisioning pgvector

`ragPlugin` declares the pgvector extension pack, so nothing in your config
names it and no SQL is yours to run. The declaration is a generator emission
(ADR-0065): `pnpm generate` writes the extension's own migration under
`migrations/pgvector/`, and applying the contract enables the extension ahead of
your tables. Locally that is `pnpm db:update` with `pnpm dev` up in another
terminal; [Migrations and the dev loop](/docs/how-to/migrate) covers why the
command needs that loop and what `--confirm` asks for. In a deployment there is
no loop, so it is `prisma migration plan` once, committed, then
`prisma db migrate`. There is no `opensaas db migrate` — `opensaas db` carries
only `update`.

What the deployment owns is provisioning:

- **Availability.** pgvector has to be present on the Postgres server. The Dev
  database carries it, as do Neon, Supabase and RDS; a server you run yourself
  needs the extension installed (`pgvector/pgvector` Docker images,
  `brew install pgvector`, `postgresql-16-pgvector`).
- **Privilege.** pgvector is not a trusted extension, so the role your migration
  connects as needs superuser or a provider grant. Where a locked-down server
  offers neither, someone who does hold the privilege pre-creates the extension
  once; the migration prechecks for it and records the step as already
  satisfied, rather than failing.

A server with no pgvector fails the migration with Prisma's own error, naming
the `pgvector` space, the missing `vector.control` file and SQL state `58P01`.
The app's own tables are untouched, because each apply runs in one transaction.

#### Search exactness

Two separate statements, both about how many rows a search returns.

**A cost of ranking inside the access filter.** An approximate HNSW scan under a
selective access filter can return fewer than `limit` rows: the index walks a
bounded candidate list, and rows the session may not see are discarded from it
rather than replaced. Under an **exact** scan the result is exact — `limit` rows
whenever `limit` rows qualify. Under an approximate scan it is bounded by
pgvector's iterative-scan budget instead (ADR-0045).

**A known limit of the pack this ships against.**
`@prisma/orm-extension-pgvector@8.0.0-rc.8` registers no index types, so an
`index` declaration derives the column type and the operator class and nothing
else — no `CREATE INDEX` is emitted. Every search today is therefore an exact
scan, and the paragraph above describes what changes when the pack gains index
support. Tracked as
[#1265](https://github.com/OpenSaasAU/stack/issues/1265).

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

A `where` predicate composes with the search; the session's own filter is ANDed
onto it, so a user only ever ranks over articles they may read:

```typescript
import { getContext } from '@/.opensaas/context'

const context = await getContext({ userId: 'user-123' })

const matches = await context.db.Article.where({
  published: { equals: true },
}).nearest('contentEmbedding', queryVector)
```

A denied read answers `[]`, the same value an empty scoped set gives.

`nearest()` is a terminal on the secured read surface, so operation-level,
filter-level and field-level access control are enforced exactly as they are for
`all()` or `first()`. The top-K is computed over the rows the session may see —
the ranking and the `minScore` bound are inside the same scoped query, not
applied to a wider result afterwards (ADR-0045).

Searching a field also requires read access to it: ordering by a vector measures
its contents, so a session that cannot read the column is refused.

## Configuration Options

### RAG Plugin Configuration

| Option           | Type                         | Default   | Description                                                      |
| ---------------- | ---------------------------- | --------- | ---------------------------------------------------------------- |
| `provider`       | `EmbeddingProviderConfig`    | —         | The single default provider                                      |
| `providers`      | `Record<string, …Config>`    | `{}`      | Named providers, when fields choose between them                 |
| `chunking`       | `ChunkingConfig`             | recursive | Project-wide chunking defaults                                   |
| `enableMcpTools` | `boolean`                    | `true`    | Register a `semantic_search_<list>` MCP tool per searchable list |
| `batchSize`      | `number`                     | `10`      | Texts per provider call during batch generation                  |
| `rateLimit`      | `number`                     | `100`     | Provider requests per minute                                     |
| `buildTime`      | `{ enabled, outputPath, … }` | off       | Build-step embedding generation into a JSON index                |

Name either `provider` or `providers`; with `providers`, a field selects one by
key.

```typescript
ragPlugin({
  providers: {
    openai: openaiEmbeddings({
      apiKey: process.env.OPENAI_API_KEY!,
      model: 'text-embedding-3-small',
    }),
    ollama: ollamaEmbeddings({ model: 'nomic-embed-text', dimensions: 768 }),
  },
  enableMcpTools: true,
  rateLimit: 100,
})
```

### Field Configuration

#### searchable() Wrapper

`searchable(baseField, options)` keeps the base field as authored and adds the
companion embedding column beside it.

| Option               | Type             | Default                           |
| -------------------- | ---------------- | --------------------------------- |
| `provider`           | `string`         | the plugin's default              |
| `dimensions`         | `number`         | the provider's, else `1536`       |
| `chunking`           | `ChunkingConfig` | the plugin's                      |
| `embeddingFieldName` | `string`         | the field's name plus `Embedding` |

```typescript
content: searchable(text(), {
  provider: 'openai',
  dimensions: 1536,
  embeddingFieldName: 'customEmbedding',
  chunking: {
    strategy: 'recursive',
    maxTokens: 250,
    overlap: 50,
  },
})
```

#### embedding() Field

| Option              | Type                                                | Default                          |
| ------------------- | --------------------------------------------------- | -------------------------------- |
| `sourceField`       | `string`                                            | —                                |
| `provider`          | `string`                                            | the plugin's default             |
| `dimensions`        | `number`                                            | the provider's, else `1536`      |
| `distanceFunction`  | `'cosine' \| 'l2' \| 'inner_product'`               | `'cosine'`                       |
| `index`             | `{ method, opclass?, m?, efConstruction?, lists? }` | none                             |
| `allowManualWrites` | `boolean`                                           | `false`                          |
| `chunking`          | `ChunkingConfig`                                    | the plugin's                     |
| `autoGenerate`      | `boolean`                                           | `true` when `sourceField` is set |
| `ui`                | `{ showVector?, showMetadata? }`                    | `false` / `true`                 |

`dimensions` is a schema fact: changing it is a migration, and a declared value
that disagrees with a statically known provider dimension fails `pnpm generate`.
`allowManualWrites` defaults to `false`, which makes the builder attach
`access: { create: () => false, update: () => false }` to the field — the
embedding is a plugin output, so an ordinary write naming it is refused.

```typescript
contentEmbedding: embedding({
  sourceField: 'content',
  provider: 'openai',
  dimensions: 1536,
  distanceFunction: 'cosine',
  autoGenerate: true,
  chunking: {
    strategy: 'sentence',
    maxTokens: 125,
  },
})
```

## Package Exports

### Main Exports (`@opensaas/stack-rag`)

**Plugin and configuration:**

- `ragPlugin(config)` - RAG plugin for Stack
- `openaiEmbeddings(config)` - OpenAI embedding provider helper
- `ollamaEmbeddings(config)` - Ollama embedding provider helper (`dimensions` is required)

### Field Types (`@opensaas/stack-rag/fields`)

- `embedding(options)` - Vector embedding field type
- `searchable(baseField, options)` - High-level wrapper for automatic RAG

### Providers (`@opensaas/stack-rag/providers`)

- `createEmbeddingProvider(config)` - Factory for creating embedding providers
- `registerEmbeddingProvider(type, factory)` - Register custom providers
- `EmbeddingProvider` - TypeScript interface for custom providers

### Runtime Utilities (`@opensaas/stack-rag/runtime`)

**High-level utilities:**

- `semanticSearch({ list, fieldName, query, provider, ... })` - Embed a query and rank it through `nearest()`
- `findSimilar({ list, fieldName, itemId, ... })` - Rank by an item's own embedding
- `createProviderFromEnv(overrides?)` - Build a provider from `EMBEDDING_PROVIDER` and friends
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

An embedding reads back as its vector plus its metadata. The two live in
separate columns — a pgvector `vector(n)` and a `jsonb` beside it — and the
field reassembles them into one value:

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

**Emitted columns:**

| Column                     | Type           |
| -------------------------- | -------------- |
| `contentEmbedding`         | `vector(1536)` |
| `contentEmbeddingMetadata` | `jsonb`        |

An embedding is a plugin output, so an ordinary create or update naming it
throws. Pass `embedding({ allowManualWrites: true })` to maintain vectors
yourself.

### SearchResult Type

Search results pair the row with its score:

```typescript
type SearchResult<T = unknown> = {
  item: T // The matching record, through Field Visibility like any other read
  score: number // Higher is more similar; the range is the column's own
}
```

The score's range is the column's `distanceFunction`, not a normalised 0–1:

| `distanceFunction` | `score`         | Range     |
| ------------------ | --------------- | --------- |
| `cosine` (default) | the raw cosine  | `[-1, 1]` |
| `l2`               | `1 / (1 + d)`   | `(0, 1]`  |
| `inner_product`    | the dot product | unbounded |

`minScore` is read on the same scale, and is lowered into the query as a
distance bound rather than applied to the results afterwards. The raw distance
is not exposed.

## Examples

### Basic Semantic Search

```typescript
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'
import { getContext } from '@/.opensaas/context'

export async function searchArticles(query: string) {
  const context = await getContext()

  const provider = createEmbeddingProvider({
    type: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
  })
  const queryVector = await provider.embed(query)

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

### High-Level Semantic Search API

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

### Find Similar Items

```typescript
import { findSimilar } from '@opensaas/stack-rag/runtime'
import { getContext } from '@/.opensaas/context'

const context = await getContext()

const similar = await findSimilar({
  list: context.db.Article,
  fieldName: 'contentEmbedding',
  itemId: 'article-123',
  limit: 5,
  excludeSelf: true,
})
```

### Text Chunking

`chunkText` sizes in **characters** (`chunkSize`, `chunkOverlap`); only
`'token-aware'` reads `tokenLimit`. This is the standalone runtime helper — the
`chunking` option on a field is `ChunkingConfig`, which sizes in tokens.

Recursive chunking respects paragraph and sentence boundaries:

```typescript
import { chunkText } from '@opensaas/stack-rag/runtime'

const recursive = chunkText(longDocument, {
  strategy: 'recursive',
  chunkSize: 1000,
  chunkOverlap: 200,
})
```

Sentence chunking keeps sentences whole:

```typescript
import { chunkText } from '@opensaas/stack-rag/runtime'

const bySentence = chunkText(longDocument, {
  strategy: 'sentence',
  chunkSize: 500,
  chunkOverlap: 100,
})
```

Token-aware chunking bounds each chunk by an estimated token count instead:

```typescript
import { chunkText } from '@opensaas/stack-rag/runtime'

const byToken = chunkText(longDocument, {
  strategy: 'token-aware',
  tokenLimit: 500,
  chunkOverlap: 50,
})
```

### Batch Processing with Rate Limiting

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

## Working Examples

- **[RAG OpenAI Chatbot](https://github.com/OpenSaasAU/stack/tree/main/examples/rag-openai-chatbot)** - Production-ready chatbot with knowledge base, streaming responses, and source citations
- **[RAG Ollama Demo](https://github.com/OpenSaasAU/stack/tree/main/examples/rag-ollama-demo)** - Local development with Ollama embeddings over a native pgvector column

## Next Steps

- **[RAG Setup Guide](/docs/how-to/rag)** - Comprehensive setup instructions, database configuration, and example walkthroughs
- **[RAG Advanced Patterns](/docs/how-to/rag-advanced)** - Architecture deep dive, custom providers, performance optimization, and advanced use cases
- **[MCP Integration Guide](/docs/how-to/mcp)** - Model Context Protocol integration with semantic search tools

## Further Reading

- [OpenAI Embeddings Guide](https://platform.openai.com/docs/guides/embeddings)
- [pgvector Documentation](https://github.com/pgvector/pgvector)
- [Ollama Documentation](https://ollama.ai)
