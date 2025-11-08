# Installing pgvector Extension

The pgvector extension is required for database-level vector similarity search in PostgreSQL.

## Option 1: If using Docker PostgreSQL (Recommended)

If you're running PostgreSQL in Docker, recreate the container with pgvector support:

```bash
# Stop and remove existing container
docker stop postgres-rag || true
docker rm postgres-rag || true

# Run PostgreSQL with pgvector
docker run -d \
  --name postgres-rag \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=rag_chatbot \
  -p 5432:5432 \
  pgvector/pgvector:pg16

# Wait a few seconds for PostgreSQL to start
sleep 5

# Push schema to new database
pnpm db:push
```

## Option 2: If using Homebrew PostgreSQL (Mac)

```bash
# Install pgvector extension
brew install pgvector

# Restart PostgreSQL
brew services restart postgresql@16

# Connect and enable extension
psql -U postgres -d rag_chatbot -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

## Option 3: If using apt PostgreSQL (Linux)

```bash
# Install pgvector
sudo apt install postgresql-16-pgvector

# Restart PostgreSQL
sudo systemctl restart postgresql

# Enable extension
sudo -u postgres psql -d rag_chatbot -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

## Option 4: Use a Managed Service with pgvector

Switch to a managed PostgreSQL service that supports pgvector:

- **Supabase** (free tier available, pgvector pre-installed)
- **Neon** (free tier available, pgvector supported)
- **AWS RDS** (install pgvector via extensions)

Update your `.env` file with the new DATABASE_URL.

## Option 5: Fallback to JSON Storage (No pgvector needed)

If you can't install pgvector, you can use JSON-based vector storage (slower, but works):

```typescript
// opensaas.config.ts
import { jsonStorage } from '@opensaas/stack-rag'

export default config({
  plugins: [
    ragPlugin({
      provider: openaiEmbeddings({ apiKey: process.env.OPENAI_API_KEY! }),
      storage: jsonStorage(), // ← Use JSON storage instead of pgvector
    }),
  ],
  // ... rest of config
})
```

Then regenerate and push schema:

```bash
pnpm generate
pnpm db:push
```

## Verify Installation

After installing pgvector, verify it's working:

```bash
# Generate Prisma client
npx prisma generate

# Run the install script
npx tsx scripts/install-pgvector.ts
```

You should see:

```
✅ pgvector extension installed successfully!
✅ Verified: pgvector extension is active
```

## Troubleshooting

If you still get the error:

```
ERROR: type "vector" does not exist
```

The extension isn't properly installed on your PostgreSQL server. Follow the appropriate installation method above for your setup.
