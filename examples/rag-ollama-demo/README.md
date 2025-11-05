# RAG Demo - Ollama + SQLite VSS

This example demonstrates **RAG (Retrieval-Augmented Generation)** integration with OpenSaas Stack using:

- **Ollama** - Local embedding generation (no API keys needed!)
- **SQLite VSS** - Vector similarity search in SQLite
- **Automatic embeddings** - Auto-generated when content changes

Perfect for local development and applications that need semantic search without external API dependencies.

## Features

- 🔍 **Semantic Search** - Find documents by meaning, not just keywords
- 🤖 **Local Embeddings** - Uses Ollama running on your machine
- 🗃️ **SQLite VSS** - Vector search directly in SQLite
- ⚡ **Auto-generation** - Embeddings update automatically when content changes
- 🎯 **No API Keys** - Completely local, no external services required

## Prerequisites

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

### 2. Generate Schema and Types

```bash
pnpm generate
```

This creates:

- `prisma/schema.prisma` - Database schema from `opensaas.config.ts`
- `.opensaas/types.ts` - TypeScript types for your lists
- `.opensaas/context.ts` - Context factory with access control

### 3. Create Database

```bash
pnpm db:push
```

This creates the SQLite database (`dev.db`) with your schema.

### 4. Run the Test Script

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
🚀 RAG Demo with Ollama + SQLite VSS

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

### 5. Start the Admin UI

```bash
pnpm dev
```

Visit:

- **Admin UI**: [http://localhost:3000/admin](http://localhost:3000/admin)
- **Home**: [http://localhost:3000](http://localhost:3000)

## How It Works

### 1. Plugin Configuration

The RAG plugin is configured in `opensaas.config.ts`:

```typescript
import { ragPlugin, ollamaEmbeddings, sqliteVssStorage } from '@opensaas/stack-rag'

export default config({
  plugins: [
    ragPlugin({
      provider: ollamaEmbeddings({
        baseURL: 'http://localhost:11434',
        model: 'nomic-embed-text',
      }),
      storage: sqliteVssStorage({
        distanceFunction: 'cosine',
      }),
    }),
  ],
  // ... rest of config
})
```

### 2. Embedding Fields

Fields with `autoGenerate: true` automatically create embeddings:

```typescript
fields: {
  content: text({ validation: { isRequired: true } }),
  contentEmbedding: embedding({
    sourceField: 'content',      // Generate from this field
    provider: 'ollama',           // Use Ollama provider
    autoGenerate: true,           // Auto-generate on create/update
  }),
}
```

### 3. Automatic Generation

When you create or update a document:

1. RAG plugin detects the change via `afterOperation` hook
2. Checks if source text changed (using hash comparison)
3. If changed, generates new embedding via Ollama
4. Stores embedding with metadata (model, dimensions, timestamp)

### 4. Semantic Search

Search documents by natural language:

```typescript
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'

// Generate query embedding
const provider = createEmbeddingProvider({
  type: 'ollama',
  baseURL: 'http://localhost:11434',
  model: 'nomic-embed-text',
})
const queryVector = await provider.embed('artificial intelligence')

// Get all documents
const docs = await context.db.document.findMany()

// Calculate similarity
const results = docs
  .map((doc) => ({
    doc,
    score: cosineSimilarity(queryVector, doc.contentEmbedding.vector),
  }))
  .sort((a, b) => b.score - a.score)
  .slice(0, 10)
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
- `createdAt` (timestamp)
- `updatedAt` (timestamp)

### Article List

- `title` (text, required)
- `body` (text, required)
- `category` (text)
- `bodyEmbedding` (embedding) - Auto-generated from `body`
- `published` (checkbox)

## Storage Format

Embeddings are stored as JSON in the database:

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

## SQLite VSS vs JSON Storage

This example uses **SQLite VSS** for vector search. The RAG package also supports:

### SQLite VSS (this example)

- ✅ Fast indexed vector search
- ✅ Native SQLite extension
- ✅ Good for production SQLite apps
- ⚠️ Requires VSS extension

### JSON Storage (alternative)

```typescript
storage: jsonStorage()
```

- ✅ No extensions needed
- ✅ Works with any database
- ✅ Good for development
- ⚠️ Slower for large datasets (full scan)

To switch to JSON storage, update `opensaas.config.ts`:

```typescript
storage: jsonStorage()
```

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
   await context.db.document.update({
     where: { id: 'doc-id' },
     data: { content: 'Updated content' },
   })
   ```

### SQLite VSS extension missing

**Error**: `sqlite-vss extension not found`

**Solution**: This example uses JSON storage as fallback if VSS is unavailable. To use VSS properly, ensure `sqlite-vss` extension is installed.

For now, you can switch to JSON storage:

```typescript
storage: jsonStorage()
```

## Performance Notes

### Embedding Generation

- **First document**: ~500ms (Ollama warm-up)
- **Subsequent documents**: ~100-200ms per document
- **Batch processing**: Not yet implemented (planned)

### Search Performance

- **SQLite VSS with index**: Sub-second for 100k+ vectors
- **JSON storage**: Linear scan, acceptable for <10k vectors
- **Cosine similarity**: Most common distance metric

### Optimization Tips

1. **Use batch endpoints** (when available):

   ```typescript
   const vectors = await provider.embedBatch([text1, text2, text3])
   ```

2. **Add indexes** (for SQLite VSS):

   ```sql
   -- Index creation (future enhancement)
   CREATE INDEX content_embedding_idx ON Document(contentEmbedding);
   ```

3. **Chunk long texts**:
   ```typescript
   import { chunkText } from '@opensaas/stack-rag/runtime'
   const chunks = chunkText(longDocument, { maxTokens: 500 })
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
- [SQLite VSS](https://github.com/asg017/sqlite-vss)
- [RAG Specification](../../specs/rag-integration.md)

## License

MIT
