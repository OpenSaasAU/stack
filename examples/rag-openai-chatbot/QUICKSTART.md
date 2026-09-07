# Quick Start Guide

Get the RAG OpenAI Chatbot demo running in 5 minutes!

## Prerequisites

- OpenAI API key
- Node.js 18+ and pnpm

That is all you need: leave `DATABASE_URL` unset and `pnpm dev` starts a Dev
database that already carries pgvector. To bring your own Postgres, see
[Using your own PostgreSQL](#using-your-own-postgresql) below.

## Quick Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Setup environment
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# 3. Start the development server — it brings the database up, generates
#    and reconciles before running the app
pnpm dev
```

`pnpm dev` keeps running. In a second terminal, seed the knowledge base:

```bash
pnpm db:seed
```

## Visit the App

- **Homepage:** http://localhost:3000
- **Chatbot:** http://localhost:3000/chat
- **Search:** http://localhost:3000/search
- **Admin:** http://localhost:3000/admin

## Using your own PostgreSQL

The server needs pgvector **available**; enabling it is the migration's job, not
yours. Docker is the shortest route:

```bash
docker run -d \
  --name postgres-pgvector \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=rag_chatbot \
  -p 5432:5432 \
  pgvector/pgvector:pg16
```

Then point `.env` at it:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/rag_chatbot?schema=public"
```

On an existing server, create the database and let `pnpm dev` do the rest:

```bash
createdb rag_chatbot
```

pgvector is not a trusted extension, so the role in your `DATABASE_URL` needs
superuser or a provider grant to enable it. If it has neither, have someone who
does pre-create the extension in that database once — the migration prechecks
for it and records the step as already satisfied.

## Test the Features

1. **Chat:** Ask "What is OpenSaas Stack?" in the chatbot
2. **Search:** Search for "access control" to see semantic matching
3. **Admin:** Create a new article and watch embeddings generate automatically

## Troubleshooting

**Can't connect to database?**

- Make sure PostgreSQL is running: `pg_isready`
- Check your DATABASE_URL in `.env`

**OpenAI errors?**

- Verify your OPENAI_API_KEY is correct
- Check you have credits: https://platform.openai.com/usage

**Embeddings not generating?**

- Check the server console for errors
- Ensure articles have content (required field)

## Next Steps

Read the full [README.md](./README.md) for:

- Detailed architecture explanation
- How RAG works in this demo
- Performance optimization tips
- Customization options
