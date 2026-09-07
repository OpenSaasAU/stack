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

`embedding()` declares its two columns through `getContractField` alone. It carries no
`getPrismaType`/`getTypeScriptType`: one field of two differently-typed columns has no
honest single PSL type, and nothing reads them. That needs the matching
`@opensaas/stack-core` change in this release, which lets `getContractField` satisfy the
field self-containment gate.

The operator class is derived from `distanceFunction` and the column type, and a declared
`opclass` that disagrees fails `pnpm generate`. An indexed field over 2,000 dimensions
emits `halfvec` (which pgvector can index to 4,000); over 4,000 generation fails with a
named error. An unindexed field stays `vector` at any dimension.

**`index:` does not yet build an index.** `@prisma/orm-extension-pgvector@8.0.0-rc.8`
registers no index types, so nothing lowers the declaration to a `CREATE INDEX`. Today it
derives the column type and the operator class — and applies both dimension caps above —
and nothing else. Declare it to pin the shape you want; re-check when the pack reaches GA.

A field that declares no `dimensions` takes its provider's, so the number is written
once — in the provider — rather than at every `searchable()`/`embedding()` call site:

```typescript
ragPlugin({ provider: ollamaEmbeddings({ model: 'nomic-embed-text', dimensions: 768 }) })
// content: searchable(text())  →  vector(768), with no dimension repeated on the field
```

Only a provider that declares no dimension of its own (a custom provider) reaches the
1536 default. `ragPlugin`'s `beforeGenerate` still refuses a **declared** dimension that
disagrees with a statically known provider dimension, and `OllamaEmbeddingConfig.dimensions`
is now required — generation must never depend on a running Ollama:

```typescript
ollamaEmbeddings({ model: 'nomic-embed-text', dimensions: 768 })
```

`beforeGenerate` also refuses a non-Postgres datasource by name. Every column the plugin
emits is Postgres-only — a pgvector vector column plus a `pg.jsonb` column beside it — and
the plugin declares the pgvector pack for every config, so a `ragPlugin` on any other
provider now fails generation with a message saying so instead of producing a contract
nothing can lower.

A field naming a provider `ragPlugin` does not declare is refused there too. The provider
fixes the column's dimension, so resolving an unrecognised name to the default one — as it
used to — emitted a column of the wrong width, and the dimension check then agreed with
itself and passed:

```typescript
ragPlugin({ provider: openaiEmbeddings({ apiKey }) })
// content: embedding({ provider: 'ollama' })
// Before: vector(1536), silently, for a provider that was never declared.
// Now:    pnpm generate fails, naming the field, the name, and what is declared.
```

A name is recognised when it is `'default'`, a key of `providers`, or the default
provider's own `type` — so `embedding({ provider: 'openai' })` beside
`ragPlugin({ provider: openaiEmbeddings(…) })` keeps working.

`createEmbeddingProvider` now refuses a built-in provider config that is missing a
required member. `EmbeddingProviderConfig`'s third member is an open `{ type: string }`
catch-all for custom providers, and it was absorbing `{ type: 'ollama', model }` — so an
omitted `dimensions` type-checked and reached the provider as `undefined`. The helpers
`createProviderFromEnv` / `getProviderConfigFromEnv` now read the Ollama model's size from
`OLLAMA_EMBEDDING_DIMENSIONS`, defaulting to 768 (`nomic-embed-text`), and refuse a value
that is not a positive integer.

**What that type does and does not catch.** It closes the `createEmbeddingProvider(…)`
call site only. Everywhere a provider config is written against the union itself — most
importantly `ragPlugin({ provider: … })` and `ragPlugin({ providers: { … } })` — the
catch-all still absorbs a built-in `type` with a member missing, because TypeScript cannot
subtract `'ollama'` from `string` and closing it would mean a breaking change to a public
type. So `ragPlugin({ provider: { type: 'ollama', model: 'nomic-embed-text' } })` still
compiles. What stops it is `beforeGenerate`, which fails `pnpm generate` naming the
provider and saying `ollamaEmbeddings({ dimensions })` is required — a generate-time
refusal rather than a compile error. Use the `ollamaEmbeddings()` / `openaiEmbeddings()`
helpers, whose parameters are the concrete config types, to get the error from `tsc`.

**Embedding generation does not run in this release (#1124, #1127).** Everything above —
the column, its dimension, the index declaration, the write denial, `nearest()` — is real
and works. Generation itself does not: the plugin writes a generated embedding through the
secured write surface under sudo, and that surface has not been ported onto the Prisma 8
collection yet, so the write throws on **every** invocation.

What an application sees today: `context.db.Article.create({ data: { content } })`
succeeds and the row commits normally; the embedding column stays `null`; and the log says
so, naming #1124 and #1127. Semantic search over that field returns nothing, because there
is nothing in the column. There is no config change that works around it.

The log says it once in full per field, and then one line per row after that, because it
is a standing defect rather than a per-row event. Which of the two you get is decided by
the **error**, not by where in the hook it was raised: a failure that matches the unported
write surface, or a provider `type` no factory answers to, is reported as standing —
naming what has to change and saying that retrying will not help. Anything else is
reported per occurrence as transient, saying the row is committed and to retry by writing
the source field again.

There is also no regeneration path (#1271), so rows written before #1127 lands keep their
null embeddings afterwards — plan to re-save the source field, or backfill, once it does.
If you need vectors before then, use `embedding({ allowManualWrites: true })` and write
them yourself.

**Further known limits on generation (#1271).** Embeddings are generated in an
`afterTransaction` hook, after the row commits, which bounds what it can do:

- A provider failure is logged, not thrown. The caller's write did succeed, and reporting
  it as a failure would invite a retry that duplicates the row. The row keeps a null
  embedding, and there is no regeneration path yet.
- A **nested** record is never embedded — `afterTransaction` carries a persisted row for
  the top-level record only, so `User.create({ data: { articles: { create: [...] } } })`
  leaves those Articles with a null embedding, with a warning naming the list.

Generation keys on the **persisted** source text, not the caller's input, so a source
field a `resolveInput` hook derives is embedded like any other.

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
