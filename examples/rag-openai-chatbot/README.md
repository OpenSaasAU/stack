# OpenSaas RAG OpenAI Chatbot Demo

A production-ready demo showcasing **Retrieval-Augmented Generation (RAG)** with OpenSaas Stack, OpenAI embeddings, and pgvector for semantic search. Features an intelligent chatbot that answers questions about OpenSaas Stack using a knowledge base.

## Features

- 🤖 **AI-Powered Chatbot** - Chat with an AI assistant that has access to a comprehensive OpenSaas Stack knowledge base
- 🔍 **Semantic Search** - Search articles using natural language with vector similarity scoring
- 📚 **Knowledge Base** - 18 pre-loaded articles about OpenSaas Stack with automatic embedding generation
- ⚡ **Automatic Embeddings** - Uses OpenAI's `text-embedding-3-small` model with automatic regeneration on content changes
- 🗄️ **pgvector Storage** - Production-ready PostgreSQL vector storage with cosine similarity search
- 🎯 **RAG Implementation** - Retrieves relevant context from knowledge base to enhance AI responses
- 📊 **Source Citations** - Chatbot responses include citations to the knowledge base articles used
- 🔒 **No Authentication** - Simplified demo without auth requirements

## Tech Stack

- **OpenSaas Stack** - Config-first Next.js framework with built-in access control
- **Vercel AI SDK** - Streaming AI responses with `ai`, `@ai-sdk/react`, and `@ai-sdk/openai`
- **OpenAI** - `text-embedding-3-small` for embeddings, `gpt-4o-mini` for chat completions
- **pgvector** - PostgreSQL extension for efficient vector similarity search
- **Next.js 16** - App Router with streaming responses
- **TypeScript** - End-to-end type safety
- **Tailwind CSS** - Utility-first styling

## Prerequisites

- Node.js 18+ and pnpm
- PostgreSQL 15+ with pgvector extension
- OpenAI API key ([Get one here](https://platform.openai.com/api-keys))

## Setup Instructions

### 1. Install PostgreSQL and pgvector

**macOS (using Homebrew):**
```bash
brew install postgresql@15
brew services start postgresql@15

# Install pgvector
brew install pgvector
```

**Ubuntu/Debian:**
```bash
sudo apt-get install postgresql-15 postgresql-15-pgvector
sudo systemctl start postgresql
```

**Docker:**
```bash
docker run -d \
  --name postgres-pgvector \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=rag_chatbot \
  -p 5432:5432 \
  ankane/pgvector
```

### 2. Create Database

```bash
# Using psql
createdb rag_chatbot

# Or connect to PostgreSQL and run:
CREATE DATABASE rag_chatbot;
```

### 3. Enable pgvector Extension

```bash
psql rag_chatbot

# In the PostgreSQL shell:
CREATE EXTENSION vector;
\q
```

### 4. Install Dependencies

```bash
pnpm install
```

### 5. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` and add your credentials:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/rag_chatbot?schema=public"
OPENAI_API_KEY="sk-..."
```

### 6. Generate Schema and Push to Database

```bash
# Generate Prisma schema and TypeScript types from opensaas.config.ts
pnpm generate

# Push schema to database
pnpm db:push
```

### 7. Seed the Database

```bash
pnpm db:seed
```

This creates 18 articles about OpenSaas Stack. Embeddings are generated automatically via the RAG plugin hooks.

### 8. Run Development Server

```bash
pnpm dev
```

Visit:
- **Homepage:** [http://localhost:3000](http://localhost:3000)
- **Chatbot:** [http://localhost:3000/chat](http://localhost:3000/chat)
- **Search:** [http://localhost:3000/search](http://localhost:3000/search)
- **Admin:** [http://localhost:3000/admin](http://localhost:3000/admin)

## Usage

### Chatbot (`/chat`)

Ask questions about OpenSaas Stack:
- "What is OpenSaas Stack?"
- "How does the access control system work?"
- "What are hooks in OpenSaas Stack?"
- "How do I create custom field types?"

The chatbot will:
1. Convert your question to a vector embedding
2. Search for the 3 most relevant articles
3. Use them as context for GPT-4 to generate an informed response
4. Show which sources were used with similarity scores

### Semantic Search (`/search`)

Search the knowledge base using natural language:
- "access control" - finds articles about the access control system
- "plugin system" - finds articles about plugins and extensions
- "embedding generation" - finds articles about RAG integration

Results are ranked by semantic similarity (cosine distance).

### Admin Panel (`/admin`)

Full CRUD interface for managing the knowledge base:
- Create new articles
- Edit existing articles
- Delete articles
- View embedding metadata (provider, model, dimensions, source hash)

Embeddings are automatically generated/updated when articles are created or modified.

## Project Structure

```
examples/rag-openai-chatbot/
├── app/
│   ├── actions/
│   │   └── search.ts        # Server action for semantic search
│   ├── api/
│   │   └── chat/
│   │       └── route.ts     # Streaming API route with RAG (Vercel AI SDK)
│   ├── admin/               # Admin UI (auto-generated CRUD)
│   ├── chat/                # Chatbot page
│   ├── search/              # Search page
│   ├── globals.css          # Global styles
│   ├── layout.tsx           # Root layout
│   └── page.tsx             # Homepage
├── components/
│   ├── ChatInterface.tsx    # Chat UI component (uses useChat hook)
│   ├── SearchInterface.tsx  # Search UI component
│   └── KnowledgeCard.tsx    # Article display card
├── scripts/
│   └── seed.ts              # Database seeding script
├── opensaas.config.ts       # OpenSaas Stack configuration
├── package.json
└── README.md
```

## How RAG Works in This Demo

### 1. Embedding Generation

When an article is created or updated:

```typescript
// Defined in opensaas.config.ts
content: searchable(text(), {
  provider: 'openai',
  dimensions: 1536,
})
```

The `searchable()` wrapper:
- Automatically creates a `contentEmbedding` field
- Adds a `resolveInput` hook that generates embeddings on create/update
- Uses OpenAI's `text-embedding-3-small` model (1536 dimensions)
- Stores embeddings as JSON with metadata (model, provider, dimensions, source hash)

### 2. Semantic Search

When searching (in `app/actions/search.ts`):

```typescript
const provider = createEmbeddingProvider({
  type: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
})

const queryVector = await provider.embed(query)

// Calculate similarity with stored embeddings
const score = cosineSimilarity(queryVector, article.contentEmbedding.vector)
```

### 3. RAG Chat Flow

When chatting (in `app/api/chat/route.ts`):

1. **Retrieve:** Search for top 3 relevant articles using semantic search
2. **Augment:** Build system message with context from retrieved articles
3. **Generate:** Stream response from GPT-4 using Vercel AI SDK

```typescript
// Perform semantic search
const searchResults = await searchKnowledge(userQuery, {
  limit: 3,
  minScore: 0.6,
})

// Build system message with RAG context
let systemMessage = 'You are a helpful AI assistant...'
if (searchResults.length > 0) {
  systemMessage += '\n\nRelevant information from knowledge base:\n\n'
  searchResults.forEach((result, i) => {
    systemMessage += `[${i + 1}] ${result.title}\n${result.content}\n\n`
  })
}

// Stream response with Vercel AI SDK
const result = streamText({
  model: openai('gpt-4o-mini'),
  system: systemMessage,
  messages: convertToModelMessages(messages),
})

return result.toUIMessageStreamResponse({
  data: {
    sources: searchResults.map(r => ({ id: r.id, title: r.title, score: r.score }))
  }
})
```

## Configuration Details

### OpenSaas Stack Config

```typescript
// opensaas.config.ts
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
            { label: 'AI/ML', value: 'ai-ml' },
            { label: 'Web Development', value: 'web-dev' },
            { label: 'Software Engineering', value: 'software-eng' },
            { label: 'Database', value: 'database' },
            { label: 'DevOps', value: 'devops' },
          ],
        }),
        published: checkbox({ defaultValue: true }),
      },
      access: {
        operation: {
          query: () => true,
          create: () => true,
          update: () => true,
          delete: () => true,
        },
      },
    }),
  },
})
```

### Generated Prisma Schema

The `pnpm generate` command creates:

```prisma
model KnowledgeBase {
  id                String   @id @default(cuid())
  title             String
  content           String
  contentEmbedding  Json?    // Stores vector + metadata
  category          String
  published         Boolean  @default(true)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

Embeddings are stored as JSON:

```json
{
  "vector": [0.123, -0.456, 0.789, ...],  // 1536 dimensions
  "metadata": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "dimensions": 1536,
    "generatedAt": "2024-11-08T10:30:00.000Z",
    "sourceHash": "abc123..."
  }
}
```

## Performance Optimization

### Indexing (Optional)

For large datasets, create a pgvector index:

```sql
CREATE INDEX knowledge_base_embedding_idx
ON "KnowledgeBase" USING ivfflat ((("contentEmbedding"->>'vector')::vector(1536)))
WITH (lists = 100);
```

### Change Detection

Embeddings only regenerate when content changes, using source hash comparison.

### Rate Limiting

OpenAI has rate limits. For batch operations, use the `batchProcess()` utility from `@opensaas/stack-rag/runtime`.

## Customization

### Use Different OpenAI Models

Edit `.env`:
```env
OPENAI_CHAT_MODEL="gpt-4o"  # Use GPT-4 instead of GPT-4o-mini
```

### Change Embedding Dimensions

For `text-embedding-3-large` (3072 dimensions):

```typescript
ragPlugin({
  provider: openaiEmbeddings({
    apiKey: process.env.OPENAI_API_KEY!,
    model: 'text-embedding-3-large',
  }),
  // ...
})

// Update field dimensions
content: searchable(text(), {
  provider: 'openai',
  dimensions: 3072,
})
```

### Add Your Own Articles

Use the Admin UI at `/admin` or seed script in `scripts/seed.ts`.

## Troubleshooting

### pgvector Extension Not Found

```
ERROR: extension "vector" is not available
```

**Solution:** Install pgvector extension for your PostgreSQL version.

### OpenAI Rate Limit Errors

```
Error: Rate limit exceeded
```

**Solution:** Wait a moment and try again, or upgrade your OpenAI plan.

### Embeddings Not Generating

**Check:**
1. `OPENAI_API_KEY` is set correctly
2. Articles have content (required for embedding generation)
3. Check server console for error messages

### Database Connection Errors

**Check:**
1. PostgreSQL is running
2. `DATABASE_URL` is correct
3. Database exists: `psql -l | grep rag_chatbot`

## Learn More

- [OpenSaas Stack Documentation](https://stack.opensaas.au/)
- [RAG Integration Spec](/specs/rag-integration.md)
- [OpenAI Embeddings Guide](https://platform.openai.com/docs/guides/embeddings)
- [pgvector Documentation](https://github.com/pgvector/pgvector)

## License

MIT
