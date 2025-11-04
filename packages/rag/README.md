# @opensaas/stack-rag

RAG (Retrieval-Augmented Generation) and AI embeddings integration for OpenSaas Stack.

Turn your OpenSaas app into a knowledge base with semantic search capabilities powered by vector embeddings.

## Features

- 🤖 **Multiple Embedding Providers**: OpenAI, Ollama (local), or bring your own
- 🗄️ **Flexible Storage**: pgvector, SQLite VSS, or JSON-based (for development)
- 🔍 **Semantic Search**: Natural language queries with relevance scoring
- 🔐 **Access Control**: All searches respect your existing access control rules
- ⚡ **Automatic Embeddings**: Auto-generate embeddings when content changes
- 🛠️ **MCP Integration**: Semantic search tools for AI assistants
- 📊 **Multiple Abstraction Levels**: From automatic "magic" to low-level control

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
import { withRAG, ragConfig, openaiEmbeddings } from '@opensaas/stack-rag'
import { embedding } from '@opensaas/stack-rag/fields'

export default withRAG(
  config({
    db: {
      provider: 'postgresql',
      url: process.env.DATABASE_URL!,
    },
    lists: {
      Article: list({
        fields: {
          title: text({ validation: { isRequired: true } }),
          content: text({ validation: { isRequired: true } }),
          // Embedding field with automatic generation
          contentEmbedding: embedding({
            sourceField: 'content',  // Auto-embed when content changes
            provider: 'openai',
            dimensions: 1536,
          }),
        },
      }),
    },
  }),
  ragConfig({
    provider: openaiEmbeddings({
      apiKey: process.env.OPENAI_API_KEY!,
      model: 'text-embedding-3-small',
    }),
  })
)
```

### 2. Generate schema and push to database

```bash
pnpm generate
pnpm db:push
```

### 3. Create content (embeddings generated automatically)

```typescript
import { getContext } from '@/.opensaas/context'

const context = getContext()

// Embedding is automatically generated from content
await context.db.article.create({
  data: {
    title: 'Introduction to AI',
    content: 'Artificial intelligence is...',
    // No need to manually create embedding - it's automatic!
  },
})
```

### 4. Perform semantic search

```typescript
import { createEmbeddingProvider, createVectorStorage } from '@opensaas/stack-rag'

export async function searchArticles(query: string) {
  const context = getContext()

  // Generate embedding for search query
  const provider = createEmbeddingProvider({
    type: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
  })
  const queryVector = await provider.embed(query)

  // Search for similar articles
  const storage = createVectorStorage({ type: 'json' })
  const results = await storage.search('Article', 'contentEmbedding', queryVector, {
    limit: 10,
    minScore: 0.7,
    context,  // Access control enforced
  })

  return results
}
```

## Local Development with Ollama

For local development without API costs:

```typescript
import { ollamaEmbeddings, jsonStorage } from '@opensaas/stack-rag'

export default withRAG(
  config({ /* ... */ }),
  ragConfig({
    provider: ollamaEmbeddings({
      baseURL: 'http://localhost:11434',
      model: 'nomic-embed-text',
    }),
    storage: jsonStorage(), // No database extensions needed
  })
)
```

First, install and run Ollama:

```bash
# Install Ollama from https://ollama.ai
ollama pull nomic-embed-text
ollama serve
```

## Storage Backends

### JSON Storage (Development)

Good for development and small datasets. No database extensions needed.

```typescript
storage: jsonStorage()
```

### pgvector (Production PostgreSQL)

Best for production apps using PostgreSQL. Requires pgvector extension.

```typescript
storage: pgvectorStorage({ distanceFunction: 'cosine' })
```

Setup:
```sql
CREATE EXTENSION vector;
```

### SQLite VSS (SQLite)

Good for SQLite-based apps. Requires sqlite-vss extension.

```typescript
storage: sqliteVssStorage({ distanceFunction: 'cosine' })
```

## MCP Integration

Automatic semantic search tools for AI assistants:

```typescript
export default withRAG(
  config({
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
  }),
  ragConfig({
    provider: openaiEmbeddings({ apiKey: process.env.OPENAI_API_KEY! }),
    enableMcpTools: true, // Enables semantic_search_article tool
  })
)
```

## Documentation

See [CLAUDE.md](./CLAUDE.md) for comprehensive documentation including:

- All abstraction levels (high-level to low-level)
- Custom embedding providers
- Custom storage backends
- Text chunking strategies
- Performance optimization
- Testing patterns
- Migration guides

## Examples

See `examples/rag-demo` for a complete working example with:

- Document search
- Chatbot with knowledge base
- MCP integration
- Multiple embedding providers

## Repository

- **GitHub**: https://github.com/OpenSaasAU/stack
- **Docs**: https://stack.opensaas.au/
- **Issues**: https://github.com/OpenSaasAU/stack/issues

## License

MIT
