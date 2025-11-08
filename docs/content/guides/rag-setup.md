# RAG Setup & Integration Guide

This guide covers everything you need to set up RAG (Retrieval-Augmented Generation) in your OpenSaas Stack application, from database configuration to building production-ready knowledge bases.

## Prerequisites

Before adding RAG to your application, ensure you have:

- **OpenSaas Stack** installed and configured
- **Node.js 18+** and pnpm
- **Database** (PostgreSQL, SQLite, or any Prisma-supported database)
- **OpenAI API key** (for OpenAI embeddings) OR **Ollama** installed (for local embeddings)

## Installation

Install the RAG package:

```bash
pnpm add @opensaas/stack-rag
```

Install your chosen embedding provider:

```bash
# For OpenAI embeddings
pnpm add openai

# OR for Ollama (local)
# No package needed - just install and run Ollama
```

## Database Setup

The RAG package supports three storage backends. Choose the one that best fits your needs.

### PostgreSQL with pgvector (Recommended for Production)

pgvector is the best option for production applications using PostgreSQL. It provides efficient vector similarity search with index support.

#### Installation

**Using Docker (Easiest):**

```bash
docker run -d \
  --name postgres-rag \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=your_database \
  -p 5432:5432 \
  pgvector/pgvector:pg16
```

**Using Homebrew (macOS):**

```bash
# Install PostgreSQL if not already installed
brew install postgresql@16
brew services start postgresql@16

# Install pgvector extension
brew install pgvector
brew services restart postgresql@16
```

**Using apt (Ubuntu/Debian):**

```bash
# Install PostgreSQL and pgvector
sudo apt install postgresql-16 postgresql-16-pgvector

# Restart PostgreSQL
sudo systemctl restart postgresql
```

#### Enable pgvector Extension

After installing PostgreSQL with pgvector, enable the extension in your database:

```bash
# Connect to your database
psql -U postgres -d your_database

# Enable the extension
CREATE EXTENSION IF NOT EXISTS vector;

# Verify installation
\dx vector
```

You should see:

```
                              List of installed extensions
  Name   | Version | Schema |                      Description
---------+---------+--------+-------------------------------------------------------
 vector  | 0.7.0   | public | vector data type and ivfflat and hnsw access methods
```

#### Configure in OpenSaas

```typescript
// opensaas.config.ts
import { ragPlugin, pgvectorStorage } from '@opensaas/stack-rag'

export default config({
  plugins: [
    ragPlugin({
      storage: pgvectorStorage({
        distanceFunction: 'cosine', // 'cosine', 'l2', or 'innerProduct'
      }),
    }),
  ],
  db: {
    provider: 'postgresql',
    url: process.env.DATABASE_URL!,
  },
})
```

#### Performance Optimization (Optional)

For large datasets, create indexes to speed up vector searches:

```sql
-- Create IVFFlat index (for datasets with 10k+ vectors)
CREATE INDEX article_embedding_idx
ON "Article" USING ivfflat ((("contentEmbedding"->>'vector')::vector(1536)))
WITH (lists = 100);

-- OR create HNSW index (better quality, slower build)
CREATE INDEX article_embedding_hnsw_idx
ON "Article" USING hnsw ((("contentEmbedding"->>'vector')::vector(1536)))
WITH (m = 16, ef_construction = 64);
```

**Index Guidelines:**

- **IVFFlat**: Faster to build, good for 10k-1M vectors
- **HNSW**: Better search quality, good for 100k+ vectors
- **lists parameter**: Set to sqrt(rows) for IVFFlat
- **m parameter**: Higher = better quality but more memory for HNSW

### SQLite with VSS (Good for SQLite Apps)

If you're using SQLite, the sqlite-vss extension provides efficient vector search.

#### Installation

```bash
# Install sqlite-vss extension (method varies by OS)
# See: https://github.com/asg017/sqlite-vss

# For macOS with Homebrew:
brew install sqlite-vss
```

#### Configure in OpenSaas

```typescript
// opensaas.config.ts
import { ragPlugin, sqliteVssStorage } from '@opensaas/stack-rag'

export default config({
  plugins: [
    ragPlugin({
      storage: sqliteVssStorage({
        distanceFunction: 'cosine',
      }),
    }),
  ],
  db: {
    provider: 'sqlite',
    url: 'file:./dev.db',
  },
})
```

### JSON Storage (Development Only)

JSON storage requires no database extensions and works with any database. Good for development and small datasets (<10k documents).

```typescript
// opensaas.config.ts
import { ragPlugin, jsonStorage } from '@opensaas/stack-rag'

export default config({
  plugins: [
    ragPlugin({
      storage: jsonStorage(), // No setup required
    }),
  ],
  db: {
    provider: 'sqlite', // Works with any database
    url: 'file:./dev.db',
  },
})
```

**Limitations:**

- O(n) search complexity (slower for large datasets)
- Similarity computed in JavaScript (no database-level optimization)
- Best for development and <10k documents

## Provider Configuration

### OpenAI Embeddings

OpenAI provides high-quality embeddings via their API. Best for production applications.

#### Get API Key

1. Sign up at [OpenAI Platform](https://platform.openai.com)
2. Navigate to API Keys
3. Create a new secret key
4. Add to `.env`:

```bash
OPENAI_API_KEY=sk-...
```

#### Configure Provider

```typescript
import { ragPlugin, openaiEmbeddings } from '@opensaas/stack-rag'

ragPlugin({
  provider: openaiEmbeddings({
    apiKey: process.env.OPENAI_API_KEY!,
    model: 'text-embedding-3-small', // or 'text-embedding-3-large'
  }),
})
```

#### OpenAI Models

| Model | Dimensions | Use Case | Cost (per 1M tokens) |
|-------|-----------|----------|---------------------|
| `text-embedding-3-small` | 1536 | General purpose, cost-effective | $0.02 |
| `text-embedding-3-large` | 3072 | Higher quality, more expensive | $0.13 |

**Recommendations:**

- Use `text-embedding-3-small` for most applications
- Use `text-embedding-3-large` for critical search quality
- Consider Ollama for development to avoid API costs

### Ollama Embeddings (Local)

Ollama runs embedding models locally. Great for development and applications that need privacy or want to avoid API costs.

#### Installation

```bash
# Install Ollama from https://ollama.ai
# Or use Homebrew on macOS:
brew install ollama

# Start Ollama service
ollama serve

# Pull an embedding model
ollama pull nomic-embed-text
```

#### Configure Provider

```typescript
import { ragPlugin, ollamaEmbeddings } from '@opensaas/stack-rag'

ragPlugin({
  provider: ollamaEmbeddings({
    baseURL: 'http://localhost:11434',
    model: 'nomic-embed-text',
  }),
})
```

#### Ollama Models

| Model | Dimensions | Use Case |
|-------|-----------|----------|
| `nomic-embed-text` | 768 | General purpose, fast |
| `mxbai-embed-large` | 1024 | Higher quality |
| `all-minilm` | 384 | Very fast, smaller |

**Recommendations:**

- Use `nomic-embed-text` for most applications
- Use `mxbai-embed-large` for better quality
- Use `all-minilm` for maximum speed

### Multiple Providers

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
    }),
  },
  storage: pgvectorStorage(),
})

// Use different providers for different fields
lists: {
  Article: list({
    fields: {
      title: text(),
      titleEmbedding: embedding({
        sourceField: 'title',
        provider: 'ollama', // Fast, local embeddings for titles
        dimensions: 768,
      }),
      content: text(),
      contentEmbedding: embedding({
        sourceField: 'content',
        provider: 'openai', // High-quality embeddings for content
        dimensions: 1536,
      }),
    },
  }),
}
```

## Complete Setup Example

Here's a complete example configuration for a knowledge base application:

### Environment Variables

```bash
# .env
DATABASE_URL=postgresql://user:password@localhost:5432/knowledge_base
OPENAI_API_KEY=sk-...
```

### OpenSaas Configuration

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'
import { text, select, checkbox, timestamp } from '@opensaas/stack-core/fields'
import { ragPlugin, openaiEmbeddings, pgvectorStorage } from '@opensaas/stack-rag'
import { searchable } from '@opensaas/stack-rag/fields'

export default config({
  plugins: [
    ragPlugin({
      provider: openaiEmbeddings({
        apiKey: process.env.OPENAI_API_KEY!,
        model: 'text-embedding-3-small',
      }),
      storage: pgvectorStorage({
        distanceFunction: 'cosine',
      }),
    }),
  ],
  db: {
    provider: 'postgresql',
    url: process.env.DATABASE_URL!,
  },
  lists: {
    Article: list({
      fields: {
        title: text({
          validation: { isRequired: true },
        }),
        // Using searchable() wrapper for automatic embeddings
        content: searchable(
          text({
            validation: { isRequired: true },
          }),
          {
            provider: 'openai',
            dimensions: 1536,
          }
        ),
        category: select({
          options: [
            { label: 'Technology', value: 'tech' },
            { label: 'Science', value: 'science' },
            { label: 'Business', value: 'business' },
          ],
        }),
        published: checkbox({
          defaultValue: false,
        }),
        publishedAt: timestamp({
          db: { updatedAt: false },
        }),
      },
      access: {
        operation: {
          query: () => true,
          create: ({ session }) => !!session,
          update: ({ session }) => !!session,
          delete: ({ session }) => !!session,
        },
        filter: {
          query: ({ session }) => {
            // Anonymous users see only published articles
            if (!session) {
              return { published: { equals: true } }
            }
            // Authenticated users see all
            return {}
          },
        },
      },
    }),
  },
})
```

### Generate Schema

```bash
pnpm generate
pnpm db:push
```

### Create a Semantic Search Function

```typescript
// lib/search.ts
'use server'

import { createEmbeddingProvider, createVectorStorage } from '@opensaas/stack-rag'
import { getContext } from '@/.opensaas/context'

export async function searchArticles(query: string, limit = 10) {
  const context = await getContext()

  // Generate query embedding
  const provider = createEmbeddingProvider({
    type: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
  })
  const queryVector = await provider.embed(query)

  // Perform search
  const storage = createVectorStorage({ type: 'pgvector' })
  const results = await storage.search('Article', 'contentEmbedding', queryVector, {
    limit,
    minScore: 0.7,
    context,
    where: { published: { equals: true } },
  })

  return results.map((r) => ({
    id: r.item.id,
    title: r.item.title,
    content: r.item.content,
    category: r.item.category,
    similarity: r.score,
  }))
}
```

### Use in a Component

```typescript
// app/search/page.tsx
'use client'

import { useState } from 'react'
import { searchArticles } from '@/lib/search'

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const results = await searchArticles(query)
    setResults(results)
    setLoading(false)
  }

  return (
    <div className="container mx-auto py-8">
      <form onSubmit={handleSearch} className="mb-8">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search articles..."
          className="w-full px-4 py-2 border rounded"
        />
        <button
          type="submit"
          disabled={loading}
          className="mt-2 px-4 py-2 bg-blue-500 text-white rounded"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      <div className="space-y-4">
        {results.map((result) => (
          <div key={result.id} className="border rounded p-4">
            <h3 className="text-xl font-bold">{result.title}</h3>
            <p className="text-gray-600 mt-2">{result.content.substring(0, 200)}...</p>
            <div className="mt-2 text-sm text-gray-500">
              Similarity: {(result.similarity * 100).toFixed(1)}%
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

## Example Walkthrough: Building a Chatbot with RAG

This walkthrough demonstrates building an AI chatbot that uses semantic search to provide informed responses based on a knowledge base.

### Step 1: Configure RAG

```typescript
// opensaas.config.ts
export default config({
  plugins: [
    ragPlugin({
      provider: openaiEmbeddings({
        apiKey: process.env.OPENAI_API_KEY!,
        model: 'text-embedding-3-small',
      }),
      storage: pgvectorStorage(),
    }),
  ],
  lists: {
    KnowledgeBase: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
        content: searchable(text({ validation: { isRequired: true } }), {
          provider: 'openai',
          dimensions: 1536,
        }),
        category: select({
          options: [
            { label: 'Product', value: 'product' },
            { label: 'Support', value: 'support' },
            { label: 'Technical', value: 'technical' },
          ],
        }),
        published: checkbox({ defaultValue: true }),
      },
    }),
  },
})
```

### Step 2: Create Search Utility

```typescript
// lib/knowledge-search.ts
'use server'

import { createEmbeddingProvider, createVectorStorage } from '@opensaas/stack-rag'
import { getContext } from '@/.opensaas/context'

export async function searchKnowledge(query: string, options = {}) {
  const { limit = 3, minScore = 0.6 } = options
  const context = await getContext()

  const provider = createEmbeddingProvider({
    type: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
  })
  const queryVector = await provider.embed(query)

  const storage = createVectorStorage({ type: 'pgvector' })
  const results = await storage.search('KnowledgeBase', 'contentEmbedding', queryVector, {
    limit,
    minScore,
    context,
    where: { published: { equals: true } },
  })

  return results.map((r) => ({
    id: r.item.id,
    title: r.item.title,
    content: r.item.content,
    score: r.score,
  }))
}
```

### Step 3: Create Chat API Route

```typescript
// app/api/chat/route.ts
import { streamText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { searchKnowledge } from '@/lib/knowledge-search'

export async function POST(req: Request) {
  const { messages } = await req.json()
  const lastMessage = messages[messages.length - 1]

  // Retrieve relevant context from knowledge base
  const searchResults = await searchKnowledge(lastMessage.content, {
    limit: 3,
    minScore: 0.6,
  })

  // Build system message with RAG context
  let systemMessage = 'You are a helpful AI assistant.'

  if (searchResults.length > 0) {
    systemMessage += '\n\nRelevant information from knowledge base:\n\n'
    searchResults.forEach((result, i) => {
      systemMessage += `[${i + 1}] ${result.title}\n${result.content}\n\n`
    })
    systemMessage += 'Use this information to provide accurate, informed responses.'
  }

  // Stream response with RAG context
  const result = streamText({
    model: openai('gpt-4o-mini'),
    system: systemMessage,
    messages,
  })

  return result.toDataStreamResponse({
    data: {
      sources: searchResults.map((r) => ({
        id: r.id,
        title: r.title,
        score: r.score,
      })),
    },
  })
}
```

### Step 4: Create Chat UI

```typescript
// app/chat/page.tsx
'use client'

import { useChat } from 'ai/react'

export default function ChatPage() {
  const { messages, input, handleInputChange, handleSubmit, data } = useChat({
    api: '/api/chat',
  })

  return (
    <div className="container mx-auto max-w-4xl py-8">
      <div className="border rounded-lg h-[600px] flex flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 ${
                  message.role === 'user'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 text-gray-900'
                }`}
              >
                <p>{message.content}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Sources */}
        {data?.sources && data.sources.length > 0 && (
          <div className="border-t p-4 bg-gray-50">
            <p className="text-sm font-semibold mb-2">Sources:</p>
            <div className="space-y-1">
              {data.sources.map((source, i) => (
                <p key={i} className="text-sm text-gray-600">
                  {source.title} (Score: {(source.score * 100).toFixed(1)}%)
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <form onSubmit={handleSubmit} className="border-t p-4">
          <input
            value={input}
            onChange={handleInputChange}
            placeholder="Ask a question..."
            className="w-full px-4 py-2 border rounded"
          />
        </form>
      </div>
    </div>
  )
}
```

### Step 5: Seed Knowledge Base

```typescript
// scripts/seed-knowledge.ts
import { getContext } from '@/.opensaas/context'
import { sudo } from '@opensaas/stack-core/context'

const articles = [
  {
    title: 'Getting Started Guide',
    content: 'OpenSaas Stack is a config-first framework for building admin-heavy applications...',
    category: 'product',
  },
  {
    title: 'Access Control System',
    content: 'The access control system automatically secures all database operations...',
    category: 'technical',
  },
  // Add more articles
]

async function seed() {
  const context = await getContext()

  for (const article of articles) {
    // Use sudo() to bypass access control during seeding
    const created = await sudo(context.db.knowledgeBase.create({
      data: article,
    }))
    console.log(`Created: ${created.title}`)
  }
}

seed()
```

Run the seed script:

```bash
npx tsx scripts/seed-knowledge.ts
```

Embeddings will be automatically generated for each article!

## Testing RAG Functionality

### Test Embedding Generation

```typescript
// scripts/test-embeddings.ts
import { createEmbeddingProvider } from '@opensaas/stack-rag'

async function test() {
  const provider = createEmbeddingProvider({
    type: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
  })

  const embedding = await provider.embed('Hello world')

  console.log('Embedding generated!')
  console.log('Dimensions:', embedding.length)
  console.log('First 5 values:', embedding.slice(0, 5))
}

test()
```

### Test Semantic Search

```typescript
// scripts/test-search.ts
import { getContext } from '@/.opensaas/context'
import { createEmbeddingProvider, createVectorStorage } from '@opensaas/stack-rag'

async function test() {
  const context = await getContext()
  const query = 'How does access control work?'

  console.log(`Searching for: "${query}"`)

  const provider = createEmbeddingProvider({
    type: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
  })
  const queryVector = await provider.embed(query)

  const storage = createVectorStorage({ type: 'pgvector' })
  const results = await storage.search('Article', 'contentEmbedding', queryVector, {
    limit: 5,
    context,
  })

  console.log(`Found ${results.length} results:`)
  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.item.title} (Score: ${r.score.toFixed(3)})`)
  })
}

test()
```

## Troubleshooting

### pgvector Extension Not Found

**Error:**

```
ERROR: extension "vector" is not available
```

**Solution:**

The pgvector extension is not installed. Follow the installation steps for your platform:

- **Docker**: Use `pgvector/pgvector:pg16` image
- **Homebrew**: `brew install pgvector`
- **apt**: `sudo apt install postgresql-16-pgvector`

Or switch to JSON storage for development.

### OpenAI Rate Limit Errors

**Error:**

```
Error: Rate limit exceeded
```

**Solution:**

- Wait a moment and retry
- Use the `batchProcess()` utility with rate limiting
- Upgrade your OpenAI plan
- Consider Ollama for development

### Embeddings Not Generating

**Symptoms:**

- `contentEmbedding` field is always `null`
- No API calls being made

**Solutions:**

1. Check API key is set: `console.log(process.env.OPENAI_API_KEY)`
2. Verify field configuration has `autoGenerate: true` or uses `searchable()`
3. Check server console for error messages
4. Ensure content field has a value (required for embedding generation)

### Slow Search Performance

**Symptoms:**

- Searches take several seconds
- Database CPU usage high

**Solutions:**

1. **Create indexes** (for pgvector):
   ```sql
   CREATE INDEX article_embedding_idx
   ON "Article" USING ivfflat ((("contentEmbedding"->>'vector')::vector(1536)))
   WITH (lists = 100);
   ```

2. **Reduce result limit**:
   ```typescript
   storage.search(..., { limit: 5 }) // Instead of 100
   ```

3. **Use minScore filter**:
   ```typescript
   storage.search(..., { minScore: 0.7 }) // Only high-quality matches
   ```

4. **Consider pgvector** if using JSON storage with large dataset

### Database Connection Issues

**Error:**

```
Can't reach database server
```

**Solutions:**

1. Verify database is running: `psql -l` or `docker ps`
2. Check `DATABASE_URL` is correct
3. Ensure database exists: `psql -l | grep your_database`
4. Check firewall/network settings

## Next Steps

- **[RAG Package Reference](/docs/packages/rag)** - Complete API documentation
- **[RAG Advanced Patterns](/docs/guides/rag-advanced)** - Custom providers, performance tuning, and advanced use cases
- **[Example: RAG OpenAI Chatbot](https://github.com/OpenSaasAU/stack/tree/main/examples/rag-openai-chatbot)** - Production-ready chatbot implementation

You now have everything you need to implement RAG in your OpenSaas Stack application!
