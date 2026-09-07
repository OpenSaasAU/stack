# RAG Setup & Integration Guide

This guide covers everything you need to set up RAG (Retrieval-Augmented Generation) in your Stack application, from database configuration to building production-ready knowledge bases.

## Prerequisites

Before adding RAG to your application, ensure you have:

- **Stack** installed and configured
- **Node.js 18+** and pnpm
- **PostgreSQL with pgvector available** — embeddings are pgvector columns, so `postgresql` is the only datasource RAG runs on
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

Embeddings live in a native pgvector `vector(n)` column beside the row, with
their metadata in a `jsonb` column next to it. There is no storage backend to
choose, and nothing in your config names pgvector — `ragPlugin` declares the
extension pack itself.

Because every column the plugin emits is a pgvector column, `postgresql` is the
only datasource RAG runs on. `pnpm generate` refuses any other one, naming the
datasource it found.

### Making pgvector available

The extension has to be present on the Postgres server before a migration can
enable it. The Dev database `opensaas dev` starts carries it, and the managed
services generally offer it — Neon, Supabase and RDS among them. For a server
you run yourself:

**Using Docker (easiest):**

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
brew install postgresql@16
brew services start postgresql@16

brew install pgvector
brew services restart postgresql@16
```

**Using apt (Ubuntu/Debian):**

```bash
sudo apt install postgresql-16 postgresql-16-pgvector
sudo systemctl restart postgresql
```

### Enabling it

You do not run any SQL for this, and there is no install script. `ragPlugin`'s
declaration is a generator emission: `pnpm generate` seeds the pack's contract
space under `migrations/pgvector/` — it writes no app migration of its own — and
that space enables the extension ahead of your tables.

```bash
pnpm generate
pnpm db:update
```

`opensaas db update` opens no connection of its own: it hands the request to a
running `opensaas dev` loop and exits non-zero when none is listening. Keep
`pnpm dev` up in another terminal for the command above.

In production the same committed migration runs under `opensaas db migrate`.

### The privilege it needs

pgvector is not a trusted extension, so enabling it is not something an
unprivileged role can do. One of these has to hold:

- The role your migration connects as is a **superuser**, or your provider has
  **granted** it the extension. The Dev database and CI's container run as
  superuser; managed Postgres services generally grant it to the app role.
- Or the extension is **pre-created** in the database by hand, once, by someone
  who does have that privilege. The migration prechecks for it, finds it
  present, and records the step as already satisfied rather than failing.

Either route arrives in the same place, and a following `db:update` is a no-op.

If the server has no pgvector at all, the migration stops with Prisma's own
error — it names the `pgvector` space, the missing `vector.control` file and SQL
state `58P01`. The app's own tables are untouched, because each apply runs in
one transaction.

### Indexes

A vector index is declared on the field that owns the column, not written as
SQL:

```typescript
contentEmbedding: embedding({
  sourceField: 'content',
  dimensions: 1536,
  distanceFunction: 'cosine',
  index: { method: 'hnsw', m: 16, efConstruction: 64 },
})
```

**Index guidelines:**

- **`ivfflat`**: faster to build, good for 10k–1M vectors. Set `lists` to about
  the square root of the row count.
- **`hnsw`**: better search quality, good for 100k+ vectors. A higher `m` buys
  quality with memory.
- The operator class is derived from the field's `distanceFunction` and column
  type, so the two cannot disagree.

Known limits: `@prisma/orm-extension-pgvector@8.0.0-rc.8` registers no index
types, so an `index` declaration derives the column type and the operator class
but is not yet lowered to a `CREATE INDEX`. Searches are correct without it;
they are unindexed scans until the pack ships index support.

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

| Model                    | Dimensions | Use Case                        | Cost (per 1M tokens) |
| ------------------------ | ---------- | ------------------------------- | -------------------- |
| `text-embedding-3-small` | 1536       | General purpose, cost-effective | $0.02                |
| `text-embedding-3-large` | 3072       | Higher quality, more expensive  | $0.13                |

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
    // Required. Ollama reports its output size only from a live embed call,
    // and generation must not depend on a running Ollama.
    dimensions: 768,
  }),
})
```

#### Ollama Models

| Model               | Dimensions | Use Case              |
| ------------------- | ---------- | --------------------- |
| `nomic-embed-text`  | 768        | General purpose, fast |
| `mxbai-embed-large` | 1024       | Higher quality        |
| `all-minilm`        | 384        | Very fast, smaller    |

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
      dimensions: 768,
    }),
  },
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
          },
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
```

`pnpm dev` applies the change; if it is already running, it applies as soon as
you save the config.

### Create a Semantic Search Function

```typescript
// lib/search.ts
'use server'

import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'
import { getContext } from '@/.opensaas/context'

export async function searchArticles(query: string, limit = 10) {
  const context = await getContext()

  // Generate query embedding
  const provider = createEmbeddingProvider({
    type: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
  })
  const queryVector = await provider.embed(query)

  // One scoped query: the Access Filter, the minScore bound and the ranking
  // all live inside nearest().
  const matches = await context.db.Article.where({
    published: { equals: true },
  }).nearest('contentEmbedding', queryVector, { limit, minScore: 0.25 })

  return matches.map((match) => ({
    id: match.item.id,
    title: match.item.title,
    content: match.item.content,
    category: match.item.category,
    similarity: match.score,
  }))
}
```

`minScore` is read on the column's own distance function, not on a normalised
0–1 scale:

| `distanceFunction` | `score`         | Range     |
| ------------------ | --------------- | --------- |
| `cosine` (default) | the raw cosine  | `[-1, 1]` |
| `l2`               | `1 / (1 + d)`   | `(0, 1]`  |
| `inner_product`    | the dot product | unbounded |

So on a cosine column `minScore: 0` admits everything more alike than opposite,
and anything above about `0.5` is a tight bound most real corpora will not
reach. Start loose and tighten against your own data.

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

import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'
import { getContext } from '@/.opensaas/context'

export async function searchKnowledge(
  query: string,
  options: { limit?: number; minScore?: number } = {},
) {
  const { limit = 3, minScore = 0.25 } = options
  const context = await getContext()

  const provider = createEmbeddingProvider({
    type: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
  })
  const queryVector = await provider.embed(query)

  const matches = await context.db.KnowledgeBase.where({
    published: { equals: true },
  }).nearest('contentEmbedding', queryVector, { limit, minScore })

  return matches.map((match) => ({
    id: match.item.id,
    title: match.item.title,
    content: match.item.content,
    score: match.score,
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
    minScore: 0.25,
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

const articles = [
  {
    title: 'Getting Started Guide',
    content: 'Stack is a config-first framework for building admin-heavy applications...',
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
  // `sudo()` returns a context that bypasses access control, for a script
  // that runs with no session.
  const context = (await getContext()).sudo()

  for (const article of articles) {
    await context.db.KnowledgeBase.create({ data: article })
    console.log(`Created: ${article.title}`)
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
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'

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
import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'

async function test() {
  const context = await getContext()
  const query = 'How does access control work?'

  console.log(`Searching for: "${query}"`)

  const provider = createEmbeddingProvider({
    type: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
  })
  const queryVector = await provider.embed(query)

  const matches = await context.db.Article.nearest('contentEmbedding', queryVector, {
    limit: 5,
  })

  console.log(`Found ${matches.length} results:`)
  matches.forEach((match, i) => {
    console.log(`${i + 1}. ${String(match.item.title)} (Score: ${match.score.toFixed(3)})`)
  })
}

test()
```

## Troubleshooting

### pgvector Not Available

**Error:**

```
MIGRATION.RUNNER_FAILED ... could not open extension control file ... vector.control
```

**Solution:**

pgvector is not present on the server. Make it available, then re-run
`pnpm db:update`:

- **Docker**: use the `pgvector/pgvector:pg16` image
- **Homebrew**: `brew install pgvector`
- **apt**: `sudo apt install postgresql-16-pgvector`
- **Managed Postgres**: Neon, Supabase and RDS offer it; check your provider's
  extension list

### Permission Denied Enabling pgvector

**Error:**

```
ERROR: permission denied to create extension "vector"
```

**Solution:**

pgvector is not a trusted extension, so the migrating role needs superuser or a
provider grant. Either grant the role that privilege, or have someone who
already holds it pre-create the extension in the database once — the migration
prechecks for it and records the step as already satisfied.

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

1. **Declare an index** on the embedding field:

   ```typescript
   contentEmbedding: embedding({
     sourceField: 'content',
     index: { method: 'hnsw', m: 16, efConstruction: 64 },
   })
   ```

   See [Indexes](#indexes) for what the pack builds today.

2. **Reduce the result limit**:

   ```typescript
   context.db.Article.nearest('contentEmbedding', queryVector, { limit: 5 })
   ```

3. **Bound the search with `minScore`**, which is lowered into the query as a
   distance bound rather than filtered afterwards:

   ```typescript
   context.db.Article.nearest('contentEmbedding', queryVector, { minScore: 0.25 })
   ```

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

- **[RAG Package Reference](/docs/reference/rag)** - Complete API documentation
- **[RAG Advanced Patterns](/docs/how-to/rag-advanced)** - Custom providers, performance tuning, and advanced use cases
- **[Example: RAG OpenAI Chatbot](https://github.com/OpenSaasAU/stack/tree/main/examples/rag-openai-chatbot)** - Production-ready chatbot implementation

You now have everything you need to implement RAG in your Stack application!
