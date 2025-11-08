# Quick Start Guide

Get the RAG OpenAI Chatbot demo running in 5 minutes!

## Prerequisites

- PostgreSQL with pgvector extension installed and running
- OpenAI API key
- Node.js 18+ and pnpm

## Quick Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Setup environment
cp .env.example .env
# Edit .env and add your DATABASE_URL and OPENAI_API_KEY

# 3. Generate schema and create database
pnpm generate
pnpm db:push

# 4. Seed the knowledge base
pnpm db:seed

# 5. Start the development server
pnpm dev
```

## Visit the App

- **Homepage:** http://localhost:3000
- **Chatbot:** http://localhost:3000/chat
- **Search:** http://localhost:3000/search
- **Admin:** http://localhost:3000/admin

## Try These Commands

### Using Docker for PostgreSQL (easiest)

```bash
docker run -d \
  --name postgres-pgvector \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=rag_chatbot \
  -p 5432:5432 \
  ankane/pgvector
```

Then use this in `.env`:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/rag_chatbot?schema=public"
```

### Create Database Manually

```bash
createdb rag_chatbot
psql rag_chatbot -c "CREATE EXTENSION vector;"
```

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
