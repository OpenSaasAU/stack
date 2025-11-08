# RAG Advanced Patterns

This guide covers advanced RAG patterns, custom implementations, performance optimization, and production best practices.

## Architecture Deep Dive

### How Automatic Embedding Generation Works

The RAG plugin uses the OpenSaas Stack hooks system to automatically generate embeddings when content changes.

#### Plugin Initialization

When you add `ragPlugin()` to your config, it:

1. **Scans field definitions** for `searchable()` wrappers or `embedding()` fields with `sourceField`
2. **Injects `resolveInput` hooks** into embedding fields
3. **Stores provider configuration** in plugin data
4. **Registers MCP tools** (if enabled)

```typescript
// What happens internally
ragPlugin({
  provider: openaiEmbeddings({ apiKey: '...' }),
  storage: pgvectorStorage(),
})

// Plugin scans config and finds:
content: searchable(text(), { provider: 'openai', dimensions: 1536 })

// Plugin automatically injects:
contentEmbedding: embedding({
  sourceField: 'content',
  provider: 'openai',
  dimensions: 1536,
  // Hook added by plugin:
  hooks: {
    resolveInput: async ({ resolvedData, operation, context }) => {
      // Generate embedding if content changed
    }
  }
})
```

#### Embedding Generation Flow

**On Create:**

1. User creates item with content
2. `resolveInput` hook intercepts
3. Checks if source field has value
4. Generates embedding via provider
5. Calculates source hash (SHA-256)
6. Returns embedding with metadata

**On Update:**

1. User updates item
2. `resolveInput` hook intercepts
3. Fetches current embedding from database
4. Compares source hash with current content
5. If changed: regenerate embedding
6. If unchanged: skip (avoid unnecessary API calls)

```typescript
// Simplified hook implementation
hooks: {
  resolveInput: async ({ resolvedData, operation, item, context }) => {
    // Get source text
    const sourceText = resolvedData[sourceField] || item?.[sourceField]
    if (!sourceText) return null

    // Check if regeneration needed
    const currentEmbedding = item?.[fieldName]
    const newHash = hashText(sourceText)

    if (currentEmbedding?.metadata?.sourceHash === newHash) {
      // Content unchanged, skip regeneration
      return currentEmbedding
    }

    // Generate new embedding
    const provider = getEmbeddingProvider(context)
    const vector = await provider.embed(sourceText)

    return {
      vector,
      metadata: {
        model: provider.model,
        provider: provider.type,
        dimensions: vector.length,
        generatedAt: new Date().toISOString(),
        sourceHash: newHash,
      },
    }
  },
}
```

### Provider Registry Pattern

The RAG package uses a registry pattern for embedding providers, making it easy to add custom providers.

```typescript
// Internal provider registry
const providerFactories = new Map<string, Factory>()

providerFactories.set('openai', (config) => new OpenAIEmbeddingProvider(config))
providerFactories.set('ollama', (config) => new OllamaEmbeddingProvider(config))

export function createEmbeddingProvider(config: EmbeddingProviderConfig) {
  const factory = providerFactories.get(config.type)
  if (!factory) {
    throw new Error(`Unknown provider type: ${config.type}`)
  }
  return factory(config)
}
```

Users can register custom providers:

```typescript
import { registerEmbeddingProvider } from '@opensaas/stack-rag/providers'

registerEmbeddingProvider('custom', (config) => {
  return {
    type: 'custom',
    model: config.model,
    dimensions: config.dimensions,
    async embed(text) {
      // Your implementation
      return vector
    },
    async embedBatch(texts) {
      // Batch implementation
      return vectors
    },
  }
})
```

### Storage Registry Pattern

Similar to providers, storage backends use a registry pattern:

```typescript
const storageFactories = new Map<string, Factory>()

storageFactories.set('json', () => new JsonVectorStorage())
storageFactories.set('pgvector', (config) => new PgVectorStorage(config))
storageFactories.set('sqlite-vss', (config) => new SqliteVssStorage(config))

export function createVectorStorage(config: VectorStorageConfig) {
  const factory = storageFactories.get(config.type)
  if (!factory) {
    throw new Error(`Unknown storage type: ${config.type}`)
  }
  return factory(config)
}
```

### Access Control Enforcement

All searches go through the access-controlled context, ensuring users only see content they have permission to view.

```typescript
async search(listKey, fieldName, queryVector, options) {
  const { context, where = {}, limit, minScore } = options
  const dbKey = getDbKey(listKey)
  const model = context.db[dbKey] // Uses access-controlled context

  // Fetch items (access control applied automatically)
  const items = await model.findMany({
    where, // User-provided filters
    // Access control filters merged automatically by context
  })

  // Calculate similarity and filter by minScore
  const results = items
    .map((item) => {
      const embedding = item[fieldName]
      if (!embedding?.vector) return null

      const score = cosineSimilarity(queryVector, embedding.vector)
      return { item, score, distance: 1 - score }
    })
    .filter((r) => r && r.score >= (minScore || 0))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return results
}
```

## Custom Embedding Providers

Creating custom embedding providers allows you to use any embedding model or service.

### Provider Interface

```typescript
interface EmbeddingProvider {
  type: string // Provider identifier
  model: string // Model name
  dimensions: number // Vector dimensions

  // Generate single embedding
  embed(text: string): Promise<number[]>

  // Generate batch embeddings (optional, but recommended)
  embedBatch?(texts: string[]): Promise<number[][]>
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
registerEmbeddingProvider('cohere', (config) => new CohereEmbeddingProvider(config))

// Export helper
export function cohereEmbeddings(config: Omit<CohereConfig, 'type'>): CohereConfig {
  return { type: 'cohere', ...config }
}
```

**Usage:**

```typescript
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

registerEmbeddingProvider('huggingface', (config) => new HuggingFaceEmbeddingProvider(config))

export function huggingfaceEmbeddings(
  config: Omit<HuggingFaceConfig, 'type'>
): HuggingFaceConfig {
  return { type: 'huggingface', ...config }
}
```

## Custom Storage Backends

Creating custom storage backends allows you to use any vector database or search service.

### Storage Interface

```typescript
interface VectorStorage {
  type: string // Storage identifier

  // Search for similar vectors
  search<T>(
    listKey: string,
    fieldName: string,
    queryVector: number[],
    options: SearchOptions
  ): Promise<SearchResult<T>[]>
}

interface SearchOptions {
  context: Context // Access-controlled context
  limit?: number // Max results
  minScore?: number // Minimum similarity score
  where?: any // Additional Prisma filters
}

interface SearchResult<T> {
  item: T // The matching record
  score: number // Similarity score (0-1)
  distance: number // Distance metric
}
```

### Example: Pinecone Storage

```typescript
// lib/storage/pinecone.ts
import { Pinecone } from '@pinecone-database/pinecone'
import { registerVectorStorage } from '@opensaas/stack-rag/storage'
import { getDbKey } from '@opensaas/stack-core'

interface PineconeConfig {
  type: 'pinecone'
  apiKey: string
  environment: string
  indexName: string
}

class PineconeVectorStorage {
  type = 'pinecone'
  private client: Pinecone
  private indexName: string

  constructor(config: PineconeConfig) {
    this.client = new Pinecone({
      apiKey: config.apiKey,
      environment: config.environment,
    })
    this.indexName = config.indexName
  }

  async search(listKey, fieldName, queryVector, options) {
    const { context, limit = 10, minScore = 0, where = {} } = options
    const dbKey = getDbKey(listKey)

    // Query Pinecone
    const index = this.client.index(this.indexName)
    const queryResponse = await index.query({
      vector: queryVector,
      topK: limit * 2, // Get extra results for filtering
      includeMetadata: true,
      filter: { listKey }, // Namespace by list
    })

    // Fetch actual items from database with access control
    const ids = queryResponse.matches.map((m) => m.id)
    const items = await context.db[dbKey].findMany({
      where: {
        id: { in: ids },
        ...where,
      },
    })

    // Map back to results with scores
    const itemMap = new Map(items.map((item) => [item.id, item]))
    const results = queryResponse.matches
      .map((match) => {
        const item = itemMap.get(match.id)
        if (!item || match.score < minScore) return null
        return {
          item,
          score: match.score,
          distance: 1 - match.score,
        }
      })
      .filter((r) => r !== null)
      .slice(0, limit)

    return results
  }
}

registerVectorStorage('pinecone', (config) => new PineconeVectorStorage(config))

export function pineconeStorage(config: Omit<PineconeConfig, 'type'>): PineconeConfig {
  return { type: 'pinecone', ...config }
}
```

**Usage:**

```typescript
import { ragPlugin } from '@opensaas/stack-rag'
import { pineconeStorage } from '@/lib/storage/pinecone'

export default config({
  plugins: [
    ragPlugin({
      storage: pineconeStorage({
        apiKey: process.env.PINECONE_API_KEY!,
        environment: 'us-east-1-aws',
        indexName: 'my-index',
      }),
    }),
  ],
})
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
    chunkSize: 1000,
    chunkOverlap: 200,
  },
})
```

**How it works:**

- Long content automatically chunked before embedding
- Each chunk gets its own embedding
- Multiple embeddings stored per document
- Searches find best matching chunks

#### Manual Chunking for Custom Workflows

```typescript
import { chunkText, generateEmbedding } from '@opensaas/stack-rag/runtime'
import { createEmbeddingProvider } from '@opensaas/stack-rag'

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
  })
)

// Store chunks in database
await context.db.documentChunk.createMany({
  data: chunkEmbeddings.map((ce) => ({
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
  })),
})
```

## Performance Optimization

### 1. Database Indexing

Create indexes on embedding fields for fast similarity search.

#### pgvector Indexes

**IVFFlat Index** (faster to build, good for 10k-1M vectors):

```sql
CREATE INDEX article_embedding_ivfflat_idx
ON "Article" USING ivfflat ((("contentEmbedding"->>'vector')::vector(1536)))
WITH (lists = 100);
```

**HNSW Index** (better quality, good for 100k+ vectors):

```sql
CREATE INDEX article_embedding_hnsw_idx
ON "Article" USING hnsw ((("contentEmbedding"->>'vector')::vector(1536)))
WITH (m = 16, ef_construction = 64);
```

**Index Guidelines:**

- **lists**: Set to `sqrt(total_rows)` for IVFFlat
- **m**: Higher = better quality but more memory (default: 16)
- **ef_construction**: Higher = better index quality (default: 64)

### 2. Batch Embedding Generation

Generate embeddings in batches to reduce API overhead and respect rate limits.

```typescript
import { batchProcess } from '@opensaas/stack-rag/runtime'
import { createEmbeddingProvider } from '@opensaas/stack-rag'

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
    console.log(
      `Progress: ${progress.percentage}% (${progress.processed}/${progress.total})`
    )
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
// ❌ Bad: No filters, large limit
const results = await storage.search('Article', 'contentEmbedding', queryVector, {
  limit: 100, // Too many results
  context,
})

// ✅ Good: Filters, reasonable limit
const results = await storage.search('Article', 'contentEmbedding', queryVector, {
  limit: 10, // Reasonable limit
  minScore: 0.7, // Only high-quality matches
  where: {
    published: { equals: true },
    createdAt: { gte: oneMonthAgo },
  },
  context,
})
```

### 5. Pre-compute Embeddings

For frequently searched content, pre-compute embeddings at build time or during seeding.

```typescript
// scripts/precompute-embeddings.ts
import { getContext } from '@/.opensaas/context'
import { createEmbeddingProvider } from '@opensaas/stack-rag'

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
    }))
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
import { createEmbeddingProvider, createVectorStorage } from '@opensaas/stack-rag'
import { getContext } from '@/.opensaas/context'

export async function hybridSearch(query: string, options = {}) {
  const { limit = 10, alpha = 0.7 } = options // alpha: semantic weight (0-1)
  const context = await getContext()

  // 1. Keyword search
  const keywordResults = await context.db.article.findMany({
    where: {
      OR: [{ title: { contains: query } }, { content: { contains: query } }],
    },
    take: limit * 2,
  })

  // 2. Semantic search
  const provider = createEmbeddingProvider({
    type: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
  })
  const queryVector = await provider.embed(query)

  const storage = createVectorStorage({ type: 'pgvector' })
  const semanticResults = await storage.search('Article', 'contentEmbedding', queryVector, {
    limit: limit * 2,
    context,
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

const hf = new HfInference(process.env.HUGGINGFACE_API_KEY!)

export async function rerankResults(query: string, results: SearchResult[], topK = 5) {
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
    })
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
async function multiVectorSearch(query: string) {
  const provider = createEmbeddingProvider({
    type: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
  })
  const queryVector = await provider.embed(query)

  const storage = createVectorStorage({ type: 'pgvector' })

  // Search each embedding field
  const [titleResults, summaryResults, contentResults] = await Promise.all([
    storage.search('Article', 'titleEmbedding', queryVector, { limit: 10, context }),
    storage.search('Article', 'summaryEmbedding', queryVector, { limit: 10, context }),
    storage.search('Article', 'contentEmbedding', queryVector, { limit: 10, context }),
  ])

  // Combine and deduplicate
  const scoreMap = new Map()

  const addResults = (results: SearchResult[], weight: number) => {
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
async function generateEmbeddingWithRetry(text: string, provider: EmbeddingProvider) {
  const maxRetries = 3
  let lastError: Error

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await provider.embed(text)
    } catch (error) {
      lastError = error as Error
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
      error: error.message,
    })

    throw error
  }
}
```

### 3. Rate Limiting

Implement rate limiting to avoid API limits:

```typescript
// lib/rate-limiter.ts
export class RateLimiter {
  private tokens: number
  private lastRefill: number
  private maxTokens: number
  private refillRate: number

  constructor(maxTokens: number, refillRate: number) {
    this.maxTokens = maxTokens
    this.refillRate = refillRate
    this.tokens = maxTokens
    this.lastRefill = Date.now()
  }

  async acquire() {
    this.refill()

    while (this.tokens < 1) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      this.refill()
    }

    this.tokens -= 1
  }

  private refill() {
    const now = Date.now()
    const elapsed = (now - this.lastRefill) / 1000 // seconds
    const tokensToAdd = elapsed * this.refillRate

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd)
    this.lastRefill = now
  }
}

// Usage
const limiter = new RateLimiter(100, 100 / 60) // 100 tokens, refill 100/min

export async function rateLimitedEmbed(text: string, provider: EmbeddingProvider) {
  await limiter.acquire()
  return provider.embed(text)
}
```

### 4. Cost Optimization

Track and optimize API costs:

```typescript
// lib/cost-tracking.ts
const COST_PER_1K_TOKENS = {
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

  const articles = await context.db.article.findMany({
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

  await writeFile(
    `backups/embeddings-${Date.now()}.json`,
    JSON.stringify(backup, null, 2)
  )

  console.log(`Backed up ${articles.length} embeddings`)
}
```

## Testing Strategies

### Unit Testing Providers

```typescript
// __tests__/providers/openai.test.ts
import { describe, it, expect } from 'vitest'
import { createEmbeddingProvider } from '@opensaas/stack-rag'

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
import { createEmbeddingProvider, createVectorStorage } from '@opensaas/stack-rag'
import { sudo } from '@opensaas/stack-core/context'

describe('Semantic Search', () => {
  beforeAll(async () => {
    const context = await getContext()

    // Seed test data
    await sudo(
      context.db.article.create({
        data: {
          title: 'Machine Learning Basics',
          content: 'Machine learning is a subset of artificial intelligence...',
        },
      })
    )
  })

  it('should find relevant articles', async () => {
    const context = await getContext()
    const query = 'What is AI?'

    const provider = createEmbeddingProvider({
      type: 'openai',
      apiKey: process.env.OPENAI_API_KEY!,
    })
    const queryVector = await provider.embed(query)

    const storage = createVectorStorage({ type: 'json' })
    const results = await storage.search('Article', 'contentEmbedding', queryVector, {
      limit: 5,
      context,
    })

    expect(results.length).toBeGreaterThan(0)
    expect(results[0].item.title).toContain('Machine Learning')
    expect(results[0].score).toBeGreaterThan(0.7)
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

1. **Stream results** instead of loading all at once
2. **Use database-level vector search** (pgvector, not JSON)
3. **Implement pagination** in search results
4. **Limit embedding dimensions** (use smaller models)

### Inconsistent Search Results

**Symptoms:**

- Different results for same query
- Low-quality matches

**Solutions:**

1. **Verify embedding dimensions match** across provider and field
2. **Check for partial embeddings** (failed generation)
3. **Adjust minScore threshold**
4. **Consider hybrid search** (keyword + semantic)
5. **Try re-ranking** with cross-encoder

## Next Steps

- **[RAG Package Reference](/docs/packages/rag)** - Complete API documentation
- **[RAG Setup Guide](/docs/guides/rag-setup)** - Database configuration and getting started
- **[OpenSaas Stack Examples](https://github.com/OpenSaasAU/stack/tree/main/examples)** - Production-ready examples

You now have the knowledge to build advanced RAG implementations with OpenSaas Stack!
