# RAG Advanced Patterns

This guide covers advanced RAG patterns, custom implementations, performance optimization, and production best practices.

## Architecture Deep Dive

### How Automatic Embedding Generation Works

The RAG plugin uses the Stack hooks system to automatically generate embeddings when content changes.

#### Plugin Initialization

When you add `ragPlugin()` to your config, it:

1. **Declares the pgvector extension pack**, so no app config names it
2. **Scans field definitions** for `searchable()` wrappers or `embedding()` fields with `sourceField`
3. **Resolves each field's dimension** from its provider, where the field declared none
4. **Injects an `afterTransaction` hook** into the lists that own those fields
5. **Registers MCP tools** (if enabled)

Concretely: given this plugin and this field,

```typescript
ragPlugin({
  provider: openaiEmbeddings({ apiKey: '...' }),
})

content: searchable(text(), { provider: 'openai', dimensions: 1536 })
```

the plugin injects a companion field beside `content` equivalent to:

```typescript
contentEmbedding: embedding({
  sourceField: 'content',
  provider: 'openai',
  dimensions: 1536,
  autoGenerate: true,
})
```

#### Embedding Generation Flow

The embedding is written **after** the write's transaction commits, not on input.
Two things drive that:

- Calling the provider is a network round trip, and a round trip has no business
  holding a database connection open inside a transaction.
- The column is write-denied to application code, so the plugin writes its own
  columns past that denial, through core's `writePluginOwnedField` reached by way
  of a module-private symbol — not through anything on the package's exported
  surface (ADR-0045). That write runs **no** hook of the list's: it carries the
  embedding column alone, so re-running `resolveInput` over it would recompute a
  derived field from input that is not there (ADR-0066).

**On create and on update:**

1. The write commits.
2. The hook reads the **persisted** source text, so a value a `resolveInput`
   hook derived is embedded like any other.
3. It hashes that text and compares it with the `sourceHash` stored on the
   existing embedding's metadata. Equal means nothing to do, which is what stops
   an unrelated field change from costing an API call. (Re-entry is not what it
   guards: the plugin's write fires no hook, so there is nothing to re-enter.)
4. Otherwise it calls the provider and writes the vector and its metadata to the
   columns.

Simplified, that is: the writer closes over the context `runtime` is handed and
is published on `context.plugins`, and the hook looks it up rather than writing
with its own context.

```typescript
runtime: (context) => ({
  [WRITE_EMBEDDING]: async (listName, id, fieldName, value) =>
    await writePluginOwnedField({ context, listName, id, fieldName, value }),
}),

afterTransaction: async (args) => {
  // `item` is on the committed create/update members only — the rolled-back
  // and delete members do not carry it — so narrow before destructuring. Even
  // there it is `undefined` for a nested list, which is the second check.
  if (args.status !== 'committed') return
  if (args.operation !== 'create' && args.operation !== 'update') return

  const { item, context } = args
  if (item === undefined) return

  const sourceText = item[sourceField]
  if (typeof sourceText !== 'string' || sourceText.length === 0) return

  const sourceHash = hashText(sourceText)
  if (item[fieldName]?.metadata?.sourceHash === sourceHash) return

  const vector = await provider.embed(sourceText)

  const write = embeddingWriter(context)

  await write(listName, item.id, fieldName, {
    vector,
    metadata: {
      model: provider.model,
      provider: provider.type,
      dimensions: provider.dimensions,
      generatedAt: new Date().toISOString(),
      sourceHash,
    },
  })
}
```

The hook's own context is used to _find_ the writer, never to write with. That
indirection is load-bearing, and a plugin that collapses it breaks under
`context.transaction()`. The `context` the write itself uses is the `AccessContext`
`Plugin.runtime` receives as its **first** argument — not the `StackContext`
`getContext` returns, and not `sudo()`, both of which carry no ORM handle and are
refused by name. The `context` the hook is handed is a different object: inside
`context.transaction(...)` its ORM handle is bound to the transaction client, and
`afterTransaction` drains **after** that transaction settles — so passing it
straight to `writePluginOwnedField` issues the escalated `UPDATE` on a handle
that is already closed. Plugin runtimes are not re-run for a transaction-bound
context, so the writer found on it is still the one holding the runtime-time
context, which is why the lookup is safe where the direct pass is not.

The field's column layout is read off the config the runtime-time context was
built from, so the write reaches `listName.fieldName`'s own columns and nothing
else; a field the config does not declare, and an `undefined` value, are refused
rather than resolved.

Known limits, because the row is already committed by the time this runs:

- A **nested** record is never embedded — the hook carries a persisted item for
  the top-level record only ([#1271](https://github.com/OpenSaasAU/stack/issues/1271)).
- A provider failure is **logged, not thrown**. The caller's write did succeed,
  and reporting it as a failure would invite a retry that duplicates the row. The
  row keeps a null embedding, and there is no regeneration path yet.

### Provider Registry Pattern

The RAG package uses a registry pattern for embedding providers, making it easy to add custom providers.

A factory is keyed by `type` and receives the whole config union, which is what
makes the narrowing below necessary:

```typescript
import type { EmbeddingProviderConfig } from '@opensaas/stack-rag'
import type { EmbeddingProvider } from '@opensaas/stack-rag/providers'

type ProviderFactory = (config: EmbeddingProviderConfig) => EmbeddingProvider

const providerFactories = new Map<string, ProviderFactory>()
```

`EmbeddingProviderConfig`'s third member is `CustomEmbeddingConfig`, an open
`{ type: string; [key: string]: unknown }`, so a factory cannot assume it was
handed the config shape matching its own key — `config.type === 'openai'` does
not narrow the union past that open member. Read a member off the union and you
get `TS2345`; the examples below narrow with `in` first.

`createEmbeddingProvider()` closes the same gap at the call site by intersecting
its argument (`<TConfig extends EmbeddingProviderConfig>(config: TConfig &
BuiltInConfigFor<TConfig>)`), so a literal naming a built-in provider must
satisfy that provider's own config even though the union alone would accept it.

Users can register custom providers:

```typescript
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

### Access Control Enforcement

Search is not a separate code path with its own scoping. `nearest()` is a
terminal on the same secured read surface as `all()` and `first()`, so the
Access Filter, Field Visibility and the list's `query` rule apply to it
unchanged:

```typescript
import { getContext } from '@/.opensaas/context'

const context = await getContext({ userId: 'user-123' })

const matches = await context.db.Article.where({
  published: { equals: true }, // the caller's own filter
}).nearest('contentEmbedding', queryVector, { limit: 10, minScore: 0.2 })
```

Two properties follow from that, and both matter for correctness rather than
tidiness:

- **The top-K is computed over the rows the session may see.** The ranking, the
  `limit` and the `minScore` bound are all lowered into one query alongside the
  Access Filter. Nothing is fetched wide and trimmed afterwards, so there is no
  over-fetch multiplier to tune and no way for a denied row to displace a
  visible one out of the result window.
- **`minScore` is a distance bound, not a post-filter.** It is inverted into the
  column's own distance function before the query runs.

Searching a field requires read access to that field: ordering by a vector
measures its contents, so a session that cannot read the column is refused
exactly as it would be for a field the list does not declare.

## Custom Embedding Providers

Creating custom embedding providers allows you to use any embedding model or service.

### Provider Interface

```typescript
interface EmbeddingProvider {
  readonly type: string // Provider identifier
  readonly model: string // Model name
  readonly dimensions: number // Vector dimensions

  // Generate single embedding
  embed(text: string): Promise<number[]>

  // Generate batch embeddings. Required — chunked fields call it directly.
  embedBatch(texts: string[]): Promise<number[][]>
}
```

### Example: Cohere Provider

```typescript
// lib/providers/cohere.ts
import { Cohere } from 'cohere-ai'
import { registerEmbeddingProvider } from '@opensaas/stack-rag/providers'

interface CohereConfig {
  type: 'cohere'
  apiKey: string
  model?: string
}

class CohereEmbeddingProvider {
  type = 'cohere'
  model: string
  dimensions: number
  private client: Cohere

  constructor(config: CohereConfig) {
    this.client = new Cohere({ apiKey: config.apiKey })
    this.model = config.model || 'embed-english-v3.0'
    this.dimensions = 1024 // embed-english-v3.0 dimensions
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embed({
      texts: [text],
      model: this.model,
      inputType: 'search_query',
    })
    return response.embeddings[0]
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await this.client.embed({
      texts,
      model: this.model,
      inputType: 'search_document',
    })
    return response.embeddings
  }
}

registerEmbeddingProvider('cohere', (config) => {
  if (!('apiKey' in config) || typeof config.apiKey !== 'string') {
    throw new Error('cohere embeddings require an apiKey')
  }
  return new CohereEmbeddingProvider({
    type: 'cohere',
    apiKey: config.apiKey,
    model: typeof config.model === 'string' ? config.model : undefined,
  })
})

export function cohereEmbeddings(config: Omit<CohereConfig, 'type'>): CohereConfig {
  return { type: 'cohere', ...config }
}
```

**Usage:**

```typescript
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { ragPlugin } from '@opensaas/stack-rag'
import { searchable } from '@opensaas/stack-rag/fields'
import { cohereEmbeddings } from '@/lib/providers/cohere'

export default config({
  plugins: [
    ragPlugin({
      provider: cohereEmbeddings({
        apiKey: process.env.COHERE_API_KEY!,
        model: 'embed-english-v3.0',
      }),
    }),
  ],
  db: { provider: 'postgresql' },
  lists: {
    Article: list({
      fields: { content: searchable(text(), { dimensions: 1024 }) },
      access: { operation: { query: () => true } },
    }),
  },
})
```

### Example: HuggingFace Provider

HuggingFace's inference API has no batch endpoint for feature extraction, so
`embedBatch` fans out over `embed`. `featureExtraction` also returns a nested
shape for some models, so the vector is narrowed rather than cast:

```typescript
// lib/providers/huggingface.ts
import { HfInference } from '@huggingface/inference'
import { registerEmbeddingProvider } from '@opensaas/stack-rag/providers'

interface HuggingFaceConfig {
  type: 'huggingface'
  apiKey: string
  model?: string
  dimensions: number
}

class HuggingFaceEmbeddingProvider {
  type = 'huggingface'
  model: string
  dimensions: number
  private client: HfInference

  constructor(config: HuggingFaceConfig) {
    this.client = new HfInference(config.apiKey)
    this.model = config.model || 'sentence-transformers/all-MiniLM-L6-v2'
    this.dimensions = config.dimensions
  }

  async embed(text: string): Promise<number[]> {
    const response: unknown = await this.client.featureExtraction({
      model: this.model,
      inputs: text,
    })
    if (!Array.isArray(response) || !response.every((n) => typeof n === 'number')) {
      throw new Error(`${this.model} did not return a flat embedding vector`)
    }
    return response
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return await Promise.all(texts.map((text) => this.embed(text)))
  }
}

registerEmbeddingProvider('huggingface', (config) => {
  if (
    !('apiKey' in config) ||
    typeof config.apiKey !== 'string' ||
    !('dimensions' in config) ||
    typeof config.dimensions !== 'number'
  ) {
    throw new Error('huggingface embeddings require an apiKey and dimensions')
  }
  return new HuggingFaceEmbeddingProvider({
    type: 'huggingface',
    apiKey: config.apiKey,
    dimensions: config.dimensions,
    model: typeof config.model === 'string' ? config.model : undefined,
  })
})

export function huggingfaceEmbeddings(config: Omit<HuggingFaceConfig, 'type'>): HuggingFaceConfig {
  return { type: 'huggingface', ...config }
}
```

## Text Chunking Strategies

For long documents, chunking text before generating embeddings improves search quality and manages token limits.

### Chunking Strategies

The RAG package provides four built-in chunking strategies:

#### 1. Recursive Chunking

Respects document structure (paragraphs, sentences). Best for general use.

```typescript
import { chunkText } from '@opensaas/stack-rag/runtime'

const chunks = chunkText(longDocument, {
  strategy: 'recursive',
  chunkSize: 1000,
  chunkOverlap: 200,
})
```

`chunkSize` and `chunkOverlap` are in characters here.

**How it works:**

1. Split by paragraphs (`\n\n`)
2. If paragraph too long, split by sentences (`. `)
3. If sentence too long, split by words
4. Combine chunks to target size
5. Add overlap for context

**Best for:**

- Articles, blog posts
- Documentation
- General text content

#### 2. Sentence-Based Chunking

Preserves sentence boundaries. Best for maintaining semantic coherence.

```typescript
const chunks = chunkText(longDocument, {
  strategy: 'sentence',
  chunkSize: 500,
  chunkOverlap: 100,
})
```

**How it works:**

1. Split by sentences (`. `, `! `, `? `)
2. Combine sentences to target size
3. Add overlap of full sentences

**Best for:**

- Technical documentation
- Legal text
- Content where sentence integrity matters

#### 3. Sliding Window Chunking

Fixed-size windows that slide across text. Best for uniform processing.

```typescript
const chunks = chunkText(longDocument, {
  strategy: 'sliding-window',
  chunkSize: 800,
  chunkOverlap: 200,
})
```

**How it works:**

1. Create fixed-size windows
2. Slide by `chunkSize - chunkOverlap`
3. Each chunk overlaps with previous

**Best for:**

- Transcripts
- Continuous prose
- When uniform chunk sizes matter

#### 4. Token-Aware Chunking

Respects token limits for embedding models. Best for API cost optimization. This
is the one strategy where `chunkOverlap` counts tokens rather than characters,
and the only one that reads `tokenLimit`.

```typescript
const chunks = chunkText(longDocument, {
  strategy: 'token-aware',
  tokenLimit: 512,
  chunkOverlap: 50,
})
```

**How it works:**

1. Estimates tokens using character count (1 token ≈ 4 characters)
2. Splits to stay under token limit
3. Respects sentence boundaries when possible

**Best for:**

- OpenAI embeddings (8191 token limit)
- Cost optimization
- Large documents

### Using Chunking with Embeddings

#### Automatic Chunking in Field Definition

```typescript
content: searchable(text(), {
  provider: 'openai',
  dimensions: 1536,
  chunking: {
    strategy: 'recursive',
    maxTokens: 250,
    overlap: 50,
  },
})
```

A field's `chunking` is a `ChunkingConfig`, measured in **tokens** — not the
`ChunkingOptions` that `chunkText()` above takes. They are separate types, and
`ChunkingOptions` does not have one unit: `chunkSize` and `chunkOverlap` are
characters under `recursive`, `sentence` and `sliding-window`, and tokens under
`token-aware`, which scales them by the same ~4 characters per token. At that
ratio, `maxTokens: 250` is about the same span of text as a recursive
`chunkSize: 1000`.

**How it works:**

- Long content automatically chunked before embedding
- Each chunk gets its own embedding
- Multiple embeddings stored per document
- Searches find best matching chunks

#### Manual Chunking for Custom Workflows

A chunk row's vector is written by your code rather than by the plugin, so the
field has to say so. Without `allowManualWrites`, `embedding()` denies writes and
the create below throws `Cannot create "embedding": field-level access denied.`:

```typescript
DocumentChunk: list({
  fields: {
    document: relationship({ ref: 'Document' }),
    chunkIndex: integer(),
    content: text(),
    embedding: embedding({ dimensions: 1536, allowManualWrites: true }),
    startOffset: integer(),
    endOffset: integer(),
  },
}),
```

```typescript
import { chunkText } from '@opensaas/stack-rag/runtime'
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'

const provider = createEmbeddingProvider({
  type: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
})

const chunks = chunkText(longDocument, {
  strategy: 'recursive',
  chunkSize: 1000,
  chunkOverlap: 200,
})

const chunkEmbeddings = await Promise.all(
  chunks.map(async (chunk, index) => {
    const embedding = await provider.embed(chunk.text)
    return {
      chunkIndex: index,
      chunkText: chunk.text,
      embedding,
      startOffset: chunk.start,
      endOffset: chunk.end,
    }
  }),
)

await context.transaction(async (tx) => {
  for (const ce of chunkEmbeddings) {
    const row = await tx.db.DocumentChunk.create({
      data: {
        document: { connect: { id: documentId } },
        chunkIndex: ce.chunkIndex,
        content: ce.chunkText,
        embedding: {
          vector: ce.embedding,
          metadata: {
            model: provider.model,
            provider: provider.type,
            dimensions: provider.dimensions,
            generatedAt: new Date().toISOString(),
          },
        },
        startOffset: ce.startOffset,
        endOffset: ce.endOffset,
      },
    })
    if (row === null) {
      throw new Error('Not allowed to write a document chunk')
    }
  }
})
```

Every row goes in under one `context.transaction`, so a failure part-way leaves
no half-chunked document behind. `create` returns `null` when the write is
denied — throwing inside the callback rolls the whole transaction back. The
`document` edge is written as `{ connect: { id } }`; writing the `documentId`
column directly is equally valid, but spelling both in one payload is refused.

## Performance Optimization

### 1. Vector Indexing

A vector index is declared on the field that owns the column, not written as
SQL. The column type and the operator class are derived from the same place the
dimension and the distance function are declared, so the two cannot drift apart:

```typescript
contentEmbedding: embedding({
  sourceField: 'content',
  dimensions: 1536,
  distanceFunction: 'cosine',
  index: { method: 'hnsw', m: 16, efConstruction: 64 },
})
```

**Index guidelines:**

- **`ivfflat`** — faster to build, good for 10k–1M vectors. Set `lists` to about
  `sqrt(total_rows)`.
- **`hnsw`** — better search quality, good for 100k+ vectors. A higher `m` buys
  quality with memory (default 16); a higher `efConstruction` buys index quality
  with build time (default 64).
- Declaring an index caps the dimension: over 2,000 the column becomes
  `halfvec`, and over 4,000 generation fails, because no pgvector index can be
  built there. An **unindexed** column stays `vector` at any dimension.
- Declaring an `opclass` that disagrees with the field's `distanceFunction`
  fails `pnpm generate` rather than building an index the search cannot use.

No index is actually built today, so every search is an exact scan — correct,
but unindexed. [Search exactness](/docs/reference/rag) has the pack limit behind
that, and what a built index would change about how many rows come back.

### 2. Batch Embedding Generation

Generate embeddings in batches to reduce API overhead and respect rate limits.

```typescript
import { batchProcess } from '@opensaas/stack-rag/runtime'
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'

const provider = createEmbeddingProvider({
  type: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
})

const result = await batchProcess({
  provider,
  texts: largeArrayOfTexts,
  batchSize: 20, // Process 20 at a time
  rateLimit: 60, // 60 requests per minute
  onProgress: (progress) => {
    console.log(`Progress: ${progress.percentage}% (${progress.processed}/${progress.total})`)
  },
})

console.log(`Processed: ${result.stats.successful}`)
console.log(`Failed: ${result.stats.failed}`)
```

### 3. Embedding Caching

The RAG package automatically caches embeddings using source hash comparison. You can enhance this with application-level caching.

```typescript
// lib/embedding-cache.ts
const embeddingCache = new Map<string, number[]>()

export async function getCachedEmbedding(text: string, provider: EmbeddingProvider) {
  const hash = hashText(text)

  // Check cache
  if (embeddingCache.has(hash)) {
    return embeddingCache.get(hash)!
  }

  // Generate and cache
  const embedding = await provider.embed(text)
  embeddingCache.set(hash, embedding)

  return embedding
}

// Add TTL for cache eviction
export function clearEmbeddingCache() {
  embeddingCache.clear()
}
```

### 4. Search Optimization

Optimize search queries with filters and limits:

```typescript
// ❌ Bad: no filters, large limit
const matches = await context.db.Article.nearest('contentEmbedding', queryVector, {
  limit: 100, // Too many results
})

// ✅ Good: filters, reasonable limit, a bound on the score
const matches = await context.db.Article.where({
  published: { equals: true },
  createdAt: { gte: oneMonthAgo },
}).nearest('contentEmbedding', queryVector, {
  limit: 10,
  minScore: 0.25, // Only high-quality matches, on a cosine column
})
```

Both the `where` and the `minScore` are lowered into the same query as the
ranking, so narrowing the search genuinely narrows the work the database does.
Filtering on `createdAt` assumes the list has it: auto-timestamps are off by
default (ADR-0004), so `Article` here either declares the field or sets
`db: { timestamps: true }`.
Pick `minScore` on the column's own scale — a `cosine` column scores the raw
cosine on `[-1, 1]`, so `0.7` is tight and `0` is merely "more alike than
opposite".

### 5. Pre-compute Embeddings

For frequently searched content, pre-compute embeddings at build time or during seeding.

```typescript
// scripts/precompute-embeddings.ts
import { getContext } from '@/.opensaas/context'
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'

const commonQueries = [
  'How do I get started?',
  'What is access control?',
  'How does RAG work?',
  // ... more common queries
]

async function precomputeQueryEmbeddings() {
  const provider = createEmbeddingProvider({
    type: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
  })

  const embeddings = await Promise.all(
    commonQueries.map(async (query) => ({
      query,
      embedding: await provider.embed(query),
    })),
  )

  // Store in database or cache
  await saveToCache(embeddings)
}
```

## Advanced Patterns

### Hybrid Search (Keyword + Semantic)

Combine traditional keyword search with semantic search for best results. Four
steps: a `contains` read for keywords, a `nearest()` ranking for meaning, a merge
keyed on id, then a weighted sort where `alpha` is the semantic weight on `[0, 1]`.

`contains` is case-insensitive — it lowers to `ilike` — and the vocabulary has no
`startsWith` or `mode`, so a keyword pass is `contains` or nothing.

```typescript
// lib/hybrid-search.ts
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'
import { getContext } from '@/.opensaas/context'

type Scored<TRow> = { item: TRow; keywordScore: number; semanticScore: number }

export async function hybridSearch(
  query: string,
  options: { limit?: number; alpha?: number } = {},
) {
  const { limit = 10, alpha = 0.7 } = options
  const context = await getContext()

  const keywordResults = await context.db.Article.where({
    OR: [{ title: { contains: query } }, { content: { contains: query } }],
  })
    .limit(limit * 2)
    .all()

  const provider = createEmbeddingProvider({
    type: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
  })
  const queryVector = await provider.embed(query)

  const semanticResults = await context.db.Article.nearest('contentEmbedding', queryVector, {
    limit: limit * 2,
  })

  const scoreMap = new Map<string, Scored<(typeof keywordResults)[number]>>()

  keywordResults.forEach((item) => {
    scoreMap.set(item.id, { item, keywordScore: 1, semanticScore: 0 })
  })

  semanticResults.forEach((result) => {
    const existing = scoreMap.get(result.item.id)
    if (existing) {
      existing.semanticScore = result.score
    } else {
      scoreMap.set(result.item.id, {
        item: result.item,
        keywordScore: 0,
        semanticScore: result.score,
      })
    }
  })

  const hybridResults = Array.from(scoreMap.values())
    .map((entry) => ({
      item: entry.item,
      score: alpha * entry.semanticScore + (1 - alpha) * entry.keywordScore,
      keywordScore: entry.keywordScore,
      semanticScore: entry.semanticScore,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return hybridResults
}
```

### Re-ranking with Cross-Encoders

Improve search quality by re-ranking results with a cross-encoder model.

```typescript
// lib/rerank.ts
import { HfInference } from '@huggingface/inference'
import type { SearchResult } from '@opensaas/stack-rag'

const hf = new HfInference(process.env.HUGGINGFACE_API_KEY!)

export async function rerankResults<T extends { id: string; content: string }>(
  query: string,
  results: SearchResult<T>[],
  topK = 5,
) {
  // Generate pairs of (query, document)
  const pairs = results.map((result) => ({
    id: result.item.id,
    text: result.item.content,
  }))

  // Score pairs with cross-encoder
  const scores = await Promise.all(
    pairs.map(async (pair) => {
      const response = await hf.textClassification({
        model: 'cross-encoder/ms-marco-MiniLM-L-6-v2',
        inputs: {
          source_sentence: query,
          sentences: [pair.text],
        },
      })
      return {
        id: pair.id,
        score: response[0].score,
      }
    }),
  )

  // Re-rank by cross-encoder scores
  const reranked = results
    .map((result) => {
      const score = scores.find((s) => s.id === result.item.id)
      return {
        ...result,
        rerankScore: score?.score || 0,
      }
    })
    .sort((a, b) => b.rerankScore - a.rerankScore)
    .slice(0, topK)

  return reranked
}
```

### Multi-Vector per Document

Store multiple embeddings per document (e.g., title, summary, content) for better search.

```typescript
// opensaas.config.ts
lists: {
  Article: list({
    fields: {
      title: text(),
      titleEmbedding: embedding({
        sourceField: 'title',
        provider: 'openai',
        dimensions: 1536,
      }),
      summary: text(),
      summaryEmbedding: embedding({
        sourceField: 'summary',
        provider: 'openai',
        dimensions: 1536,
      }),
      content: text(),
      contentEmbedding: embedding({
        sourceField: 'content',
        provider: 'openai',
        dimensions: 1536,
      }),
    },
  }),
}
```

**Querying multiple embeddings:**

Every field above names the same provider, so one query vector fits all three
columns. A field on a different provider needs its own vector — the provider
fixes the column's width, and a vector of the wrong length is refused.

```typescript
import type { NearestMatch } from '@opensaas/stack-core'
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'
import { getContext } from '@/.opensaas/context'

async function multiVectorSearch(query: string) {
  const context = await getContext()

  const provider = createEmbeddingProvider({
    type: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
  })
  const queryVector = await provider.embed(query)

  const [titleResults, summaryResults, contentResults] = await Promise.all([
    context.db.Article.nearest('titleEmbedding', queryVector, { limit: 10 }),
    context.db.Article.nearest('summaryEmbedding', queryVector, { limit: 10 }),
    context.db.Article.nearest('contentEmbedding', queryVector, { limit: 10 }),
  ])

  const scoreMap = new Map<string, { item: { id: string }; score: number }>()

  const addResults = (results: NearestMatch<{ id: string }>[], weight: number) => {
    results.forEach((r) => {
      const existing = scoreMap.get(r.item.id)
      const score = r.score * weight
      if (existing) {
        existing.score = Math.max(existing.score, score)
      } else {
        scoreMap.set(r.item.id, { item: r.item, score })
      }
    })
  }

  addResults(titleResults, 1.5)
  addResults(summaryResults, 1.2)
  addResults(contentResults, 1.0)

  return Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
}
```

The weights above bias towards title matches, then summary, then body.

## Production Best Practices

### 1. Error Handling

Handle embedding generation failures gracefully. The helper below retries with
exponential backoff, reports the exhausted case to your monitoring service, and
then returns `null` rather than throwing — so a provider outage degrades the
embedding instead of failing the write that triggered it.

```typescript
// hooks/embedding-error-handling.ts
import type { EmbeddingProvider } from '@opensaas/stack-rag/providers'

async function generateEmbeddingWithRetry(text: string, provider: EmbeddingProvider) {
  const maxRetries = 3
  let lastError: Error | undefined

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await provider.embed(text)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      console.error(`Embedding generation failed (attempt ${i + 1}/${maxRetries}):`, error)

      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, i)))
    }
  }

  await logToSentry('Embedding generation failed after retries', {
    text: text.substring(0, 100),
    error: lastError,
  })

  return null
}
```

### 2. Monitoring and Logging

Track embedding generation and search performance:

```typescript
// lib/rag-monitoring.ts
import type { EmbeddingProvider } from '@opensaas/stack-rag/providers'

export async function monitoredEmbedGeneration(text: string, provider: EmbeddingProvider) {
  const startTime = Date.now()

  try {
    const embedding = await provider.embed(text)
    const duration = Date.now() - startTime

    // Log metrics
    await logMetric('embedding.generation.success', {
      provider: provider.type,
      model: provider.model,
      textLength: text.length,
      duration,
    })

    return embedding
  } catch (error) {
    const duration = Date.now() - startTime

    await logMetric('embedding.generation.error', {
      provider: provider.type,
      model: provider.model,
      textLength: text.length,
      duration,
      error: error instanceof Error ? error.message : String(error),
    })

    throw error
  }
}
```

### 3. Rate Limiting

`RateLimiter` is a shipped export of `@opensaas/stack-rag/runtime`, so there is
nothing to write. It admits `requestsPerMinute` requests in any rolling minute
and `waitForSlot()` resolves when the next one is free:

```typescript
import { RateLimiter } from '@opensaas/stack-rag/runtime'
import type { EmbeddingProvider } from '@opensaas/stack-rag/providers'

const limiter = new RateLimiter(100)

export async function rateLimitedEmbed(text: string, provider: EmbeddingProvider) {
  await limiter.waitForSlot()
  return provider.embed(text)
}
```

### 4. Cost Optimization

Track and optimize API costs:

```typescript
// lib/cost-tracking.ts
import type { EmbeddingProvider } from '@opensaas/stack-rag/providers'

const COST_PER_1K_TOKENS: Record<string, number> = {
  'text-embedding-3-small': 0.00002,
  'text-embedding-3-large': 0.00013,
}

export function estimateEmbeddingCost(text: string, model: string) {
  const estimatedTokens = text.length / 4 // Rough estimate: 1 token ≈ 4 chars
  const costPer1K = COST_PER_1K_TOKENS[model] || 0
  return (estimatedTokens / 1000) * costPer1K
}

export async function trackEmbeddingCost(text: string, provider: EmbeddingProvider) {
  const cost = estimateEmbeddingCost(text, provider.model)

  await logMetric('embedding.cost', {
    model: provider.model,
    cost,
    textLength: text.length,
  })

  return cost
}
```

### 5. Backup and Recovery

Implement backup strategies for embeddings:

```typescript
// scripts/backup-embeddings.ts
import { getContext } from '@/.opensaas/context'
import { writeFile } from 'fs/promises'

export async function backupEmbeddings() {
  const context = await getContext()

  const articles = await context.db.Article.select('id', 'title', 'contentEmbedding').all()

  const backup = {
    timestamp: new Date().toISOString(),
    count: articles.length,
    embeddings: articles.map((a) => ({
      id: a.id,
      title: a.title,
      embedding: a.contentEmbedding,
    })),
  }

  await writeFile(`backups/embeddings-${Date.now()}.json`, JSON.stringify(backup, null, 2))

  console.log(`Backed up ${articles.length} embeddings`)
}
```

## Testing Strategies

### Unit Testing Providers

```typescript
// __tests__/providers/openai.test.ts
import { describe, it, expect } from 'vitest'
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'

describe('OpenAI Provider', () => {
  it('should generate embeddings', async () => {
    const provider = createEmbeddingProvider({
      type: 'openai',
      apiKey: process.env.OPENAI_API_KEY!,
    })

    const embedding = await provider.embed('Hello world')

    expect(embedding).toBeInstanceOf(Array)
    expect(embedding).toHaveLength(1536)
    expect(embedding[0]).toBeTypeOf('number')
  })

  it('should generate batch embeddings', async () => {
    const provider = createEmbeddingProvider({
      type: 'openai',
      apiKey: process.env.OPENAI_API_KEY!,
    })

    const embeddings = await provider.embedBatch(['Hello', 'World'])

    expect(embeddings).toHaveLength(2)
    expect(embeddings[0]).toHaveLength(1536)
    expect(embeddings[1]).toHaveLength(1536)
  })
})
```

### Integration Testing Search

The seed runs through `sudo()`, so it does not depend on the fixture's session.
The score assertion is on a cosine column, where the score is the raw cosine —
`0.7` is a genuinely tight bound there:

```typescript
// __tests__/integration/search.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { getContext } from '@/.opensaas/context'
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'

describe('Semantic Search', () => {
  beforeAll(async () => {
    const context = (await getContext()).sudo()

    await context.db.Article.create({
      data: {
        title: 'Machine Learning Basics',
        content: 'Machine learning is a subset of artificial intelligence...',
      },
    })
  })

  it('should find relevant articles', async () => {
    const context = await getContext()
    const query = 'What is AI?'

    const provider = createEmbeddingProvider({
      type: 'openai',
      apiKey: process.env.OPENAI_API_KEY!,
    })
    const queryVector = await provider.embed(query)

    const matches = await context.db.Article.nearest('contentEmbedding', queryVector, {
      limit: 5,
    })

    expect(matches.length).toBeGreaterThan(0)
    expect(matches[0].item.title).toContain('Machine Learning')
    expect(matches[0].score).toBeGreaterThan(0.7)
  })
})
```

## Troubleshooting

### High API Costs

**Symptoms:**

- Unexpectedly high OpenAI bills
- Many API calls for unchanged content

**Solutions:**

1. **Enable source hash comparison** (automatic in RAG plugin)
2. **Use Ollama for development**
3. **Implement application-level caching**
4. **Use batch processing** with `embedBatch()`
5. **Choose smaller model** (`text-embedding-3-small` vs `large`)

### Slow Search Performance

See [Performance Optimization](#performance-optimization) section above.

### Memory Issues with Large Datasets

**Symptoms:**

- Out of memory errors
- Slow application performance

**Solutions:**

1. **Bound every search** with `limit` and `minScore` — both are lowered into the query
2. **Declare an index** on the embedding field
3. **Select only the fields you need** with `.select()` so vectors are not materialised
4. **Limit embedding dimensions** (use smaller models)

### Inconsistent Search Results

**Symptoms:**

- Different results for same query
- Low-quality matches

**Solutions:**

1. **Verify embedding dimensions match** across provider and field
2. **Check for partial embeddings** (failed generation)
3. **Adjust the `minScore` threshold** — it is read on the column's own distance function, not a normalised 0–1 scale
4. **Consider hybrid search** (keyword + semantic)
5. **Try re-ranking** with cross-encoder

## Next Steps

- **[RAG Package Reference](/docs/reference/rag)** - Complete API documentation
- **[RAG Setup Guide](/docs/how-to/rag)** - Database configuration and getting started
- **[Stack Examples](https://github.com/OpenSaasAU/stack/tree/main/examples)** - Production-ready examples

You now have the knowledge to build advanced RAG implementations with Stack!
