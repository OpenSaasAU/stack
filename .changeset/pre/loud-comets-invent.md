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

`embedding()` declares its two columns through `getContractField` alone — one field of two
differently-typed columns has no honest single PSL type to give, which is part of why the
PSL-shaped members are removed from the field-builder contract in this same release. That
needs the matching `@opensaas/stack-core` change, which puts `getContractField` in their
place at the field self-containment gate. `embedding()`'s descriptor is `kind: 'columns'`,
so the gate asks it for an `outputType` as well — two columns give no single column to be
typed from — and it declares one.

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

**Embedding generation runs end to end.** `context.db.Article.create({ data: { content } })`
commits the row, and once that transaction settles the plugin embeds the **persisted**
source text and writes the vector and its metadata to the column past that field's own
write denial. Writing the source text again regenerates it; a write that leaves the source
text alone does not,
because the `sourceHash` on the stored metadata short-circuits.

When a generation does fail, the log distinguishes a **standing** defect from a transient
one by the **error**, not by where in the hook it was raised. A provider `type` no factory
answers to is standing: it is said once in full per field and then one line per row, naming
what has to change and saying that retrying will not help. Anything else is reported per
occurrence as transient, saying the row is committed and to retry by writing the source
field again.

There is no regeneration command (#1271), so a row whose generation failed keeps its null
embedding until its source field is written again.

**Further known limits on generation (#1271).** Embeddings are generated in an
`afterTransaction` hook, after the row commits, which bounds what it can do:

- A provider failure is logged, not thrown. The caller's write did succeed, and reporting
  it as a failure would invite a retry that duplicates the row. The row keeps a null
  embedding, and there is no regeneration path yet.
- A **nested** record is never embedded — `afterTransaction` carries a persisted row for
  the top-level record only. On this release that row cannot be created in the first place:
  a nested spelling under a relationship key is refused by `NestedRelationInputError`
  (ADR-0050), so the hook's warning is a backstop rather than something a write reaches.

Generation keys on the **persisted** source text, not the caller's input, so a source
field a `resolveInput` hook derives is embedded like any other.

The embedding and its metadata are write-denied to application code: an ordinary create or
update naming them throws. The plugin writes them itself, past that denial and running no
hook of the list's (ADR-0068), after the write's transaction settles. Applications that maintain their own vectors opt out explicitly:

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
