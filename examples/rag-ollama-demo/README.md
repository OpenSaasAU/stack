# RAG Demo - Ollama + pgvector

This example demonstrates **RAG (Retrieval-Augmented Generation)** integration with OpenSaas Stack using:

- **Ollama** - Local embedding generation (no API keys needed!)
- **pgvector** - Vector similarity search in a native Postgres column
- **Automatic embeddings** - Auto-generated when content changes

Perfect for local development and applications that need semantic search without external API dependencies.

## Features

- 🔍 **Semantic Search** - Find documents by meaning, not just keywords
- 🤖 **Local Embeddings** - Uses Ollama running on your machine
- 🗃️ **pgvector** - Vector search in the column itself, ranked by `nearest()`
- ⚡ **Auto-generation** - Embeddings update automatically when content changes
- 🎯 **No API Keys** - Completely local, no external services required

## Prerequisites

A Postgres with pgvector available. Leave `DATABASE_URL` unset and `pnpm dev`
starts a Dev database that carries it — see
[Provisioning pgvector](#provisioning-pgvector) to bring your own.

### 1. Install Ollama

Download and install Ollama from [https://ollama.ai](https://ollama.ai)

**macOS:**

```bash
brew install ollama
```

**Linux:**

```bash
curl -fsSL https://ollama.ai/install.sh | sh
```

**Windows:**
Download from [https://ollama.ai/download](https://ollama.ai/download)

### 2. Pull the Embedding Model

```bash
ollama pull nomic-embed-text
```

This downloads the `nomic-embed-text` model (~274MB), which generates 768-dimensional embeddings optimized for semantic search.

### 3. Verify Ollama is Running

```bash
ollama list
```

You should see `nomic-embed-text` in the list. Ollama runs as a background service on `http://localhost:11434` by default.

## Getting Started

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Set Up Environment

```bash
cp .env.example .env
```

### 3. Generate Schema and Types

```bash
pnpm generate
```

This creates:

- `prisma/contract.ts` - The Contract module, and `prisma.config.ts` at the root, which names it
- `prisma/contract.json` and `prisma/contract.d.ts` - The emitted contract artifacts. **Commit both** — generation says so on its way out, and `.opensaas/context.ts` imports them
- `migrations/pgvector/` - The pgvector extension pack's contract space, seeded because the config declares that pack. Generation seeds a space for each declared pack and writes no app migration of its own; the app's schema history comes from `prisma migration plan`
- `.opensaas/types.ts` - TypeScript types for your lists
- `.opensaas/context.ts` - Context factory with access control

### 4. Start the Admin UI

```bash
pnpm dev
```

Visit:

- **Admin UI**: [http://localhost:3000/admin](http://localhost:3000/admin)
- **Home**: [http://localhost:3000](http://localhost:3000)

### 5. Run the Test Script

With `pnpm dev` running in another terminal:

```bash
pnpm test
```

This script:

1. ✅ Creates sample documents and articles
2. ✅ Verifies embeddings are auto-generated
3. ✅ Performs semantic search queries
4. ✅ Demonstrates similarity scoring
5. ✅ Tests embedding updates on content changes

**Expected output:**

```
🚀 RAG Demo with Ollama + pgvector

📝 Initializing...
✓ Provider: ollama
✓ Model: nomic-embed-text
✓ Dimensions: 768

📚 Creating sample documents...
✓ Created: Introduction to Machine Learning
✓ Created: Deep Learning Fundamentals
✓ Created: Natural Language Processing
✓ Created: Computer Vision Applications
✓ Created: JavaScript Basics

🔍 Verifying auto-generated embeddings...
✓ Documents with embeddings: 5/5
✓ Articles with embeddings: 3/3

🔎 Performing semantic searches...
📍 Query 1: "artificial intelligence and neural networks"
Top 3 Results:
  1. Deep Learning Fundamentals (similarity: 0.8234)
  2. Introduction to Machine Learning (similarity: 0.7891)
  3. Natural Language Processing (similarity: 0.7456)
```

## How It Works

### 1. Plugin Configuration

The RAG plugin is configured in `opensaas.config.ts`:

```typescript
import { config } from '@opensaas/stack-core'
import { ragPlugin, ollamaEmbeddings } from '@opensaas/stack-rag'

export default config({
  plugins: [
    ragPlugin({
      provider: ollamaEmbeddings({
        baseURL: 'http://localhost:11434',
        model: 'nomic-embed-text',
        dimensions: 768,
      }),
    }),
  ],
  db: { provider: 'postgresql' },
  // ... lists
})
```

`ragPlugin` declares the pgvector extension pack itself, so no config names it.

### 2. Embedding Fields

Use the `searchable()` wrapper to automatically add embeddings to any field:

```typescript
import { searchable } from '@opensaas/stack-rag/fields'

fields: {
  // Using searchable() wrapper (recommended)
  content: searchable(
    text({ validation: { isRequired: true } }),
    { provider: 'ollama' },  // dimensions come from the provider (768)
  ),
}
```

**What it does:**

- Automatically creates a `contentEmbedding` field
- Links it to the `content` field
- Auto-generates embeddings on create/update
- Cleaner, more concise syntax

**Alternative (manual pattern):**

```typescript
import { embedding } from '@opensaas/stack-rag/fields'

fields: {
  content: text({ validation: { isRequired: true } }),
  contentEmbedding: embedding({
    sourceField: 'content',      // Generate from this field
    provider: 'ollama',           // Use Ollama provider
    autoGenerate: true,           // Auto-generate on create/update
  }),
}
```

Both patterns are fully supported and produce the same results.

### 3. Automatic Generation

When you create or update a document:

1. RAG plugin sees the committed row in an `afterTransaction` hook
2. Checks if source text changed (using hash comparison)
3. If changed, generates new embedding via Ollama
4. Writes the vector and its metadata under sudo — the columns are write-denied
   to application code

### 4. Semantic Search

Search documents by natural language:

```typescript
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'

// Generate query embedding
const provider = createEmbeddingProvider({
  type: 'ollama',
  baseURL: 'http://localhost:11434',
  model: 'nomic-embed-text',
  dimensions: 768,
})
const queryVector = await provider.embed('artificial intelligence')

// Rank the column itself, inside the access filter
const results = await context.db.Document.where({ published: { equals: true } }).nearest(
  'contentEmbedding',
  queryVector,
  { limit: 10 },
)
```

## Project Structure

```
rag-ollama-demo/
├── app/
│   ├── admin/[[...admin]]/    # Admin UI
│   │   └── page.tsx
│   ├── layout.tsx             # Root layout
│   └── page.tsx               # Home page
├── opensaas.config.ts         # Schema + RAG config
├── test.ts                    # Semantic search demo
├── .env.example               # Environment variables
└── README.md                  # This file
```

## Schema

### Document List

- `title` (text, required)
- `content` (text, required)
- `summary` (text)
- `contentEmbedding` (embedding) - Auto-generated from `content`
- `published` (checkbox)

### Article List

- `title` (text, required)
- `body` (text, required)
- `category` (text)
- `bodyEmbedding` (embedding) - Auto-generated from `body`
- `published` (checkbox)

Both lists also carry `id`, which is the only column added for you. Neither
carries `createdAt`/`updatedAt`: auto-timestamps are off by default (ADR-0004)
and this config opts into them nowhere. A list that wants them either declares
the two fields itself or sets `db: { timestamps: true }` — on the list, or on
`db` for every list at once.

## Storage Format

`contentEmbedding` is two columns — a pgvector `vector(768)` and a `jsonb` column beside
it — that read back as one value:

```json
{
  "vector": [0.123, -0.456, 0.789, ...],  // 768 dimensions
  "metadata": {
    "provider": "ollama",
    "model": "nomic-embed-text",
    "dimensions": 768,
    "generatedAt": "2024-11-04T10:30:00.000Z",
    "sourceHash": "abc123"  // Hash of source text for change detection
  }
}
```

Both columns are Postgres-only, and pgvector is the only vector backend: this example
needs a Postgres with the `vector` extension available.

### Provisioning pgvector

You do not enable the extension yourself, and there is no install script.
`ragPlugin` declares the pgvector extension pack, `pnpm generate` seeds that
pack's contract space under `migrations/` — it writes no app migration of its
own — and `pnpm dev` enables the extension when it reconciles. `pnpm dev` has to
be running for `pnpm db:update` to have anything to talk to.

Leave `DATABASE_URL` unset and the Dev database `pnpm dev` starts carries
pgvector already. Pointing at a Postgres of your own adds two requirements:

- The extension has to be **available** on that server — `brew install pgvector`,
  `postgresql-16-pgvector`, the `pgvector/pgvector` Docker images, or a managed
  service that offers it.
- The connecting role needs the privilege to **create** it. pgvector is not a
  trusted extension, so that is superuser or a provider grant. Where a
  locked-down server offers neither, have someone who holds the privilege
  pre-create the extension in that database once; the migration prechecks for it
  and records the step as already satisfied.

A server with no pgvector fails the migration with Prisma's own error, naming
the `pgvector` space and SQL state `58P01`.

### Ollama's dimension

`OLLAMA_EMBEDDING_DIMENSIONS` in `.env` is the model's output size, defaulting to
768 (`nomic-embed-text`). It is read rather than discovered because it is a
column's type and Ollama reports it only from a live embed call — which
generation must not depend on. Change the model and you change this number, the
`dimensions` in `opensaas.config.ts`, and the column: that is a migration.

## Ollama Models

This example uses `nomic-embed-text`, but you can use other models:

### nomic-embed-text (recommended)

- **Dimensions**: 768
- **Size**: 274MB
- **Use case**: General purpose semantic search
- **Performance**: Fast, good accuracy

### mxbai-embed-large

```bash
ollama pull mxbai-embed-large
```

- **Dimensions**: 1024
- **Size**: 670MB
- **Use case**: Higher accuracy semantic search

### all-minilm

```bash
ollama pull all-minilm
```

- **Dimensions**: 384
- **Size**: 45MB
- **Use case**: Lightweight, fast embeddings

To use a different model:

```typescript
provider: ollamaEmbeddings({
  model: 'mxbai-embed-large',
})
```

**Note**: Dimensions must match between provider and field config.

## Troubleshooting

### Ollama not running

**Error**: `Failed to connect to Ollama`

**Solution**:

```bash
# Check if Ollama is running
ollama list

# If not, start Ollama service (usually starts automatically)
ollama serve
```

### Model not found

**Error**: `model "nomic-embed-text" not found`

**Solution**:

```bash
ollama pull nomic-embed-text
```

### Embeddings not generating

**Symptoms**: Documents created but `contentEmbedding` is `null`

**Debug steps**:

1. Check Ollama is running: `ollama list`
2. Verify model is pulled: `ollama pull nomic-embed-text`
3. Check logs for errors during document creation
4. Manually trigger update:
   ```typescript
   await context.db.Document.update({
     where: { id: 'doc-id' },
     data: { content: 'Updated content' },
   })
   ```

## Performance Notes

### Embedding Generation

- **First document**: ~500ms (Ollama warm-up)
- **Subsequent documents**: ~100-200ms per document
- **Batch processing**: Not yet implemented (planned)

### Search Performance

- **pgvector**: ranked in the database, over the column itself
- **Cosine similarity**: Most common distance metric, and this example's default

### Optimization Tips

1. **Use batch endpoints** (when available):

   ```typescript
   const vectors = await provider.embedBatch([text1, text2, text3])
   ```

2. **Declare the index on the field** (see `embedding({ index })` in the RAG README —
   under the pgvector pack this example ships against, the declaration derives the
   column type and operator class and does not yet build the index):

   ```typescript
   contentEmbedding: embedding({ sourceField: 'content', index: { method: 'hnsw' } })
   ```

3. **Chunk long texts**:
   ```typescript
   import { chunkText } from '@opensaas/stack-rag/runtime'
   const chunks = chunkText(longDocument, { chunkSize: 500 })
   ```

## Next Steps

1. **Try different search queries** - Modify `test.ts` to search for specific topics
2. **Add more content** - Use the Admin UI to create documents
3. **Experiment with models** - Try `mxbai-embed-large` or `all-minilm`
4. **Build a search interface** - Create a custom search page
5. **Add MCP integration** - Enable semantic search via MCP tools

## Learn More

- [OpenSaas Stack Documentation](https://stack.opensaas.au/docs)
- [RAG Package](../../packages/rag/README.md)
- [Ollama Documentation](https://ollama.ai/docs)
- [pgvector](https://github.com/pgvector/pgvector)
- [RAG Specification](../../specs/rag-integration.md)

## License

MIT
