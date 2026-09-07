---
'@opensaas/stack-rag': minor
'@opensaas/stack-cli': minor
---

`embedding()` is a native pgvector column with its index, distance function and write denial on the field

The field emits a `Vector(n)` column with its metadata in a `jsonb` column beside it,
declares that column to `nearest()`, and carries the vector index it wants:

```typescript
import { ragPlugin, openaiEmbeddings } from '@opensaas/stack-rag'
import { embedding } from '@opensaas/stack-rag/fields'

export default config({
  plugins: [ragPlugin({ provider: openaiEmbeddings({ apiKey: process.env.OPENAI_API_KEY! }) })],
  db: { provider: 'postgresql' },
  lists: {
    Article: list({
      fields: {
        content: text(),
        contentEmbedding: embedding({
          sourceField: 'content',
          dimensions: 1536,
          distanceFunction: 'cosine',
          index: { method: 'hnsw', m: 16, efConstruction: 64 },
        }),
      },
    }),
  },
})
```

`ragPlugin` declares the pgvector extension pack itself through `addExtension`, so no
config names it.

The operator class is derived from `distanceFunction` and the column type, and a declared
`opclass` that disagrees fails `pnpm generate`. An indexed field over 2,000 dimensions
emits `halfvec` (which pgvector can index to 4,000); over 4,000 generation fails with a
named error. An unindexed field stays `vector` at any dimension.

**`index:` does not yet build an index.** `@prisma/orm-extension-pgvector@8.0.0-rc.8`
registers no index types, so nothing lowers the declaration to a `CREATE INDEX`. Today it
derives the column type and the operator class — and applies both dimension caps above —
and nothing else. Declare it to pin the shape you want; re-check when the pack reaches GA.

`ragPlugin`'s `beforeGenerate` refuses a declared dimension that disagrees with a
statically known provider dimension, and `OllamaEmbeddingConfig.dimensions` is now
required — generation must never depend on a running Ollama:

```typescript
ollamaEmbeddings({ model: 'nomic-embed-text', dimensions: 768 })
```

The embedding and its metadata are write-denied to application code: an ordinary create or
update naming them throws. The plugin writes them itself under sudo, after the write's
transaction settles. Applications that maintain their own vectors opt out explicitly:

```typescript
manualVector: embedding({ dimensions: 1536, allowManualWrites: true })
```

Semantic search runs through the secured surface's `nearest()` terminal:

```typescript
const matches = await context.db.Article.where({ published: { equals: true } }).nearest(
  'contentEmbedding',
  queryVector,
  { limit: 10, minScore: 0.7 },
)
```

`packages/rag/src/storage/` is deleted in full — `createVectorStorage`,
`registerVectorStorage`, `JsonVectorStorage`, `JsonFileStorage`, `PgVectorStorage`,
`SqliteVssStorage`, `prismaFilterToSQL` — along with `pgvectorStorage()`,
`sqliteVssStorage()`, `jsonStorage()`, `RAGConfig.storage` and every vector-storage config
type. `semanticSearch()` and `findSimilar()` keep their names and drop their `storage`
option. The scaffolder's semantic-search feature template no longer emits a `storage`
option.

**This drops semantic search for every database except Postgres.** The `json`,
`json-file` and `sqlite-vss` backends are removed with no replacement, and `embedding()`
now emits Postgres-only columns (`pgvector.Vector(n)` plus `pg.jsonb`). An app on SQLite,
or one that used `jsonStorage()` to avoid a database extension, has no migration path in
this release other than moving to Postgres with pgvector installed. If you need the old
in-JavaScript cosine scan, keep it in your own app — `docs/lib/embeddings-search.ts` in
this repo is a ~40-line worked example of exactly that.

`@prisma/orm-extension-pgvector` is now a peer dependency of `@opensaas/stack-rag`:
install it alongside the package, since `ragPlugin` names it in every config it builds.

```bash
pnpm add @opensaas/stack-rag @prisma/orm-extension-pgvector
```
