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
pnpm test:rag
```

The script reseeds both lists from empty, so it can be re-run as often as you
like. It:

1. ✅ Clears and recreates the sample documents and articles
2. ✅ Waits for the embeddings the plugin generates after each write commits
3. ✅ Ranks them through `nearest()`
4. ✅ Runs the same search through an anonymous and a signed-in context, to show
   the ranking is scoped by access control
5. ✅ Changes a document's source text and watches its embedding regenerate

**Expected output** (scores vary with the model):

```
✓ Provider: ollama (nomic-embed-text, 768d)
✓ Document 01a08b40-a962-745a-840e-48fc4b5d5acf: Introduction to Machine Learning
...
✓ documents: 6/6 embedded
✓ articles: 3/3 embedded

📊 ollama/nomic-embed-text, 768d, vector length 768, sourceHash 8jlb9g

📍 "artificial intelligence and neural networks"
   0.7269  Introduction to Machine Learning
   0.7264  Deep Learning Fundamentals
   0.6457  Natural Language Processing

Signed in:
   0.8614  Reinforcement Learning Draft
   0.6159  Introduction to Machine Learning
   ...
Anonymous:
   0.6159  Introduction to Machine Learning
   0.5663  Deep Learning Fundamentals
   ...
```

Both of those lists run to five rows — `test.ts` asks for `limit: 5` — and are
elided here to the rows that make the point.

The unpublished draft is the _closest_ match to that last query and still does
not reach an anonymous reader: `nearest()` ranks inside the scoped set rather
than filtering a ranked one.

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
        baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
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
import { text } from '@opensaas/stack-core/fields'
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
import { text } from '@opensaas/stack-core/fields'
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

Both patterns are fully supported, and for the field above they produce the same
column: `searchable()` takes `dimensions` too, and where neither declares one the
plugin fills it in from the provider — 768 here, not `embedding()`'s own 1536
default. What `searchable()` cannot express is `distanceFunction`, `index` and
`allowManualWrites`, none of which are `SearchableOptions`. Wanting one of those
three is the reason to spell the field out, and Optimization Tip 2 below is an
example of exactly that.

### 3. Automatic Generation

When you create or update a document:

1. RAG plugin sees the committed row in an `afterTransaction` hook
2. Checks if source text changed (using hash comparison)
3. If changed, generates new embedding via Ollama
4. Writes the vector and its metadata through core's `writePluginOwnedField` —
   the columns are write-denied to application code, and that write runs no
   hook of the list's (ADR-0066)

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

Both lists scope `query` to published rows for an anonymous reader and open up
for any session, so `nearest()` has an Access Filter to rank inside.

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
768 (`nomic-embed-text`). Only `test.ts` in this example reads it, to build the
provider it embeds a _query_ with; `@opensaas/stack-rag/runtime`'s
`getProviderConfigFromEnv` reads it too, for the same reason. The column's own
dimension is the literal `dimensions: 768` in
`opensaas.config.ts`, which is why `ollamaEmbeddings` requires it: a column's type
must not depend on a running Ollama, and Ollama reports its output size only from a
live embed call. Change the model and you change both — and changing the column is
a migration.

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
  dimensions: 1024,
})
```

**Note**: Dimensions must match between provider and field config.

## Troubleshooting

### Ollama not running

**Error**: `Ollama embedding generation failed: Failed to connect to Ollama at
http://localhost:11434. Ensure Ollama is running.`

**Solution**:

```bash
# Check if Ollama is running
ollama list

# If not, start Ollama service (usually starts automatically)
ollama serve
```

### Model not found

**Error**: a 404 from Ollama, surfaced as
`Ollama embedding generation failed: HTTP 404:` followed by Ollama's own JSON
body, which says the model was not found and to pull it first.

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
- **Batch processing**: available to call as `provider.embedBatch()`, but the
  plugin's own `afterTransaction` embedding is per row and does not use it

### Search Performance

- **pgvector**: ranked in the database, over the column itself
- **Cosine similarity**: Most common distance metric, and this example's default
- **Every search is an exact scan.** `@prisma/orm-extension-pgvector@8.0.0-rc.8`
  registers no index types, so no vector index can be built yet and the plan for
  a `nearest()` is a sequential scan followed by a sort ([#1265](https://github.com/OpenSaasAU/stack/issues/1265)).
  That is fine at this example's scale and is not fine at a corpus's.

### Optimization Tips

1. **Use batch endpoints** — `embedBatch` is on the provider interface and both
   providers implement it:

   ```typescript
   const vectors = await provider.embedBatch([text1, text2, text3])
   ```

2. **Declare the index on the field** (`embedding({ index })` is documented in
   [RAG: advanced](https://stack.opensaas.au/docs/how-to/rag-advanced), not in the
   RAG package README —
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
2. **Add more content** - Use the Admin UI to create documents. Creating works
   here and the embedding generates behind it; **editing an existing row does
   not**. The item form submits every field it rendered, including the
   plugin-owned `contentEmbedding`, which is write-denied to application code —
   so Save comes back with
   `Validation failed: Cannot update "contentEmbedding": field-level access denied.`
   and the row is unchanged. Browse, create and delete are the working paths;
   change content by re-running `pnpm test:rag`, which reseeds both lists.
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
