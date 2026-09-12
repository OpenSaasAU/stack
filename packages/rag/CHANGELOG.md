# @opensaas/stack-rag

## 0.44.0

### Minor Changes

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Automatic embedding generation runs, and the package no longer says otherwise

  `@opensaas/stack-rag` was built and documented while the secured write surface could not
  execute on the Prisma 8 collection, so the plugin's escalated write threw on every
  invocation. That surface now executes, and generation with it:
  `context.db.Article.create({ data: { content } })` commits the row, and once that
  transaction settles the plugin embeds the **persisted** source text and writes the vector
  and its metadata past that field's own write denial. Writing the source text again
  regenerates it; a write that leaves the source text alone does not, because the
  `sourceHash` on the stored metadata short-circuits.

  Everything written for the inert surface is gone with it:

  - `generation-failure.ts` no longer classifies "the secured write surface has not been
    ported" as a standing defect. The predicate matched
    `findUnique is not a function` / `Unknown column "data"`, neither of which the write
    pipeline can now raise, and the branch logged
    `EMBEDDING GENERATION IS NOT RUNNING … No config change works around it` — a false
    statement to a user. A provider `type` no factory answers to is still reported as
    standing; everything else is still reported per occurrence as transient.
  - The write denial and the search helpers are tested through `context.db` rather than
    through `hookPipeline`, and every vector under assertion is one the generation hook
    produced from source text written through the same surface. `allowManualWrites` is
    asserted by reading the columns back rather than by inspecting resolved data.

  `hookPipeline` is no longer exported from `@opensaas/stack-core/internal`. It was added
  there so `@opensaas/stack-rag` could prove its write denial one layer below
  `context.db`, which was the deepest seam that then existed; nothing depends on it now.
  That path carries no semver guarantee and the export was never released.

  `allowManualWrites` remains the deliberate opt-out for an application that maintains its
  own vectors — it is not a workaround for anything:

  ```typescript
  manualVector: embedding({ dimensions: 1536, allowManualWrites: true })
  ```

  Core's multi-column write-access gate is now also proven through `context.db`: a denied
  create or update throws naming the field and leaves the per-part columns untouched, a
  granted one writes both, `sudo()` bypasses the gate, and clearing the field with `null`
  clears both columns.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Search helpers take the list they search, the MCP tool embeds with the field's own provider, and the pgvector docs describe provisioning

  `semanticSearch()` and `findSimilar()` no longer take a `listKey` or a
  `context`. They take the list itself, off the secured `db` surface, which is
  where the scoping already lives — nothing in a search path names a list by
  string any more:

  ```typescript
  const context = await getContext()

  const results = await semanticSearch({
    list: context.db.Article,
    fieldName: 'contentEmbedding',
    query: 'articles about machine learning',
    provider: createEmbeddingProvider({ type: 'openai', apiKey: process.env.OPENAI_API_KEY! }),
    limit: 10,
    minScore: 0.25,
  })

  const similar = await findSimilar({
    list: context.db.Article,
    fieldName: 'contentEmbedding',
    itemId: 'article-123',
  })
  ```

  The type that `list` accepts is exported as `SearchableList` from
  `@opensaas/stack-rag/runtime`: the `where` / `nearest` / `first` members these
  helpers actually call, so a generated `context.db.Article` and the engine's own
  delegate both satisfy it and the row type is inferred from whichever is passed.
  Note that it does not carry the engine's compile-time refusal of a list with no
  vector column — that gap is tracked as
  [#1303](https://github.com/OpenSaasAU/stack/issues/1303).

  The generated `semantic_search_<list>` MCP tool now resolves its embedding
  provider from the **searched field's** own `provider`, the way the generation
  hook does, instead of always using the plugin's default. `nearest()` validates
  the query vector against the column's declared dimension, so on a config whose
  field named a provider of a different width the tool raised a validation error
  on every call.

  The same tool's `minScore` default of `0.5` is gone entirely: omitted, the
  search is now ranked with no bound at all. Its description states the real
  range, which is the column's own distance function rather than a normalised
  0–1: `cosine` scores the raw cosine on `[-1, 1]`, `l2` scores
  `1 / (1 + distance)` on `(0, 1]`, and `inner_product` scores the dot product,
  which is unbounded. The unchanged `0.5` had silently tightened from "raw cosine
  at or above 0" to "at or above 0.5" when scoring moved into `nearest()`, so an
  assistant calling the tool with no `minScore` got far fewer results, or none, on
  a corpus that used to answer. No bound is the only default that means the same
  thing on all three scales — `0` would still have cut every anti-correlated row
  on an `inner_product` column.

  That tool also refuses a wrongly-typed argument by name instead of falling back
  to a default. Its `inputSchema` is a plain JSON Schema, which the MCP handler
  does not enforce, so `field: 42` had bypassed the unknown-field check and
  searched the default column, and `minScore: "0.8"` had become `0` — each one
  silently answering a different question than the caller asked.

  The README and agent guidance describe pgvector **provisioning** rather than
  installation: `ragPlugin` declares the extension pack, `pnpm generate` writes
  its migration and `pnpm db:update` enables it. What the deployment owns is
  making the extension available and either granting the migrating role the
  privilege to create it — pgvector is not trusted, so that means superuser or a
  provider grant — or pre-creating it, which the migration prechecks for and
  skips. The stale `ivfflat` recipe over a JSON column is gone; an index is
  declared on the field.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - `AccessContext.prisma` becomes `AccessContext.ormHandle`

  The engine's internal ORM handle now carries a name that says what it is. The public bypass was renamed to `context.unsafe` first; until now the handle underneath it was still called `prisma`, so a reader could not tell which of the two a `prisma` in the source meant.

  `ormHandle` is the client the secured surface's terminals, the Write Pipeline and the access filter actually issue their queries through. The engine applies the Access Filter, Field Visibility and hooks _around_ it, so the handle itself enforces none of them — the same absence of protection as `context.unsafe`, on a different object. `AccessContext` has no `unsafe` member, so `ormHandle` is what a hook or a plugin `runtime()` factory is handed.

  ```typescript
  // Before
  const plugin = {
    runtime: (context) => ({
      getAuditTrail: (listName: string) =>
        context.prisma.auditLog.findMany({ where: { listName } }),
    }),
  }

  // After
  const plugin = {
    runtime: (context) => ({
      getAuditTrail: (listName: string) =>
        context.ormHandle.auditLog.findMany({ where: { listName } }),
    }),
  }
  ```

  The Write Pipeline rebinds `ormHandle` wherever it rebinds `context.db`, exactly as it did before — this rename changes nothing about when a hook's database work is transactional. Every write opens a transaction (ADR-0010), so a hook's own write through either handle rolls back with the write that failed.

  `getContext()`'s second positional parameter is renamed to match; it is positional, so no call site changes. `@opensaas/stack-auth`'s better-auth wiring and `@opensaas/stack-rag`'s vector search now read `context.ormHandle`.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - The hybrid-search sample in the package guidance now uses the query-value surface: `context.db.Article.where({ OR: [...] }).all()` rather than the removed `findMany`.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - `embedding()` is a native pgvector column with its index, distance function and write denial on the field

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

  There is no regeneration command ([#1271](https://github.com/OpenSaasAU/stack/issues/1271)), so a row whose generation failed keeps its null
  embedding until its source field is written again.

  **Further known limits on generation ([#1271](https://github.com/OpenSaasAU/stack/issues/1271)).** Embeddings are generated in an
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

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Scope the package's Vitest run to `src`, so the suite stops running twice

  The `test` turbo task depends on `build`, so `dist/` is present when tests run
  and Vitest discovered the compiled `dist/**/*.test.js` duplicates alongside the
  sources — every test executed twice, 470 where there are 235. The config now
  carries the same `exclude: [...defaultExclude, '**/dist/**']` that
  `@opensaas/stack-core` has. Nothing about the package's behaviour changes; the
  suite reports honest counts and takes roughly half the CI time ([#1311](https://github.com/OpenSaasAU/stack/issues/1311)).

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Document the manual-write opt-out where the guidance shows a manual write, and correct the export list

  `packages/rag/CLAUDE.md`'s "Manual Embedding Storage" section showed an ordinary
  `context.db.Article.create({ data: { contentEmbedding: { … } } })` with no
  mention of `allowManualWrites`. `embedding()` defaults that to `false` and denies
  the write, so an agent following the section got
  `Cannot create "contentEmbedding": field-level access denied.` — the same defect
  that was fixed in the automatic-generation section 130 lines below it. The
  section now declares the field before it writes to it:

  ```typescript
  fields: {
    title: text(),
    contentEmbedding: embedding({ dimensions: 1536, allowManualWrites: true }),
  }
  ```

  The export list carried two stale signatures: `generateEmbeddings(config, text, provider)`
  is `generateEmbeddings({ provider, texts, … })`, and `chunkText(text, strategy)`
  is `chunkText(text, options)` with `strategy` a member of `options`. It now also
  names `generateEmbedding()` and `searchable()`, and says that
  `@opensaas/stack-rag/mcp` carries types rather than the tools — `ragPlugin`
  registers those itself.

  `README.md` said `pnpm generate` writes "the extension's migration alongside the
  app's". Generation seeds a contract space for each declared extension pack and
  writes no app migration of its own; the app's schema history comes from
  `prisma migration plan`. The README also prescribed a bare `pnpm db:update`,
  which opens no connection of its own and exits non-zero unless an `opensaas dev`
  loop is listening.

  `CLAUDE.md`'s package-structure tree still described `src/mcp/` as "MCP tool
  generators", contradicting the export list 35 lines below it, and pointed its
  test example at a `packages/rag/__tests__/` directory that does not exist.

  Every `config()` sample in the package's `README.md` and `CLAUDE.md` carried
  `db: { url: process.env.DATABASE_URL! }`, which has not been a member of
  `DatabaseConfig` since the Prisma 8 rework — the samples failed to compile with
  `TS2353`. The runtime resolves the URL itself, or takes a pool through
  `db.client`:

  ```typescript
  db: {
    provider: 'postgresql'
  }
  ```

  Documentation across the RAG surface claimed that `createdAt`/`updatedAt` are
  added to every list automatically. Auto-timestamps have been **off by default**
  since ADR-0004 (`resolveListTimestamps`): `id` is the only column added for you,
  and a list opts in by declaring the two fields itself or by setting
  `db: { timestamps: true }`, per list or globally. Neither RAG example opts in, so
  neither carries them.

  The docs prescribed `opensaas db migrate` for deployment. No such subcommand
  exists — `opensaas db` registers only `update` — and the sentence sat beside this
  PR's own text saying `db:update` needs a running dev loop, so the two read as a
  contradiction. Deployment is `prisma migration plan` then `prisma db migrate`.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - `context.db` is keyed by the PascalCase list name and carries the opaque read wrapper

  `context.db.<List>` is now spelled the way the config spells the list — `context.db.AuthUser`, not
  `context.db.authUser` — and `getDbKey()` is deleted (`getUrlKey()` and `getListKeyFromUrl()` stay).
  Every call site through the secured surface, and every ORM handle the engine reaches a model
  through, moves to the list key.

  ```typescript
  // Before
  const posts = await context.db.blogPost.findMany()

  // After
  const posts = await context.db.BlogPost.findMany()
  ```

  The same member is now also a query value: `.where(...)` composes an immutable read and `.all()` /
  `.first()` are the terminals that run it. A terminal resolves operation-level `query` access, adds
  the access filter as a second entry in the collection's own filter list (nothing is hand-merged),
  enters the engine origin around the ORM call, applies Field Visibility, and returns `[]` / `null`
  on denial — indistinguishable from an empty result.

  ```typescript
  const mine = await context.db.Post.where({ published: true }).all()
  const first = await context.db.Post.where({ authorId: session.userId }).first()
  ```

  `where` takes an equality predicate (`{ column: value }` or `{ column: { equals: value } }`); an
  operator the engine does not lower yet is refused rather than passed through.

  The three read members belong to a list you can query for many rows, so a singleton list does not
  carry them — `get()` stays the way to read one. That matches the type the generator has always
  emitted for a singleton.

  Code the CLI writes into your project moves to the list key with everything else: the feature
  generator's blog and auth pages (`context.db.Post.findMany(…)`), and the Keystone migration guide,
  which now says list names are PascalCase.

  A predicate whose condition is `undefined` is still skipped rather than refused, matching Prisma's
  `undefined`-means-omitted semantics — so an access filter spelled `({ session }) => ({ authorId:
session?.userId })` constrains nothing for an anonymous caller, while the explicit `{ equals:
undefined }` spelling of the same rule is refused. Making the lowering total is the closed Where
  vocabulary's job ([#1147](https://github.com/OpenSaasAU/stack/issues/1147)). Relation-valued `needs` are likewise not yet widened on `all()`/`first()`
  the way `findMany` widens them ([#1149](https://github.com/OpenSaasAU/stack/issues/1149)).

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Rewrite each package README against the Prisma 8 surface

  The READMEs now document the API the packages actually ship, replacing the
  Prisma 7 spellings that no longer resolve.

  Reads compose on `context.db` keyed by the list's PascalCase config key and end
  in a terminal, rather than calling a Prisma delegate:

  ```ts
  const posts = await context.db.Post.where({ status: { equals: 'published' } })
    .orderBy({ createdAt: 'desc' })
    .limit(20)
    .all()

  const post = await context.db.Post.where({ id }).first()
  if (!post) return null
  ```

  `findMany`, `findUnique`, `findFirst` and `count()` are gone; the terminals are
  `all()`, `first()`, `aggregate()` and `nearest()`. A denied read is silent, so
  every `first()` result is a null check.

  Writes take an args object with an identity-only `where`, and a relationship is
  set with `connect` or cleared with `null`:

  ```ts
  const updated = await context.db.Post.update({
    where: { id },
    data: { title, author: { connect: { id: authorId } } },
  })
  ```

  The database config documented in each README is the one `DatabaseConfig`
  carries — `provider: 'postgresql'`, `idField`, `timestamps`, `schemas`,
  `extensions` and `client`. `prismaClientConstructor`, `db.url` and
  `extendPrismaSchema` are gone, and the connection is resolved from the
  environment rather than named in the config.

  Review round two swept each README against the built `.d.ts` rather than against
  another doc, and corrected what the grep-shaped sweep had missed:

  - The UI README's theming block documented bare `--background`/`--primary` HSL
    triplets under a `.dark` class. The shipped contract is `--color-*` tokens in
    `oklch()`, resolved through `light-dark()` and switched by `data-theme` — the
    stylesheet's own header says the design exists "without a duplicated `.dark`
    block". Its primitives list also omitted eight real exports (`Textarea`,
    `Popover`, `Calendar`, `TimePicker`, `DateTimePicker`, `Combobox`, `Badge`,
    `Avatar`), and two samples read `config.lists` without awaiting `config`.
  - The tiptap README reused a filter-returning `AccessControl` rule as
    **field-level** `access.update`. `FieldAccess` types those slots as
    boolean-returning, so that is a type error and a runtime
    `InvalidFieldAccessResultError`, not a scoped update.
  - The storage README's upload route was the last copy still casting
    `formData.get(...) as string` / `as 'file' | 'image'` off a
    `FormDataEntryValue | null`.
  - The auth README's Account shape named `providerId: 'credentials'`; better-auth
    1.7 uses `'credential'` for email/password, and the model carries `issuer`.
  - The Vercel Blob README passed `cacheControl` to `vercelBlobStorage()`. The
    provider option is `cacheControlMaxAge` (a number of seconds);
    `VercelBlobStorageConfig` carries an index signature, so the wrong spelling
    type-checked and was silently ignored.

  Round three corrected what round two's sweeps could not see, each having keyed
  on where a construct sat rather than on what it was:

  - The Vercel Blob README's **options listing** still named `cacheControl` 112
    lines above the call site round two fixed, so the page contradicted itself and
    the half a reader consults first was the wrong half.
  - Sixteen hook samples across the docs and the core, cli and example READMEs
    destructured a member the `delete` branch of its args union does not carry, so
    the destructure failed before any in-body `operation` guard could narrow. Three
    more named an argument on no branch at all: `value` and `inputValue` on
    `resolveInput`/`afterOperation`, and `session` on `ResolveInputHookArgs`.
  - The core README carried a third instance of the field-access class — a bare
    `text({ access: … })` excerpt with no enclosing `fields: {` — plus
    `query: true` where `OperationAccess.query` takes a function, a
    `ValidationError` built from a string where the constructor takes `string[]`,
    and a stale claim that `password()` is excluded from reads.
  - The cli README's "What it does" block under `opensaas db update` described
    `opensaas dev`, and called `migrate` a command group when it has no
    subcommands.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - A plugin's write of a column it owns runs no hook, which stops it destroying derived fields

  An embedding is write-denied to application code, so the RAG plugin's generation hook
  wrote it through `sudo().db.<list>.update()`. That is an ordinary secured write, so it
  re-ran the list's **whole** hook pipeline carrying the embedding column and nothing else —
  and a list-level `resolveInput` that derives one field from other input, the pattern
  `CLAUDE.md` documents, then recomputed the derived field from values that were not there:

  ```typescript
  Article: list({
    fields: {
      title: text(),
      body: text(),
      content: text(),
      contentEmbedding: embedding({ sourceField: 'content', dimensions: 3 }),
    },
    hooks: {
      // Ran a second time on the plugin's write, with `title` and `body` absent
      resolveInput: ({ resolvedData }) => ({
        ...resolvedData,
        content: [resolvedData.title, resolvedData.body].join(' '),
      }),
    },
  })
  ```

  `create({ data: { title: 'red', body: 'hot' } })` committed `content: 'red hot'` and then
  overwrote it with `' '` — the join of two `undefined`s — and embedded that. No error, no
  log: the row and its vector were both silently wrong. The write threw on every invocation
  before the Write Pipeline landed, so this was only reachable once generation began running.

  The plugin's write no longer goes through `context.db`. Core owns it as a single-field
  write, `writePluginOwnedField`, exported from `@opensaas/stack-core/extend` for any plugin
  that injects a field it computes:

  ```typescript
  import { writePluginOwnedField } from '@opensaas/stack-core/extend'

  runtime: (context) => ({
    [WRITE_VECTOR]: async (listName, id, fieldName, value) =>
      await writePluginOwnedField({ context, listName, id, fieldName, value }),
  })
  ```

  It splits the value through the field's own `splitColumns` exactly as the Write Pipeline
  does, issues one scoped `UPDATE`, and runs no hook.

  It reaches no field but the one named, and that is enforced rather than asked of the
  caller: the field is resolved against the config the context was built from, so the
  columns written are that field's own and the caller passes no layout. A list or a field
  the config does not declare — including one named for a key it inherits from
  `Object.prototype`, which a bare lookup answers for — is refused by name, as is a context
  carrying no config, as is an `undefined` value, which would otherwise wipe a multi-column
  field and no-op a single-column one, two outcomes for one input. This narrows the escalated
  `db` update it replaces, which could write any column on the row, but it is not a privilege
  boundary: a plugin holding `context.ormHandle` can already write anything, and this refuses
  the mistake rather than the intent.

  It takes the `AccessContext` `Plugin.runtime` receives as its first argument; the
  `StackContext` `getContext` returns carries no ORM handle and is refused by name. That
  second argument, `sudo`, is now declared as the `StackContext` it always was — a plugin
  reaching `sudo().db` is unaffected, one reaching `ormHandle` off it was already getting
  `undefined` and now fails to compile. See ADR-0068.

  A write refused by name is a wiring defect that fails identically on every row, so the RAG
  plugin's failure log now reports all three refusals — and `WriteCollectionMissingError`
  beside them — as the standing defect they are, rather than telling the reader to retry a
  write that can never succeed.

  What changes for an application: a list hook no longer fires a second time when the plugin
  writes a generated column, so one logical change now fires one side effect. Nothing about
  `context.db` changes — an application write runs the pipeline exactly as before, and
  `embedding({ allowManualWrites: true })` still writes through it.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Remove the PSL-shaped and TypeScript-face members from the field-builder contract

  **Third-party field packages must migrate.** The generator emits a TypeScript
  contract module, not PSL (ADR-0040), and reads a field's TypeScript face from
  `outputType`/`inputType` (ADR-0052). Nothing consulted the PSL-shaped members
  any more, so they are gone from `BaseFieldConfig` and from every builder:

  - `getPrismaType`
  - `getPrismaColumns`
  - `getPrismaRelation`
  - `getTypeScriptType`
  - `getTypeScriptImports`
  - `resultExtension`
  - `VirtualField.outputType` (the required `string` narrowing; the optional
    `outputType: TypeDescriptor` on `BaseFieldConfig` is what a virtual field
    declares now)

  The `PrismaRelationResult`, `MultiColumnPrismaResult` and `ResultExtensionConfig`
  types they were shaped by are removed with them.

  Migrating a field builder — describe the column instead of the PSL line:

  ```ts
  // Before
  export function slug(options?: Omit<SlugField, 'type'>): SlugField {
    return {
      type: 'slug',
      ...options,
      getZodSchema: () => z.string().optional(),
      getPrismaType: () => ({ type: 'String', modifiers: '? @unique' }),
      getTypeScriptType: () => ({ type: 'string', optional: true }),
    }
  }

  // After
  export function slug(options?: Omit<SlugField, 'type'>): SlugField {
    return {
      type: 'slug',
      ...options,
      getZodSchema: () => z.string().optional(),
      getContractField: (fieldName) => ({
        kind: 'column',
        name: fieldName,
        type: { pack: 'pg', type: 'text' },
        nullable: true,
        unique: true,
      }),
    }
  }
  ```

  A field whose TypeScript face differs from its column's codec type declares it
  directly, rather than through `resultExtension` or `getTypeScriptType`:

  ```ts
  // Before
  resultExtension: { outputType: "import('@my/pkg').Metadata | null" },
  getTypeScriptType: () => ({ type: 'Metadata | null', optional: true }),
  getTypeScriptImports: () => [{ names: ['Metadata'], from: '@my/pkg' }],

  // After — the import is inline, so no separate import declaration is needed
  outputType: "import('@my/pkg').Metadata | null",
  inputType: "File | import('@my/pkg').Metadata | null",
  ```

  A field spanning several physical columns returns `{ kind: 'columns', columns }`
  from `getContractField` and keeps `getColumnNames`/`assembleColumns`/`splitColumns`.

  **The generate-time gate moved with the contract.** `validateFieldConfig` now
  requires `getContractField` and `getZodSchema` from a stored field (a
  relationship only the former), and additionally `outputType` from a field that
  has no single column to be typed from — one whose descriptor is
  `kind: 'columns'` or `kind: 'computed'`. Both are read off the descriptor, so a
  `computed` field carries the obligation whether or not its builder also sets the
  `virtual` flag that core's own `virtual()` sets alongside it. That closes a hole
  where such a field passed
  the gate, generated successfully, and left every consumer reading it as
  `unknown` (issue [#1292](https://github.com/OpenSaasAU/stack/issues/1292)). `FieldConfigValidationError.missingMethod` is renamed
  to `missingMember` to carry `outputType` alongside the two methods.

  `validateFieldConfig`'s signature changed with it: `listKey` and a new fourth
  `config` argument are both **required**, because they are what
  `getContractField` takes and reading the descriptor is what makes the rule
  decidable. The optional `getColumnNames` is not consulted — it is a separate
  member that only travels with `kind: 'columns'` by convention, so reading it
  would both miss a `columns` field that does not implement it ([#1292](https://github.com/OpenSaasAU/stack/issues/1292)'s hole) and
  wrongly demand `outputType` from a single-column field that does.
  `FieldConfigValidationError.listKey` is likewise no longer optional.

  The gate swallows a throw out of `getContractField`: that is a field's own
  refusal seam (`embedding()` throws there for an impossible `dimensions`).
  `opensaas generate` runs this gate first of all, and its config-surface step —
  `validateDatabaseConfig` → `validateExtensionPacks` — re-reads every descriptor
  straight afterwards and reports the throw as a `field-descriptor-error` refusal
  carrying the field's own message, so the run still fails with
  `List "<List>": fields.<field> cannot describe its contract column — <message>`
  rather than a raw stack trace. Derivation is never reached.

  `inputType` is never required by the generator. On a single-column field its
  absence means the column's own input type; a `kind: 'columns'` field has no
  single column for that to name, so it should declare `inputType` alongside
  `outputType` — every multi-column field in this repo does, and what the
  generator emits for one that does not is untested.

  **A field-level hook's value type is resolved from the field key, and is
  `unknown` when there is no single key to resolve.** `FieldHooks`'
  `resolveInput`/`resolveOutput` positions used to be typed from the deleted
  `getTypeScriptType`. `FieldHooks<TTypeInfo, 'title'>` now resolves to the
  field's statically declared `outputType`, or else to the property the generated
  `Lists.<List>.Item` carries for it.

  But `BaseFieldConfig.hooks` cannot pin a field key — a builder is written
  before it knows where it is mounted — so through the config surface
  (`list<Lists.Post.TypeInfo>({ fields: { title: text({ hooks }) } })`) the
  instantiation is `FieldHooks<TTypeInfo>`, whose key is the union of every field
  on the list, and the value type is **`unknown`**: the same open type as before
  this change. Resolving that union would type each field's hook by the whole
  row, so a `text()` hook would accept a `Date` and reject its own `string`. An
  honestly `unknown` type is better than a confidently wrong one; narrowing it
  needs the field key threaded into `BaseFieldConfig`, tracked in issue [#1306](https://github.com/OpenSaasAU/stack/issues/1306).

  Two related limits, for the same reason: `lists.ts` emits `Fields` as the field
  _interfaces_, on which `outputType` is optional, so a declared face never
  survives into a generated `TypeInfo` — the declared branch is reachable only
  from a hand-authored one. And a virtual field's hook value stays `unknown`,
  since it has no declared face there and no column in the stored row.

  `db.keystoneCompat`'s implicit empty-string text default is now carried by
  `text()`'s contract column, where the deleted `getPrismaType` used to emit it —
  but only where the field's own create validator accepts **both** the omission
  that default is there to fill **and** the `''` it inserts. Both questions are
  asked of the schema rather than restated, so the column and the validator
  cannot drift apart:

  - a column default drops the column from the required half of the generated
    `CreateInput`, so carrying one where the validator refuses an omission would
    type-check a `create` that then threw `ValidationError`;
  - and the value a column default inserts is never seen by validation — the
    database supplies it — so carrying one where the validator refuses `''`
    would store a row the config forbids on every omitted `create`. That is the
    outcome an explicit `defaultValue: ''` already gets right: it is filled by
    `applyCreateDefaults` before validation and correctly rejected. The two
    spellings of "this column defaults to an empty string" now agree.

  **Known limit: the flag is therefore inert for
  `validation: { isRequired: true }` text — Keystone's commonest text column —
  and for `validation: { length: { min: N } }` with `N` above zero.** Keystone 6
  renders both as `NOT NULL DEFAULT ''`, so a migrating project sees
  `DROP DEFAULT` for them in `migrate diff`. Setting `defaultValue: ''` by hand
  is refused at runtime for the same reason, so the field's validation has to be
  relaxed alongside it. Full parity would need the flag to relax the create
  validator itself, which `getZodSchema` has no config to read; that is a
  separate change. A column made non-null through `db: { isNullable: false }`
  alone still gets the default, as does one carrying only a `length.max`.

  Relatedly, `text()` no longer treats `validation: { length: { min: 0 } }` as
  `min(1)`. A zero minimum now means no minimum, so `''` validates — which is
  what the option says, and what lets such a column keep its compat default
  without the column and the validator disagreeing. `isRequired` still imposes a
  floor of `min(1)` on a field that declares `length: { min: 0 }` or no minimum
  at all, and never lowers a larger declared one — `isRequired` with
  `length: { min: 5 }` is still `min(5)`.

  **Test coverage that thinned.** Three assertions were lost rather than ported,
  and are recorded here so the change is not silent:

  - `select()`'s "falls back to a capitalized `fieldName` when `listName` is not
    provided" — `getContractField` is always given a `listKey`.
  - The quoted-vs-unquoted PSL default rendering for a string versus an enum
    `select()` — the contract carries one `{ kind: 'literal' }` for both.
  - The per-field `getTypeScriptType` blocks in `tests/field-types.test.ts`
    became `expect(field.outputType).toBeUndefined()` — "declares no override",
    which is weaker than the old "text is `string`, optional when not required".
    Column nullability is still asserted on the same fields, and the codec now
    owns the type (ADR-0052), so the fact has moved rather than vanished.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Correct the RAG agent guidance for the native vector column, and prove the declared-dependency read under exact selection

  `packages/rag/CLAUDE.md` described the world before `embedding()` became a
  pgvector column. Two sections were wrong in ways that produced code that throws:

  - Automatic generation was documented as a field-level `afterOperation` hook
    writing the embedding through `context.db.Article.update(...)`. That write is
    exactly what the field's write denial now refuses. The section describes the
    real path instead — a list-level `afterTransaction` hook, running after the
    commit, writing through the plugin's own escalated path — and points at
    `embedding({ allowManualWrites: true })` for an app that maintains its own
    vectors.
  - The migration guide claimed "Existing embeddings in JSON format are
    compatible" and prescribed `pnpm db:push`. There is no conversion: the vector
    is a `vector(n)` column with a `jsonb` metadata sibling, and an embedding is
    derived data that is regenerated from its source text.
  - The guide now says how the schema change is actually applied, because
    `db:update` is not `db:push`'s drop-in replacement. `opensaas db update` opens
    no connection of its own — it hands the request to a running `opensaas dev`
    loop and exits non-zero when none is listening — so locally the loop applies
    the change (`pnpm dev`, against `DATABASE_URL` when set and the Dev database
    otherwise), a destructive plan such as a dimension change needs
    `pnpm db:update --confirm <database name>` from a second terminal, and a
    deployment has no loop at all and migrates with `prisma migration plan` then
    `prisma db migrate`.
  - Automatic generation is gated on `autoGenerate` alone; a field carrying it
    with no `sourceField` is a config error that `pnpm generate` throws on, not a
    silent skip. Re-saving a row's source field is what regenerates its embedding
    after a dimension change, and the recipe now says so: a null vector reads back
    as no stored embedding at all, so the `sourceHash` gate has nothing to match
    and does not short-circuit.

  `examples/rag-ollama-demo`'s README described `pnpm generate` as writing "the
  contract's own migrations". It writes the Contract module and `prisma.config.ts`,
  emits `prisma/contract.json` and `prisma/contract.d.ts` — both of which have to
  be committed — and seeds only declared extension packs' spaces under
  `migrations/`. The app's own schema history comes from `prisma migration plan`.

  The CLI's field-package contract test now reads a multi-column storage field
  through a real table under `.select()`, with a computed field that declares it
  and an identical one that declares nothing:

  ```typescript
  badge: virtual({
    type: 'string',
    needs: ['hero'],
    hooks: { resolveOutput: ({ item }) => heroOf(item) },
  })
  ```

  The declaring hook receives the assembled value — the widening resolves the
  logical key to its part columns — and the non-declaring one reads `undefined`
  on the same row.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Correct the RAG guidance's own usage examples so they compile against the real
  signatures, and point the README at the examples that exist.

  `chunkText`'s entry in the export list was corrected last round; its usage
  example 439 lines below was not, and passed `maxTokens`/`overlap` — the
  field-level `ChunkingConfig` names, not `ChunkingOptions`. It also fed the
  returned `TextChunk[]` straight to `embedBatch(string[])`. Both now compile:

  ```typescript
  const chunks = chunkText(longDocument, {
    strategy: 'recursive',
    chunkSize: 500,
    chunkOverlap: 50,
  })

  const vectors = await provider.embedBatch(chunks.map((chunk) => chunk.text))
  ```

  Sweeping the rest of the file against the source turned up the same class in the
  custom-provider example. `registerEmbeddingProvider`'s factory is handed the
  whole `EmbeddingProviderConfig` union, whose custom member is an open
  `{ type: string; [key: string]: unknown }`, so `config.model` arrives as
  `unknown` and `config.dimensions` is absent from `OpenAIEmbeddingConfig`, so it
  is not readable off the union. Reading them straight onto the returned
  `EmbeddingProvider` was two type errors; the example now narrows both, and says
  why:

  ```typescript
  registerEmbeddingProvider('custom', (config) => {
    const model = typeof config.model === 'string' ? config.model : 'custom-embed'
    const dimensions =
      'dimensions' in config && typeof config.dimensions === 'number' ? config.dimensions : 768

    return {
      type: 'custom',
      model,
      dimensions,
      async embed(text) {
        return [/* vector */]
      },
      async embedBatch(texts) {
        return [[/* vectors */]]
      },
    }
  })
  ```

  The README's Examples section pointed at `examples/rag-demo`, which does not
  exist, and credited it with MCP integration and multiple providers, which
  neither real example has. It now names `examples/rag-ollama-demo` and
  `examples/rag-openai-chatbot` and says what each actually demonstrates.

  The sweep that found those was then run over every fenced TypeScript block in
  the RAG guidance rather than the lines a grep implicated: each block compiled
  against this branch's own built declarations, and each block that redeclares an
  exported type checked for structural equivalence with the real one. That second
  check is what caught the `EmbeddingProvider` interface documenting `embedBatch`
  as optional when it is required — a block declaring its own copy of a type
  compiles against that copy, so nothing else would have. Also corrected across
  the guidance:

  - The Cohere and HuggingFace factory registrations passed the config union
    straight into constructors typed `CohereConfig` / `HuggingFaceConfig`; both
    now narrow with the same `in` guard.
  - The "internal provider registry" sketch invented a `Factory` type and
    constructed built-in providers off the un-narrowed union — the very defect
    corrected twenty lines below it. It is now the registry's real signature,
    with the reason narrowing is needed stated as prose.
  - A retry loop read `lastError` before definite assignment and cast with `as
Error`; a monitoring example read `.message` off `unknown`; a cost table was
    indexed by a free `string`. All three now narrow properly.
  - Blocks that used `createEmbeddingProvider`, `getContext`, `text`,
    `SearchResult` or `EmbeddingProvider` without importing them now import them.
  - Multi-vector search annotated `nearest()`'s result as `SearchResult`; that is
    what `semanticSearch()` and `findSimilar()` return. `nearest()` returns
    `NearestMatch` from `@opensaas/stack-core`.
  - The "Rate Limiting" recipe had the reader hand-write a `RateLimiter` class
    into `lib/rate-limiter.ts`. `RateLimiter` is already exported from
    `@opensaas/stack-rag/runtime` — a different shape under the same name, so
    following the guide collides with the package. The recipe is now the shipped
    class: `new RateLimiter(100)` and `await limiter.waitForSlot()`.
  - The reference's `SearchResult` sketch wrote `SearchResult<T>` where the
    package declares `SearchResult<T = unknown>`, making the bare `SearchResult`
    the reference uses elsewhere an arity error the package does not have.

  Three types spell chunking options, and the docs now keep them apart:
  `ChunkingOptions` (`chunkSize`/`chunkOverlap`) for `chunkText()` and
  `generateEmbedding()`; `ChunkingConfig` (`maxTokens`/`overlap`, in tokens) for a
  field's `chunking:`; and `BuildTimeConfig` (`chunkSize`/`chunkOverlap` again, in
  characters).

  `ChunkingOptions`' unit depends on the strategy, so stating it flatly would be
  wrong. Under `recursive`, `sentence` and `sliding-window` its numbers are
  characters. Under `token-aware` they are tokens: `chunkText` hands `chunkOverlap`
  to `tokenAwareChunk`, which multiplies it by ~4 characters per token, and does
  the same to `chunkSize` when no `tokenLimit` is given. The `token-aware` example
  in the advanced guide already said so inline (`chunkOverlap: 50, // Overlap in
tokens`) and was correct.

  An earlier round renamed three field-level `chunking:` blocks from the first
  spelling to the second but carried their numbers across the unit change, so
  `1000` characters became `1000` tokens. At the ~4 characters-per-token ratio the
  same page states, those are now `maxTokens: 250` / `overlap: 50` and
  `maxTokens: 125`, and the guide says which unit a field's `chunking:` is in.

  Correcting an earlier claim of ours about that rename: it did not break correct
  code. The field-config misuse dates to `afa865f6` ([#741](https://github.com/OpenSaasAU/stack/issues/741)), and that sweep's only
  two chunking edits were both `chunkText` call sites moved in the correct
  direction. The accurate statement is that the earlier sweep went one direction
  only.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Render `embedding()` fields in the admin UI, and stop serialising vectors to the browser

  The `embedding` field type had no admin UI component, so every embedding column
  rendered as `Unsupported field type: embedding`. Worse, the item form still sent
  the field's value back on save, which the field's own write deny then refused —
  so **an item with an embedding field could not be saved from the admin UI at
  all** (`Validation failed: Cannot update "contentEmbedding": field-level access
denied.`).

  `@opensaas/stack-rag/components/register` registers a read-only renderer for the
  field and a list-table Cell. The registries live in the browser bundle, so the
  import belongs in a client component:

  ```tsx
  // app/admin/[[...admin]]/FieldRegistration.tsx
  'use client'

  import '@opensaas/stack-rag/components/register'

  export function FieldRegistration() {
    return null
  }
  ```

  ```tsx
  // app/admin/[[...admin]]/page.tsx
  <>
    <FieldRegistration />
    <AdminUI context={context} config={config} /* ... */ />
  </>
  ```

  `ui.showVector` and `ui.showMetadata` were a documented surface with nothing
  behind them; they now drive that renderer — and the page payload, not just the
  display. A vector the admin UI does not render is no longer serialised to the
  browser, so the default (`showVector: false`) keeps a 768- or 1536-float array
  out of every admin page:

  ```typescript
  contentEmbedding: embedding({
    sourceField: 'content',
    ui: { showVector: true }, // opt in to rendering (and shipping) the vector
  })
  ```

  An embedding is also out of the default list-table columns, since a vector is
  unreadable in a table; naming it in `ui.listView.initialColumns` still shows it.

  In `@opensaas/stack-ui`, a field's `ui.valueForClientSerialization` now runs on
  the list-view path as well as the item form. The list table serialises whole
  rows rather than only the columns it renders, so a field withheld from the
  default columns still reached the browser in full. Any field declaring that
  transform now has it honoured on both paths.

### Patch Changes

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Export the access-filter builder from the public entry

  `checkAccess`, `mergeFilters` and `checkCreateAccess` — the operation-level
  access primitives — are now supported API on `@opensaas/stack-core`, with TSDoc. A
  package that reads outside `context.db` (a vector search issuing its own SQL, a
  plugin composing a filter) imports them instead of carrying a copy that drifts
  from the engine's own evaluation (ADR-0038, ADR-0057):

  ```typescript
  import { checkAccess, mergeFilters } from '@opensaas/stack-core'

  const result = await checkAccess(config.lists.Post.access?.operation?.query, {
    session: context.session,
    context,
  })

  // `null` is the Silent failure signal: denied, so do not query at all.
  const where = mergeFilters(callerWhere, result)
  if (where === null) return []
  ```

  An absent rule denies. A filter result is ANDed with the caller's `where`, never
  merged key-by-key, so it can only ever narrow what the caller asked for. Gate a
  `create` with `checkCreateAccess`, which refuses a filter result rather than
  reading it as an allow (ADR-0030). All three scope rows, not fields: field-level
  `read` access runs inside `context.db`, so a caller reading outside it is
  responsible for field visibility itself.

  `@opensaas/stack-rag` drops its own copies of both — the ones ADR-0038 names as
  the reason this export exists — and calls core's. Behaviour is unchanged;
  `buildAccessControlFilter`, `mergeAccessFilter` and `prismaFilterToSQL` keep
  their signatures.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Fix pgvector semantic search calling `$queryRawUnsafe` without its receiver, which turned every search into a `TypeError` instead of a query.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Declare the Node >=22.18.0 floor in `engines`.

- [#1476](https://github.com/OpenSaasAU/stack/pull/1476) [`6f3db44`](https://github.com/OpenSaasAU/stack/commit/6f3db44a21aedf7cbbe86981a885394bc19ec2da) Thanks [@borisno2](https://github.com/borisno2)! - Fix flaky `ProcessingQueue` concurrency test: assert peak in-flight processor calls instead of wall-clock duration.

## 0.43.0

## 0.42.3

## 0.42.2

## 0.42.1

## 0.42.0

## 0.41.0

## 0.40.0

### Patch Changes

- [#970](https://github.com/OpenSaasAU/stack/pull/970) [`fa1819b`](https://github.com/OpenSaasAU/stack/commit/fa1819b0a71b5f21175e6e87d64dd6b398255a8a) Thanks [@borisno2](https://github.com/borisno2)! - Clean up comments in `packages/rag/src` per the CLAUDE.md Comments rule — removed restatement and stale narration, kept public-API TSDoc, external-constraint notes, and genuine footgun warnings. No behavior changes.

## 0.39.2

## 0.39.1

## 0.39.0

## 0.38.0

## 0.37.0

## 0.36.0

## 0.35.0

## 0.34.0

## 0.33.0

## 0.32.0

## 0.31.1

## 0.31.0

## 0.30.0

## 0.29.0

## 0.28.0

## 0.27.1

## 0.27.0

### Patch Changes

- [#664](https://github.com/OpenSaasAU/stack/pull/664) [`37838ef`](https://github.com/OpenSaasAU/stack/commit/37838efbf726b27baa5e1da448d44223c6953e3f) Thanks [@borisno2](https://github.com/borisno2)! - Upgrade TypeScript to v7. `typescript` now resolves to the `@typescript/typescript6` compatibility shim (keeping the classic compiler API available for `typescript-eslint` and Next.js's build-time type-checking, neither of which support TS 7's restructured package yet), while `@typescript-eslint/eslint-plugin` is bumped to 8.63.0 to match. The CLI's Node-build compiler step (ADR-0011) now shells out to `tsc` instead of the removed synchronous `Program` API, using its own pinned native TS 7 binary via a new `@typescript/native` dependency.

## 0.26.0

## 0.25.0

## 0.24.0

## 0.23.0

## 0.22.0

## 0.21.0

### Minor Changes

- [#415](https://github.com/OpenSaasAU/stack/pull/415) [`8980ff3`](https://github.com/OpenSaasAU/stack/commit/8980ff36ffb0879d8f4409740493dd940572cc9d) Thanks [@borisno2](https://github.com/borisno2)! - Curate the `@opensaas/stack-core` public surface into clearly-scoped entry points

  The root entry point now exposes only the everyday consumer surface — `config`,
  `list`, `getContext`, the naming helpers (`getDbKey`, `getUrlKey`,
  `getListKeyFromUrl`), `ValidationError`, and the config/access types you annotate
  with. Plugin and field authoring contracts move to a new `/extend` path, and the
  plumbing shared with sibling packages and generated code moves to `/internal`.

  ```typescript
  // Everyday usage (unchanged)
  import { config, list, getContext } from '@opensaas/stack-core'

  // Authoring a plugin or a third-party field package
  import type { Plugin, BaseFieldConfig, TypeInfo } from '@opensaas/stack-core/extend'
  ```

  `@opensaas/stack-core/internal` carries no semver guarantees; application code
  should never import from it. `Session` stays on the root entry point because it is
  the module-augmentation target.

  Removed from the public surface (zero callers): the nine `*HookArgs` types and the
  callerless typed-query runtime types. The other `@opensaas/*` packages and the CLI
  generator are updated to import from the new paths.

### Patch Changes

- [#414](https://github.com/OpenSaasAU/stack/pull/414) [`f03e5ac`](https://github.com/OpenSaasAU/stack/commit/f03e5ac32d5a38ef31c895b200b1a4f7a5e50c9c) Thanks [@borisno2](https://github.com/borisno2)! - Fix docs to use the canonical `authPlugin()`/`ragPlugin()` config pattern instead of the non-existent `withAuth()`/`authConfig()`/`withRAG()`/`ragConfig()` wrappers

## 0.20.1

## 0.20.0

## 0.19.1

## 0.19.0

## 0.18.2

## 0.18.1

## 0.18.0

## 0.17.0

## 0.16.0

## 0.15.0

## 0.14.0

## 0.13.0

## 0.12.1

## 0.12.0

## 0.11.0

## 0.10.0

## 0.9.0

## 0.8.0

## 0.7.0

## 0.6.2

## 0.6.1

## 0.6.0

## 0.5.0

## 0.4.0

### Patch Changes

- [#172](https://github.com/OpenSaasAU/stack/pull/172) [`929a2a9`](https://github.com/OpenSaasAU/stack/commit/929a2a9a2dfa80b1d973d259dd87828d644ea58d) Thanks [@list<Lists.User.TypeInfo>({](https://github.com/list<Lists.User.TypeInfo>({), [@list<Lists.User.TypeInfo>({](https://github.com/list<Lists.User.TypeInfo>({)! - Improve TypeScript type inference for field configs and list-level hooks by automatically passing TypeInfo from list level down

  This change eliminates the need to manually specify type parameters on field builders when using features like virtual fields, and fixes a critical bug where list-level hooks weren't receiving properly typed parameters.

  ## Field Type Inference Improvements

  Previously, users had to write `virtual<Lists.User.TypeInfo>({...})` to get proper type inference. Now TypeScript automatically infers the correct types from the list-level type parameter.

  **Example:**

  ```typescript
  // Before

    fields: {
      displayName: virtual<Lists.User.TypeInfo>({
        type: 'string',
        hooks: {
          resolveOutput: ({ item }) => `${item.name} (${item.email})`,
        },
      }),
    },
  })

  // After

    fields: {
      displayName: virtual({
        type: 'string',
        hooks: {
          resolveOutput: ({ item }) => `${item.name} (${item.email})`,
        },
      }),
    },
  })
  ```

  ## List-Level Hooks Type Inference Fix

  Fixed a critical type parameter mismatch where `Hooks<TTypeInfo>` was passing the entire TypeInfo object as the first parameter instead of properly destructuring it into three required parameters:
  1. `TOutput` - The item type (what's stored in DB)
  2. `TCreateInput` - Prisma create input type
  3. `TUpdateInput` - Prisma update input type

  **Impact:**
  - `resolveInput` now receives proper Prisma input types (e.g., `PostCreateInput`, `PostUpdateInput`)
  - `validateInput` has access to properly typed input data
  - `beforeOperation` and `afterOperation` have correct item types
  - All list-level hook callbacks now get full IntelliSense and type checking

  **Example:**

  ```typescript
  Post: list<Lists.Post.TypeInfo>({
    fields: { title: text(), content: text() },
    hooks: {
      resolveInput: async ({ operation, resolvedData }) => {
        // ✅ resolvedData is now properly typed as PostCreateInput or PostUpdateInput
        // ✅ Full autocomplete for title, content, etc.
        if (operation === 'create') {
          console.log(resolvedData.title) // TypeScript knows this is string | undefined
        }
        return resolvedData
      },
      beforeOperation: async ({ operation, item }) => {
        // ✅ item is now properly typed as Post with all fields
        if (operation === 'update' && item) {
          console.log(item.title) // TypeScript knows this is string
          console.log(item.createdAt) // TypeScript knows this is Date
        }
      },
    },
  })
  ```

  ## Breaking Changes
  - Field types now accept full `TTypeInfo extends TypeInfo` instead of just `TItem`
  - `FieldsWithItemType` utility replaced with `FieldsWithTypeInfo`
  - All field builders updated to use new type signature
  - List-level hooks now receive properly typed parameters (may reveal existing type errors)

  ## Benefits
  - ✨ Cleaner code without manual type parameter repetition
  - 🎯 Better type inference in both field-level and list-level hooks
  - 🔄 Consistent type flow from list configuration down to individual fields
  - 🛡️ Maintained full type safety with improved DX
  - 💡 Full IntelliSense support in all hook callbacks

## 0.3.0

## 0.2.0

### Patch Changes

- [#132](https://github.com/OpenSaasAU/stack/pull/132) [`fcf5cb8`](https://github.com/OpenSaasAU/stack/commit/fcf5cb8bbd55d802350b8d97e342dd7f6368163b) Thanks [@borisno2](https://github.com/borisno2)! - Upgrade to Prisma 7 with database adapter support

  ## Breaking Changes

  ### Required `prismaClientConstructor`

  Prisma 7 requires database adapters. All configs must now include `prismaClientConstructor`:

  ```typescript
  import { PrismaBetterSQLite3 } from '@prisma/adapter-better-sqlite3'
  import Database from 'better-sqlite3'

  export default config({
    db: {
      provider: 'sqlite',
      prismaClientConstructor: (PrismaClient) => {
        const db = new Database(process.env.DATABASE_URL || './dev.db')
        const adapter = new PrismaBetterSQLite3(db)
        return new PrismaClient({ adapter })
      },
    },
  })
  ```

  ### Removed `url` from `DatabaseConfig`

  The `url` field has been removed from the `DatabaseConfig` type. Database connection URLs are now passed directly to adapters in `prismaClientConstructor`:

  ```typescript
  // ❌ Before (Prisma 6)
  db: {
    provider: 'sqlite',
    url: 'file:./dev.db',  // url in config
  }

  // ✅ After (Prisma 7)
  db: {
    provider: 'sqlite',
    prismaClientConstructor: (PrismaClient) => {
      const adapter = new PrismaBetterSQLite3({ url: './dev.db' })  // url in adapter
      return new PrismaClient({ adapter })
    },
  }
  ```

  ### Generated Schema Changes
  - Generator provider changed from `prisma-client-js` to `prisma-client`
  - Removed `url` field from datasource block
  - Database URL now passed via adapter in `prismaClientConstructor`

  ### Required Dependencies

  Install the appropriate adapter for your database:
  - **SQLite**: `@prisma/adapter-better-sqlite3` + `better-sqlite3`
  - **PostgreSQL**: `@prisma/adapter-pg` + `pg`
  - **MySQL**: `@prisma/adapter-mysql` + `mysql2`

  ## Migration Steps
  1. Install Prisma 7 and adapter:

     ```bash
     pnpm add @prisma/client@7 @prisma/adapter-better-sqlite3 better-sqlite3
     pnpm add -D prisma@7
     ```

  2. Update your `opensaas.config.ts` to include `prismaClientConstructor` (see example above)
  3. Regenerate schema and client:

     ```bash
     pnpm generate
     npx prisma generate
     ```

  4. Push schema to database:
     ```bash
     pnpm db:push
     ```

  See the updated documentation in CLAUDE.md for more examples including PostgreSQL and custom adapters.

- [#107](https://github.com/OpenSaasAU/stack/pull/107) [`f4f3966`](https://github.com/OpenSaasAU/stack/commit/f4f3966faedba07d2cf412fab826d81e30c63a6c) Thanks [@borisno2](https://github.com/borisno2)! - Add strict typing for plugin runtime services

  This change implements fully typed plugin runtime services, providing autocomplete and type safety for `context.plugins` throughout the codebase.

  **Core Changes:**
  - Extended `Plugin` type with optional `runtimeServiceTypes` metadata for type-safe code generation
  - Converted `OpenSaasConfig` and `AccessContext` from `type` to `interface` to enable module augmentation
  - Plugins can now declare their runtime service type information

  **Auth Plugin:**
  - Added `AuthRuntimeServices` interface defining runtime service types
  - Exported runtime types from package
  - Users now get full autocomplete for `context.plugins.auth.getUser()` and `context.plugins.auth.getCurrentUser()`

  **RAG Plugin:**
  - Added `RAGRuntimeServices` interface defining runtime service types
  - Exported runtime types from package
  - Users now get full autocomplete for `context.plugins.rag.generateEmbedding()` and `context.plugins.rag.generateEmbeddings()`

  **CLI Generator:**
  - Enhanced plugin types generator to import and use plugin runtime service types
  - Generated `.opensaas/plugin-types.ts` now includes proper type imports
  - `PluginServices` interface extends `Record<string, Record<string, any> | undefined>` for type compatibility
  - Maintains backwards compatibility with plugins that don't provide type metadata

  **UI Package:**
  - Updated `AdminUI` props to accept contexts with typed plugin services
  - Ensures compatibility between generated context types and UI components

  **Benefits:**
  - Full TypeScript autocomplete for all plugin runtime methods
  - Compile-time type checking catches errors early
  - Better IDE experience with hover documentation and jump-to-definition
  - Backwards compatible - third-party plugins without type metadata continue to work
  - Zero type errors in examples

  **Example:**

  ```typescript
  const context = await getContext()

  // Fully typed with autocomplete
  context.plugins.auth.getUser('123') // (userId: string) => Promise<unknown>
  context.plugins.rag.generateEmbedding('text') // (text: string, providerName?: string) => Promise<number[]>
  ```

## 0.1.7

### Patch Changes

- 372d467: Add `searchable` helper functions to embeddings
- 372d467: Add sudo to context to bypass access control
- Updated dependencies [372d467]
  - @opensaas/stack-core@0.1.7

## 0.1.6

### Patch Changes

- 39996ca: Fix missing StoredEmbedding type import in generated types. Fields can now declare TypeScript imports needed for their types via the new `getTypeScriptImports()` method. This resolves the type error where `StoredEmbedding` was referenced but not imported in the generated `.opensaas/types.ts` file.
- Updated dependencies [39996ca]
- Updated dependencies [39996ca]
  - @opensaas/stack-core@0.1.6
