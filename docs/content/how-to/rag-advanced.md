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

```typescript
// What happens internally
ragPlugin({
  provider: openaiEmbeddings({ apiKey: '...' }),
})

// Plugin scans config and finds:
content: searchable(text(), { provider: 'openai', dimensions: 1536 })

// Plugin injects the companion field:
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
  output through a `sudo()` context that the hook reaches by way of a
  module-private symbol — not through anything on the package's exported surface
  (ADR-0045).

**On create and on update:**

1. The write commits.
2. The hook reads the **persisted** source text, so a value a `resolveInput`
   hook derived is embedded like any other.
3. It hashes that text and compares it with the `sourceHash` stored on the
   existing embedding's metadata. Equal means nothing to do — this is what stops
   the plugin's own write from re-entering, and what stops an unrelated field
   change from costing an API call.
4. Otherwise it calls the provider and writes the vector and its metadata under
   `sudo`.

```typescript
// Simplified hook implementation
afterTransaction: async ({ status, operation, item, context }) => {
  if (status !== 'committed') return
  if (operation !== 'create' && operation !== 'update') return

  const sourceText = item[sourceField]
  if (typeof sourceText !== 'string' || sourceText.length === 0) return

  const sourceHash = hashText(sourceText)
  if (item[fieldName]?.metadata?.sourceHash === sourceHash) return

  const vector = await provider.embed(sourceText)

  await writeUnderSudo(listName, item.id, fieldName, {
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

// Register the provider
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

// Export helper
export function cohereEmbeddings(config: Omit<CohereConfig, 'type'>): CohereConfig {
  return { type: 'cohere', ...config }
}
```

**Usage:**

```typescript
import { config } from '@opensaas/stack-core'
import { ragPlugin } from '@opensaas/stack-rag'
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
  // ... lists
})
```

### Example: HuggingFace Provider

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
    const response = await this.client.featureExtraction({
      model: this.model,
      inputs: text,
    })
    return Array.from(response as number[])
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // HuggingFace doesn't have batch API, so we process individually
    const embeddings = await Promise.all(texts.map((text) => this.embed(text)))
    return embeddings
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
  chunkSize: 1000, // Max characters per chunk
  chunkOverlap: 200, // Overlap between chunks
})
```

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
const chunks = chunkText(document, {
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
const chunks = chunkText(document, {
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

Respects token limits for embedding models. Best for API cost optimization.

```typescript
const chunks = chunkText(document, {
  strategy: 'token-aware',
  tokenLimit: 512, // Max tokens per chunk (not characters)
  chunkOverlap: 50, // Overlap in tokens
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

// Chunk long document
const chunks = chunkText(longDocument, {
  strategy: 'recursive',
  chunkSize: 1000,
  chunkOverlap: 200,
})

// Generate embeddings for each chunk
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

// Store chunks in database, all in one transaction
await context.transaction(async (tx) => {
  for (const ce of chunkEmbeddings) {
    await tx.db.DocumentChunk.create({
      data: {
        documentId: documentId,
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
  }
})
```

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

Known limits: `@prisma/orm-extension-pgvector@8.0.0-rc.8` registers no index
types, so a declaration derives the column type and the operator class and is
not yet lowered to a `CREATE INDEX`
([#1265](https://github.com/OpenSaasAU/stack/issues/1265)). Searches are correct
without one; they are unindexed scans until the pack ships index support.

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

Combine traditional keyword search with semantic search for best results.

```typescript
// lib/hybrid-search.ts
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'
import { getContext } from '@/.opensaas/context'

export async function hybridSearch(
  query: string,
  options: { limit?: number; alpha?: number } = {},
) {
  const { limit = 10, alpha = 0.7 } = options // alpha: semantic weight (0-1)
  const context = await getContext()

  // 1. Keyword search
  const keywordResults = await context.db.Article.where({
    OR: [{ title: { contains: query } }, { content: { contains: query } }],
  })
    .limit(limit * 2)
    .all()

  // 2. Semantic search
  const provider = createEmbeddingProvider({
    type: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
  })
  const queryVector = await provider.embed(query)

  const semanticResults = await context.db.Article.nearest('contentEmbedding', queryVector, {
    limit: limit * 2,
  })

  // 3. Merge results with weighted scoring
  const scoreMap = new Map()

  keywordResults.forEach((item) => {
    scoreMap.set(item.id, {
      item,
      keywordScore: 1.0, // Present in keyword results
      semanticScore: 0,
    })
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

  // 4. Calculate hybrid scores and sort
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

  // Search each embedding field. Every field here names the same provider, so
  // one query vector fits all three columns — a field on a different provider
  // needs its own vector, because the provider fixes the column's width.
  const [titleResults, summaryResults, contentResults] = await Promise.all([
    context.db.Article.nearest('titleEmbedding', queryVector, { limit: 10 }),
    context.db.Article.nearest('summaryEmbedding', queryVector, { limit: 10 }),
    context.db.Article.nearest('contentEmbedding', queryVector, { limit: 10 }),
  ])

  // Combine and deduplicate
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

  addResults(titleResults, 1.5) // Higher weight for title matches
  addResults(summaryResults, 1.2)
  addResults(contentResults, 1.0)

  return Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
}
```

## Production Best Practices

### 1. Error Handling

Handle embedding generation failures gracefully:

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

      // Wait before retry (exponential backoff)
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, i)))
    }
  }

  // Log to monitoring service
  await logToSentry('Embedding generation failed after retries', {
    text: text.substring(0, 100),
    error: lastError,
  })

  // Return null instead of throwing (allows item creation to succeed)
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

  const articles = await context.db.Article.findMany({
    select: {
      id: true,
      title: true,
      contentEmbedding: true,
    },
  })

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

```typescript
// __tests__/integration/search.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { getContext } from '@/.opensaas/context'
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'

describe('Semantic Search', () => {
  beforeAll(async () => {
    // `sudo()` returns a context that bypasses access control, so the seed
    // does not depend on the fixture's session.
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
    // A cosine column scores the raw cosine, so this is a genuinely tight bound.
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
