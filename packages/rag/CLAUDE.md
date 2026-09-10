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
│   ├── fields/         # embedding() field type, searchable() wrapper
│   ├── providers/      # OpenAI, Ollama embedding providers
│   ├── runtime/        # generateEmbeddings(), semanticSearch()
│   └── mcp/            # Types for custom MCP tools — no tools, no generators;
│                       # ragPlugin registers the semantic search tools itself
```

## Package Exports

### Main exports (`@opensaas/stack-rag`)

- `ragPlugin({ ... })` - Plugin added to `config({ plugins: [...] })` that wires RAG into your config
- `openaiEmbeddings({ ... })` - OpenAI provider config helper
- `ollamaEmbeddings({ ... })` - Ollama provider config helper (`dimensions` is required)

### Fields (`@opensaas/stack-rag/fields`)

- `embedding({ ... })` - Vector embedding field type
- `searchable(field, { ... })` - Wraps a field so the list also carries its companion `embedding()`

### Providers (`@opensaas/stack-rag/providers`)

- `createEmbeddingProvider(config)` - Factory for embedding providers
- `OpenAIEmbeddingProvider` - OpenAI implementation
- `OllamaEmbeddingProvider` - Ollama implementation
- `registerEmbeddingProvider(type, factory)` - Register custom providers

### Runtime (`@opensaas/stack-rag/runtime`)

- `generateEmbedding({ provider, text, ... })` - One `StoredEmbedding`, or a `ChunkedEmbedding[]` under `enableChunking: true`
- `generateEmbeddings({ provider, texts, ... })` - A `StoredEmbedding[]`, batched
- `semanticSearch({ list, fieldName, query, provider, ... })` - Embed a query and rank through `nearest()`
- `findSimilar({ list, fieldName, itemId, ... })` - Rank by an item's own embedding
- `chunkText(text, options)` - Text chunking utilities; `strategy` is one of `options`

### MCP (`@opensaas/stack-rag/mcp`)

Semantic search tools are registered by `ragPlugin` itself, so nothing here is
imported to get them. The module carries the types a custom tool needs:
`SearchResult` and `SemanticSearchOptions`.

## Usage Patterns

### Basic Setup with OpenAI

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { ragPlugin, openaiEmbeddings } from '@opensaas/stack-rag'
import { embedding } from '@opensaas/stack-rag/fields'

export default config({
  db: { provider: 'postgresql' },
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
  db: { provider: 'postgresql' },
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

An embedding is a plugin output, so the field is write-denied to application
code by default and a create or update naming it throws
`Cannot create "contentEmbedding": field-level access denied.` A list that
maintains its own vectors opts out on the field:

```typescript
fields: {
  title: text(),
  contentEmbedding: embedding({ dimensions: 1536, allowManualWrites: true }),
}
```

No `sourceField` and no `autoGenerate`, so nothing regenerates the column behind
you. Then the write is an ordinary one:

```typescript
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'
import { getContext } from '@/.opensaas/context'

const provider = createEmbeddingProvider({
  type: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
})

const vector = await provider.embed('Hello world')

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

The vector has to be exactly as wide as the field's `dimensions` — that is the
column's type, and the field's own schema refuses a mismatch before the write
reaches it.

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
  db: { provider: 'postgresql' },
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

`ragPlugin()` extends every list holding an `embedding()` field with
`autoGenerate` set with a **list-level `afterTransaction` hook**. `autoGenerate`
alone is the gate: a field carrying it but no `sourceField` is a config error,
not a quiet skip — `pnpm generate` throws
`RAG plugin: Field "<List>.<field>" has autoGenerate enabled but no sourceField specified`.
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
   embedding's metadata. Equal means nothing to do, which is what stops an
   unrelated field change from costing an API call. Re-entry is not what it
   guards: the plugin's write fires no hook (ADR-0066).
3. Otherwise calls the provider and writes the vector and its metadata.

Generation runs after the commit, not on input, because calling a provider is a
network round trip that has no business holding a database connection open
inside a transaction (ADR-0045).

**The column is write-denied to application code.** A plain
`context.db.Article.update({ where, data: { contentEmbedding } })` throws
`Cannot update "contentEmbedding": field-level access denied.` — do not write
that. The plugin's own output reaches the column through core's
`writePluginOwnedField` (ADR-0066), held behind a module-private symbol which is
on neither the package's exported surface nor the generated `PluginServices`
face. That write carries this field's columns and nothing else, and runs **no**
hook of the list's: driving it through `sudo().db` would re-run `resolveInput`
over a payload naming only the embedding, which destroys a field the list
derives from other input. The columns are the field's own because core resolves
the field against the config the context carries — the plugin names a list and a
field, never a layout, and a name the config does not declare is refused.
Application code that maintains its own vectors declares
`embedding({ allowManualWrites: true })` and then writes the field like any
other, through the ordinary pipeline.

Known limits of the generation hook, all of them consequences of running after
the commit — none can abort the write:

- A nested record is never embedded: `afterTransaction` carries a persisted
  `item` for the top-level record only (#1271). No write reaches that today —
  a nested spelling under a relationship key is refused by
  `NestedRelationInputError` (ADR-0050) — so the hook's warning is a backstop.
- A provider failure is logged, not thrown. The row keeps a null embedding and
  there is no regeneration path yet (#1271); `generation-failure.ts` classifies
  a throw as transient or standing and says a standing one once per field.

### Access Control Integration

All searches use the access-controlled context:

```typescript
import { getContext } from '@/.opensaas/context'

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
  const model = typeof config.model === 'string' ? config.model : 'custom-embed'
  const dimensions =
    'dimensions' in config && typeof config.dimensions === 'number' ? config.dimensions : 768

  return {
    type: 'custom',
    model,
    dimensions,
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

The factory is handed the whole `EmbeddingProviderConfig` union, whose custom
member is an open `{ type: string; [key: string]: unknown }`. So `config.model`
arrives as `unknown`. `config.dimensions` is required on `OllamaEmbeddingConfig`
and supplied by the custom member's index signature, but it is absent from
`OpenAIEmbeddingConfig`, so it is not on every member and therefore not readable
off the union — which is exactly why the `in` guard is the right narrowing.
Narrow both, as above, rather than reading them straight onto the returned
`EmbeddingProvider`, whose `model` and `dimensions` are a required `string` and
`number`.

## Provisioning pgvector

`ragPlugin` declares the pgvector extension pack, so the extension's own
migration is a generator emission: `pnpm generate` seeds it under
`migrations/pgvector/` (ADR-0065). Applying the contract is what enables the
extension — the dev loop locally, `prisma db migrate` in a deployment (see
"Applying the change" below). No DDL here is hand-written and there is no
install script.

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
  chunkSize: 500,
  chunkOverlap: 50,
})

// Generate embeddings for each chunk
const vectors = await provider.embedBatch(chunks.map((chunk) => chunk.text))
```

### Hybrid Search (Keyword + Semantic)

```typescript
// Combine traditional search with semantic search
const keywordResults = await context.db.Article.where({
  OR: [{ title: { contains: query } }, { content: { contains: query } }],
}).all()

const semanticResults = await context.db.Article.nearest('contentEmbedding', queryVector)

// Merge and deduplicate results
```

### Find Similar Items

```typescript
// Find articles similar to a given article
const article = await context.db.Article.where({ id: { equals: id } }).first()
// `null` is either "no such row" or "the Access Filter denied it" — an
// access-controlled read never says which, so guard before dereferencing.
const stored = article?.contentEmbedding

const similar = stored
  ? await context.db.Article.where({ id: { not: id } }).nearest('contentEmbedding', stored.vector, {
      limit: 5,
    })
  : []
```

## Testing

```typescript
// packages/rag/src/providers/providers.test.ts
import { describe, it, expect } from 'vitest'
import { createOpenAIProvider } from './openai.js'

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
5. Apply the schema change. Which command that is depends on where the database
   is — see "Applying the change" below
6. Embeddings are generated from the source text on create and update

### Applying the change

`opensaas db update` (`pnpm db:update`) is **not** a standalone migrate command.
It opens no connection of its own: it hands the request to a **running
`opensaas dev` loop** over that loop's control channel, and exits non-zero with
`NoDevLoopError` when none is listening (`packages/cli/src/commands/db.ts`). So
the route differs by where you are.

**Locally, the loop applies it.** Run `pnpm dev`. It generates and reconciles on
boot, and again on every save of `opensaas.config.ts`
(`packages/cli/src/commands/dev.ts`). Which database it reconciles is one rule:
`DATABASE_URL` set means no Dev database starts and the loop uses the one you
named — which is the route to an existing app's own Postgres. Leave it unset and
you get the Dev database the loop starts for you. `pnpm db:update` is for the one
case the loop declines to decide by itself, below.

**In a deployment there is no loop, so `db:update` has nothing to talk to.** Plan
the migration once against a database you are willing to open a planning
connection to, commit the result, then apply it: `prisma migration plan`, then
`prisma db migrate`. The starter templates wire these as `pnpm migrate` and
`pnpm migrate:deploy`; the RAG examples carry no such script, so run the Prisma
commands. See [Deploy](https://stack.opensaas.au/docs/how-to/deploy).

Either route runs the pgvector space's `CREATE EXTENSION IF NOT EXISTS`, which
needs the extension available on the server and the create privilege (see
"Provisioning pgvector" above).

### Changing a field's dimension

The dimension is the column's type, so changing it retypes the column and a
stored vector of the old width does not survive. That makes it a **destructive
plan**, and the dev loop will not apply one unasked: on save it prints the plan,
leaves the database and the running app on the old schema, and tells you to
consent from a second terminal (`packages/cli/src/commands/dev.ts`). With the
loop still running:

```bash
pnpm db:update --confirm postgres
```

The token is the name of the database being changed — that is what Prisma asks
for before it destroys data, and the Dev database's name is `postgres`. The loop
stages its own generation, so there is no separate `pnpm generate` step. In a
deployment, apply it as a migration instead (see "Applying the change" above).

Every affected row is then left with a null embedding. There is no re-embedding
command (#1271); what regenerates one is re-saving the row's source field, which
works because a null vector reads back as no stored embedding at all, so the
`sourceHash` gate has nothing to match and does not short-circuit.

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
