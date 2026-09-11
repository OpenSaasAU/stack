# OpenSaas RAG OpenAI Chatbot Demo

A production-ready demo showcasing **Retrieval-Augmented Generation (RAG)** with OpenSaas Stack, OpenAI embeddings, and pgvector for semantic search. Features an intelligent chatbot that answers questions about OpenSaas Stack using a knowledge base.

## Features

- 🤖 **AI-Powered Chatbot** - Chat with an AI assistant that has access to a comprehensive OpenSaas Stack knowledge base
- 🔍 **Semantic Search** - Search articles using natural language with vector similarity scoring
- 📚 **Knowledge Base** - 18 pre-loaded articles about OpenSaas Stack with automatic embedding generation
- ⚡ **Automatic Embeddings** - Uses OpenAI's `text-embedding-3-small` model with automatic regeneration on content changes
- 🗄️ **Native pgvector Column** - a `vector(1536)` column ranked in the database by `nearest()`
- 🎯 **RAG Implementation** - Retrieves relevant context from knowledge base to enhance AI responses
- 📊 **Source Citations** - Chatbot responses include citations to the knowledge base articles used
- 🔒 **No Authentication** - Simplified demo without auth requirements

## Tech Stack

- **OpenSaas Stack** - Config-first Next.js framework with built-in access control
- **Vercel AI SDK** - Streaming AI responses with `ai`, `@ai-sdk/react`, and `@ai-sdk/openai`
- **OpenAI** - `text-embedding-3-small` for embeddings, `gpt-5-nano` for chat completions
- **pgvector** - PostgreSQL extension for efficient vector similarity search
- **Next.js 16** - App Router with streaming responses
- **TypeScript** - End-to-end type safety
- **Tailwind CSS** - Utility-first styling

## Prerequisites

- Node.js 22.18+ and pnpm (the workspace's `engines` field is `>=22.18.0`)
- No database of your own: `pnpm dev` starts a Dev database — an in-process
  PGlite behind a socket server — and it carries pgvector. Bringing your own
  Postgres instead needs PostgreSQL 15+ with pgvector available on that server.
- OpenAI API key ([Get one here](https://platform.openai.com/api-keys))

## Setup Instructions

### 1. Make pgvector available (only if you bring your own Postgres)

Skip this whole step to develop on the Dev database `pnpm dev` starts — it
carries pgvector already. To point the example at a Postgres of your own, the
extension has to be present on that server:

**macOS (using Homebrew):**

```bash
brew install postgresql@15
brew services start postgresql@15
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
  pgvector/pgvector:pg16
```

The `docker run` above already creates `rag_chatbot` from `POSTGRES_DB`, so
there is nothing more to do on that route. On a Postgres you already run, create
the database yourself instead:

```bash
createdb rag_chatbot
```

You do **not** enable the extension yourself, and there is no install script to
run. `ragPlugin` declares the pgvector extension pack, `pnpm generate` seeds
that pack's contract space under `migrations/` — it writes no app migration of
its own — and `pnpm dev` enables the extension when it reconciles. `pnpm dev`
has to be running for `pnpm db:update` to have anything to talk to.

pgvector is not a trusted extension, so the role in your `DATABASE_URL` needs
superuser or a provider grant to enable it. If it has neither, have someone who
does pre-create the extension in that database once — the migration prechecks
for it and records the step as already satisfied.

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` and add your credentials:

```env
OPENAI_API_KEY="sk-..."
```

Leave `DATABASE_URL` unset to develop on the Dev database, or set it to reach a
Postgres of your own.

### 4. Generate Schema

```bash
pnpm generate
```

`pnpm dev` runs this for you and reconciles the database with what it emits.

### 5. Run Development Server

```bash
pnpm dev
```

Visit:

- **Homepage:** [http://localhost:3000](http://localhost:3000)
- **Chatbot:** [http://localhost:3000/chat](http://localhost:3000/chat)
- **Search:** [http://localhost:3000/search](http://localhost:3000/search)
- **Admin:** [http://localhost:3000/admin](http://localhost:3000/admin)

### 6. Seed the Database

With `pnpm dev` running in another terminal:

```bash
pnpm db:seed
```

This creates 18 articles about OpenSaas Stack. Embeddings are generated
automatically by the RAG plugin once each write commits, and the script waits
for them rather than exiting while columns are still null.

It clears the list first, so it re-runs from empty as often as you like. An
embedding is derived data — it is regenerated from the article text, never
carried over.

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
3. Use them as context for the chat model to generate an informed response
4. Show which sources were used with similarity scores

### Semantic Search (`/search`)

Search the knowledge base using natural language:

- "access control" - finds articles about the access control system
- "plugin system" - finds articles about plugins and extensions
- "embedding generation" - finds articles about RAG integration

Results are ranked by semantic similarity (cosine distance).

### Admin Panel (`/admin`)

A browse-and-delete interface for the knowledge base. Browsing and deleting work.
Creating and editing are both offered and both always refused, for two different
reasons.

Creating is offered but always refused. This list sets `create: () => false`
(see [OpenSaas Stack Config](#opensaas-stack-config) below) so the seed script can demonstrate
`sudo()` bypassing it, and the admin page builds an anonymous context. The Create
button on a list view carries no access check at all, and
`/admin/knowledge-base/create` returns the form regardless — so the create is
offered, attempted, and refused **loudly**, with `Access denied or operation
failed` above the form. `pnpm db:seed` is how articles get in.

`contentEmbedding` has no admin component — no field component is registered for
the `embedding` type — so the column renders as an unsupported field rather than
showing its provider, model, dimensions and source hash. Read that metadata from
`contentEmbedding.metadata`: the field is one logical value assembled from two
columns, and core strips the per-part columns on the way out, so the raw
`contentEmbeddingMetadata` column never reaches a caller.

Editing is offered and refused too, for an unrelated reason. `contentEmbedding` is
write-denied to application code, and the item form submits every field it was
handed rather than only the ones that changed — so a Save carries the embedding
back and core refuses it with
`Validation failed: Cannot update "contentEmbedding": field-level access denied.`
above the fields, leaving the row untouched.

Embeddings are still regenerated automatically whenever an article's `content`
changes — from `pnpm db:seed`, or from any `context.db.KnowledgeBase.update()`
naming only the fields you mean to write. An edit made in the admin UI is not one
of those.

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
content: text({ validation: { isRequired: true } }),
contentEmbedding: embedding({
  sourceField: 'content',
  provider: 'openai',
  dimensions: 1536,
  distanceFunction: 'cosine',
  autoGenerate: true,
  index: { method: 'hnsw', m: 16, efConstruction: 64 },
}),
```

This example writes the companion field out; `rag-ollama-demo` shows the
`searchable()` wrapper, which adds the same field for you. Spelling it out is
what lets the column declare its own distance function and index.

The field:

- Is what `ragPlugin` scans for: seeing `autoGenerate`, the plugin installs an
  `afterTransaction` hook on the list that embeds the persisted text once the write commits
- Uses OpenAI's `text-embedding-3-small` model (1536 dimensions)
- Stores the vector in a pgvector `vector(1536)` column, with its metadata (model, provider, dimensions, source hash) in a `jsonb` column beside it
- Is write-denied to application code: an ordinary create or update naming it
  throws, because the vector is the plugin's output

**Known limit:** `@prisma/orm-extension-pgvector@8.0.0-rc.8` registers no index
types, so that `index` declaration derives the column type and operator class
and is **not** yet lowered to a `CREATE INDEX`
([#1265](https://github.com/OpenSaasAU/stack/issues/1265)). Every search is an
exact scan — `EXPLAIN` reports a sequential scan and a sort. At 18 articles that
is irrelevant; at corpus scale it is not.

### 2. Semantic Search

When searching (in `app/actions/search.ts`):

```typescript
const provider = createEmbeddingProvider({
  type: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'text-embedding-3-small',
})

const queryVector = await provider.embed(query)

// One scoped query: the Access Filter, the minScore bound and the ranking all
// live inside nearest(). No `published` filter is written here — this context
// is anonymous, and the list's own `query` rule bounds it before the ranking.
const matches = await context.db.KnowledgeBase.nearest('contentEmbedding', queryVector, {
  limit,
  minScore,
})
```

### 3. RAG Chat Flow

When chatting (in `app/api/chat/route.ts`):

1. **Retrieve:** Search for top 3 relevant articles using semantic search
2. **Augment:** Build system message with context from retrieved articles
3. **Generate:** Stream the response from the chat model using the Vercel AI SDK

```typescript
// Perform semantic search
const searchResults = await searchKnowledge(userQuery, {
  limit: 3,
  // Raw cosine, not a normalised 0-1 score: 0.25 is a loose floor.
  minScore: 0.25,
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
  model: openai(process.env.OPENAI_CHAT_MODEL || 'gpt-5-nano'),
  system: systemMessage,
  messages: await convertToModelMessages(messages),
})

return result.toUIMessageStreamResponse({
  messageMetadata: () => ({
    sources: searchResults.map((r) => ({ id: r.id, title: r.title, score: r.score })),
  }),
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
    }),
  ],
  db: { provider: 'postgresql' },
  lists: {
    KnowledgeBase: list({
      fields: {
        title: text({
          validation: { isRequired: true },
          ui: { displayMode: 'input' },
        }),
        content: text({
          validation: { isRequired: true },
          ui: { displayMode: 'textarea' },
        }),
        contentEmbedding: embedding({
          sourceField: 'content',
          provider: 'openai',
          dimensions: 1536,
          distanceFunction: 'cosine',
          autoGenerate: true,
          index: { method: 'hnsw', m: 16, efConstruction: 64 },
        }),
        category: select({
          options: [
            { label: 'AI/ML', value: 'ai-ml' },
            { label: 'Web Development', value: 'web-dev' },
            { label: 'Software Engineering', value: 'software-eng' },
            { label: 'Database', value: 'database' },
            { label: 'DevOps', value: 'devops' },
          ],
          validation: { isRequired: true },
          ui: { displayMode: 'select' },
        }),
        published: checkbox({ defaultValue: true }),
      },
      access: {
        operation: {
          // Anonymous readers — the search page and the chatbot — see published
          // articles only. `nearest()` ranks inside that scope, so an
          // unpublished article cannot reach an answer even when it is the
          // closest match.
          query: ({ session }) => (session ? true : { published: { equals: true } }),
          // Denied so the seed script can demonstrate sudo() bypassing it
          create: () => false,
          update: () => true,
          delete: () => true,
        },
      },
    }),
  },
})
```

### Emitted columns

`pnpm generate` emits the app's contract — the schema the app's own migration is
later planned from — so `KnowledgeBase` carries `id`, `title`, `content`,
`category` and `published`, plus two columns for the one `contentEmbedding`
field:

| Column                     | Type           |
| -------------------------- | -------------- |
| `contentEmbedding`         | `vector(1536)` |
| `contentEmbeddingMetadata` | `jsonb`        |

There is no `createdAt`/`updatedAt` pair. `id` is the only column added for you;
auto-timestamps are off by default (ADR-0004) and this config opts into them
nowhere. A list that wants them either declares the two fields itself or sets
`db: { timestamps: true }` — on the list, or on `db` for every list at once.

The vector is a native pgvector column, not JSON, and the field reassembles the
pair into a single value on read:

```json
{
  "vector": [0.123, -0.456, 0.789],
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

For large datasets, declare an index on the embedding field rather than writing
SQL:

```typescript
contentEmbedding: embedding({
  sourceField: 'content',
  index: { method: 'ivfflat', lists: 100 },
})
```

Known limits: the pgvector pack this example ships against registers no index
types, so the declaration derives the column type and the operator class and is
not yet lowered to a real index ([#1265](https://github.com/OpenSaasAU/stack/issues/1265)).

### Change Detection

Embeddings only regenerate when content changes, using source hash comparison.

### Rate Limiting

OpenAI has rate limits. For batch operations, use the `batchProcess()` utility from `@opensaas/stack-rag/runtime`.

## Customization

### Use Different OpenAI Models

Edit `.env`:

```env
OPENAI_CHAT_MODEL="gpt-4o"  # the /chat route defaults to gpt-5-nano
```

The embedding model is not an environment variable: it is declared in
`opensaas.config.ts`, because its dimension is the vector column's type and
changing it is a migration rather than a setting.

### Change Embedding Dimensions

For `text-embedding-3-large` (3072 dimensions). Note that the committed field's
`index` declaration has to go with it — see below:

```typescript
ragPlugin({
  provider: openaiEmbeddings({
    apiKey: process.env.OPENAI_API_KEY!,
    model: 'text-embedding-3-large',
  }),
  // ...
})

// Update the column's dimension to match, and drop `index`
contentEmbedding: embedding({
  sourceField: 'content',
  provider: 'openai',
  dimensions: 3072,
  distanceFunction: 'cosine',
  autoGenerate: true,
})
```

Dropping `index` is not optional at this dimension. pgvector indexes `vector` to
2,000 dimensions, so an **indexed** field above that resolves to a `halfvec`
column — and `@prisma/orm-extension-pgvector@8.0.0-rc.8` registers only `Vector`.
Keeping the `index` this example's config declares therefore fails `pnpm generate`
outright, before any migration is planned:

```
❌ Error: prisma contract emit failed (exit 2).
CONTRACT.SOURCE_LOAD_FAILED ... "why":"type.pgvector.HalfVector is not a function"
```

With `index` dropped, the column emits as an unindexed `vector(3072)` — which
costs nothing here, since that `index` declaration is not yet lowered to a
`CREATE INDEX` anyway (#1265, the Known limit noted on the field).

The dimension is the column's type, so this retypes the column. The dev loop
will not apply that unasked, and says so:

```
This change would destroy data, so it was not applied:

  • Alter type of "KnowledgeBase"."contentEmbedding" to vector(3072) (destructive)
    ALTER TABLE "public"."KnowledgeBase" ALTER COLUMN "contentEmbedding" TYPE vector(3072) USING "contentEmbedding"::vector(3072)
```

**Clear the stored vectors before you apply it.** That `USING` cast cannot widen
a stored 1536-dimension vector, so on a seeded database the migration does not
half-succeed — it aborts, and consent does not get you past it:

```
MIGRATION.RUNNER_FAILED — Operation alterType.KnowledgeBase.contentEmbedding failed
  why:      "expected 3072 dimensions, not 1536"
  sqlState: 22000
The database is unchanged and nothing was promoted.        # exit 1
```

So empty the column first. Deleting the articles works — this list allows
`delete`, so the Admin UI's Delete button is a route in — and so does nulling
just the vectors if you want to keep the rows:

```bash
psql "$(node -p "require('./.opensaas/dev-db.json').url")" \
  -c 'update "KnowledgeBase" set "contentEmbedding" = NULL'
```

With no vector left to cast, `pnpm db:update --confirm postgres` exits 0 and
reports `Applied, promoted.`. Re-run `pnpm db:seed` to regenerate the embeddings
from the article text — it clears the list before recreating it, so it is safe on
either route. Asked for consent in a non-interactive session, `db update` prints:

```
"Apply 1 destructive operation(s) to postgres? Data they remove cannot be recovered:
  - Alter type of "KnowledgeBase"."contentEmbedding" to vector(3072)" requires explicit
consent, and the session is not interactive. Grant it by passing --confirm postgres.
```

### Add Your Own Articles

Add them to `sampleArticles` in `scripts/seed.ts` and re-run `pnpm db:seed`. The
Admin UI is not a route in: this list denies `create`, and the seed's `sudo()` is
what gets past it.

## Troubleshooting

### pgvector Not Available

```
MIGRATION.RUNNER_FAILED ... could not open extension control file ... vector.control
```

**Solution:** the server your `DATABASE_URL` points at has no pgvector. Install
it for that PostgreSQL version, or unset `DATABASE_URL` to use the Dev database,
which carries it.

### Permission Denied Enabling pgvector

```
ERROR: permission denied to create extension "vector"
```

**Solution:** pgvector is not a trusted extension, so the connecting role needs
superuser or a provider grant. Either grant it, or have someone who already
holds the privilege pre-create the extension in that database once — the
migration prechecks for it and skips the step.

### OpenAI Rate Limit Errors

The provider wraps every OpenAI failure, so a 429 reaches you as
`OpenAI embedding generation failed:` followed by the SDK's own message
(`429 Rate limit reached for ...`).

**Solution:** Wait a moment and try again, or upgrade your OpenAI plan.

### Embeddings Not Generating

**Check:**

1. `OPENAI_API_KEY` is set correctly
2. Articles have content (required for embedding generation)
3. Read the terminal you ran the write from. The plugin embeds in an
   `afterTransaction` hook, which runs in whichever process made the write — so
   provider errors from `pnpm db:seed` print in the seed's own terminal, not in
   the `pnpm dev` console.

### Database Connection Errors

On the default path there is no database of your own to check: `pnpm dev` starts
the Dev database on a loopback port of its own choosing and records it in
`.opensaas/dev-db.json`. `pg_isready` and `psql -l` with no arguments answer for
a local PostgreSQL install, which is a different server — they will report
healthy, or absent, regardless of the Dev database. To reach the Dev database,
take its URL from that file:

```bash
psql "$(node -p "require('./.opensaas/dev-db.json').url")" -c '\dt'
```

**If you set `DATABASE_URL` to a Postgres of your own**, then the usual checks
apply: the server is running (`pg_isready`), the URL is correct, and the
database exists (`psql -l | grep rag_chatbot`).

## Learn More

- [OpenSaas Stack Documentation](https://stack.opensaas.au/)
- [RAG Integration Spec](../../specs/rag-integration.md)
- [OpenAI Embeddings Guide](https://platform.openai.com/docs/guides/embeddings)
- [pgvector Documentation](https://github.com/pgvector/pgvector)

## License

MIT
