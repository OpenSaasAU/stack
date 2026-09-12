# @opensaas/stack-cli

## 0.44.0

### Minor Changes

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - `opensaas dev` no longer reconciles or promotes on a save that changes nothing

  The loop reconciled on every watcher event, including one carrying config bytes
  it had already generated from — and an identical-bytes `writeFileSync` fires a
  change event of its own on every platform. `promoteStagedGeneration` rewrites
  the live root `prisma.config.ts` as its last act, so that no-op reconcile
  overwrote a committed file the user had not changed. (On Linux, inotify can
  deliver one `fs.writeFileSync` as two events, which doubled the odds per save
  but was never the cause.)

  The loop now remembers the config source it generated from and skips a save that
  reproduces it, naming the way out:

  ```
  Config saved with no change: nothing to reconcile.
  To regenerate and reconcile anyway — after a failed reconcile, or for a change in a
  module the config imports — run `pnpm db:update` (`opensaas db update`) in another terminal.
  ```

  That route matters because the guard compares the config's own bytes, and the
  config file is all the loop watches. A change in a module the config **imports**
  fires no event, and re-saving the config no longer forces a regenerate the way
  it used to. `opensaas db update` regenerates from the current config — the
  loader disables its module cache, so the reload re-reads every imported module —
  and promotes. When a destructive change is parked, the skip says so and re-shows
  the `pnpm db:update` guidance rather than going quiet.

  A reconcile that fails after generating — a database briefly out of reach, say —
  no longer leaves the guard armed, so saving again retries instead of reporting
  that nothing changed.

  A save that does change the config behaves exactly as before: an additive edit
  goes live without a restart, a destructive one waits for `pnpm db:update`, and a
  config change with no schema effect (adding a `virtual()` field, say) still
  promotes its regenerated bundle. Whitespace- and comment-only edits still
  reconcile and promote in full — the guard compares bytes, not meaning, and only
  ever errs towards doing the work.

  The watcher also debounces with `awaitWriteFinish`, so one save reaches it as one
  event. That costs every config save at least 200ms of latency before the loop
  reacts.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - `context.prisma` becomes the Unsafe surface, `context.unsafe`

  The deliberately unsecured handle now carries a name that states the bypass, and it is Prisma 8's own query lanes rather than a bare client. Everything the secured surface does, it skips — no access filter, no field visibility, no `resolveOutput`, no hooks, no error normalisation — and every execution enters the unsafe origin, so the tripwire lets it through and a query issued by neither surface is still refused.

  ```typescript
  // Before
  const posts = await context.prisma.post.findMany()

  // After — the ORM lane, behind a transparent proxy that marks every call
  const posts = await context.unsafe.orm.public.Post.all()

  // Rows, streamed, from a typed SQL plan
  const rows = context.unsafe.query(context.unsafe.sql.public.Post.select('id').build())
  for await (const row of rows) {
    // consumed after the scope closed, still marked
  }

  // Statistics from a raw statement
  const stats = await context.unsafe.execute(
    context.unsafe.raw.sql`UPDATE "public"."Post" SET "published" = true`.affectedCount().build(),
  )
  ```

  `sql` and `raw` are Prisma's builders untouched. The surface hands out neither the bare client nor `prepare()`/`runtime()` — they are not among its own members, in the type or in the runtime value — because either would execute a statement the tripwire never sees.

  Inside `context.transaction(...)`, the transaction context's `unsafe` runs its plans through the transaction's own executor while keeping the client's contract-scoped raw lane, so a script no longer has to close over the outer client. The engine's own ORM handle is rebound to the transaction's collections at the same time: a Prisma 8 transaction holds one pooled connection for the whole callback, so a `db` left on the outer handle would commit outside the open transaction, or wait for a second connection the dev database's single-connection pool never frees.

  Core exports the surface and its builders from `@opensaas/stack-core` and `@opensaas/stack-core/unsafe`; the generated context hands the client to `getContext` so it can build one.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Move the toolchain to the Prisma 8 line and drop Prisma 7 and SQLite

  The Prisma 8 ORM family (`@prisma/orm-postgres` at `8.0.0-rc.8`) and the `prisma` CLI (`8.0.0-rc.12`) are now the single pinned toolchain. `@prisma/client`, `@prisma/adapter-better-sqlite3` and every other Prisma 7 package are gone from every manifest, and every package states a Node `>=22.18.0` floor.

  - `@opensaas/stack-core` peers on `@prisma/orm-postgres` instead of `@prisma/client`, and takes `@electric-sql/pglite`, `@electric-sql/pglite-socket` and `@electric-sql/pglite-pgvector` as optional peers for the in-process dev database.
  - `@opensaas/stack-cli` depends on `prisma`, `@prisma/orm-postgres` and the three PGlite packages directly. `opensaas generate` runs `prisma` from the app's own `node_modules/.bin`, so the app must still list `prisma@8.0.0-rc.12` as a devDependency and `@prisma/orm-postgres@8.0.0-rc.8` as a dependency itself.

  An app on this line installs the family alongside the stack:

  ```bash
  pnpm add @prisma/orm-postgres@8.0.0-rc.8
  pnpm add -D prisma@8.0.0-rc.12
  ```

  This is the first step of the Prisma 8 build ([#1121](https://github.com/OpenSaasAU/stack/issues/1121)); the generator, runtime and examples follow in later releases.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Every write through `context.db` opens a real Prisma 8 transaction again

  The Write Pipeline decided whether to open a transaction by probing the client
  for `$transaction` — the Prisma 7 name, which no Prisma 8 object carries. The
  guard was constant-false, so every write ran with no transaction and no
  rollback guarantee: a multi-statement write that failed partway, or a hook that
  threw after the database call, left its rows committed.

  The transaction capability is now an explicit signal rather than a probed
  method name. `getContext` resolves a `TransactionOpener` from the Prisma 8
  client it is handed, and puts it on the context; a context that is already
  bound to an open transaction — `context.transaction()`'s callback, a hook's
  rebound context — carries none, so a joined write still joins the enclosing
  transaction rather than opening a second one (ADR-0028). `context.transaction()`
  opens through the same opener, so both paths share one mechanism.

  The generated context now hands `getContext` the ORM handle rather than the
  client, which is what the engine reaches models through:

  ```typescript
  // .opensaas/context.ts (generated)
  getOpensaasContext(
    config,
    ormHandleFor(config, db),
    session,
    storage,
    false,
    undefined,
    undefined,
    db,
  )
  ```

  `requireOrmHandle(config, orm)` is exported from `@opensaas/stack-core` for a
  caller that builds a context over a Prisma 8 client of its own, and throws
  `OrmHandleUnresolvableError` naming the list whose collection the client does
  not expose.

  A context built over a Prisma 8 client whose collections do not cover the
  config now refuses at construction rather than quietly downgrading its writes
  to non-transactional, and `context.transaction()` over a client that can
  neither open a transaction nor join one throws `TransactionUnavailableError`
  instead of running the callback with no atomicity. A context assembled from a
  hand-built ORM double — `getContext` called without its `client` argument —
  still writes directly against that double, and now says so.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@{](https://github.com/{)! - The generated types file declares the contract remainder and instantiates core's generics

  `.opensaas/types.ts` no longer re-derives every scalar type, nullability and
  relation arity by hand. It writes one `Remainder` entry per list — the four
  facts the emitted Contract artifacts cannot carry — and names one interface per
  shape extending a generic `@opensaas/stack-core` now exports, keyed by the
  emitted `Contract`:

  ```typescript
  export type Remainder = {

      computed: { displayName: string }
      output: { secret: import('@opensaas/stack-core/internal').HashedPassword }
      input: Record<never, never>
      needs: { displayName: 'name' }
    }
    Settings: {
      computed: Record<never, never>
      output: Record<never, never>
      input: Record<never, never>
      needs: Record<never, never>
      singleton: true
    }
  }

  export interface User extends Stack$Row<Stack$Contract, Remainder, 'User'> {}
  export interface UserCreateInput extends Stack$CreateInput<Stack$Contract, Remainder, 'User'> {}
  export interface UserUpdateInput extends Stack$UpdateInput<Stack$Contract, Remainder, 'User'> {}
  export interface UserList extends Stack$SecuredList<Stack$Contract, Remainder, 'User'> {}

  export interface Context<TSession extends Stack$Session = Stack$Session> extends Stack$StackContext<
    DB,
    TSession,
    Stack$PluginServices
  > {}
  ```

  Everything the file imports is aliased behind `Stack$`, so a list may be named
  `Row`, `Contract` or `Session` without shadowing the generic its own interface
  is declared from. Only what is used is imported, so a bundle compiled under
  `noUnusedLocals` stays clean.

  `Post`, `PostCreateInput`, `PostUpdateInput`, `Context`, `BaseContext`,
  `TransactionContext` and `Lists.Post.TypeInfo` keep their names, so imports do
  not change. What changes is what they mean:

  - **An included to-one relation reads `| null`, a to-many `[]`** — by arity
    alone, whatever the foreign key's nullability. Access control can scope the
    related row away, so code that dereferenced a required relation without a
    check now fails `tsc`.
  - **A virtual field's `resolveOutput` hook receives exactly its declared
    `needs` plus the list's system fields.** Reading an undeclared column is a
    compile error for any hook authored under `list<Lists.Post.TypeInfo>`:

    ```typescript
    excerpt: virtual({
      type: 'string',
      needs: ['content'],
      hooks: {
        resolveOutput: ({ item }) => item.content.slice(0, 100), // compiles
        // resolveOutput: ({ item }) => item.title,              // tsc error
      },
    })
    ```

    The set is the one `deriveDependencyTable` resolves for the runtime
    (ADR-0051), not the declaration as written, so **a `needs` naming a
    relationship yields a different `item` type than before**: it now carries the
    foreign-key column this side owns as well as the relation, matching what the
    widening actually fetches.

    ```typescript
    byline: virtual({
      type: 'string',
      needs: ['author'],
      hooks: {
        // `authorId` is now on `item`; previously only `author` was.
        resolveOutput: ({ item }) => `${item.author?.name ?? '?'} (${item.authorId})`,
      },
    })
    ```

    A `needs` entry naming a field the list does not have is dropped rather than
    typed, the list's system fields are its actual ones (a list with
    `db.timestamps: false` carries only `id`), and only a **virtual** field gets
    this narrowed `item` — a stored field's `resolveOutput` still sees the whole
    row, which is what the runtime hands it.

  - **A write input is checked against the contract's columns.** A system-filled
    column (`id`, `createdAt`, `updatedAt`) is not writable, a non-nullable column
    with no default is required on create, and an unknown key is rejected.
  - **Every write terminal admits silent denial.** `create` returns
    `Row | null`, and `createMany` / `updateMany` — which run one secured write
    per item — return `(Row | null)[]`, so a partially denied batch is visible in
    the type. Code that used a create result without checking now fails `tsc`:

    ```typescript
    const post = await context.db.post.create({ data })
    if (!post) return { error: 'Access denied' }
    ```

  - Every per-list `GetPayload`, `Select`, `Include`, `WhereInput`, `*Args`,
    `VirtualFields`, `TransformedFields` and `{List}Crud` type is gone;
    `CustomDB` is now `DB`.

  Resolving a list's model off the ORM client now **throws**
  `OrmModelMissingError` where the client carries no delegate for it. The
  previous behaviour degraded silently in one place: a nested write's
  pre-existing-id capture treated a missing parent delegate as "no pre-existing
  ids", so a disconnect that should have been reported instead ran against an
  empty set. A real client always carries the delegate, so this surfaces on test
  doubles — give the double the model, or use a client whose model keys match the
  config's list names in `getDbKey` form (`AuthUser` → `authUser`):

  ```typescript
  // Before: a double missing `post` silently captured nothing
  const prisma = { user: userDouble }
  // After: give it the delegate the config declares
  const prisma = { user: userDouble, post: postDouble }
  ```

  `PrismaClientLike = any` is deleted. `context.prisma` is `OrmClient`, a
  structural interface, and `AccessContext`, `StackContext` and
  `AccessControlledDB` lose their `TPrisma` type parameter — drop the argument:

  ```typescript
  // Before
  function render(context: AccessContext<unknown>) {}
  // After
  function render(context: AccessContext) {}
  ```

  `OrmClient`, `OrmRow` and `OrmOperationArgs` are deliberately untyped
  (`Record<string, unknown>` and an index signature). The unsecured surface's
  shape depends on the config's list names, so the typed surface is the generated
  bundle's `DB` and `Row`; `unknown` here forces a narrow at each use where the
  `any` it replaces did not. Use `context.db` when you want types.

  `StackContext`'s first parameter is now the generated `db` surface, not the
  client, and refuses one: a stale `StackContext<MyPrismaClient>` fails its
  constraint rather than silently meaning `db: MyPrismaClient`.

  `pnpm generate` now refuses two configs it used to emit uncompilable code for:
  a virtual field with no declared `outputType`, and two lists whose generated
  names collide (`Post` and `PostList` both want `PostList`). Both errors name the
  list and field involved.

  The bundle's type-only import of the emitted declarations is now
  `'../prisma/contract.d.js'`. `'../prisma/contract.d.ts'` resolved to the
  Contract module sitting beside it, so `Contract` was not among the exports the
  import found; re-run `pnpm generate`.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Remove `findMany` / `findFirst` / `findUnique` / `count` from the generated read surface

  The Prisma 7 read names outlived the client that could serve them: every one of
  them type-checked and then threw `TypeError: … is not a function`, under `sudo`
  too. Reaching for one is now a compile error rather than a runtime failure.

  ```typescript
  // Before
  const posts = await context.db.Post.findMany({ where: { published: { equals: true } } })
  const post = await context.db.Post.findUnique({ where: { id } })
  const first = await context.db.Post.findFirst({ where: { slug: { equals: slug } } })
  const total = await context.db.Post.count()

  // After
  const posts = await context.db.Post.where({ published: { equals: true } }).all()
  const post = await context.db.Post.where({ id }).first()
  const first = await context.db.Post.where({ slug: { equals: slug } }).first()
  const { total } = await context.db.Post.aggregate((aggregate) => ({ total: aggregate.count() }))
  ```

  A singleton's `get()` is unchanged in shape and now resolves through the same
  composed read an ordinary list reads through, so its operation access, Access
  Filter, Field Visibility and related-list `query` access are the engine's rather
  than a second copy of them.

  Its auto-create is also tightened on a security path. `get()` previously fired
  the auto-create for any `query` rule that did not answer a strict `false`, so a
  rule that answered a **filter** — a first-class form, used to scope a read —
  fell through it. On an absent row that created the singleton and handed it to a
  session the filter excluded; on a present row it reached the singleton-create
  constraint's unscoped row count and threw
  `Cannot create: … is a singleton list with an existing record`, turning a read
  whose whole design is silent failure into an existence oracle. The auto-create
  now fires only for a rule that answered a strict `true` (or under `sudo`), and
  the created row is handed back through the composed read rather than raw. Every
  other form — `false`, a filter, a missing rule — answers the same `null` an
  absent row answers, writes nothing, and raises nothing; a rule that throws still
  propagates.

  If you relied on a filter-returning `query` rule auto-creating a singleton, give
  that list a `query` rule that answers `true` and scope it with the Access Filter
  on the fields instead.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Delete the Node build; the Generated bundle loads under plain Node from the committed contract

  The `.opensaas/` bundle is erasable TypeScript by contract and loads natively under Node 22.18+, so the compiled twin that existed to serve bundler-less consumers is gone (ADR-0054, withdrawing ADR-0011). Removed:

  - `output.buildTarget` from the config surface. A config that sets it is now a compile error; delete the `output` block (or the key) — nothing replaces it, because `.opensaas/context.ts` is the one specifier both a bundler and plain Node load.

    ```typescript
    // Before
    export default config({
      output: { buildTarget: 'node' },
      // ...
    })

    // After
    export default config({
      // ...
    })
    ```

    A plain-Node consumer imports the bundle entry directly:

    ```typescript
    const { rawOpensaasContext } = await import('./.opensaas/context.ts')
    ```

  - The CLI's Node build step, its `.opensaas/dist/` layout, and `@typescript/native` as a runtime dependency of `@opensaas/stack-cli` (it stays a devDependency, the compiler the package builds and type-checks its own tests with).

  The CLI's tests now run the real `node` binary over a generated bundle with no flags and no loader, and type-check generator output under `erasableSyntaxOnly` and `verbatimModuleSyntax` so a non-erasable construct fails a CLI test before it fails a user's Node.

  `create-opensaas-app` no longer accepts `--db`, and its SQLite-to-PostgreSQL transform is deleted. The scaffolded project uses the database its template declares; change it by editing `db` in the generated `opensaas.config.ts`. The scaffolded `tsconfig.json` now carries `erasableSyntaxOnly` and `verbatimModuleSyntax`, so the type-checker reports a non-erasable config before Node does.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Wait for the dev loop's promotion to finish before the staged-reconcile test stamps the root config

  `packages/cli/tests/staged-reconcile.test.ts` treated the app answering with the new
  contract as proof that the promotion behind it had finished. It is not: promotion moves
  a set of files and the filesystem offers no multi-file commit. `prisma/contract.ts` is
  swapped first, then `prisma/contract.json` — the first of them the app reads, and so the
  first that can change its answer — then `contract.d.ts`, then `.opensaas/`, and the
  project-root `prisma.config.ts` last. Between the app's answer changing and that final
  swap the test could append its "held back until promotion" stamp to a root config the
  loop was about to overwrite, and the next assertion then read a regenerated file with no
  stamp in it.

  The test now waits for the loop's own end-of-promotion line before stamping. That line
  is printed after `promoteStagedGeneration` returns, so it is the one signal emitted once
  the whole set is in place, and the wait is anchored to the output the config edit
  produced so an earlier promotion's line cannot satisfy it.

  No change to the reconciler: the invariant under test — a parked generation must not
  reach the live root config — holds, and the test still guards it.

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

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - `opensaas dev` is the dev loop: it starts the Dev database, generates, reconciles and runs the app

  Running `opensaas dev` in a project now starts the Dev database on a free loopback port
  (persisting under `.opensaas/dev-db`, with `vector` loaded when the config declares the pgvector
  pack), runs `generate`, runs `prisma db update` against it, and spawns the app — `next dev` by
  default:

  ```bash
  opensaas dev              # runs `next dev`
  opensaas dev -- vitest    # runs your own command instead
  ```

  The app child is handed **no** `DATABASE_URL` — one inherited from the environment is removed
  rather than merely left uninjected: it finds the database through the state file, so
  the generated runtime reports `'dev-database'` provenance and takes the single-connection binding.
  `DATABASE_URL` already set is the Database escape — no Dev database starts and the environment
  passes through untouched. The project's `.env` is loaded before that decision is made, the same
  file the generated `prisma.config.ts` and `next dev` load, so a `DATABASE_URL` written there is
  honoured rather than shadowed by a sidecar nothing uses; a shell variable still outranks the file.
  The database dies with the process; `opensaas.config.ts` is still watched, and the loop shuts the
  database down on every path that unwinds — a failed reconcile, a Prisma CLI that will not run, and
  Ctrl-C at the consent prompt included. A `generate` that refuses ends the process outright, past
  the reach of an async shutdown, so that path is covered synchronously instead: the app child is
  killed and the run's state file removed.

  Every Prisma CLI spawn is asynchronous now (a `spawnSync` deadlocks the socket server the Dev
  database is served on), with stdin closed for `contract emit` and the terminal inherited for the
  boot `db update`, so a destructive plan stops at Prisma's own consent prompt and the app is never
  started.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Add the row lock and the advisory lock to the transaction-bound context

  A capacity gate is the case a stricter isolation level used to cover, and `context.transaction(fn)` no longer takes one. `.forUpdate()` is the replacement: a row lock on the contended parent, taken **before** the count, so every racer takes the same token on the same row and the count cannot go stale under a booking a racer that got there first has already committed.

  ```typescript
  const result = await context.transaction(async (tx) => {
    // The lock comes BEFORE both reads below. `null` here is denied-or-gone —
    // either way there is no gate to run.
    const held = await tx.db.Slot.where({ id: { equals: slotId } })
      .forUpdate()
      .first()
    if (held === null) return { booked: false }

    // BOTH sides of the gate are read after the lock, each in its own statement.
    // `held`'s own columns are the row as of BEFORE the lock was granted, so
    // `held.capacity` can be stale; this re-read cannot be, because no one else
    // can commit an update to a row this transaction holds.
    const slot = await tx.db.Slot.where({ id: { equals: slotId } }).first()
    const { taken } = await tx.db.Booking.where({ slotId: { equals: slotId } }).aggregate(
      (aggregate) => ({ taken: aggregate.count() }),
    )
    if (slot === null || taken >= slot.capacity) return { booked: false }

    return { booked: true, item: await tx.db.Booking.create({ data: { slotId, holder } }) }
  })
  ```

  **The lock is a mutex on the row, not a fresh read of it.** Each of the two statements takes its own snapshot under Read Committed, so a column another transaction committed between the read and the lock reaches the caller as its **pre-lock** value — only the row's identity is post-lock, and this differs from a single-statement `SELECT … FOR UPDATE`, which Postgres re-evaluates after acquiring. Read whatever the gate compares against in its own statement after the lock, the way the count above is.

  `.forUpdate()` is on the transaction-bound builder and nowhere else. A lock taken outside a transaction is released at the end of the statement that took it, so it would compile, run, return rows and guard nothing — `context.db.Slot.forUpdate()` is a compile error rather than a throw. The generated bundle names two faces per list for it, `SlotList` and `SlotTxList`, and `TransactionContext` is the context over the locking one.

  The terminal runs two statements. The scoped read goes first and resolves operation access, the Access Filter and Field Visibility exactly as any read does; the engine then composes `SELECT <pk> FROM <table> WHERE <pk> IN ($1…$n) ORDER BY <pk> LIMIT $n+1 FOR UPDATE` over the keys it returned and runs it on the transaction's own connection. So the locked set is provably a subset of the readable set, and **a terminal never returns a row it did not lock**: a row deleted between the two statements locks nothing, `first()` yields `null` and `all()` the surviving subset. `null` now means denied-or-vanished.

  `first()` and `all()` carry the modifier. `aggregate()` and `nearest()` refuse it rather than drop it — an aggregate returns no primary keys to lock, and a ranking is not a gate. There is no `forShare`, no `NOWAIT` and no `SKIP LOCKED`: a skipped locked row would be indistinguishable from an access-denied one, which would make silent failure mean two things at once. The engine always emits `ORDER BY <pk>`, so acquisition order is the same in every session.

  A list whose table has no single-column primary key cannot be locked (`RowLockIdentityError`), and one terminal binds at most `ROW_LOCK_MAX_KEYS` keys (`RowLockKeyLimitExceededError`) — a cost limit, fail-closed, well under Postgres's bind-parameter ceiling, where the failure is a corrupted bind rather than a clean refusal.

  `tx.advisoryLock(key)` joins it on the transaction context, for an invariant that is not a row:

  ```typescript
  await context.transaction(async (tx) => {
    await tx.advisoryLock(`checkout:${cartId}`)
    // …
  })
  ```

  It runs `pg_advisory_xact_lock(hashtext($1))` and releases when the transaction ends, whichever way it ends. It sits on the context rather than on `db` because it locks a number and belongs to no list. `hashtext` is 32-bit, so two distinct keys can collide — a collision costs spurious serialisation, never a missed lock.

  See ADR-0047 and ADR-0062.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Add the Dev database primitive and give the URL lookup a provenance

  `@opensaas/stack-core/dev-database` exports `startDevDatabase()`, which starts an
  in-process PGlite behind a socket server on a free loopback TCP port and publishes
  it in a state file (URL and pid) under the Generated bundle directory, so that the
  app, a seed script and a second-terminal `db update` all find it through the same
  lookup instead of an injected variable (ADR-0063). PGlite and its socket and
  pgvector packages are optional peers, imported only when the primitive is called.

  ```typescript
  import { startDevDatabase } from '@opensaas/stack-core/dev-database'

  const database = await startDevDatabase({
    dataDir: '.opensaas/dev-db',
    extensions: ['vector'],
  })
  // ... database.url, database.port
  await database.stop()
  ```

  `stop()` is idempotent — a `SIGINT` handler and a `finally` may both call it — and drops
  the state file only once the socket server and PGlite are actually released. A failure
  anywhere in startup tears down whatever was already constructed, so no port is left
  bound. An IPv6 `host` is bracketed into the published URL.

  `resolveDatabaseUrl()` now returns `{ url, provenance }` rather than a bare string,
  and consults the dev database state file when the environment names no connection.
  `provenance` is `'env'` for `DATABASE_URL`/`DIRECT_DATABASE_URL` and `'dev-database'`
  for the state file; with neither it throws, naming both remedies. Callers that want
  just the string take `.url`; `findDatabaseUrl()`, which the generated
  `prisma.config.ts` uses, is unchanged in shape and still non-throwing.

  ```typescript
  // Before
  const url = resolveDatabaseUrl()

  // After
  const { url, provenance } = resolveDatabaseUrl()
  ```

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

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - `opensaas generate` seeds each declared extension pack's contract space under `migrations/`

  Every `db.extensions` entry now has its `/pack`, `/control` and `/runtime` subpaths derived from the package name and checked, and its migration package, head ref and contract snapshot materialised under `migrations/` — between writing `prisma.config.ts` and emitting the contract (ADR-0065). Seeding opens no database connection; the space's content is a function of the installed pack version alone.

  ```typescript
  // opensaas.config.ts
  export default config({
    db: {
      provider: 'postgresql',
      extensions: [{ name: 'pgvector', from: '@prisma/orm-extension-pgvector' }],
    },
    lists: {/* ... */},
  })
  ```

  `pnpm generate` then writes, and reports, the pack's space:

  ```
  ✅ pgvector: migrations/pgvector updated
  ```

  ```
  migrations/pgvector/20260601T0000_install_vector_extension/migration.json
  migrations/pgvector/20260601T0000_install_vector_extension/ops.json
  migrations/pgvector/refs/head.json
  migrations/snapshots/<hash>/contract.json
  migrations/snapshots/<hash>/contract.d.ts
  ```

  Commit these files. A second `generate` leaves them byte-identical and reports the space `unchanged`; upgrading the pack to a version shipping a new migration package rewrites the head ref, so the upgrade surfaces as a generate diff rather than a silent drift. Prisma then runs `CREATE EXTENSION IF NOT EXISTS` from the committed space on `db init`, `db update` and `db migrate` — there is no hand-run DDL step.

  A pack that does not publish one of the three subpaths fails generation naming the pack and the exact missing subpath, and it fails before anything is written — `prisma.config.ts` is never left carrying an import that cannot resolve. A pack whose `/control` subpath loads but default-exports no control descriptor is refused the same way, naming the pack and the subpath rather than failing as a `TypeError` from inside the seed phase.

  Subpaths are resolved under the `import` condition, the same way the generated artifacts reach them, so an ESM-only pack is accepted and a dual-published pack is loaded from its ESM build. Overlapping `exports` patterns are ranked the way Node ranks them, and a directory at a subpath is not treated as a resolution — ESM cannot import one.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - `pnpm generate` emits the Prisma 8 artifact set: a Contract module, `prisma.config.ts` and the committed contract artifacts

  `opensaas generate` no longer writes a Prisma schema or a generated Prisma client. It derives the contract from `opensaas.config.ts`, renders a standalone, fully literal `prisma/contract.ts`, writes a `prisma.config.ts` at the project root, shells to the pinned `prisma contract emit` for `prisma/contract.json` + `prisma/contract.d.ts`, checks the emitted relation graph against the derivation, then writes the `.opensaas/` bundle.

  The Contract module imports nothing from your config — only `@prisma/orm-postgres/contract-builder`, the column-type helpers, and each pack declared in `db.extensions`:

  ```typescript
  // prisma/contract.ts — generated
  import { defineContract, nativeEnum, pg } from '@prisma/orm-postgres/contract-builder'
  import pgvector from '@prisma/orm-extension-pgvector/pack'

  export const contract = defineContract({ extensions: { pgvector } }, ({ field, model, rel }) => {
    // ...
  })
  ```

  `prisma.config.ts` imports each pack's `/control` façade, loads the project's `.env`, and resolves its connection through the stack's URL lookup (`DIRECT_DATABASE_URL`, then `DATABASE_URL`). Prisma's config evaluation loads no dotenv of its own, so without that load a project keeping its connection only in `.env` would reach `db update` and `migrate` with nothing set. The load is native — `process.loadEnvFile`, no dependency — and guarded, so a project with no `.env` still generates and runs:

  ```typescript
  // prisma.config.ts — generated
  import { existsSync } from 'node:fs'
  import { join } from 'node:path'
  import { definePrismaConfig } from 'prisma/config'
  import { defineConfig } from '@prisma/orm-postgres/config'
  import { findDatabaseUrl } from '@opensaas/stack-core'
  import pgvector from '@prisma/orm-extension-pgvector/control'

  const envFile = join(import.meta.dirname, '.env')
  if (existsSync(envFile)) process.loadEnvFile(envFile)

  export default definePrismaConfig({
    orm: defineConfig({
      contract: './prisma/contract.ts',
      output: './prisma',
      extensions: [pgvector],
      db: { connection: findDatabaseUrl() },
    }),
  })
  ```

  Commit `prisma/contract.ts`, `prisma/contract.json` and `prisma/contract.d.ts` — a schema change is then reviewable in the PR that made it, and CI can fail on a stale artifact.

  The generated `.opensaas/context.ts` constructs its client from the committed `contract.json` rather than from a generated client package:

  ```typescript
  postgres<Contract>({ contractJson, url: resolveDatabaseUrl() })
  ```

  Core adds `resolveDatabaseUrl()` (throws when nothing is set) and `findDatabaseUrl()` (returns `undefined`) — the one place a connection string is read from `DIRECT_DATABASE_URL` or `DATABASE_URL` — plus `resolveListTimestamps`. `output.prismaSchema` is now `output.contractModule` (default `prisma/contract.ts`), and a plugin's `afterGenerate` receives `contractModule` where it received `prismaSchema`. The hook runs **before** `prisma contract emit`, so a rewritten `contractModule` is the one the emitted artifacts describe and the one the relation-graph gate checks — a rewrite the toolchain rejects fails `opensaas generate` rather than landing on disk unemitted.

  Until the bundle is rewritten against `prisma/contract.d.ts`, the per-model `Select`, `Include`, `WhereInput`, `*Args` and write-`data` shapes in `.opensaas/types.ts` are unnarrowed placeholders: a query result is typed as the full model row (no `select`/`include` narrowing), and only the scalars OpenSaaS itself narrows are checked on a write.

  `authPlugin`'s per-model `indexes` no longer document a `sort` direction on a field reference; an index column cannot carry one, and a `sort` key is refused at generation.

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

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Bring the CLI's MCP server onto the Prisma 8 surface

  `opensaas_implement_feature` wrote a config the stack cannot load: `provider: 'sqlite'`
  with a `prismaClientConstructor`, under an `@prisma/adapter-better-sqlite3` import, and
  finished by telling the user to run `pnpm db:push`. The feature generator now emits the
  Postgres-only block, and every instruction the server prints names a command that exists:

  ```typescript
  // Emitted into the user's opensaas.config.ts
  export default config({
    plugins: [authPlugin({ ... })],
    db: {
      provider: 'postgresql',
    },
    lists: { ... },
  })
  ```

  Next steps now read "Run `pnpm dev` — `opensaas dev` starts the Dev database, regenerates,
  and reconciles it with the new schema", with `pnpm db:update` for a change held back as
  destructive. `opensaas_feature_docs`, `opensaas_answer_migration`, the wizard completion
  text and the validation checklist carry the same substitutions, and the migration wizard
  offers `postgresql` as the only `db_provider`.

  Three emitted-code bugs found by running the generator are fixed with it. The `avatar` and
  `featuredImage` field entries carried a trailing `//` comment that swallowed the
  comma-separator and the field after it, so the object literal did not parse. The blog
  feature emitted `Post.tags` and `Tag.posts` as an implicit many-to-many, which ADR-0048
  deletes and the contract validator refuses by name — both ends now point at a `PostTag`
  junction list carrying a unique `db.indexes` entry over the pair. And the `file-upload`
  feature placed its `image()`/`file()` entries directly in `lists`, where list declarations
  belong; they now sit inside the list that owns them.

  ```typescript
  // Emitted for a blog with Tags
  Post: list({ fields: { tags: relationship({ ref: 'PostTag.post', many: true }) } }),
  Tag: list({ fields: { posts: relationship({ ref: 'PostTag.tag', many: true }) } }),
  PostTag: list({
    fields: {
      post: relationship({ ref: 'Post.tags' }),
      tag: relationship({ ref: 'Tag.posts' }),
    },
    db: { indexes: [{ fields: ['post', 'tag'], unique: true }] },
  }),
  ```

  A new suite generates all 13 wizard answer paths derived from the catalog. Each asserts the
  result parses as TypeScript and names none of the dead surface; the 12 that declare lists
  also evaluate those declarations and run them through the chain `opensaas generate` runs
  before it writes anything — `validateConfigFields`, `validateNeedsDeclarations`,
  `validateDatabaseConfig`, `validateRelations`, `deriveContract` — so a config the stack
  refuses fails the suite rather than passing because it parsed.

- [#1453](https://github.com/OpenSaasAU/stack/pull/1453) [`37bdc74`](https://github.com/OpenSaasAU/stack/commit/37bdc74624cb6790347e1605725fb5aabcb02cc9) Thanks [@borisno2](https://github.com/borisno2)! - The migration assistant (`opensaas migrate --with-ai`, `opensaas_answer_migration`) no longer emits a Prisma 7 database block. `MigrationGenerator` now writes the Postgres-only `db: { provider: 'postgresql' }` block for both a fresh Prisma/Next.js migration and the KeystoneJS migration guide — no `prismaClientConstructor`, no driver adapter import, and no `joinTableNaming` guidance for a key that no longer exists. The Keystone guide's many-to-many step now shows a junction-list example instead, and the emitted next steps point at `pnpm generate`/`pnpm dev` instead of `prisma generate`/`prisma db push`.

  A generate-and-validate test suite (`emitted-migration-surface.test.ts`) now covers the migration generator the same way `emitted-prisma-surface.test.ts` covers the feature wizard: every emitted config is parsed, swept for dead Prisma 7 surface, and run through the CLI's own pre-write validation chain.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Generation emits the dependency-set table and the unique-constraint map; the runtime dependency fold is deleted

  `pnpm generate` now resolves each computed field's `needs` into its one-hop set — columns and relations, a relation implying its foreign-key column — records each list's actual system fields, and writes both plus a unique-constraint-name-to-field-names map to `.opensaas/tables.ts`. The generated context hands them to the runtime, so the engine widens a read from an emitted fact instead of walking the config on every read (ADR-0051), and a unique violation can resolve to per-field messages without parsing error prose (ADR-0042).

  ```ts
  // .opensaas/tables.ts
  export const dependencyTable: DependencyTable = {
    Post: {
      systemFields: ['id', 'createdAt', 'updatedAt'],
      fields: {
        byline: { columns: ['authorId', 'title'], relations: ['author'] },
      },
    },
    Category: { systemFields: ['id'], fields: {} }, // db.timestamps: false
  }

  export const constraintMap: ConstraintMap = {
    User_email_key: { list: 'User', fields: ['email'] },
    Profile_user_key: { list: 'Profile', fields: ['user'] },
  }
  ```

  Core exports `deriveDependencyTable(config)`, `deriveConstraintMap(config, contract)` and `deriveGeneratedTables(config, contract)` for anything that needs the same facts.

  The dependency set is one hop and non-transitive, so a declaration can no longer form a closure: `validateNeedsClosureDepth` and its `'cycle'`/`'depth'` refusals, the recursive `foldDeclaredDependencies`, its `visitedLists` cycle guard and `DeclaredOnlyTree` are all removed. A config that used to fail generation with an over-deep or cyclic `needs` closure now generates. `validateNeedsDeclarations` is unchanged and still refuses an entry naming nothing on the list, an entry naming a computed field, and a `needs` on a field with no `resolveOutput` hook.

  One behaviour change to be aware of: a relation fetched only to satisfy a declaration no longer has its own computed fields run, so it no longer carries its own declarations either. A hook needing two hops takes a privileged read inside itself.

  **Migration note (silent break):** a `resolveOutput` hook on a list reached only as another field's declared dependency stops running. Its value was already stripped from the caller's result along with the branch, so nothing a caller receives changes — but a hook with a side effect (a counter, a log, a cache write) loses it. Grep for `resolveOutput` hooks on lists that appear in another list's `needs` and do more than return a value.

  The derived constraint names now match what PostgreSQL actually stores for an identifier over 63 bytes. A primary key is emitted unnamed and PostgreSQL derives it with `makeObjectName`, which reserves the `_pkey` label and shrinks the table component (`<58 chars>_pkey`); a unique is named by Prisma and only clipped by PostgreSQL, which keeps the leading 63 bytes and loses `_key`. Previously both were clipped, so every derived primary-key name over the limit was wrong and a `23505` on it would have missed the map.

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

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - The generated context constructs the Prisma 8 client from `contract.json`

  Core gains `@opensaas/stack-core/client`, whose `resolveRuntimeConnection()` chooses how the
  runtime binds its connection, and the generated `.opensaas/context.ts` builds its client from it
  once per process — with the stack-owned origin tripwire in `middleware` and each declared pack's
  runtime façade in `extensions`.

  ```typescript
  import { resolveRuntimeConnection } from '@opensaas/stack-core/client'

  postgres<Contract>({
    contractJson,
    middleware: [originTripwire],
    ...resolveRuntimeConnection(config.db.client),
  })
  ```

  Three branches, in order:

  - `db.client.pg` — your own pool. The factory is called here and nowhere else, once, after the
    config promise resolves, so loading the config (the CLI's `generate`, tooling, a type check)
    never opens a connection.
  - A dev database (`opensaas dev`) — a single-connection pool with `verifyMarker: false`, both
    required by the socket-multiplexed dev database and applied on its provenance only.
  - `DATABASE_URL` — the connection string and Prisma's defaults, plus `db.client.poolOptions`.

  With neither a connection variable nor a running dev database, the first use throws
  `DatabaseUrlUnresolvedError`, naming both remedies. That failure is not cached: a process that
  starts before its database does drops the memo and builds a client on the next call, so the dev
  server booting ahead of `opensaas dev` recovers on its own rather than serving a stale error for
  the rest of its life.

  An explicit `db.client.pg` still wins over a running dev database, but now says so — binding your
  own pool there loses the single connection and `verifyMarker: false` that database requires, and
  `resolveRuntimeConnection` warns rather than rebinding silently.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Stage the dev loop's regeneration behind reconciliation, and add `opensaas db update`

  A config edit under `opensaas dev` no longer regenerates in place. The new contract
  and bundle are written to `.opensaas/staged/`, `prisma db update` is planned against
  them, and they are promoted only once the plan has applied — so the app never reloads
  onto a contract the database does not carry.

  A plan that would destroy data is not applied. The loop prints it, leaves the database
  and the bundle at the previous schema, keeps serving, and tells you to run
  `pnpm db:update`:

  ```
  This change would destroy data, so it was not applied:
    • Drop column "note" from "Note" (destructive)
      ALTER TABLE "public"."Note" DROP COLUMN "note"

  The app keeps serving the previous schema. To apply it, run `pnpm db:update`
  (`opensaas db update --confirm postgres`) in another terminal.
  ```

  `opensaas db update` is that command:

  ```bash
  opensaas db update --confirm postgres
  ```

  It passes the consent token through to Prisma, promotes the staged artifacts, and
  restarts the app child after a destructive promote — a client cached across a reload
  would otherwise keep querying the dropped column. The reconcile itself runs inside the
  running loop, which owns the Dev database and the migrations refs, so a second terminal
  opens no connection of its own. With no loop listening, the command fails naming
  `opensaas dev`. If the loop goes away part-way through an exchange, the command says so
  rather than claiming no loop is running.

  Staging covers the whole generation: the project-root `prisma.config.ts` is held back
  with the rest and promoted with it, so a discarded `db.extensions` change leaves no
  config describing extensions the contract does not carry. Promotion moves the entire
  staged bundle directory — including files a plugin's `afterGenerate` wrote — and swaps
  each file into place through a rename, so the running app never reads a half-written
  one.

  Each file lands atomically; the set of them does not. The filesystem offers no
  multi-file commit, so a crash part-way through promotion leaves the bundle split across
  two contracts. The loop reports the split, naming the file it stopped on, and re-running
  `opensaas generate` rewrites the whole bundle from the current config.

### Patch Changes

- [#1465](https://github.com/OpenSaasAU/stack/pull/1465) [`0c33f68`](https://github.com/OpenSaasAU/stack/commit/0c33f68b5d9449b4cdaecc792815bbd64afd7e9f) Thanks [@borisno2](https://github.com/borisno2)! - Fix `context.unsafe.sql`/`.raw` degrading to `object` through the generated `Context`/`BaseContext`/`TransactionContext` types. The generated bundle now keys the Unsafe surface to the app's own Prisma 8 client, so a migration script gets Prisma's own typed SQL builder and raw tag with no cast.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - The Prisma 8 config surface: `db.idField`, `db.extensions`, `db.client`, `db.provider` (postgresql only), typed `onDelete`/`onUpdate` on relationships, `db.indexes` without `sort`, and `PluginContext.addExtension` (ADR-0040, ADR-0048, ADR-0049, ADR-0064).

  ```typescript
  export default config({
    db: {
      provider: 'postgresql',
      idField: 'uuid7', // the default; 'cuid2' | 'int autoincrement'
      extensions: [{ name: 'pgvector', from: '@prisma/orm-extension-pgvector' }],
      client: {
        pg: () => new Pool({ connectionString: process.env.DATABASE_URL }), // a lazy factory
      },
    },
    lists: {
      Invoice: list({
        fields: {
          customer: relationship({ ref: 'Customer.invoices', db: { onDelete: 'restrict' } }),
        },
        db: {
          idField: 'int autoincrement',
          indexes: [{ fields: ['customer'], name: 'Invoice_customer_idx' }],
        },
      }),
    },
  })

  // A plugin declares the pack its field types need; the same name from the same
  // package merges, the same name from a different package throws.
  init: async (context) => {
    context.addExtension({ name: 'pgvector', from: '@prisma/orm-extension-pgvector' })
  }
  ```

  `pnpm generate` now refuses, naming the list, the entry and the fix (`validateDatabaseConfig` and `validateRelations` are exported for the same checks elsewhere): a `sort` direction on a `db.indexes` field reference; `many: true` on both sides of a relationship or on a list-only ref (author the junction as its own list); `db.idField` on a singleton; `db.foreignKey: true` on both sides of a one-to-one; `db.isNullable: false`, `db.onDelete`/`db.onUpdate` or a `db.indexes` entry on a side that owns no foreign key column; `'setNull'` together with `db.isNullable: false`; a `many: false` relationship whose `ref` is its own field; the same extension pack name declared from two packages; and a relationship at a composite-keyed list.

  `prismaClientConstructor`, `extendPrismaSchema` (config- and field-level), `joinTableNaming` and `db.relationName` are removed from the config types. `@opensaas/stack-auth`'s derived lists declare their cascade through `db.onDelete` instead of `extendPrismaSchema`.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Field builders declare their contract contribution as a structured descriptor, and `needs` accepts stored columns

  Every core field builder now carries `getContractField(fieldName, listKey, config)`, returning a `ContractFieldDescriptor`: a stored column as a pack-qualified type constructor (`{ pack, type, args }`) with native type, nullability and column mapping; for a relationship, the relation and the foreign-key column this side owns; for a virtual field, `{ kind: 'computed' }`. It is the only way a field describes its storage: the PSL-shaped `getPrismaType`/`getPrismaColumns`/`getPrismaRelation` it replaces are removed from the contract in this same release.

  ```typescript
  import type { BaseFieldConfig } from '@opensaas/stack-core/extend'

  export function embedding(dimensions: number): BaseFieldConfig<TypeInfo> {
    return {
      type: 'embedding',
      getContractField: (fieldName) => ({
        kind: 'column',
        name: fieldName,
        type: { pack: 'pgvector', type: 'Vector', args: [dimensions] },
        nullable: true,
      }),
      // ...getZodSchema and the rest of the builder
    }
  }

  text().getContractField('title', 'Post', config)
  // { kind: 'column', name: 'title', type: { pack: 'pg', type: 'text' }, nullable: true }

  relationship({ ref: 'User.posts' }).getContractField('author', 'Post', config)
  // { kind: 'relation', target: 'User', inverse: { field: 'posts', synthetic: false }, many: false,
  //   foreignKey: { name: 'authorId', map: 'author', nullable: true, unique: false, index: true,
  //                 references: { list: 'User', field: 'id' } } }
  ```

  A default that is not a JSON literal (a `Date`, a `Decimal`, a `Map`) is refused by the builder, naming the list and field, rather than silently dropped; a `bigint` default is carried as its decimal string whether written `42n`, `42` or `'42'`. A caller-supplied `outputType`/`inputType` now wins over the `select`, `password` and `calendarDay` builder defaults.

  A field's TypeScript face is one pair of `TypeDescriptor` values — `outputType` (what a read returns) and `inputType` (what a write accepts) — set only where it differs from the column's codec type: `password` reads as `HashedPassword`, `select` reads and writes its option union, `calendarDay` reads and writes a `YYYY-MM-DD` string, and `virtual({ type })` keeps its spelling with `outputType` as the computed entry. A stored field that sets neither takes the codec's type.

  `needs` now accepts stored-column keys as well as relations (`needs: ['lineItems', 'price']`), and `pnpm generate` refuses a `needs` on a field with no `resolveOutput` hook, naming the list and field. A declared column is honoured at runtime: under a fragment `query` that selects only the computed field, the hook's `item` still carries the column and the result still does not.

  ```typescript
  total: virtual({
    type: 'number',
    needs: ['price', 'quantity'],
    hooks: { resolveOutput: ({ item }) => item.price * item.quantity },
  })
  ```

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@{](https://github.com/{)! - The secured surface takes the closed Where vocabulary, lowered in one place

  `context.db.<List>.where(...)` now accepts the whole vocabulary — `equals`,
  `not`, `in`, `notIn`, `lt`, `lte`, `gt`, `gte`, `contains`, the `AND`/`OR`/`NOT`
  combinators, and `some`/`every`/`none` on a relation of any cardinality — plus a
  new scalar-only `.orderBy()`. Everything lowers onto the ORM's predicate lambda
  in one place (ADR-0055).

  ```typescript
  const posts = await context.db.Post.where({
    OR: [{ title: { contains: 'release' } }, { views: { gte: 100 } }],
   some: { handle: { equals: 'ada' } } },
  })
    .orderBy({ views: 'desc' })
    .all()
  ```

  - `contains` is engine-escaped and case-insensitive, so `contains: '50%'` matches
    a literal per-cent sign rather than binding a wildcard.
  - `equals: null` lowers to `IS NULL`, `not: null` to `IS NOT NULL`.
  - A relation predicate scopes the `EXISTS` by the related list's own `query`
    access. `some` and `none` ask about the rows the caller may see; `every` asks
    whether every row the caller may see matches, so a row the caller cannot see
    never decides the parent's membership. A related list the session cannot
    query is the empty set: `some` is false, `none` and `every` are true.
  - An Access Filter that scopes by a relation is expanded into the related list's
    own Access Filter. A filter that expands into itself — directly, or through
    another list — throws `AccessFilterRecursionError` naming the chain, rather
    than recursing until the process runs out of memory. An acyclic chain deeper
    than ten lists is refused the same way. Failing closed is deliberate: a
    truncated Access Filter is a widened read.
  - An unknown key or operator is a `ValidationError` naming the list and the key,
    under `sudo` too. A key the session cannot read is refused with the identical
    message a key the list does not declare gets, so the refusal is not an
    existence oracle; a denied caller still gets the Silent failure first and sees
    no validation error at all.

  **Lowering is now total.** A condition that resolved to `undefined` is refused
  rather than dropped, on both spellings. An access rule written as
  `({ session }) => ({ authorId: session?.userId })` used to match every row for an
  anonymous caller; it now throws. Spell the denial:

  ```typescript
  // Before — silently matched everything when session was null
  query: ({ session }) => ({ authorId: session?.userId })

  // After
  query: ({ session }) => (session ? { authorId: { equals: session.userId } } : false)
  ```

  The same refusal now covers the clause `mergeFilters` folds in, so the guarantee
  holds on every surface rather than only on `.where().all()/.first()`: an access
  filter carrying an `undefined` condition anywhere (including nested under an
  operator or inside an `AND`/`OR` branch) throws the new, exported
  `UndefinedAccessFilterError`. A caller's own `where` is untouched — this applies
  only to what an access rule returns.

  **Also changed:** the filter engine's `FilterCondition` is a Where vocabulary
  value; a to-one relationship's label filter emits `some` rather than `is`; a
  to-many count filter shrinks to presence (`orders:0` → `none`, `orders:>0` /
  `orders:>=1` → `some`, any other comparison degrades to free text);
  and read-path key validation rejects an operator outside the vocabulary
  (`startsWith`, `endsWith`, `mode`, `search` and the array/JSON operators are
  gone).

  **Removed exports.** These have no replacement — the behaviour they carried is
  either gone or now expressed in the Where vocabulary:

  | Removed                                       | What to do instead                                             |
  | --------------------------------------------- | -------------------------------------------------------------- |
  | `RELATIONSHIP_COUNT_FILTER_KEY`               | Nothing — the count-filter marker no longer exists.            |
  | `RelationshipCountFilterMarker`               | Nothing — same.                                                |
  | `resolveRelationshipCountFilters`             | Nothing — a count filter shrinks to `some`/`none` when parsed. |
  | `resolveRelationshipLabelFilters`             | Nothing — a to-one label filter emits `some` directly.         |
  | `isToOneRelationshipField`                    | Read `many` off the relationship field config.                 |
  | `ColumnEquality`, `UnsupportedPredicateError` | Gone with the predicate builder they belonged to.              |

  **Newly exported:** `UndefinedAccessFilterError` and, from the secured surface,
  `AccessFilterRecursionError`.

- [#1466](https://github.com/OpenSaasAU/stack/pull/1466) [`95cb6dc`](https://github.com/OpenSaasAU/stack/commit/95cb6dc70a6c622c70c8cd74a14abb53f25bc95f) Thanks [@borisno2](https://github.com/borisno2)! - Fix three spots that assumed every list carries `createdAt`/`updatedAt` (timestamps are opt-in, ADR-0004): the migration generator no longer drops a source model's timestamp columns — it opts the list into `db.timestamps` when they match the auto-managed shape, or declares them as ordinary fields otherwise; the MCP fields projection no longer advertises or accepts `createdAt`/`updatedAt` on a list that doesn't have them; and the blog feature generator's scaffolded Post list now opts into `db.timestamps`, since its generated pages read `post.createdAt`.

- [#1461](https://github.com/OpenSaasAU/stack/pull/1461) [`aa65d0f`](https://github.com/OpenSaasAU/stack/commit/aa65d0fef6b2df0120e48ec3c1c34e7cd59ef175) Thanks [@borisno2](https://github.com/borisno2)! - `generateCommand()` now throws `GenerationFailedError` on failure instead of calling `process.exit(1)`. `opensaas generate` catches it at the CLI entry point and exits 1 as before; `opensaas dev` catches it at boot and runs the loop's async `stop()`, so a generation failure closes the Dev database cleanly instead of orphaning it.

- [#1467](https://github.com/OpenSaasAU/stack/pull/1467) [`2739ad8`](https://github.com/OpenSaasAU/stack/commit/2739ad8923ab3db893eefb718d21fcb2d079a519) Thanks [@borisno2](https://github.com/borisno2)! - Fix a list/field hook's `context.db` resolving through core's unkeyed default instead of the app's own generated `db` surface, so `context.db.typoedListName` compiled inside a hook and a real list lost its row type. `TypeInfo` now carries the generated `db`, and every hook-args type keys `context` to it.

- [#1474](https://github.com/OpenSaasAU/stack/pull/1474) [`540d7e1`](https://github.com/OpenSaasAU/stack/commit/540d7e112a3aa62c7fc2422e4f91a85a0409d35e) Thanks [@borisno2](https://github.com/borisno2)! - Fix `dev.test.ts` flaking in CI: the cold `./dev.js` import no longer sits inside a test's 5s timeout, and a timed-out test can no longer leak a spawn call into the next test.
- Updated dependencies [[`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`0c33f68`](https://github.com/OpenSaasAU/stack/commit/0c33f68b5d9449b4cdaecc792815bbd64afd7e9f), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`5aa3815`](https://github.com/OpenSaasAU/stack/commit/5aa38159fe5a54f3f0c294cc47f439ec9175d544), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`21bd0d5`](https://github.com/OpenSaasAU/stack/commit/21bd0d53860d8ad2f801c65e83637e523adc19f6), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`27d91d5`](https://github.com/OpenSaasAU/stack/commit/27d91d54fcd79122dfe695b5dea94c14572a2b98), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`95cb6dc`](https://github.com/OpenSaasAU/stack/commit/95cb6dc70a6c622c70c8cd74a14abb53f25bc95f), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`d59945a`](https://github.com/OpenSaasAU/stack/commit/d59945a36ba6615823e22822f366fb2507fbad68), [`9fe6917`](https://github.com/OpenSaasAU/stack/commit/9fe6917f37f4110740e2aa9ee174355699f8b36d), [`2739ad8`](https://github.com/OpenSaasAU/stack/commit/2739ad8923ab3db893eefb718d21fcb2d079a519), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`3fb20e0`](https://github.com/OpenSaasAU/stack/commit/3fb20e05ce986e25d317910280cfd45abb034c8a), [`4dd1dd0`](https://github.com/OpenSaasAU/stack/commit/4dd1dd0b555a6838a989d2ee43399c676742be0c), [`7242781`](https://github.com/OpenSaasAU/stack/commit/7242781e1d27e6e7a4a08ed63d7ecb544e20db6e), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`1ecc97e`](https://github.com/OpenSaasAU/stack/commit/1ecc97ec31580d778d138122f89798f4be651744), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7adac1b`](https://github.com/OpenSaasAU/stack/commit/7adac1bfdbce5c49c8f09a3f69bd9684a77d4cc2), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03)]:
  - @opensaas/stack-core@0.44.0

## 0.43.0

### Patch Changes

- Updated dependencies [[`1da6535`](https://github.com/OpenSaasAU/stack/commit/1da6535a840596a7ef4ec3f7ba742da62ef117df)]:
  - @opensaas/stack-core@0.43.0

## 0.42.3

### Patch Changes

- [#1337](https://github.com/OpenSaasAU/stack/pull/1337) [`1a616c1`](https://github.com/OpenSaasAU/stack/commit/1a616c1e2ff31de1afe970a5fcfcc25ea7cbedb0) Thanks [@borisno2](https://github.com/borisno2)! - Core's `AugmentedFindUnique`/`AugmentedFindFirst`/`AugmentedFindMany` now carry the same trailing non-generic overload the generator's `CustomDB` already emits ([#1287](https://github.com/OpenSaasAU/stack/issues/1287)), and `getContext` takes a third, unconstrained, defaulted `TDb` type parameter so a caller can ask for `StackContext<TPrisma, CustomDB>` directly. The generated `.opensaas/context.ts` factory uses this to drop its `as unknown as Context<TSession>` casts down to a single, honest `as Context<TSession>`.

  Observable side effect: since `Parameters<>`/`ReturnType<>` resolve against an overloaded type's LAST member, `Parameters<AccessControlledDB<P>[K]['findMany' | 'findFirst' | 'findUnique']>[0]` now resolves to the new trailing member's argument type (Prisma's args shape minus `select`/`include`/`query`) instead of the full original Prisma args — anyone introspecting these types directly via `Parameters<>` will see this narrower shape.

- Updated dependencies [[`1a616c1`](https://github.com/OpenSaasAU/stack/commit/1a616c1e2ff31de1afe970a5fcfcc25ea7cbedb0)]:
  - @opensaas/stack-core@0.42.3

## 0.42.2

### Patch Changes

- [#1289](https://github.com/OpenSaasAU/stack/pull/1289) [`6a66454`](https://github.com/OpenSaasAU/stack/commit/6a664543345aa0e268d21ec1854a52b81a3b4953) Thanks [@borisno2](https://github.com/borisno2)! - Fix a regression from 0.42.1 ([#1264](https://github.com/OpenSaasAU/stack/issues/1264)): the generated `findUnique`/`findFirst`/`findMany` (and singleton `get`) delegates were not assignable to a plain structural seam, and `Parameters<>` over them resolved to `never`. Restores 0.42.0's behavior for both.
- Updated dependencies []:
  - @opensaas/stack-core@0.42.2

## 0.42.1

### Patch Changes

- [#1268](https://github.com/OpenSaasAU/stack/pull/1268) [`2976f57`](https://github.com/OpenSaasAU/stack/commit/2976f57a0d80687c3a27e11c3b7ec7fa9830cdb7) Thanks [@borisno2](https://github.com/borisno2)! - Fix a hook's `context.db` under-describing rows: `TypeInfo` now carries a `db` member (the generator points it at the generated `CustomDB`), so a hook reading a virtual or transformed field off `context.db.<list>` type-checks instead of failing with `TS2339`.
  Run `opensaas generate` after upgrading to pick up the new member on `Lists.<List>.TypeInfo`.

- [#1264](https://github.com/OpenSaasAU/stack/pull/1264) [`2e1ee3d`](https://github.com/OpenSaasAU/stack/commit/2e1ee3de446639f24331c5cebd01aeed37ca3e31) Thanks [@borisno2](https://github.com/borisno2)! - Fix `context.db.<list>.findUnique`/`findFirst`/`findMany` (and singleton `get`) in the generated `CustomDB` silently losing fragment narrowing: passing a `query` fragment compiled but the result stayed typed as the unnarrowed list payload instead of `ResultOf<typeof fragment>`. These methods now carry the same fragment overload as core's `AccessControlledDB`, so an unselected field is a compile error on the result.

- [#1277](https://github.com/OpenSaasAU/stack/pull/1277) [`3501b65`](https://github.com/OpenSaasAU/stack/commit/3501b653c803763801e0f1931e3bf22f9224fc0a) Thanks [@borisno2](https://github.com/borisno2)! - Fix the generated `Context`/`BaseContext` types to derive from core's `StackContext` instead of hand-restating its members, so `context.transaction(...)` now typechecks with no cast and `tx.db.<list>` carries the generated per-list types.
- Updated dependencies [[`2976f57`](https://github.com/OpenSaasAU/stack/commit/2976f57a0d80687c3a27e11c3b7ec7fa9830cdb7), [`2e1ee3d`](https://github.com/OpenSaasAU/stack/commit/2e1ee3de446639f24331c5cebd01aeed37ca3e31)]:
  - @opensaas/stack-core@0.42.1

## 0.42.0

### Minor Changes

- [#1214](https://github.com/OpenSaasAU/stack/pull/1214) [`11ea14a`](https://github.com/OpenSaasAU/stack/commit/11ea14aee0721f662d8592994e81dbe3cfe22941) Thanks [@borisno2](https://github.com/borisno2)! - Thread the app's Prisma client type through `TypeInfo` into every list/field hook-args type, so a hook's `context` resolves to the consumer's own `StackContext` instead of `StackContext<any>`.

  Before this change, `TypeInfo` carried no client type, so `context.db` inside any hook resolved through `AccessControlledDB<any>` — a mapped type over `keyof any` that declares no named delegate. A hook's `context` was therefore assignable to nothing app-specific, forcing consumers who wanted to pass it into their own typed functions to write `context as unknown as Context`.

  `TypeInfo` now has a `prisma` member (defaulted to the existing `PrismaClientLike`, so this is fully additive), and every hook-args type — `ResolveInputHookArgs`, `ValidateHookArgs`, `BeforeOperationHookArgs`, `AfterOperationHookArgs`, `BeforeTransactionHookArgs`/`AfterTransactionHookArgs`, and their field-level equivalents — types `context` off it:

  ```typescript
  // A hook authored the documented way now gets a context keyed to your own
  // generated Prisma client, with no cast needed to use it elsewhere:
  Post: list<Lists.Post.TypeInfo>({
    hooks: {
      validate: async ({ context }) => {
        await myDomainFn({ context }) // ✅ context.db.post etc. are real, typed delegates
      },
    },
  })
  ```

  The CLI generator emits the new `prisma` member on each list's `Lists.<List>.TypeInfo`, pointing at your project's own generated `PrismaClient` — no config changes required, and a hook authored without `TypeInfo` is unaffected.

  Because `context.db.<list>` now resolves to a real delegate instead of `any`, a pre-existing type error in a hook that previously compiled silently (e.g. a return value that didn't actually match the list's row type) can now surface as a genuine compile error. `AccessControlledDB`'s catch-all index signature is unchanged by this fix, so a misspelled delegate name (`context.db.typoedListName`) is not yet caught — that's a separate, tracked limitation.

### Patch Changes

- Updated dependencies [[`11ea14a`](https://github.com/OpenSaasAU/stack/commit/11ea14aee0721f662d8592994e81dbe3cfe22941)]:
  - @opensaas/stack-core@0.42.0

## 0.41.0

### Patch Changes

- Updated dependencies [[`2260539`](https://github.com/OpenSaasAU/stack/commit/2260539c5488dae0ee6e7f86ccd913e5c898ccdb), [`aa34cca`](https://github.com/OpenSaasAU/stack/commit/aa34cca65877759b9625da1538c65c53ed54385a), [`182153c`](https://github.com/OpenSaasAU/stack/commit/182153cb976b14ef67673d0eeef7925d950bfa10), [`67dce2e`](https://github.com/OpenSaasAU/stack/commit/67dce2e9d96afdc5c69f0a2f1c8b395346d4e942), [`682795f`](https://github.com/OpenSaasAU/stack/commit/682795f7c7f0d0194ffd08e993d452c368bcd847), [`73d1b6a`](https://github.com/OpenSaasAU/stack/commit/73d1b6aba9a9b789a8111105d56257a1de66a883), [`f1e8792`](https://github.com/OpenSaasAU/stack/commit/f1e8792ce580d92a5874599dfb8a8ccde4d6c8b3), [`9eb7c77`](https://github.com/OpenSaasAU/stack/commit/9eb7c7766d212e92b02d53a1ba3aaead4faf1496), [`5b478de`](https://github.com/OpenSaasAU/stack/commit/5b478de64f3564d837d2f9f912972e49008be884), [`d335122`](https://github.com/OpenSaasAU/stack/commit/d335122323b3402c0838aa50873fab0c085fbb01)]:
  - @opensaas/stack-core@0.41.0

## 0.40.0

### Minor Changes

- [#1017](https://github.com/OpenSaasAU/stack/pull/1017) [`b30fa61`](https://github.com/OpenSaasAU/stack/commit/b30fa6135a6acca8c9be99fbdf5ffa7faab1959f) Thanks [@{](https://github.com/{)! - Let an application declare model-level indexes (`db.indexes`) on the derived auth lists (`User`/`Session`/`Account`/`Verification`/`RateLimit`).

  Each per-model block in `authPlugin()` now accepts `indexes`, in the same shape as a list's own `db.indexes`:

  ```typescript
  authPlugin({
    // Adopt a live constraint's real name instead of Prisma's derived one.
   indexes: [{ fields: ['email'], unique: true, name: 'user_email_key' }] },
    session: { indexes: [{ fields: ['token'], unique: true, name: 'session_token_key' }] },
    // Extend a derived column into a composite index.
    verification: {
      indexes: [{ fields: ['identifier', { field: 'createdAt', sort: 'desc' }] }],
    },
  })
  ```

  An entry covering a column the stack already derives an index for (e.g. `User.email`) suppresses that derived index for that column and emits only the app's entry, rather than erroring — the application's declaration wins (ADR-0035). Suppression is per-column: every other derived index on the model is unaffected.

  This also fixes a related generator gap: a list's `db.indexes` can now reference `createdAt`/`updatedAt` even when the list has no explicit field for them and relies on `db.timestamps` for the auto-injected columns (previously only a list with an explicitly declared `createdAt`/`updatedAt` field could be indexed on it).

- [#1003](https://github.com/OpenSaasAU/stack/pull/1003) [`9de43c8`](https://github.com/OpenSaasAU/stack/commit/9de43c80c8ef996dc6f08f68f7c1d8451aa0f10e) Thanks [@borisno2](https://github.com/borisno2)! - Add `context.withSession(session)` — a sibling to `sudo()` for the other axis. It derives a `StackContext` that reuses the receiver's already-resolved config, client (including a transaction client — a call inside `context.transaction()` stays in that transaction), and storage, but carries a substituted session, so access control and hooks run against the new session as normal.

  This closes a gap for callers that are legitimately authorised but arrive without the session a list `validate` hook expects — an unattended dispatcher, a service principal, or a job runner:

  ```typescript
  // Runs with the job owner's session so hooks see the right identity, while
  // still going through the normal access control checks for that session.
  const asOwner = context.withSession(job.ownerSession)
  await asOwner.db.task.update({ where: { id: job.taskId }, data: { status: 'done' } })

  // Drop to anonymous
  const anonymous = context.withSession(null)
  ```

  `withSession` grants no authority of its own — the derived context can do exactly what any context built with that session directly could do. It's orthogonal to `sudo()`: `context.withSession(s).sudo()` and `context.sudo().withSession(s)` are equivalent, since `withSession` preserves the receiver's sudo state instead of resetting it.

  The generated `Context<TSession>` type (`.opensaas/types.ts`) now includes `withSession: (session: TSession | null) => Context<TSession>` alongside `sudo`, so the method is typed in application code — run `opensaas generate` (or `pnpm generate`) to pick it up.

### Patch Changes

- [#967](https://github.com/OpenSaasAU/stack/pull/967) [`ca20d45`](https://github.com/OpenSaasAU/stack/commit/ca20d458e969f964bb792331c9ec181314093431) Thanks [@borisno2](https://github.com/borisno2)! - Clean up stale/restating comments in migration, MCP, and commands source per CLAUDE.md's Comments rule. No behavior changes.

- [#968](https://github.com/OpenSaasAU/stack/pull/968) [`026489c`](https://github.com/OpenSaasAU/stack/commit/026489c8fe34aaf1a29a93a882d4a57cca42bce0) Thanks [@borisno2](https://github.com/borisno2)! - Clean up restating/duplicated comments in `packages/cli/src/generator/` per the CLAUDE.md Comments rule. No behavior change.
- Updated dependencies [[`8e6707a`](https://github.com/OpenSaasAU/stack/commit/8e6707adcca9d7e062bc1747ec79a29082c09ef9), [`afd1a60`](https://github.com/OpenSaasAU/stack/commit/afd1a60a6ddaa558bf14887e45fa1c007e6669b0), [`b30fa61`](https://github.com/OpenSaasAU/stack/commit/b30fa6135a6acca8c9be99fbdf5ffa7faab1959f), [`16da817`](https://github.com/OpenSaasAU/stack/commit/16da8176114826d18d6747d27abedf75de6c3262), [`51ae299`](https://github.com/OpenSaasAU/stack/commit/51ae299b7624f97e890f85b3075c62d8e114cec2), [`f85c7d1`](https://github.com/OpenSaasAU/stack/commit/f85c7d1b92e76d5e8ae090f93c0ff94e0d6c36c1), [`0f2e12a`](https://github.com/OpenSaasAU/stack/commit/0f2e12a69710e759d8749b8536fd5b31836226e9), [`05c747a`](https://github.com/OpenSaasAU/stack/commit/05c747a18284ac769860f751a660b72591570571), [`0b5b51e`](https://github.com/OpenSaasAU/stack/commit/0b5b51e52787ea9e945206a109a7a56dc38e78e5), [`4ce64b4`](https://github.com/OpenSaasAU/stack/commit/4ce64b4f9868eca0f34cc0676e46440b3d8f16ce), [`48d2762`](https://github.com/OpenSaasAU/stack/commit/48d27626dfb636c481301116e46c826ef3156124), [`9de43c8`](https://github.com/OpenSaasAU/stack/commit/9de43c80c8ef996dc6f08f68f7c1d8451aa0f10e), [`52dfdd2`](https://github.com/OpenSaasAU/stack/commit/52dfdd2c051aa2f4b4cbd96a459213c34c3bf85c)]:
  - @opensaas/stack-core@0.40.0

## 0.39.2

### Patch Changes

- [#960](https://github.com/OpenSaasAU/stack/pull/960) [`77ca919`](https://github.com/OpenSaasAU/stack/commit/77ca91931bc3de4051c1a40cc00b77158b8192e6) Thanks [@borisno2](https://github.com/borisno2)! - Remove the generated `prisma-extensions.ts` module and its unreachable `$extends` branch in the generated context factory — the guard deciding whether to apply it was always true, so the extension never actually ran (`context.db` already applies `resolveOutput` correctly). This also fixes `TS2589: Type instantiation is excessively deep` on larger schemas, since the removed branch's inferred type was the cause. No runtime behavior changes; regenerating cleans up a stale `prisma-extensions.ts` left by prior versions.
- Updated dependencies [[`77ca919`](https://github.com/OpenSaasAU/stack/commit/77ca91931bc3de4051c1a40cc00b77158b8192e6)]:
  - @opensaas/stack-core@0.39.2

## 0.39.1

### Patch Changes

- [#955](https://github.com/OpenSaasAU/stack/pull/955) [`ab2bc34`](https://github.com/OpenSaasAU/stack/commit/ab2bc34539bc06d9946933061284480185753edc) Thanks [@borisno2](https://github.com/borisno2)! - Fix `TS2589: Type instantiation is excessively deep` in the generated `Context`/`CustomDB` types once a schema grows past ~7-8 lists. `CustomDB`/`BaseContext`/`Context` are now generated as `interface`s (with each list's CRUD methods extracted to a named `{List}Crud` interface) instead of `type` aliases, so `Context.sudo()`'s self-reference no longer forces eager re-expansion of the whole database type ([#952](https://github.com/OpenSaasAU/stack/issues/952)).

- [#950](https://github.com/OpenSaasAU/stack/pull/950) [`fcc5380`](https://github.com/OpenSaasAU/stack/commit/fcc538020789e46555638b81fa7b7c11ceff08a8) Thanks [@borisno2](https://github.com/borisno2)! - Fix `resolveTsconfigAlias` corrupting resolution of `opensaas.config.ts` and its whole import closure when `tsconfig.json` has a bare `"*"` path pattern (e.g. `{ "*": ["./src/*"] }`, a common catch-all for unprefixed imports like `lib/utils`). The bare pattern now produces an empty alias key, which jiti's prefix-based resolution would otherwise match against every specifier; it is now skipped and reported as a warning like other unrepresentable path entries.
- Updated dependencies []:
  - @opensaas/stack-core@0.39.1

## 0.39.0

### Minor Changes

- [#926](https://github.com/OpenSaasAU/stack/pull/926) [`5e546b0`](https://github.com/OpenSaasAU/stack/commit/5e546b0fe3542ba41fc77e0a4628acc96eec13ea) Thanks [@borisno2](https://github.com/borisno2)! - Add a first-class `bigInt()` field type for 64-bit integers (e.g. a millisecond epoch) that overflow `integer()`'s 32-bit `Int` — Prisma `BigInt`, TypeScript `bigint`, with an admin UI component, filtering, and MCP support.

  ```typescript
  import { bigInt } from '@opensaas/stack-core/fields'

  fields: {
    occurredAtMs: bigInt({ validation: { isRequired: true } }),
  }

  await context.db.event.create({
    data: { occurredAtMs: 9007199254740993n }, // bigint, number, or numeric string
  })
  ```

  Create/update accept `bigint`, an integer `number`, or a numeric `string`, and always coerce to `bigint`. A `number` above `Number.MAX_SAFE_INTEGER` is rejected rather than silently losing precision. `bigint` isn't JSON-serialisable, so an MCP CRUD tool renders the value as a decimal string instead of throwing, and the admin UI's server→client boundary (list table, item form, relationship table) now round-trips a `bigint` value correctly rather than throwing during render. The migration introspector maps Prisma `BigInt` columns to `bigInt()` instead of the previous lossy `text()` fallback.

- [#932](https://github.com/OpenSaasAU/stack/pull/932) [`5400956`](https://github.com/OpenSaasAU/stack/commit/5400956c79c0e2f2bc1a70e976ad27f28be54688) Thanks [@borisno2](https://github.com/borisno2)! - Resolve `tsconfig.json` path aliases (`compilerOptions.paths`) when loading `opensaas.config.ts`, so a value import using an alias (e.g. `@/*`) works in the config and anywhere in its import closure, not just in type-only positions.

  ```typescript
  // tsconfig.json
  {
    "compilerOptions": {
      "paths": { "@/*": ["./src/*"] }
    }
  }

  // opensaas.config.ts
  import { lists } from '@/opensaas/lists' // now resolves
  ```

  Only the single-trailing-`*`, single-target form of `paths` is translated; an entry with multiple candidate targets or an unsupported pattern shape logs a warning naming the pattern and is skipped rather than failing generation. Projects without a `tsconfig.json`, or without `paths`, are unaffected. The `opensaas migrate` command's Keystone config loader resolves aliases the same way.

### Patch Changes

- [#927](https://github.com/OpenSaasAU/stack/pull/927) [`bbf8843`](https://github.com/OpenSaasAU/stack/commit/bbf8843567f0b95689589c53d3ceb9e3eb00adca) Thanks [@borisno2](https://github.com/borisno2)! - Fix migration introspector mapping Prisma/Keystone `Decimal` columns to `text()` instead of `decimal()`. Declared `@db.Decimal(precision, scale)` attributes now carry through to the generated field.

- [#931](https://github.com/OpenSaasAU/stack/pull/931) [`114302b`](https://github.com/OpenSaasAU/stack/commit/114302b95129484fadb6a1a640435ab1a5d2d102) Thanks [@borisno2](https://github.com/borisno2)! - `db.indexes` generation now fails with a descriptive error for an empty `fields` array, and for a single-field entry that duplicates a column already indexed by that field's own `isIndexed` — previously these silently produced invalid or duplicate Prisma.

- Updated dependencies [[`5e546b0`](https://github.com/OpenSaasAU/stack/commit/5e546b0fe3542ba41fc77e0a4628acc96eec13ea), [`cbb03fc`](https://github.com/OpenSaasAU/stack/commit/cbb03fc26047869d23513fbb156c6194d9be389b), [`5f00c3a`](https://github.com/OpenSaasAU/stack/commit/5f00c3a456295a1125281a4227309a8f8c6d853d), [`6f9a64d`](https://github.com/OpenSaasAU/stack/commit/6f9a64d2f25212e91181adc2b67add326a540f6a), [`9a399d6`](https://github.com/OpenSaasAU/stack/commit/9a399d68e4d3f384d4cef5ccd5fc8ec6802a40a5), [`05c9ad4`](https://github.com/OpenSaasAU/stack/commit/05c9ad40f8c4e76718d870e0c1c02511a3475943), [`4d8b654`](https://github.com/OpenSaasAU/stack/commit/4d8b654d099ce13d00893ebc4ce904fa69f2c47a), [`e0baadd`](https://github.com/OpenSaasAU/stack/commit/e0baaddade059cfea639d232f6953fc8c339f6f4), [`ab4a5dd`](https://github.com/OpenSaasAU/stack/commit/ab4a5ddd83eebcf85d4a98f210cd378b974725f5), [`94802ee`](https://github.com/OpenSaasAU/stack/commit/94802eee3b2fdc64fab4b576945820a6df9311c5), [`114302b`](https://github.com/OpenSaasAU/stack/commit/114302b95129484fadb6a1a640435ab1a5d2d102)]:
  - @opensaas/stack-core@0.39.0

## 0.38.0

### Minor Changes

- [#889](https://github.com/OpenSaasAU/stack/pull/889) [`b9b9357`](https://github.com/OpenSaasAU/stack/commit/b9b935719774b01a81cfd2082387b76806c1a484) Thanks [@borisno2](https://github.com/borisno2)! - Fix `getSessionFromAuth` to project `sessionFields` from the _resolved_ better-auth session instead of only its `user` sub-object. A `customSession` plugin's replaced shape with no `user` key is now correctly treated as a signed-in session (never misreported as anonymous), and a session-only field (e.g. the admin plugin's `impersonatedBy`) is now resolvable. Errors from the underlying session lookup now propagate instead of silently becoming `null`, and a `sessionFields` entry that can't be resolved is omitted and logs a warning (once per field, per process) instead of vanishing silently.

  The scaffolded `getSession()` — the CLI feature generator's `lib/auth.ts` template, and `examples/starter-auth`/`examples/auth-demo` — now call this single shared helper, reading `sessionFields` from the resolved config at runtime instead of baking a field list in at generation time. `examples/auth-demo`'s `getSession()` also now correctly returns `null` for an anonymous visitor (previously returned a truthy object of `undefined` values).

  ```typescript
  authPlugin({ sessionFields: ['userId', 'email', 'name', 'role'] })
  ```

  ```typescript
  // lib/auth.ts
  export async function getSession() {
    const resolvedConfig = await config
    const authConfig = resolvedConfig._pluginData?.auth as NormalizedAuthConfig | undefined
    const sessionFields = authConfig?.sessionFields ?? ['userId', 'email', 'name']
    return getSessionFromAuth(auth, sessionFields, await headers())
  }
  ```

### Patch Changes

- Updated dependencies [[`b21d8b2`](https://github.com/OpenSaasAU/stack/commit/b21d8b2af43f7a2a7ea10a89cfb39140a856bd68), [`b21d8b2`](https://github.com/OpenSaasAU/stack/commit/b21d8b2af43f7a2a7ea10a89cfb39140a856bd68), [`17eb72f`](https://github.com/OpenSaasAU/stack/commit/17eb72f0a9a4b7508e3f318da66bb8d4c6cbd705)]:
  - @opensaas/stack-core@0.38.0

## 0.37.0

### Minor Changes

- [#868](https://github.com/OpenSaasAU/stack/pull/868) [`6bf9dcb`](https://github.com/OpenSaasAU/stack/commit/6bf9dcb1b8d030d57371b6b4a4f55462eb8ab2eb) Thanks [@borisno2](https://github.com/borisno2)! - Add `db.indexes` to `ListConfig` for model-level composite `@@unique`/`@@index` constraints spanning two or more of a list's own fields — the multi-column case single-field `isIndexed` can't reach.

  Entries name OpenSaaS field names, not raw database columns; the generator resolves a scalar field to its own name and a relationship field to its foreign key column:

  ```typescript
  Audition: list({
    fields: {
      student: relationship({ ref: 'Student.auditions' }),
      production: relationship({ ref: 'Production.auditions' }),
    },
    db: {
      // One audition per student per production — a DB-level backstop a
      // hook's existence check alone can't provide against concurrent writes.
      indexes: [{ fields: ['student', 'production'], unique: true }],
    },
  })
  // Generates: @@unique([studentId, productionId])

  AuthVerification: list({
    fields: { identifier: text(), createdAt: timestamp() },
    db: {
      indexes: [
        {
          fields: ['identifier', { field: 'createdAt', sort: 'desc' }],
          name: 'AuthVerification_identifier_createdAt_idx', // adopts an existing constraint name via Prisma's `map:`
        },
      ],
    },
  })
  // Generates: @@index([identifier, createdAt(sort: Desc)], map: "AuthVerification_identifier_createdAt_idx")
  ```

  An entry naming an unknown field, a virtual field, a to-many relationship, or the non-FK side of a one-to-one relationship fails `pnpm generate` with an error naming the list, the entry, and the bad field, rather than being silently dropped or emitted as invalid Prisma. A config with no `db.indexes` generates byte-for-byte identical output to before this change.

### Patch Changes

- Updated dependencies [[`6bf9dcb`](https://github.com/OpenSaasAU/stack/commit/6bf9dcb1b8d030d57371b6b4a4f55462eb8ab2eb), [`7b6189f`](https://github.com/OpenSaasAU/stack/commit/7b6189fa60119a45082ba62dd71d915d93de529c)]:
  - @opensaas/stack-core@0.37.0

## 0.36.0

### Minor Changes

- [#857](https://github.com/OpenSaasAU/stack/pull/857) [`cdca174`](https://github.com/OpenSaasAU/stack/commit/cdca17444a5259cd0d3d8604a90a2cea4566cda2) Thanks [@borisno2](https://github.com/borisno2)! - Add `needs` to the base field config: a computed field can declare the immediate relations its `resolveOutput` hook depends on, so the read fetches exactly those — without widening what the caller receives (ADR-0025).

  Since ADR-0024, a bare read (no caller `include`) returns a row's own columns only, so a virtual field reading `item.someRelation` silently computed over `undefined` unless a caller happened to include it. `needs` fixes that:

  ```typescript
  Order: list({
    fields: {
      lineItems: relationship({ ref: 'LineItem.order', many: true }),
      total: virtual({
        type: 'number',
        needs: ['lineItems'],
        hooks: {
          resolveOutput: ({ item }) =>
            item.lineItems.reduce((sum, li) => sum + li.price * li.quantity, 0),
        },
      }),
    },
  })
  ```

  The declared relation is fetched wherever the field is computed — at the root of a read and at every nested level — and is scoped through the Access Filter exactly like a caller-named relation: a dependency the session can't query is not fetched, and the hook sees nothing in its place. A field always computes on whatever it can see, so a partially-denied dependency still produces a value rather than being withheld. The relation itself is stripped from the result unless the caller named it too, for both `include` reads and fragment `query` reads.

  `needs` is available on every field type, not only `virtual()`. `opensaas generate` now also validates every `needs` declaration: an entry naming a non-relationship or non-existent field, or a declaration closure that can't fit within the read-include depth cap from any starting point, fails generation with a message naming the offending field/chain rather than silently truncating at runtime.

  See `docs/adr/0025-a-computed-field-declares-the-relations-it-needs.md`.

### Patch Changes

- [#859](https://github.com/OpenSaasAU/stack/pull/859) [`ebb4cd3`](https://github.com/OpenSaasAU/stack/commit/ebb4cd3515ff40f960f888e7b4147d1d089a0966) Thanks [@borisno2](https://github.com/borisno2)! - Fix `isIndexed: true` on `text`, `decimal` and `calendarDay` emitting an invalid inline `@index` attribute, producing a schema Prisma rejects with "Attribute not known: @index".
  Non-unique indexes are now emitted as block-level `@@index([field])`; `isIndexed: 'unique'` is unchanged.
- Updated dependencies [[`cdca174`](https://github.com/OpenSaasAU/stack/commit/cdca17444a5259cd0d3d8604a90a2cea4566cda2), [`ebb4cd3`](https://github.com/OpenSaasAU/stack/commit/ebb4cd3515ff40f960f888e7b4147d1d089a0966)]:
  - @opensaas/stack-core@0.36.0

## 0.35.0

### Minor Changes

- [#853](https://github.com/OpenSaasAU/stack/pull/853) [`d0c94a9`](https://github.com/OpenSaasAU/stack/commit/d0c94a994e8be67742c97b6757ca4dd4e454f682) Thanks [@borisno2](https://github.com/borisno2)! - **This break is silent.** A `context.db` read with no `include` (and no fragment `query`) used to auto-include every readable relationship of the list, recursing up to 5 levels deep. It now returns the row's own columns plus its virtual fields only — matching Prisma's own semantics for a bare read — and relations arrive only when you name them. A read that used to return `post.author` now returns no `author` key at all: no error, no warning, just less data (ADR-0024). This applies uniformly to `findUnique`, `findMany`, and a singleton's `get()`, under sudo and under a session alike. Foreign-key columns (e.g. `authorId`) are unaffected and always returned, so a relation stays reachable by id without an `include`.

  **Detect call sites that need updating:**

  - Grep for bare reads: `context.db.*.find*` calls (or a singleton's `.get()`) with no `include` and no `query` argument, whose result is later used to access a relationship field.
  - Grep for `resolveOutput` hooks on `virtual` fields that read a relation off `item` (e.g. `item.author`, `item.posts`) — these silently degrade the same way, since a hook's own `context.db` read is subject to the same rule.

  **Migrate** by naming the relation explicitly, either via `include`:

  ```typescript
  // Before — relied on the auto-include
  const post = await context.db.post.findUnique({ where: { id } })
  post.author // used to be populated

  // After — name it
  const post = await context.db.post.findUnique({
    where: { id },
    include: { author: true },
  })
  post.author // populated
  ```

  or via a fragment `query`:

  ```typescript
  const post = await context.db.post.findUnique({
    where: { id },
    query: postWithAuthorFragment,
  })
  ```

  A `resolveOutput` hook that read `item.<relation>` should instead read through `context.db` with an explicit `include`, or its caller should pass one.

  **Singleton `get()` gains caller-`include` support** it never had — it can now be narrowed and widened like any other read:

  ```typescript
  const settings = await context.db.settings.get({ include: { homepage: true } })
  ```

  Bare reads also stop evaluating operation-level `query` access on related lists (that walk previously ran for every relation at every level before fetching anything), so an access function relied on for a side effect will no longer fire on a bare read.

  See `docs/adr/0024-a-read-with-no-include-fetches-scalars-not-relations.md` for the full rationale.

### Patch Changes

- Updated dependencies [[`d0c94a9`](https://github.com/OpenSaasAU/stack/commit/d0c94a994e8be67742c97b6757ca4dd4e454f682)]:
  - @opensaas/stack-core@0.35.0

## 0.34.0

### Patch Changes

- Updated dependencies [[`fedc858`](https://github.com/OpenSaasAU/stack/commit/fedc858f41bf5cacf001f64e7b710112f2fce20b)]:
  - @opensaas/stack-core@0.34.0

## 0.33.0

### Patch Changes

- Updated dependencies [[`0caf680`](https://github.com/OpenSaasAU/stack/commit/0caf68007e41b69f1a5d5f74fb15df2548a559dc), [`1a3f51d`](https://github.com/OpenSaasAU/stack/commit/1a3f51d5837d6e5244ccf04c3d14c41c264701c3)]:
  - @opensaas/stack-core@0.33.0

## 0.32.0

### Minor Changes

- [#813](https://github.com/OpenSaasAU/stack/pull/813) [`5a6198c`](https://github.com/OpenSaasAU/stack/commit/5a6198c9489641e4b1ad542a3181c15e750f7d85) Thanks [@borisno2](https://github.com/borisno2)! - Auth forms now submit through app-owned server actions instead of the browser `authClient`

  The pre-built auth forms (`SignInForm`, `SignUpForm`, `ForgotPasswordForm`, and the new
  `ResetPasswordForm`) no longer take an `authClient` prop that calls `/api/auth/*` from the
  browser. Instead each form takes **server action** props — `'use server'` functions the app
  defines against its own `auth` instance. This keeps the auth network surface server-side and
  matches the app's existing `lib/actions/*` convention. `createAuth` now auto-adds
  better-auth's `nextCookies` plugin, so the session cookie set inside a server action persists.
  See ADR-0020.

  The package exports the action contract types (`AuthActionResult`, `SignInInput`,
  `SignUpInput`, `RequestPasswordResetInput`, `ResetPasswordInput`, and the action aliases).
  `createClient` is unchanged for client-side session reading (`useSession`).

  Migration — define the actions in your app and pass them to the forms:

  ```typescript
  // lib/actions/auth.ts
  'use server'
  import { headers } from 'next/headers'
  import { auth } from '@/lib/auth'
  import type { AuthActionResult, SignInInput } from '@opensaas/stack-auth/ui'

  export async function signInAction(input: SignInInput): Promise<AuthActionResult> {
    try {
      await auth.api.signInEmail({
        body: { email: input.email, password: input.password },
        headers: await headers(),
      })
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Sign in failed' }
    }
  }
  ```

  ```tsx
  // Before
  <SignInForm authClient={authClient} redirectTo="/admin" />

  // After
  <SignInForm signInAction={signInAction} redirectTo="/admin" />
  ```

  Social sign-in becomes a redirecting server action passed as `signInSocialAction`. The CLI
  feature-generator now scaffolds `lib/actions/auth.ts` and a `reset-password` page, and no
  longer emits `lib/auth-client.ts`.

### Patch Changes

- Updated dependencies []:
  - @opensaas/stack-core@0.32.0

## 0.31.1

### Patch Changes

- Updated dependencies []:
  - @opensaas/stack-core@0.31.1

## 0.31.0

### Patch Changes

- Updated dependencies [[`047487a`](https://github.com/OpenSaasAU/stack/commit/047487adf502f10f7f6774ff52c38c70d465f533), [`9cd06dd`](https://github.com/OpenSaasAU/stack/commit/9cd06dddb45512966affc3a6b3455e97595c0de2), [`b190813`](https://github.com/OpenSaasAU/stack/commit/b190813a4531bd01b3206845b2c531099e0a204a), [`f67cd79`](https://github.com/OpenSaasAU/stack/commit/f67cd798724712a90d7ada8f28202d3d6371693f), [`dcb10e2`](https://github.com/OpenSaasAU/stack/commit/dcb10e27c28a8a8f9a5e625f550ac5c750436eb6), [`f8b6f02`](https://github.com/OpenSaasAU/stack/commit/f8b6f02c18322d0d04a7c3cc82e579d0ba9a2da9), [`c05701e`](https://github.com/OpenSaasAU/stack/commit/c05701e523815b8f411a6d39e57bbb9317dc2a9d), [`5a60291`](https://github.com/OpenSaasAU/stack/commit/5a602916f30535604b590b875c363f21930a109f), [`2fcb582`](https://github.com/OpenSaasAU/stack/commit/2fcb5820bc00d9d432265d1ba01404097e296e8e), [`85c7fc3`](https://github.com/OpenSaasAU/stack/commit/85c7fc3b3a0090a986cafa0e46b1798f237264da), [`8199238`](https://github.com/OpenSaasAU/stack/commit/81992382290f356071955f16efd14f7771045a16), [`4d99e91`](https://github.com/OpenSaasAU/stack/commit/4d99e910b61c6196564a7248abf3d32b1d6be883), [`20459b5`](https://github.com/OpenSaasAU/stack/commit/20459b5a7f8b2578342509442d36017cfa2f08f6), [`62a1612`](https://github.com/OpenSaasAU/stack/commit/62a16127c7b6610a35fb239911eff3486de585be), [`c210319`](https://github.com/OpenSaasAU/stack/commit/c210319c3b25ff74d832d3c2ec5d3253d5d8b832), [`55d55e0`](https://github.com/OpenSaasAU/stack/commit/55d55e0a1ed9521b6e31283524d9194a9420059a), [`96e1067`](https://github.com/OpenSaasAU/stack/commit/96e1067661c7ebc8e23896086fec7428e475dd03)]:
  - @opensaas/stack-core@0.31.0

## 0.30.0

### Minor Changes

- [#744](https://github.com/OpenSaasAU/stack/pull/744) [`5e135ef`](https://github.com/OpenSaasAU/stack/commit/5e135ef635dd7cd97ab106f46fbf808250aa079e) Thanks [@borisno2](https://github.com/borisno2)! - MCP feature wizards now generate current-API code for all five features

  - `comments`, `file-upload`, and `semantic-search` wizards previously returned "coming soon" stubs — they now generate real config (Comment list with moderation/threading, storage config with local/S3/R2/Vercel Blob providers, ragPlugin with OpenAI or Ollama embeddings and `searchable()` fields).
  - The `authentication` wizard output was rewritten to the current API: `authPlugin` with `socialProviders`/`extendUserList`/`access` (ADR-0013), the required `prismaClientConstructor`, `SignInForm`/`SignUpForm` with the `authClient` prop, and `lib/auth.ts` wiring via `createAuth(config, rawOpensaasContext)`.
  - The `blog` wizard now emits valid `select()` options, wires Category/Tag relationships on both sides, and uses filter-based query access.
  - `opensaas mcp start` no longer prints its startup banner to stdout, which corrupted the MCP stdio JSON-RPC stream.
  - Removed unsupported options from wizard catalogs (Cohere/Anthropic embeddings, magic links) and fixed the docs provider's field-type guidance (`json()` mapping, `getPrismaType` modifiers).

### Patch Changes

- [#741](https://github.com/OpenSaasAU/stack/pull/741) [`afa865f`](https://github.com/OpenSaasAU/stack/commit/afa865f62ed7968b494a87e0621cf71bacd36f39) Thanks [@borisno2](https://github.com/borisno2)! - Update documentation links to the restructured docs site URLs (Diátaxis layout)

- Updated dependencies [[`afa865f`](https://github.com/OpenSaasAU/stack/commit/afa865f62ed7968b494a87e0621cf71bacd36f39), [`5e135ef`](https://github.com/OpenSaasAU/stack/commit/5e135ef635dd7cd97ab106f46fbf808250aa079e)]:
  - @opensaas/stack-core@0.30.0

## 0.29.0

### Patch Changes

- Updated dependencies [[`f51cef8`](https://github.com/OpenSaasAU/stack/commit/f51cef876d6376e4e2bc8ac990229ff60e232bb1), [`56e9f9b`](https://github.com/OpenSaasAU/stack/commit/56e9f9b0a4d1920662cf0564682e767993917b56)]:
  - @opensaas/stack-core@0.29.0

## 0.28.0

### Patch Changes

- [#696](https://github.com/OpenSaasAU/stack/pull/696) [`0bcfb4a`](https://github.com/OpenSaasAU/stack/commit/0bcfb4a6f1183ee75017bee73566f5aaa3b5408e) Thanks [@borisno2](https://github.com/borisno2)! - Note in the generated Keystone auth migration guide that Auth-injected lists now ship closed by default (ADR-0013) and how to grant them access via `authPlugin({ access: { ... } })`.

- [#691](https://github.com/OpenSaasAU/stack/pull/691) [`7f113a9`](https://github.com/OpenSaasAU/stack/commit/7f113a9c454a9c92ca4769687832da661acf250a) Thanks [@borisno2](https://github.com/borisno2)! - Fix misleading doc comment on the generated `rawOpensaasContext` export: it's a `Promise<Context>` meant to be passed to a lazy-Proxy consumer (e.g. `createAuth`), not a synchronous value.

- [#694](https://github.com/OpenSaasAU/stack/pull/694) [`529fa98`](https://github.com/OpenSaasAU/stack/commit/529fa984cccab50ba88cf22c69431e9f5f927f8a) Thanks [@borisno2](https://github.com/borisno2)! - Preserve host-added `datasource` keys (e.g. `shadowDatabaseUrl`) in `prisma.config.ts` across `generate` runs instead of overwriting the block wholesale.

- Updated dependencies [[`0bcfb4a`](https://github.com/OpenSaasAU/stack/commit/0bcfb4a6f1183ee75017bee73566f5aaa3b5408e), [`aec907f`](https://github.com/OpenSaasAU/stack/commit/aec907f29b31ca507831d729182938975ec4b4fa), [`fd64913`](https://github.com/OpenSaasAU/stack/commit/fd64913ac65ed60440eaee210a34a6f8e3824c21)]:
  - @opensaas/stack-core@0.28.0

## 0.27.1

### Patch Changes

- Updated dependencies [[`1bd4f12`](https://github.com/OpenSaasAU/stack/commit/1bd4f1258f9b3ac77ca048ac657ee31b0299821f)]:
  - @opensaas/stack-core@0.27.1

## 0.27.0

### Patch Changes

- [#664](https://github.com/OpenSaasAU/stack/pull/664) [`37838ef`](https://github.com/OpenSaasAU/stack/commit/37838efbf726b27baa5e1da448d44223c6953e3f) Thanks [@borisno2](https://github.com/borisno2)! - Upgrade TypeScript to v7. `typescript` now resolves to the `@typescript/typescript6` compatibility shim (keeping the classic compiler API available for `typescript-eslint` and Next.js's build-time type-checking, neither of which support TS 7's restructured package yet), while `@typescript-eslint/eslint-plugin` is bumped to 8.63.0 to match. The CLI's Node-build compiler step (ADR-0011) now shells out to `tsc` instead of the removed synchronous `Program` API, using its own pinned native TS 7 binary via a new `@typescript/native` dependency.

- Updated dependencies [[`37838ef`](https://github.com/OpenSaasAU/stack/commit/37838efbf726b27baa5e1da448d44223c6953e3f), [`18c39c8`](https://github.com/OpenSaasAU/stack/commit/18c39c8b8ffc0b0c5c4551385bb67054448e5781), [`9d9c7f8`](https://github.com/OpenSaasAU/stack/commit/9d9c7f8e5afd0b4afb01dc40cb16217f8d675354), [`002e755`](https://github.com/OpenSaasAU/stack/commit/002e755ca405c23127b3c88378955127cc8b3f67), [`a15e566`](https://github.com/OpenSaasAU/stack/commit/a15e5660d736c8ea2d4b804c5ef6891510b2ea3d)]:
  - @opensaas/stack-core@0.27.0

## 0.26.0

### Patch Changes

- Updated dependencies [[`322d5b6`](https://github.com/OpenSaasAU/stack/commit/322d5b64d11c3e3401493511e0c0e3a1fa20e210), [`0be254e`](https://github.com/OpenSaasAU/stack/commit/0be254e2b2e6bbc0c2f168438aea49d2e1cc7f0b)]:
  - @opensaas/stack-core@0.26.0

## 0.25.0

### Minor Changes

- [#606](https://github.com/OpenSaasAU/stack/pull/606) [`801230e`](https://github.com/OpenSaasAU/stack/commit/801230e1a95efc17c8bec46c7094f0b72956f54b) Thanks [@borisno2](https://github.com/borisno2)! - Enforce field-level scalar narrowing at the write call site, and fix `checkbox({ defaultValue: false })` optionality

  The generated `context.db.<list>.create()/update()/createMany()/updateMany()` `data`
  type now narrows scalar fields to their OpenSaaS `getTypeScriptType()` types instead of
  inheriting Prisma's wider input types. Field-level narrowing (e.g. `calendarDay` → `string`)
  is now a genuine compile-time error to violate, not just a runtime validation failure.

  ```ts
  // calendarDay is a `string` end-to-end:
  await context.db.event.create({ data: { startDate: new Date() } })
  //                                                  ^^^^^^^^^^ Type 'Date' is not assignable to type 'string'.
  await context.db.event.create({ data: { startDate: '2026-01-01' } }) // ✅ compiles
  ```

  Relationship nested writes (`connect`/`create`/`connectOrCreate`), unchecked foreign keys
  (e.g. `authorId`), and `decimal`/`json` writes are unaffected: `decimal` still accepts
  `Decimal | number | string` and `json` still accepts Prisma's `JsonNull`/`DbNull` sentinels.

  Also fixes a latent bug where `checkbox({ defaultValue: false })` (and any field with a
  falsy-but-present default) was generated as a required field on create — it is now correctly
  optional.

  Note: this may surface pre-existing type errors in consumer code that passed a `Date` to a
  `calendarDay` field. Such code already failed at runtime; it now fails at compile time. Pass a
  `YYYY-MM-DD` string instead.

- [#609](https://github.com/OpenSaasAU/stack/pull/609) [`1d79fe6`](https://github.com/OpenSaasAU/stack/commit/1d79fe6aad79a3598ebb2ca973d9936757b25c1f) Thanks [@borisno2](https://github.com/borisno2)! - Consolidate nullability between the standalone `{List}CreateInput`/`{List}UpdateInput` exports and the call-site write-`data` override into a single source of truth ([#608](https://github.com/OpenSaasAU/stack/issues/608)).

  The generated types previously described a list's create/update input shape in two places that disagreed on how a nullable scalar was represented: the write-`data` override emitted `name?: string | null` (matching Prisma's nullable-column input) while the standalone `{List}CreateInput`/`{List}UpdateInput` emitted `name?: string`. Both paths now render each scalar member through one shared helper, so a nullable scalar is consistently `name?: T | null` in every input representation. Required scalars stay required, and `decimal`/`json`/relationship/multi-column handling is unchanged.

  This is a non-breaking type refinement, but if you assigned the standalone `{List}CreateInput`/`{List}UpdateInput` types into a stricter local type, a nullable scalar may now be inferred as `T | null`:

  ```typescript
  // A nullable text() field on Post now generates:
  export type PostCreateInput = {
    title: string // required scalar — unchanged
    content?: string | null // nullable scalar — now includes `| null`
  }
  ```

- [#594](https://github.com/OpenSaasAU/stack/pull/594) [`4f0d407`](https://github.com/OpenSaasAU/stack/commit/4f0d40721feff1a3109647a81fcbe47db5970026) Thanks [@borisno2](https://github.com/borisno2)! - Add an opt-in **Node build** of the generated `.opensaas/` bundle (ADR-0011, [#579](https://github.com/OpenSaasAU/stack/issues/579)).

  Setting `output: { buildTarget: 'node' }` in `opensaas.config.ts` makes `opensaas generate` additionally compile the bundle to a plain-Node-loadable ESM form under `.opensaas/dist/` — `.js` + `.d.ts` with a `{"type":"module"}` marker — alongside the default `.ts` bundler form. The compiled entry is `.opensaas/dist/context.js`, with the Prisma client subtree at `.opensaas/dist/prisma-client/**` and the project config compiled in as a sibling, so a live module (e.g. better-auth's Prisma adapter) can be imported in a bundler-less runtime — plain Node, a Playwright e2e helper, or a build-time script — that the default `.ts` form cannot execute.

  The Node build is purely additive: with `output.buildTarget` absent (the default), generation behaves exactly as before and no `.opensaas/dist/` is emitted.

  ```typescript
  // opensaas.config.ts
  export default config({
    output: { buildTarget: 'node' },
    // ...
  })

  // then, from a plain-Node consumer (no bundler, no tsx):
  import { createAuth } from '@opensaas/stack-auth/server'
  import { config, rawOpensaasContext } from './.opensaas/dist/context.js'

  const auth = createAuth(config, rawOpensaasContext)
  await auth.api.signUpEmail({ body: { email, password, name } })
  ```

  The compile runs via the TypeScript compiler API with `rewriteRelativeImportExtensions` (turning the bundle's `.ts`-extension imports into runnable `.js` specifiers), `declaration`, `skipLibCheck`, and `noEmitOnError: false`, so it reuses the bundle's type-clean guarantee without adding a build dependency. `'node'` is the only `buildTarget` today; the field is a string-literal union so future compiled targets can be added without a breaking change.

- [#592](https://github.com/OpenSaasAU/stack/pull/592) [`e355c05`](https://github.com/OpenSaasAU/stack/commit/e355c05a0787980b997609c4571271ab5c250f36) Thanks [@borisno2](https://github.com/borisno2)! - Make the generated `.opensaas/prisma-client` subtree statically resolvable by default and add a `db.prismaGeneratorOptions` passthrough.

  The generated `generator client { ... }` block now emits `importFileExtension = "ts"` and `moduleFormat = "esm"` by default, so the prisma-client subtree uses explicit `.ts` import extensions and matches the extension style the rest of the `.opensaas` bundle already uses — the whole import graph is statically resolvable by a bundler out of the box, no post-generation surgery required.

  A new optional `db.prismaGeneratorOptions` lets you override these values when you need a different module/extension story (e.g. emitting `.js` extensions for a plain-Node consumer). Any value you supply wins; omitted keys fall back to the `ts`/`esm` defaults. The existing `previewFeatures = ["multiSchema"]` emission (when `db.schemas` is set) is preserved and coexists with the new options.

  ```typescript
  export default config({
    db: {
      provider: 'postgresql',
      prismaGeneratorOptions: {
        importFileExtension: 'js',
        moduleFormat: 'commonjs',
      },
      // ... rest of config
    },
    // ...
  })
  ```

- [#584](https://github.com/OpenSaasAU/stack/pull/584) [`b17ec45`](https://github.com/OpenSaasAU/stack/commit/b17ec45127fe55f02437892e9fd389c67373635a) Thanks [@borisno2](https://github.com/borisno2)! - Add `findFirst` to access-controlled `context.db.<list>` delegates

  `findFirst` is sugar over the existing access-filtered `findMany` (`take: 1`), so
  it introduces no new access surface: it applies the exact same query-access checks
  and access-controlled include building as `findMany`, then returns the first
  matching row or `null`. It honours the read-side silent-failure contract — an
  access-denied query yields `null` rather than throwing.

  ```ts
  // Non-unique single-row lookup
  const account = await context.db.account.findFirst({
    where: { userId: '123' },
    orderBy: { createdAt: 'desc' },
  })

  // Narrow the single result with a query fragment
  const post = await context.db.post.findFirst({
    where: { published: true },
    query: postFragment,
  })
  // post: ResultOf<typeof postFragment> | null
  ```

  The CLI type generator now emits a `findFirst` method (and `<List>FindFirstArgs`
  type) for each list in the generated `.opensaas/types.ts`, so migrated apps that
  reach for the familiar Prisma `findFirst` pattern get full type support.

### Patch Changes

- [#606](https://github.com/OpenSaasAU/stack/pull/606) [`801230e`](https://github.com/OpenSaasAU/stack/commit/801230e1a95efc17c8bec46c7094f0b72956f54b) Thanks [@borisno2](https://github.com/borisno2)! - Remove unused getRelatedListName helper from the types generator (dead code, no behavior change)

- [#591](https://github.com/OpenSaasAU/stack/pull/591) [`c741055`](https://github.com/OpenSaasAU/stack/commit/c74105548aadb9991a4cded3b12d9c1a5b0dcd0c) Thanks [@borisno2](https://github.com/borisno2)! - Fix `tsc` failure in generated `prisma-extensions.ts` for multi-column storage fields in `db: { columns: 'keystone' }` mode. The result extension's `needs` now references the physical part columns (e.g. `image_url`, `image_pathname`, …) derived from the field's `getColumnNames`, instead of the logical field name which has no scalar on the model (previously typed `true` against `never`). This removes the last error forcing `@ts-nocheck` on the generated bundle ([#559](https://github.com/OpenSaasAU/stack/issues/559)).

- Updated dependencies [[`44ec937`](https://github.com/OpenSaasAU/stack/commit/44ec9375baa4dacab4e34b03cbefb27c8aec07c9), [`be9a896`](https://github.com/OpenSaasAU/stack/commit/be9a8965ad6338c279e99cfe3bf24162e63ffb92), [`e39d6e9`](https://github.com/OpenSaasAU/stack/commit/e39d6e9e37be2337c8cf1979053e76877f14296c), [`fadd9db`](https://github.com/OpenSaasAU/stack/commit/fadd9dbd17085f4dd15899371a054ec46f943ce4), [`4f0d407`](https://github.com/OpenSaasAU/stack/commit/4f0d40721feff1a3109647a81fcbe47db5970026), [`e355c05`](https://github.com/OpenSaasAU/stack/commit/e355c05a0787980b997609c4571271ab5c250f36), [`ca4973b`](https://github.com/OpenSaasAU/stack/commit/ca4973b504eadb123d179e8f4d16d6ec8c9f8fc1), [`44ec937`](https://github.com/OpenSaasAU/stack/commit/44ec9375baa4dacab4e34b03cbefb27c8aec07c9), [`ecbf834`](https://github.com/OpenSaasAU/stack/commit/ecbf834059a072c428b0739d6ebcf4c74be8c893), [`a93cebb`](https://github.com/OpenSaasAU/stack/commit/a93cebb5a6ba6550d8cdbb94f010c902ad7e29f1), [`481d6e0`](https://github.com/OpenSaasAU/stack/commit/481d6e00be90b1159b0b30eff015e5079c840158), [`4622b5f`](https://github.com/OpenSaasAU/stack/commit/4622b5fa8fc731e2c8995011f1be0cfe341578da), [`b17ec45`](https://github.com/OpenSaasAU/stack/commit/b17ec45127fe55f02437892e9fd389c67373635a), [`8f98e25`](https://github.com/OpenSaasAU/stack/commit/8f98e25fbef4ec0fc3ff0cba456ff7f2f7ba2ea8)]:
  - @opensaas/stack-core@0.25.0

## 0.24.0

### Minor Changes

- [#553](https://github.com/OpenSaasAU/stack/pull/553) [`7f9b577`](https://github.com/OpenSaasAU/stack/commit/7f9b577678636d3f4d81e614ed022a03c61fe5c6) Thanks [@borisno2](https://github.com/borisno2)! - Emit explicit `.ts` import extensions in the generated `.opensaas` bundle so it's loadable by the host bundler

  The generator now appends an explicit `.ts` extension to every relative import it emits across the Generated bundle — `context.ts`, `types.ts`, `prisma-extensions.ts`, `lists.ts`, the `opensaas.config` import, and the `prisma-client/**` tree references. Previously these specifiers were extensionless (e.g. `import { PrismaClient } from './prisma-client/client'`), which only a TS-aware loader could resolve. A plain Node process or an un-aliased bundler (webpack/Next) failed to resolve the sub-imports, and pushing the bundle out of the compile graph with a `webpackIgnore`d dynamic `import()` meant `next build` never file-traced the `prisma-client/**` subtree into the serverless output.

  With explicit extensions the bundle resolves identically under `tsx`, `vitest`, plain Node type-stripping, esbuild, and webpack/Next without any consumer-side `extensionAlias`, and statically importing it compiles + file-traces under `next build`. This is the default output (no flag). See ADR-0008.

  **Consumer requirement:** the project that type-checks the bundle must set `allowImportingTsExtensions: true` in its tsconfig `compilerOptions`, otherwise the `.ts` specifiers fail the TypeScript step with TS5097. The flag is compatible with Next's `noEmit`, so it slots into the existing `next build` type-check. Projects scaffolded with `create-opensaas-app` get this flag by default.

  Generated output (before → after):

  ```typescript
  // before
  import { PrismaClient } from './prisma-client/client'
  import type { Context } from './types'
  import { prismaExtensions } from './prisma-extensions'
  import configOrPromise from '../opensaas.config'

  // after
  import { PrismaClient } from './prisma-client/client.ts'
  import type { Context } from './types.ts'
  import { prismaExtensions } from './prisma-extensions.ts'
  import configOrPromise from '../opensaas.config.ts'
  ```

  Regenerate with `pnpm generate` to pick up the new extensions. The supported production path is to statically import the bundle (e.g. `import { getContext } from '@/.opensaas/context'`) so the host build traces it — see the deployment guide for the `outputFileTracingIncludes` recipe.

### Patch Changes

- Updated dependencies [[`66496b4`](https://github.com/OpenSaasAU/stack/commit/66496b487bae61f3cdea26fcfcaf605caaaa5520)]:
  - @opensaas/stack-core@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies [[`da4ba52`](https://github.com/OpenSaasAU/stack/commit/da4ba529161e2c8702e4c62ae1594e300f32cbb1)]:
  - @opensaas/stack-core@0.23.0

## 0.22.0

### Minor Changes

- [#497](https://github.com/OpenSaasAU/stack/pull/497) [`be4181a`](https://github.com/OpenSaasAU/stack/commit/be4181ada3f2d6386052df4d4869ad150d360f89) Thanks [@{](https://github.com/{)! - Derive the auth plugin's Auth lists from the better-auth config

  `authPlugin` now mirrors the better-auth config a developer writes instead of hardcoding the keys `User`/`Session`/`Account`/`Verification`. Per-model `modelName` becomes the OpenSaaS list key (and a table `@@map`), and the `fields` column map becomes per-field `@map`s. The plugin only ever adds/extends its own derived keys, so an app's separate domain `User` is never overwritten. The runtime `getUser`/`getCurrentUser` helpers now resolve the user list key from the configured user model instead of a hardcoded `'user'`.

  Default behaviour (no overrides) is unchanged: the lists are still keyed `User`/`Session`/`Account`/`Verification` with the original field shapes and no `@@map`.

  ```typescript
  // Adopt existing better-auth tables without a destructive migration
  authPlugin({
   modelName: 'AuthUser', fields: { name: 'full_name' } },
    session: { modelName: 'AuthSession', fields: { userId: 'user_id' } },
    account: { modelName: 'AuthAccount' },
    verification: { modelName: 'AuthVerification' },
  })
  // -> lists keyed AuthUser/AuthSession/AuthAccount/AuthVerification
  //    with @@map + column @map matching the live tables
  ```

  Lists also gain a model-level `db.map` option, which emits a `@@map("...")` on the generated Prisma model so a list key can differ from its physical table name.

- [#498](https://github.com/OpenSaasAU/stack/pull/498) [`dc51f23`](https://github.com/OpenSaasAU/stack/commit/dc51f237323ee53a705c4b9831dd8db85efd9bc1) Thanks [@borisno2](https://github.com/borisno2)! - Add an `output` config block so `opensaas generate` can relocate the generated Prisma schema and `.opensaas` bundle (e.g. to coexist with an existing Keystone `prisma/` during migration)

  Set `output.prismaSchema` and/or `output.opensaasDir` in `opensaas.config.ts` to move where the generator writes. Defaults are unchanged (`prisma/schema.prisma`, `.opensaas/`) when the block is omitted. The generated files' cross-references follow the configured locations: `context.ts`/`prisma-extensions.ts` import `opensaas.config` from the resolved bundle, the Prisma client `generator { output }` points back at the relocated bundle, and the top-level `prisma.config.ts` references the configured schema directory so `prisma` CLI commands keep working.

  The pre-existing top-level `opensaasPath` option is preserved: the effective `.opensaas` bundle directory resolves as `output.opensaasDir` > `opensaasPath` > the default `.opensaas`. Setting `opensaasPath` alone still relocates the bundle through the CLI exactly as before; `output.opensaasDir` overrides it when both are set.

  ```typescript
  export default config({
    output: {
      prismaSchema: 'prisma-opensaas/schema.prisma',
      opensaasDir: 'generated/opensaas',
    },
    db: {/* ... */},
    lists: {/* ... */},
  })
  ```

- [#511](https://github.com/OpenSaasAU/stack/pull/511) [`696f5c0`](https://github.com/OpenSaasAU/stack/commit/696f5c08c37d4a18107e48cb6b360c9492c7425c) Thanks [@borisno2](https://github.com/borisno2)! - Add non-destructive multi-column mode to `image()` / `file()` for adopting an existing Keystone database without dropping columns (ADR-0006).

  Keystone stores an image across seven per-part columns (`_url`, `_width`, `_height`, `_filesize`, `_contentType`, `_contentDisposition`, `_pathname`) and a file across three (`_filename`, `_filesize`, `_url`). By default `image()`/`file()` still back a single `Json?` column (greenfield unchanged). Set `db.columns: 'keystone'` to map the field onto the existing per-part columns in place — assembled into an `ImageMetadata`/`FileMetadata` on read and split back on write — so a migrating project reaches a clean schema diff with no data migration and no re-upload of existing assets.

  ```typescript
  import { image, file } from '@opensaas/stack-storage/fields'

  fields: {
    // Maps onto image_url, image_width, … image_pathname in place.
    avatar: image({ storage: 'images', db: { columns: 'keystone' } }),

    // Per-part @map names are configurable for non-default column names.
    cover: image({
      storage: 'images',
      db: { columns: { mode: 'keystone', map: { url: 'cover_link' } } },
    }),

    resume: file({ storage: 'documents', db: { columns: 'keystone' } }),
  }
  ```

  No-re-upload guarantee (both modes): an already-shaped metadata value — or, in multi-column mode, populated columns — is authoritative and never triggers a storage upload; only a `File`-like input uploads.

  Adds a multi-column field-emission contract (`getPrismaColumns`) plus `getColumnNames`/`assembleColumns`/`splitColumns` to the field-authoring surface so any field can map onto several physical columns. The generator emits one `@map`-ped Prisma line per column; reads assemble the logical value from the raw columns and strip them from the result; writes split the logical value back across the columns.

- [#505](https://github.com/OpenSaasAU/stack/pull/505) [`238966b`](https://github.com/OpenSaasAU/stack/commit/238966b791871247efd9ed2531de73586fb72c35) Thanks [@borisno2](https://github.com/borisno2)! - Surface the canonical Keystone migration guide and the `opensaas-migration` plugin install steps from `opensaas migrate`

  `opensaas migrate` now prints the published Keystone → stack guide URL and how to install the `opensaas-migration` Claude Code plugin (its skills and commands). The same pointers are available via `opensaas migrate --help` without running a migration. The CLI links to the canonical guide rather than embedding its text.

  ```bash
  # Both surface the guide URL + plugin install steps
  opensaas migrate
  opensaas migrate --help
  ```

  Output points at:
  - Guide: https://stack.opensaas.au/docs/guides/migrating-from-keystone
  - Plugin (automatic): `npx @opensaas/stack-cli migrate --with-ai`
  - Plugin (manual, inside Claude Code):
    - `/plugin marketplace add OpenSaasAU/stack`
    - `/plugin install opensaas-migration@opensaas-stack-marketplace`

- [#499](https://github.com/OpenSaasAU/stack/pull/499) [`f9e0505`](https://github.com/OpenSaasAU/stack/commit/f9e05053c75c76781751d5d9e5d1ed5cd9be635f) Thanks [@borisno2](https://github.com/borisno2)! - Add opt-in `db.keystoneCompat` mode for Keystone-compatible empty-string text defaults

  When migrating from Keystone 6, every non-null text column carries an implicit empty-string default. Set `db: { keystoneCompat: true }` to mirror that: any non-null `text()` column without an explicit `defaultValue` now generates `String @default("")`, so a migrating schema reaches parity without hand-setting `defaultValue: ''` on dozens of columns.

  The mode is off by default (greenfield schemas stay clean) and never affects nullable text, fields with an explicit `defaultValue`, or any non-text field — an explicit `text({ defaultValue: 'x' })` always wins.

  ```typescript
  export default config({
    db: {
      provider: 'postgresql',
      keystoneCompat: true, // non-null text without a default → @default("")
      prismaClientConstructor: (PrismaClient) => {
        // ... adapter setup
      },
    },
    lists: {
      Account: list({
        fields: {
          // required text → String @default("")
          name: text({ validation: { isRequired: true } }),
          // explicit default still wins → String @default("PLEASE_UPDATE")
          status: text({ validation: { isRequired: true }, defaultValue: 'PLEASE_UPDATE' }),
          // nullable text is untouched → String?
          bio: text(),
        },
      }),
    },
  })
  ```

  See ADR-0004 for the full Keystone-compatible generator defaults.

- [#501](https://github.com/OpenSaasAU/stack/pull/501) [`e30f6a1`](https://github.com/OpenSaasAU/stack/commit/e30f6a1ef69dc65ae68b37539fa74c3f97823cfd) Thanks [@borisno2](https://github.com/borisno2)! - Auto-timestamps are now OFF by default; opt in with `db.timestamps`

  The generator no longer appends `createdAt`/`updatedAt` to every model. This matches
  Keystone 6 (which never adds them automatically) and keeps Keystone → stack migrations
  non-destructive. A list opts in either by declaring the fields itself or by enabling the
  new `db.timestamps` flag. See ADR-0004.

  Note: this changes a long-standing default. Existing apps that relied on auto-injected
  timestamps should set `db: { timestamps: true }` to keep them.

  Enable globally:

  ```typescript
  export default config({
    db: {
      provider: 'postgresql',
      timestamps: true, // re-enable auto createdAt/updatedAt for all lists
      // ...
    },
    lists: {/* ... */},
  })
  ```

  Override per list (takes precedence over the global setting):

  ```typescript
  lists: {
    // Opt this one list out even though timestamps are on globally
    Production: list({
      fields: { name: text() },
      db: { timestamps: false },
    }),
    // Opt this one list in even though the global default is off
    Audited: list({
      fields: { name: text() },
      db: { timestamps: true },
    }),
  }
  ```

  When timestamps are enabled and a list already declares its own `createdAt`/`updatedAt`
  field, the auto column is skipped for the declared field(s) so Prisma never sees a
  duplicate (`P1012`):

  ```typescript
  lists: {
    Post: list({
      fields: {
        title: text(),
        createdAt: timestamp(), // kept as declared; no duplicate auto column
      },
    }),
  }
  ```

  The decision is exposed as a pure, testable predicate `resolveListTimestamps(listConfig, dbConfig)`
  from `@opensaas/stack-cli`, and `DatabaseConfig` is now re-exported from `@opensaas/stack-core`.

- [#503](https://github.com/OpenSaasAU/stack/pull/503) [`f471e3c`](https://github.com/OpenSaasAU/stack/commit/f471e3c95eee2254ac9fde04adc8c5693240e293) Thanks [@borisno2](https://github.com/borisno2)! - Add `select()` db options for Keystone schema parity: `db.isNullable` and `db.enumName`.

  `db.isNullable: true` forces the nullable `?` on the generated column even when a
  `defaultValue` is present. The default behaviour is unchanged — a select with a
  `defaultValue` still generates NOT NULL unless you opt in explicitly:

  ```typescript
  // Optional select with a default, kept nullable for data containing NULLs
  status: select({
    options: [
      { label: 'Draft', value: 'draft' },
      { label: 'Published', value: 'published' },
    ],
    defaultValue: 'draft',
    db: { isNullable: true },
  })
  // Generates: status String? @default("draft")

  // Enum-backed equivalent
  status: select({
    options: [{ label: 'Open', value: 'open' }],
    defaultValue: 'open',
    db: { type: 'enum', isNullable: true },
  })
  // Generates: status <Enum>? @default(open)
  ```

  `db.enumName` overrides the derived `<List><Field>` name of the generated Prisma
  enum for native-enum selects, renaming both the `enum` block and every reference
  to it in the owning model — useful for matching a live DB enum (e.g. Keystone's
  `…Type` suffix):

  ```typescript
  status: select({
    options: [
      { label: 'Open', value: 'open' },
      { label: 'Closed', value: 'closed' },
    ],
    db: { type: 'enum', enumName: 'AccountNoteStatusType' },
  })
  // Generates: enum AccountNoteStatusType { ... } and the column references it
  ```

- [#493](https://github.com/OpenSaasAU/stack/pull/493) [`acb6100`](https://github.com/OpenSaasAU/stack/commit/acb6100a078aca29e94a82ebe607d2d4f8683af2) Thanks [@borisno2](https://github.com/borisno2)! - Honour `defaultValue` for `text()`, `integer()`, and `json()` fields in the generated Prisma schema

  These three field builders previously dropped `defaultValue` and emitted no `@default(...)`. They now serialise the configured default into a Prisma `@default(...)` literal via a new shared, pure `formatPrismaDefault` module, matching Keystone 6 conventions. The nullable `?` modifier is preserved independently of the default, and fields without a `defaultValue` still emit no `@default(...)`.

  ```typescript
  fields: {
    // Int @default(3550)
    quota: integer({ defaultValue: 3550 }),
    // String @default("PLEASE_UPDATE")
    status: text({ defaultValue: 'PLEASE_UPDATE' }),
    // Json? @default("[1,2,3,4,5]") — Keystone's space-free JSON literal
    limits: json({ defaultValue: [1, 2, 3, 4, 5] }),
    // Json? @default("[]")
    tags: json({ defaultValue: [] }),
  }
  ```

  See ADR-0004 for the Keystone-compatibility rationale.

- [#510](https://github.com/OpenSaasAU/stack/pull/510) [`4ce9284`](https://github.com/OpenSaasAU/stack/commit/4ce92845d272474dc15360edd12f31929a40521a) Thanks [@borisno2](https://github.com/borisno2)! - Singleton lists now emit a bare `id Int @id` (no `@default(1)`) to match Keystone 6, so singletons reach Schema parity from config alone instead of needing `extendPrismaSchema` to strip the column default (see ADR-0004).

  ```ts
  lists: {
    Settings: list({
      isSingleton: true,
      fields: { siteName: text() },
    }),
  }
  ```

  Generated Prisma schema:

  ```prisma
  model Settings {
    id        Int      @id
    siteName  String
  }
  ```

  Non-singleton lists are unaffected and continue to emit `id String @id @default(cuid())`.

- [#502](https://github.com/OpenSaasAU/stack/pull/502) [`593390c`](https://github.com/OpenSaasAU/stack/commit/593390c57d9844ca7ada8f45b340c849f1d8d647) Thanks [@{](https://github.com/{)! - Add `authPlugin` schema placement so Auth lists can adopt an existing non-`public` better-auth layout (clean-diff adoption)

  The auth lists can now be placed in a non-`public` Postgres schema (e.g. `auth`) so they diff CLEAN against a separate-schema better-auth installation. A plugin-level `schema` option applies `@@schema(...)` to all generated Auth lists, with a per-list override.

  ```typescript
  authPlugin({
    schema: 'auth', // all Auth lists get @@schema("auth")
   modelName: 'AuthUser' },
    session: { modelName: 'AuthSession' },
    account: { modelName: 'AuthAccount' },
    // per-model override: relocate one list to a different schema
    verification: { modelName: 'AuthVerification', schema: 'auth_internal' },
  })
  ```

  The plugin's `beforeGenerate` hook wires the datasource `schemas` array (always including `public`) and defaults any list without an explicit `db.schema` to `public`, producing a valid multi-schema Prisma schema. With no `schema` option the output is unchanged (greenfield default stays in `public`, no `@@schema`).

  Core support added for this (mirroring the `db.map` → `@@map` work):
  - List-level `db.schema` → the Prisma generator emits `@@schema("...")` on the model.
  - Database-level `db.schemas` → the generator emits the datasource `schemas = [...]` array and enables the `multiSchema` preview feature.

  ```typescript
  // Core/generator building blocks
  db: { provider: 'postgresql', schemas: ['public', 'auth'] }
  AuthUser: list({ fields: { ... }, db: { map: 'AuthUser', schema: 'auth' } })
  // Generates: model AuthUser { ... @@map("AuthUser") @@schema("auth") }
  ```

### Patch Changes

- [#526](https://github.com/OpenSaasAU/stack/pull/526) [`a09103a`](https://github.com/OpenSaasAU/stack/commit/a09103afcb471575ebbfe09a439168375d474bac) Thanks [@borisno2](https://github.com/borisno2)! - Fix migration introspectors mapping Prisma/Keystone Float columns to the non-existent `float()` builder; they now map to `decimal()` and warn about the Float→Decimal type change.

- [#519](https://github.com/OpenSaasAU/stack/pull/519) [`abf350d`](https://github.com/OpenSaasAU/stack/commit/abf350d93150c0db6ad72e2bef4610ea68e9ec22) Thanks [@borisno2](https://github.com/borisno2)! - Fix multi-schema P1012: models without `db.schema` now default to `@@schema("public")` instead of emitting no `@@schema` (mirrors the enum default). Greenfield output is unchanged.

- [#512](https://github.com/OpenSaasAU/stack/pull/512) [`31a3129`](https://github.com/OpenSaasAU/stack/commit/31a31293c36e7633d9d576c8679d3a5a6788b089) Thanks [@borisno2](https://github.com/borisno2)! - Fix multi-schema mode (db.schemas): emit @@schema on generated native enum blocks so an enum-backed select() no longer produces an invalid schema (P1012). Enums inherit their owning model's schema, defaulting to public; greenfield output is unchanged.

- [#507](https://github.com/OpenSaasAU/stack/pull/507) [`fa8d6b4`](https://github.com/OpenSaasAU/stack/commit/fa8d6b43f0261176cb36d4f52b912655b21bdd07) Thanks [@borisno2](https://github.com/borisno2)! - Fix stale migration guide link in the MCP migration wizard's config-generation failure message; it now reuses the canonical `MIGRATION_GUIDE_URL` (`https://stack.opensaas.au/docs/guides/migrating-from-keystone`) instead of the old 404 path.

- Updated dependencies [[`be4181a`](https://github.com/OpenSaasAU/stack/commit/be4181ada3f2d6386052df4d4869ad150d360f89), [`dc51f23`](https://github.com/OpenSaasAU/stack/commit/dc51f237323ee53a705c4b9831dd8db85efd9bc1), [`309c666`](https://github.com/OpenSaasAU/stack/commit/309c666388b71e2bfbe16b7da3ee0f923b3bf716), [`696f5c0`](https://github.com/OpenSaasAU/stack/commit/696f5c08c37d4a18107e48cb6b360c9492c7425c), [`696f5c0`](https://github.com/OpenSaasAU/stack/commit/696f5c08c37d4a18107e48cb6b360c9492c7425c), [`f9e0505`](https://github.com/OpenSaasAU/stack/commit/f9e05053c75c76781751d5d9e5d1ed5cd9be635f), [`d152203`](https://github.com/OpenSaasAU/stack/commit/d1522035e21b6ad7ad1b89b05264c54c13dadcf1), [`e30f6a1`](https://github.com/OpenSaasAU/stack/commit/e30f6a1ef69dc65ae68b37539fa74c3f97823cfd), [`f471e3c`](https://github.com/OpenSaasAU/stack/commit/f471e3c95eee2254ac9fde04adc8c5693240e293), [`acb6100`](https://github.com/OpenSaasAU/stack/commit/acb6100a078aca29e94a82ebe607d2d4f8683af2), [`593390c`](https://github.com/OpenSaasAU/stack/commit/593390c57d9844ca7ada8f45b340c849f1d8d647)]:
  - @opensaas/stack-core@0.22.0

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

- [#416](https://github.com/OpenSaasAU/stack/pull/416) [`841a836`](https://github.com/OpenSaasAU/stack/commit/841a836494e2647f390ae19a8c4121d38ebd2fa4) Thanks [@borisno2](https://github.com/borisno2)! - Move field-config types to `@opensaas/stack-core/fields`, beside their builders

  The concrete field-config types (`TextField`, `IntegerField`, `CheckboxField`,
  `TimestampField`, `PasswordField`, `SelectField`, `RelationshipField`,
  `JsonField`, `VirtualField`, plus `DecimalField`, `CalendarDayField`, and
  `PrismaRelationResult`) now live on the `/fields` entry point alongside the
  builders that produce them, instead of the root barrel. One concept, one import
  path:

  ```typescript
  import { text, decimal } from '@opensaas/stack-core/fields'
  import type { TextField, DecimalField } from '@opensaas/stack-core/fields'
  ```

  `DecimalField` and `CalendarDayField` were previously defined but exported from
  nowhere — they are now public, and the CLI's lists generator maps `decimal`/
  `calendarDay` fields to their precise types instead of the generic
  `BaseFieldConfig` fallback. The umbrella `FieldConfig` stays on the root entry
  point and `BaseFieldConfig` stays on `/extend`.

- [#456](https://github.com/OpenSaasAU/stack/pull/456) [`8470d3e`](https://github.com/OpenSaasAU/stack/commit/8470d3e00d7c8cc62a2f773c82dc00fbd1672cd8) Thanks [@borisno2](https://github.com/borisno2)! - Generate a `prisma.config.ts` datasource that supports the production `prisma migrate` workflow.

  The generated datasource URL now prefers `DIRECT_DATABASE_URL` and falls back to `DATABASE_URL`, so migrations can use a direct (non-pooled) connection on serverless Postgres (e.g. Neon) while the running app connects through the pooled `DATABASE_URL`. Local SQLite is unaffected: with `DIRECT_DATABASE_URL` unset, the expression resolves to `DATABASE_URL`.

  ```typescript
  // generated prisma.config.ts
  import 'dotenv/config'
  import { defineConfig } from 'prisma/config'

  // Returns undefined for missing vars so the `??` fallback can take effect.
  const env = (name: string): string | undefined => process.env[name]

  export default defineConfig({
    schema: 'prisma',
    datasource: {
      url: env('DIRECT_DATABASE_URL') ?? env('DATABASE_URL'),
    },
  })
  ```

  To use a direct connection for migrations on serverless Postgres, set `DIRECT_DATABASE_URL` in your environment; `prisma migrate dev` / `prisma migrate deploy` will use it. See ADR-0003.

### Patch Changes

- [#441](https://github.com/OpenSaasAU/stack/pull/441) [`bc20bf4`](https://github.com/OpenSaasAU/stack/commit/bc20bf447cf724bd0ee153ea9a69d54cc26a6bb2) Thanks [@borisno2](https://github.com/borisno2)! - Validate field self-containment at config load instead of failing deep in generation

  Core now exports `validateFieldConfig(field, fieldKey, listKey?)` and `validateConfigFields(config)` (plus the `FieldConfigValidationError` type). They check each field implements its generation contract — `getPrismaType`, `getTypeScriptType`, and `getZodSchema` (or `getPrismaRelation` for relationships; virtual fields skip `getPrismaType`) — and return structured per-field errors. `opensaas generate` runs this first and fails fast with a clear message naming the list, field, and missing method, rather than throwing an opaque stack trace mid-generation.

- [#428](https://github.com/OpenSaasAU/stack/pull/428) [`50371ea`](https://github.com/OpenSaasAU/stack/commit/50371ea3dd134f6b3718f347fed2c0d3b7dc63ce) Thanks [@borisno2](https://github.com/borisno2)! - Fix outdated SQLite adapter guidance to match the installed `@prisma/adapter-better-sqlite3` API (`PrismaBetterSqlite3` constructed with `{ url }`), so copied examples actually run. Updates the CLI "missing adapter" error message and the migration config it generates, plus the `prismaClientConstructor` JSDoc example.

- [#415](https://github.com/OpenSaasAU/stack/pull/415) [`8980ff3`](https://github.com/OpenSaasAU/stack/commit/8980ff36ffb0879d8f4409740493dd940572cc9d) Thanks [@borisno2](https://github.com/borisno2)! - Emit `BaseFieldConfig` from `@opensaas/stack-core/extend` in generated `.opensaas/lists.ts`

  The lists generator falls back to `BaseFieldConfig` for field types it doesn't
  map explicitly (e.g. plugin-contributed fields like `embedding`, and the
  `calendarDay`/`decimal` built-ins). That symbol now lives on the `/extend`
  authoring entry point, so generated code imports it from there instead of the
  root, fixing a `has no exported member 'BaseFieldConfig'` type error.

- [#414](https://github.com/OpenSaasAU/stack/pull/414) [`f03e5ac`](https://github.com/OpenSaasAU/stack/commit/f03e5ac32d5a38ef31c895b200b1a4f7a5e50c9c) Thanks [@borisno2](https://github.com/borisno2)! - Fix docs to use the canonical `authPlugin()`/`ragPlugin()` config pattern instead of the non-existent `withAuth()`/`authConfig()`/`withRAG()`/`ragConfig()` wrappers

- [#397](https://github.com/OpenSaasAU/stack/pull/397) [`8e394ab`](https://github.com/OpenSaasAU/stack/commit/8e394abe9df2da53ba23b93836853516bb4e25d5) Thanks [@borisno2](https://github.com/borisno2)! - Move relationship Prisma schema generation into the relationship field builder

  The relationship field now exposes a `getPrismaRelation()` method that returns its complete Prisma schema contribution (FK line, relation line, synthetic back-relation). The Prisma generator delegates to this method instead of special-casing relationships, keeping it a neutral coordinator. Generated schemas are unchanged.

- Updated dependencies [[`8980ff3`](https://github.com/OpenSaasAU/stack/commit/8980ff36ffb0879d8f4409740493dd940572cc9d), [`841a836`](https://github.com/OpenSaasAU/stack/commit/841a836494e2647f390ae19a8c4121d38ebd2fa4), [`bc20bf4`](https://github.com/OpenSaasAU/stack/commit/bc20bf447cf724bd0ee153ea9a69d54cc26a6bb2), [`50371ea`](https://github.com/OpenSaasAU/stack/commit/50371ea3dd134f6b3718f347fed2c0d3b7dc63ce), [`70b4f53`](https://github.com/OpenSaasAU/stack/commit/70b4f538d380bbf546af50a985d29b48a71d3b4d), [`8e394ab`](https://github.com/OpenSaasAU/stack/commit/8e394abe9df2da53ba23b93836853516bb4e25d5), [`d3fdf2a`](https://github.com/OpenSaasAU/stack/commit/d3fdf2a2e5374302bc7fe1fe814cb0f567a349df), [`0f9c644`](https://github.com/OpenSaasAU/stack/commit/0f9c644a115ad747e338e6138b4762b4a48a9144), [`96258b0`](https://github.com/OpenSaasAU/stack/commit/96258b00bb762d9e38cfb83eacae65ce670b161f), [`898e477`](https://github.com/OpenSaasAU/stack/commit/898e47747abc02e457a54e2a78939450d16da5fb), [`29966b2`](https://github.com/OpenSaasAU/stack/commit/29966b23597199bcf4233298b1d0de6401b91acd)]:
  - @opensaas/stack-core@0.21.0

## 0.20.1

### Patch Changes

- [#386](https://github.com/OpenSaasAU/stack/pull/386) [`fcb04d6`](https://github.com/OpenSaasAU/stack/commit/fcb04d6916ab5451080cface330431866b52826c) Thanks [@borisno2](https://github.com/borisno2)! - Fix missing `query` parameter in generated `FindManyArgs` and `FindUniqueArgs` types

  Passing a fragment to `context.db.post.findMany({ query: fragment })` or `context.db.post.findUnique({ where: { id }, query: fragment })` no longer produces a TypeScript error. The generator now emits `query?: Fragment<PostOutput, FieldSelection<PostOutput>>` in the relevant args types.

- [#384](https://github.com/OpenSaasAU/stack/pull/384) [`6b7284a`](https://github.com/OpenSaasAU/stack/commit/6b7284adc828d115aeb25416db45d2be1e68f828) Thanks [@borisno2](https://github.com/borisno2)! - Fix virtual fields typed as `never` when mixed with relation fields in `select` or when using `include`

- Updated dependencies []:
  - @opensaas/stack-core@0.20.1

## 0.20.0

### Patch Changes

- Updated dependencies [[`28be231`](https://github.com/OpenSaasAU/stack/commit/28be23183bc7a9a072f86b3b7286c9c2109fdb11)]:
  - @opensaas/stack-core@0.20.0

## 0.19.1

### Patch Changes

- [#356](https://github.com/OpenSaasAU/stack/pull/356) [`6d771d1`](https://github.com/OpenSaasAU/stack/commit/6d771d11750eb4454b263b3db5bb1b44615be454) Thanks [@borisno2](https://github.com/borisno2)! - Fix regression where list-only many-to-many relationships no longer generated synthetic back-reference fields on the target model, causing Prisma schema validation errors

- Updated dependencies []:
  - @opensaas/stack-core@0.19.1

## 0.19.0

### Minor Changes

- [#346](https://github.com/OpenSaasAU/stack/pull/346) [`aa5edec`](https://github.com/OpenSaasAU/stack/commit/aa5edecfbd2fc2dcab67479088d4c6ff2dd24600) Thanks [@borisno2](https://github.com/borisno2)! - Improve KeystoneJS migration guidance for virtual fields and context.graphql patterns

  The Keystone migration guide now covers two areas that require changes beyond a simple import swap:

  **Virtual fields** — detected automatically; the generated guide shows how to replace `graphql.field({ resolve })` with `hooks: { resolveOutput }` and a `type` declaration:

  ```diff
  - fullName: virtual({
  -   field: graphql.field({
  -     type: graphql.String,
  -     resolve: (item) => `${item.firstName} ${item.lastName}`,
  -   }),
  - })
  + fullName: virtual({
  +   type: 'string',
  +   hooks: {
  +     resolveOutput: ({ item }) => `${item.firstName} ${item.lastName}`,
  +   },
  + })
  ```

  **context.graphql calls** — the guide now includes a step showing how to replace `context.graphql.run()` and `context.query.*` with `context.db.{listName}.{method}()`:

  ```diff
  - const { posts } = await context.graphql.run({
  -   query: `query { posts(where: { status: { equals: published } }) { id title } }`,
  - })
  + const posts = await context.db.post.findMany({
  +   where: { status: { equals: 'published' } },
  + })
  ```

  The introspector warning for virtual fields is also updated to give clearer guidance.

- [#348](https://github.com/OpenSaasAU/stack/pull/348) [`5410cb6`](https://github.com/OpenSaasAU/stack/commit/5410cb604198e087762e39c8aec87fe3736d8c01) Thanks [@borisno2](https://github.com/borisno2)! - Add `db.type: 'enum'` support to the `select` field for native database enum storage

  The `select` field now supports `db.type: 'enum'` to store values as a native Prisma enum type rather than a plain string. This generates an `enum` block in the Prisma schema and uses the enum type in the model, matching Keystone 6's enum select behaviour.

  ```typescript
  import { select } from '@opensaas/stack-core/fields'

  lists: {
    Post: list({
      fields: {
        status: select({
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
            { label: 'Archived', value: 'archived' },
          ],
          db: { type: 'enum' },   // generates a Prisma enum
          defaultValue: 'draft',
        }),
      },
    }),
  }
  ```

  This generates the following Prisma schema:

  ```prisma
  enum PostStatus {
    draft
    published
    archived
  }

  model Post {
    id        String     @id @default(cuid())
    status    PostStatus @default(draft)
    createdAt DateTime   @default(now())
    updatedAt DateTime   @default(now()) @updatedAt
  }
  ```

  **Notes:**
  - The enum name is derived from `<ListName><FieldName>` in PascalCase (e.g. `PostStatus`, `UserRole`)
  - Default values use unquoted Prisma enum syntax (`@default(draft)` not `@default("draft")`)
  - Enum option values must be valid Prisma identifiers: start with a letter, contain only letters, digits, and underscores (e.g. `in_progress` is valid, `in-progress` is not)
  - The TypeScript union type (`'draft' | 'published'`) is generated identically to a string select field
  - Omitting `db.type` or setting `db.type: 'string'` (the default) preserves the existing `String` column behaviour

- [#342](https://github.com/OpenSaasAU/stack/pull/342) [`94b0df6`](https://github.com/OpenSaasAU/stack/commit/94b0df65c860348441200d914dbf37bda3bd25cf) Thanks [@borisno2](https://github.com/borisno2)! - Improve KeystoneJS migration agent with side-by-side examples and targeted update guidance

  The Keystone migration wizard and agent now produce a targeted migration guide instead of
  regenerating the entire config. Since Keystone and OpenSaaS Stack share the same
  `list()`/field/hook/access API, only imports, the database adapter config, and auth setup
  need to change.

  Key improvements:
  - The migration agent prompt now includes side-by-side Keystone vs OpenSaaS examples for
    config structure, imports, access control, hooks, auth, and many-to-many join tables
  - The wizard uses a minimal fast-path for Keystone projects (just 3 questions: db provider,
    auth, auth methods) instead of the full question flow
  - The generator produces a diff-style migration guide for Keystone showing exactly what to
    change, rather than regenerating list definitions the user already has
  - Many-to-many join table naming is now surfaced automatically when M2M relations are
    detected, with `joinTableNaming: 'keystone'` guidance to preserve existing data

### Patch Changes

- [#345](https://github.com/OpenSaasAU/stack/pull/345) [`c815d2f`](https://github.com/OpenSaasAU/stack/commit/c815d2f02a81b16189e8eea0e635ea1aa0a1d6ec) Thanks [@borisno2](https://github.com/borisno2)! - Fix `migrate --with-ai` generating `path` instead of `repo` in Claude marketplace settings

- [#345](https://github.com/OpenSaasAU/stack/pull/345) [`c815d2f`](https://github.com/OpenSaasAU/stack/commit/c815d2f02a81b16189e8eea0e635ea1aa0a1d6ec) Thanks [@borisno2](https://github.com/borisno2)! - Fix broken migration guide URL in `migrate` console output (missing `/docs` prefix)

- [#352](https://github.com/OpenSaasAU/stack/pull/352) [`bd41b1e`](https://github.com/OpenSaasAU/stack/commit/bd41b1e75b78c2e9748422352e6a500ed26df4e9) Thanks [@borisno2](https://github.com/borisno2)! - Fix singleton lists to use `Int @id @default(1)` matching Keystone 6 behaviour

  Singleton lists now generate `Int @id @default(1)` in the Prisma schema instead of
  `String @id @default(cuid())`. This matches Keystone 6's behaviour where singleton
  records always use integer primary key `1`, making migration from Keystone 6 straightforward
  without data loss.

  **Migration guide for existing singleton lists:**

  If you have an existing database with singleton models that use `String @id`, you will need
  to run an SQL migration to convert the id column from text to integer:

  ```sql
  -- Example for PostgreSQL (adjust table name as needed)
  ALTER TABLE "EmailSettings" ALTER COLUMN id TYPE INTEGER USING id::integer;
  UPDATE "EmailSettings" SET id = 1;
  ```

  For SQLite (which does not support ALTER COLUMN):

  ```sql
  -- Recreate the table with Int id
  CREATE TABLE "EmailSettings_new" (id INTEGER PRIMARY KEY DEFAULT 1, ...);
  INSERT INTO "EmailSettings_new" SELECT 1, ... FROM "EmailSettings";
  DROP TABLE "EmailSettings";
  ALTER TABLE "EmailSettings_new" RENAME TO "EmailSettings";
  ```

  New projects and fresh databases will work automatically without any migration steps.
  Fixes #350.

- [#344](https://github.com/OpenSaasAU/stack/pull/344) [`c259030`](https://github.com/OpenSaasAU/stack/commit/c259030dab3cdc641a9f40dd21746a1bd46fb76d) Thanks [@borisno2](https://github.com/borisno2)! - Fix updatedAt field to include @default(now()) in generated Prisma schema to prevent migration failures on databases with existing data

- Updated dependencies [[`bd41b1e`](https://github.com/OpenSaasAU/stack/commit/bd41b1e75b78c2e9748422352e6a500ed26df4e9), [`28f2834`](https://github.com/OpenSaasAU/stack/commit/28f2834b199b93200c74cefb1594ba3704f0a839), [`5410cb6`](https://github.com/OpenSaasAU/stack/commit/5410cb604198e087762e39c8aec87fe3736d8c01)]:
  - @opensaas/stack-core@0.19.0

## 0.18.2

### Patch Changes

- Updated dependencies [[`0b0f322`](https://github.com/OpenSaasAU/stack/commit/0b0f3223e3703014164d49c8f3b455752a6468c1)]:
  - @opensaas/stack-core@0.18.2

## 0.18.1

### Patch Changes

- Updated dependencies [[`3f59454`](https://github.com/OpenSaasAU/stack/commit/3f59454e03976f7ff4f401c661624d1934910a17)]:
  - @opensaas/stack-core@0.18.1

## 0.18.0

### Minor Changes

- [#324](https://github.com/OpenSaasAU/stack/pull/324) [`a05db98`](https://github.com/OpenSaasAU/stack/commit/a05db983f1579038c0542b13e4438496022c1ac1) Thanks [@borisno2](https://github.com/borisno2)! - Add `createMany` and `updateMany` types to generated type definitions

  The type generator now includes properly typed `createMany` and `updateMany` methods in the `CustomDB` type, matching the implementation added in PR #315.

  ```typescript
  // createMany - bulk create with full type safety
  const posts = await context.db.post.createMany({
    data: [
      { title: 'Post 1', content: 'Content 1' },
      { title: 'Post 2', content: 'Content 2' },
    ],
    select: { id: true, title: true },
  })

  // updateMany - bulk update with where filter
  const updated = await context.db.post.updateMany({
    where: { status: 'draft' },
    data: { status: 'published' },
  })
  ```

  Also fixes hook types to use locally defined `BaseContext` instead of importing `AccessContext` from core, giving hooks access to the properly typed `CustomDB` with virtual fields and all operations.

### Patch Changes

- Updated dependencies []:
  - @opensaas/stack-core@0.18.0

## 0.17.0

### Minor Changes

- [#322](https://github.com/OpenSaasAU/stack/pull/322) [`9032dca`](https://github.com/OpenSaasAU/stack/commit/9032dca163bcaa51d3b2386a8e76b28e6c712cbb) Thanks [@borisno2](https://github.com/borisno2)! - Add BaseContext type for shared services between hooks and server actions

  The type generator now exports a `BaseContext` type that contains only the core context properties (`db`, `session`, `storage`, `plugins`, `_isSudo`). This allows services to accept a base context type that works with both:
  - **Field hooks** (which receive `AccessContext`)
  - **Server actions** (which receive full `Context`)

  Previously, services had to choose between accepting `Context` (incompatible with hooks) or using type assertions. Now you can write services that work in both contexts:

  ```typescript
  // In your generated .opensaas/types.ts, you'll now have both:
  export type BaseContext<TSession extends OpensaasSession = OpensaasSession> = {
    db: CustomDB
    session: TSession
    // ... other base properties
  }

  export type Context<TSession extends OpensaasSession = OpensaasSession> =
    BaseContext<TSession> & {
      serverAction: (props: ServerActionProps) => Promise<unknown>
      sudo: () => Context<TSession>
    }
  ```

  **Usage example:**

  ```typescript
  // Service that works with both hooks and server actions
  export class ScheduleService {
    private context: BaseContext // ✅ Accepts BaseContext instead of Context

    constructor(context: BaseContext) {
      this.context = context
    }

    async checkConflicts(userId: string) {
      // Only uses db and session - works everywhere
      return this.context.db.schedule.findMany({
        where: { userId },
      })
    }
  }

  // Factory function
  export function createScheduleService(context: BaseContext): ScheduleService {
    return new ScheduleService(context)
  }

  // ✅ Works in field hooks
  fields: {
    schedule: relationship({
      ref: 'Schedule',
      hooks: {
        validateInput: async ({ context, addValidationError }) => {
          const service = createScheduleService(context) // No type error!
          const hasConflict = await service.checkConflicts(userId)
          if (hasConflict) {
            addValidationError('Schedule conflict detected')
          }
        },
      },
    })
  }

  // ✅ Also works in server actions
  export async function checkSchedule(context: Context, userId: string) {
    const service = createScheduleService(context) // Also works!
    return service.checkConflicts(userId)
  }
  ```

  This resolves the type incompatibility issue where services needed to use type assertions or duplicate code to work in both hooks and server actions.

- [#323](https://github.com/OpenSaasAU/stack/pull/323) [`247a259`](https://github.com/OpenSaasAU/stack/commit/247a2590f699b0e27b3661942295064d640e225f) Thanks [@borisno2](https://github.com/borisno2)! - Add full Prisma filter operator support to WhereInput types

  The generated `WhereInput` types now expose all of Prisma's filter operators instead of just `equals` and `not`. This resolves GitHub issue #318.

  **String fields** now support:

  ```typescript
  const where: PostWhereInput = {
    title: {
      contains: 'search',
      startsWith: 'Hello',
      endsWith: '!',
      in: ['Post 1', 'Post 2'],
      notIn: ['Spam'],
      mode: 'insensitive', // case-insensitive search
    },
  }
  ```

  **Number fields** now support:

  ```typescript
  const where: PostWhereInput = {
    viewCount: {
      gte: 100, // greater than or equal
      lte: 1000, // less than or equal
      gt: 50, // greater than
      lt: 500, // less than
      in: [10, 20, 30],
      notIn: [0],
    },
  }
  ```

  **DateTime fields** now support:

  ```typescript
  const where: PostWhereInput = {
    publishDate: {
      gte: new Date('2024-01-01'),
      lte: new Date('2024-12-31'),
    },
  }
  ```

  **Boolean operators** now match Prisma's structure:

  ```typescript
  const where: PostWhereInput = {
    // AND can be single object OR array
    AND: { status: { equals: 'published' } },
    // OR is array-only
    OR: [{ status: { in: ['published', 'draft'] } }, { title: { contains: 'important' } }],
    // NOT can be single object OR array
    NOT: { status: { equals: 'archived' } },
  }
  ```

  No migration required - this change is fully backward compatible. Existing code using `equals` and `not` will continue to work.

### Patch Changes

- [#317](https://github.com/OpenSaasAU/stack/pull/317) [`69b7af6`](https://github.com/OpenSaasAU/stack/commit/69b7af631c784e7ca0fbe4d1c3979b12fc8c9afe) Thanks [@borisno2](https://github.com/borisno2)! - Fix synthetic field generation for one-sided relationships when using joinTableNaming: 'keystone'

- [#321](https://github.com/OpenSaasAU/stack/pull/321) [`834d437`](https://github.com/OpenSaasAU/stack/commit/834d437ab47f6246d58f1aa005847321796bfdc3) Thanks [@borisno2](https://github.com/borisno2)! - Fix select type narrowing to properly include virtual fields and nested relations in query results

- Updated dependencies [[`538bc20`](https://github.com/OpenSaasAU/stack/commit/538bc20698b7d0f3c6600741f4553306008dec64)]:
  - @opensaas/stack-core@0.17.0

## 0.16.0

### Minor Changes

- [#311](https://github.com/OpenSaasAU/stack/pull/311) [`85b067b`](https://github.com/OpenSaasAU/stack/commit/85b067b2d10bddaffccf519025aeae2dbc00fa85) Thanks [@borisno2](https://github.com/borisno2)! - Add customizable join table naming for many-to-many relationships

  **New Features:**
  1. **Global Keystone Naming:** Set `joinTableNaming: 'keystone'` for automatic KeystoneJS-compatible naming across all M2M relationships
  2. **Per-Field Relation Names:** Use `db.relationName` on individual relationship fields for fine-grained control
  3. **Hybrid Support:** Combine both options - per-field names override global setting

  **Use Cases:**
  - **KeystoneJS Migration:** Preserve existing join table names to prevent data loss
  - **Custom Naming:** Specify exact relation names for specific relationships
  - **Mixed Projects:** Use Keystone naming for migrations while customizing specific tables

  **Configuration Options:**

  **Option 1: Global Keystone Naming**

  ```typescript
  export default config({
    db: {
      provider: 'postgresql',
      joinTableNaming: 'keystone', // Auto-apply to all M2M relationships
    },
    lists: {
      Lesson: {
        fields: {
          teachers: relationship({ ref: 'Teacher.lessons', many: true }),
          // → Creates implicit join table _Lesson_teachers
        },
      },
    },
  })
  ```

  **Option 2: Per-Field Relation Name**

  ```typescript
  lists: {
    Lesson: {
      fields: {
        teachers: relationship({
          ref: 'Teacher.lessons',
          many: true,
          db: { relationName: 'Lesson_teachers' }, // Only set on ONE side
        }),
      },
    },
    Teacher: {
      fields: {
        lessons: relationship({ ref: 'Lesson.teachers', many: true }),
        // Automatically uses same relationName from other side
      },
    },
  }
  ```

  **Option 3: Hybrid (per-field overrides global)**

  ```typescript
  export default config({
    db: {
      joinTableNaming: 'keystone', // Default for most relationships
    },
    lists: {
      Lesson: {
        fields: {
          students: relationship({ ref: 'Student.lessons', many: true }),
          // → Uses global Keystone naming: _Lesson_students
          teachers: relationship({
            ref: 'Teacher.lessons',
            many: true,
            db: { relationName: 'CustomTeachers' }, // Override for this one
          }),
          // → Uses custom name: _CustomTeachers
        },
      },
    },
  })
  ```

  **How It Works:**

  Prisma automatically creates implicit join tables when you use `@relation("name")` on both sides of a many-to-many relationship. The join table is named `_name`. No explicit join table models are generated - Prisma handles this automatically.

  **Migration Guide:**
  1. Identify all M2M relationships in your Keystone schema
  2. Choose strategy:
     - Full migration: Use `joinTableNaming: 'keystone'`
     - Selective: Use per-field `db.relationName`
  3. Run `pnpm generate`
  4. Verify relation names match (check for `@relation("name")`)
  5. Use `prisma db push` to sync

  **Validation:**
  - Both sides of bidirectional M2M must use matching `relationName` if both specify it
  - Only need to set on one side - automatically propagates to other side
  - Per-field takes precedence over global setting

### Patch Changes

- [#314](https://github.com/OpenSaasAU/stack/pull/314) [`c6b66e2`](https://github.com/OpenSaasAU/stack/commit/c6b66e229a6e16838cf5833e973e5060379aa874) Thanks [@borisno2](https://github.com/borisno2)! - Fix TypeScript errors when selecting virtual fields on nested relationships

- Updated dependencies [[`85b067b`](https://github.com/OpenSaasAU/stack/commit/85b067b2d10bddaffccf519025aeae2dbc00fa85)]:
  - @opensaas/stack-core@0.16.0

## 0.15.0

### Minor Changes

- [#306](https://github.com/OpenSaasAU/stack/pull/306) [`e7b3542`](https://github.com/OpenSaasAU/stack/commit/e7b354246e40c6d91c459a50791f6eef12f9521d) Thanks [@borisno2](https://github.com/borisno2)! - Add GetPayload helper types for virtual fields

  Virtual fields are now fully type-safe in Prisma select queries. The type generator now creates `{ListName}GetPayload<T>` helper types that conditionally include virtual fields based on selection.

  Before this change, virtual fields were not recognized in Prisma select types:

  ```typescript
  import { Prisma } from '@/.opensaas/prisma-client/client'

  const select = {
    id: true,
    age: true, // ❌ TS Error: 'age' does not exist in type 'StudentSelect'
  } satisfies Prisma.StudentSelect
  ```

  After this change, you can use the generated types from `.opensaas/types`:

  ```typescript
  import { StudentSelect, StudentGetPayload } from '@/.opensaas/types'

  const studentSelect = {
    id: true,
    firstName: true,
    age: true, // ✅ Virtual field - fully typed!
  } satisfies StudentSelect

  type StudentDetail = StudentGetPayload<{ select: typeof studentSelect }>
  // ✅ StudentDetail includes: { id: string, firstName: string, age: number }
  ```

  The helper type only includes virtual fields that are explicitly selected:

  ```typescript
  const basicSelect = {
    id: true,
    firstName: true,
    // age NOT selected
  } satisfies StudentSelect

  type BasicStudent = StudentGetPayload<{ select: typeof basicSelect }>
  // ✅ BasicStudent includes: { id: string, firstName: string }
  // age is NOT included
  ```

  No migration needed - this is purely additive. Existing code continues to work, and you can adopt the new types incrementally by:
  1. Running `pnpm generate` to regenerate types
  2. Importing from `.opensaas/types` instead of `@/.opensaas/prisma-client/client`
  3. Using `{ListName}Select` and `{ListName}GetPayload<T>` for type-safe virtual field queries

- [#310](https://github.com/OpenSaasAU/stack/pull/310) [`19f04b1`](https://github.com/OpenSaasAU/stack/commit/19f04b1c5e0b172257936c366bd28d56aa825a24) Thanks [@relationship({](https://github.com/relationship({), [@relationship({](https://github.com/relationship({), [@relationship({](https://github.com/relationship({), [@relationship({](https://github.com/relationship({)! - Add automatic foreign key indexing for relationship fields (matching Keystone behavior)

  Relationship fields now automatically generate `@@index` directives on their foreign key fields by default. This matches Keystone's behavior and prevents performance regression when migrating from Keystone.

  **Default behavior (indexed):**

  ```typescript
   ref: 'User.posts' })
  // Generates: @@index([authorId])
  ```

  **Explicit control:**

  ```typescript
  // Force indexing
   ref: 'User.posts', isIndexed: true })

  // Unique constraint (for one-to-one)
   ref: 'User.posts', isIndexed: 'unique' })

  // Disable indexing (not recommended)
   ref: 'User.posts', isIndexed: false })
  ```

  This resolves the issue where migrations from Keystone would drop all foreign key indexes, causing performance degradation on queries filtering or joining on foreign keys.

### Patch Changes

- Updated dependencies [[`19f04b1`](https://github.com/OpenSaasAU/stack/commit/19f04b1c5e0b172257936c366bd28d56aa825a24)]:
  - @opensaas/stack-core@0.15.0

## 0.14.0

### Minor Changes

- [#298](https://github.com/OpenSaasAU/stack/pull/298) [`5f1bfb5`](https://github.com/OpenSaasAU/stack/commit/5f1bfb5d286b3b43c61fceeae6d78588c126d488) Thanks [@borisno2](https://github.com/borisno2)! - Add field-level `extendPrismaSchema` support for relationship fields

  Relationship fields now support `extendPrismaSchema` in their `db` config, allowing granular modification of generated Prisma schema lines. This is useful for self-referential relationships that need custom `onDelete` or `onUpdate` actions.

  ```typescript
  parent: relationship({
    ref: 'Category.children',
    db: {
      foreignKey: true,
      extendPrismaSchema: ({ fkLine, relationLine }) => ({
        fkLine,
        relationLine: relationLine.replace(
          '@relation(',
          '@relation(onDelete: SetNull, onUpdate: Cascade, ',
        ),
      }),
    },
  })
  ```

  The function receives `fkLine` (the foreign key field line, only present for single relationships that own the FK) and `relationLine` (the relation field line), and returns the modified lines.

  Fixes #284

- [#294](https://github.com/OpenSaasAU/stack/pull/294) [`fdda49d`](https://github.com/OpenSaasAU/stack/commit/fdda49dfb63feaa37d01c0c0bf2f79df8be8ae9e) Thanks [@{](https://github.com/{), [@{](https://github.com/{), [@{](https://github.com/{)! - Add relationship field support to WhereInput types

  Generated WhereInput types now include relationship fields, enabling access control filters that traverse relationships:

  ```typescript
  // One-to-many relationships use some/every/none
  const userFilter: UserWhereInput = {
    posts: {
      some: {
        status: { equals: 'published' },
      },
    },
  }

  // Many-to-one relationships use direct nesting
  const postFilter: PostWhereInput = {

      email: { equals: 'user@example.com' },
    },
  }

  // Complex nested filters are now possible
  const complexFilter: PostWhereInput = {
    AND: [
      { status: { equals: 'published' } },
      {

          posts: {
            some: { status: { equals: 'published' } },
          },
        },
      },
    ],
  }
  ```

  This enables common access control patterns like filtering students by their account's user:

  ```typescript
  export function studentFilter({ session }: { session: Session | null }): StudentWhereInput {
    return {
      account: {
   id: { equals: session?.userId } },
      },
    }
  }
  ```

- [#296](https://github.com/OpenSaasAU/stack/pull/296) [`71584da`](https://github.com/OpenSaasAU/stack/commit/71584da61b89e66685d7e1b7c3e22adaa57b7490) Thanks [@borisno2](https://github.com/borisno2)! - Add Select and Include types with virtual field support

  Virtual fields are now included in generated Select and Include types, enabling proper TypeScript type checking when selecting virtual fields:

  ```typescript
  import type { UserSelect } from '@/.opensaas/types'

  // Before: This would cause a type error
  const select = {
    id: true,
    name: true,
    displayName: true, // Error: 'displayName' does not exist in Prisma.UserSelect
  } satisfies Prisma.UserSelect

  // After: Virtual fields work correctly
  const select = {
    id: true,
    name: true,
    displayName: true, // ✓ Works! Virtual field is included in UserSelect
  } satisfies UserSelect
  ```

  For lists without virtual fields, the generated types simply re-export Prisma's types:

  ```typescript
  export type PostSelect = Prisma.PostSelect
  export type PostInclude = Prisma.PostInclude
  ```

  For lists with virtual fields, the types extend Prisma's types:

  ```typescript
  export type UserSelect = Prisma.UserSelect & {
    displayName?: boolean
  }
  ```

  This resolves the issue where virtual fields couldn't be used in select/include objects with the `satisfies` operator.

- [#295](https://github.com/OpenSaasAU/stack/pull/295) [`6f8d37a`](https://github.com/OpenSaasAU/stack/commit/6f8d37a0761d50b9b9b707f26b39176304428770) Thanks [@borisno2](https://github.com/borisno2)! - Add singleton lists support for single-record tables

  You can now create singleton lists (lists that should only ever have one record) by setting `isSingleton: true`. This is useful for Settings, Configuration, or other global single-record tables.

  Features:
  - Prevents creating multiple records (throws error on second create)
  - Auto-creates record with field defaults on first access (configurable)
  - Provides a `get()` method for easy access to the singleton record
  - Blocks `delete` and `findMany` operations on singleton lists
  - Works with all existing access control and hooks

  Usage:

  ```typescript
  import { config, list } from '@opensaas/stack-core'
  import { text, checkbox, integer } from '@opensaas/stack-core/fields'

  export default config({
    lists: {
      Settings: list({
        fields: {
          siteName: text({ defaultValue: 'My Site' }),
          maintenanceMode: checkbox({ defaultValue: false }),
          maxUploadSize: integer({ defaultValue: 10 }),
        },
        access: {
          operation: {
            query: () => true,
            update: isAdmin,
          },
        },
        isSingleton: true, // Enable singleton mode
      }),
    },
  })
  ```

  Access the singleton record:

  ```typescript
  // Auto-creates with defaults if no record exists
  const settings = await context.db.settings.get()

  // Update the singleton
  await context.db.settings.update({
    where: { id: settings.id },
    data: { siteName: 'Updated Site' },
  })
  ```

  Disable auto-create:

  ```typescript
  Settings: list({
    fields: {/* ... */},
    isSingleton: {
      autoCreate: false, // Must manually create the record
    },
  })
  ```

### Patch Changes

- Updated dependencies [[`5f1bfb5`](https://github.com/OpenSaasAU/stack/commit/5f1bfb5d286b3b43c61fceeae6d78588c126d488), [`6f8d37a`](https://github.com/OpenSaasAU/stack/commit/6f8d37a0761d50b9b9b707f26b39176304428770), [`ed25cc5`](https://github.com/OpenSaasAU/stack/commit/ed25cc5aba43709d40ad256c982364ca8a8b0f2e), [`c2263d2`](https://github.com/OpenSaasAU/stack/commit/c2263d21cc7a4eaffc0b06af04eb7b3a1a3ce437), [`0c66ebc`](https://github.com/OpenSaasAU/stack/commit/0c66ebc4492fac47f2028569b080d496328c18bf)]:
  - @opensaas/stack-core@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [[`b979df4`](https://github.com/OpenSaasAU/stack/commit/b979df458ea39ce763dd92aa212fc70be207c416)]:
  - @opensaas/stack-core@0.13.0

## 0.12.1

### Patch Changes

- [#279](https://github.com/OpenSaasAU/stack/pull/279) [`da903a2`](https://github.com/OpenSaasAU/stack/commit/da903a2024993348944017b30155a693c276a53a) Thanks [@borisno2](https://github.com/borisno2)! - make prisma config point to prisma folder

- Updated dependencies []:
  - @opensaas/stack-core@0.12.1

## 0.12.0

### Minor Changes

- [#275](https://github.com/OpenSaasAU/stack/pull/275) [`02e9ab1`](https://github.com/OpenSaasAU/stack/commit/02e9ab1578741e9fd32cbc3a7938c66002c4d5f6) Thanks [@borisno2](https://github.com/borisno2)! - Add calendarDay field type for date-only values in ISO8601 format

  You can now use the `calendarDay` field for storing date values without time components:

  ```typescript
  import { calendarDay } from '@opensaas/stack-core/fields'

  fields: {
    birthDate: calendarDay({
      validation: { isRequired: true }
    }),
    startDate: calendarDay({
      defaultValue: '2025-01-01',
      db: { map: 'start_date' }
    }),
    eventDate: calendarDay({
      isIndexed: true
    })
  }
  ```

  The field:
  - Stores dates in ISO8601 format (YYYY-MM-DD)
  - Uses native DATE type on PostgreSQL/MySQL via `@db.Date`
  - Uses string representation on SQLite
  - Supports all standard field options (validation, database mapping, indexing)

### Patch Changes

- Updated dependencies [[`152e3bc`](https://github.com/OpenSaasAU/stack/commit/152e3bc7e7c703ad981ad54d32f5f7251233e66d), [`02e9ab1`](https://github.com/OpenSaasAU/stack/commit/02e9ab1578741e9fd32cbc3a7938c66002c4d5f6)]:
  - @opensaas/stack-core@0.12.0

## 0.11.0

### Minor Changes

- [#270](https://github.com/OpenSaasAU/stack/pull/270) [`8a476a5`](https://github.com/OpenSaasAU/stack/commit/8a476a563761f3b268ad43269058267871e43b73) Thanks [@relationship({](https://github.com/relationship({)! - Add support for custom database column names via `db.map`

  You can now customize database column names using Prisma's @map attribute, following Keystone's pattern:

  **Regular fields:**

  ```typescript
  fields: {
    firstName: text({
      db: { map: 'first_name' }
    }),
    email: text({
      isIndexed: 'unique',
      db: { map: 'email_address' }
    })
  }
  ```

  **Relationship foreign keys:**

  ```typescript
  fields: {

      ref: 'User.posts',
      db: { foreignKey: { map: 'author_user_id' } },
    })
  }
  ```

  Foreign key columns now default to the field name (not `fieldNameId`) for better consistency with Keystone's behavior.

- [#265](https://github.com/OpenSaasAU/stack/pull/265) [`27a211d`](https://github.com/OpenSaasAU/stack/commit/27a211dbb8c9c3d462cdc8cf2c717386b76548b6) Thanks [@borisno2](https://github.com/borisno2)! - Add automatic Prisma schema formatting after generation

  The `opensaas generate` command now automatically runs `prisma format` after generating the schema file. This ensures consistent formatting of the generated `prisma/schema.prisma` file.

  The formatting step is non-critical - if it fails (e.g., due to missing environment variables or network issues), generation will continue with a warning instead of failing.

  No action required - formatting happens automatically during `pnpm generate`.

### Patch Changes

- Updated dependencies [[`ec53708`](https://github.com/OpenSaasAU/stack/commit/ec53708898579dcc7de80eb9fc9a3a99c45367c9), [`8a476a5`](https://github.com/OpenSaasAU/stack/commit/8a476a563761f3b268ad43269058267871e43b73), [`bbe7f05`](https://github.com/OpenSaasAU/stack/commit/bbe7f051428013b327cbadc5fda7920d5885a6bc), [`ba9bfa8`](https://github.com/OpenSaasAU/stack/commit/ba9bfa80e88f125d00d621e3b7fe8e39ffaeb145), [`38337cc`](https://github.com/OpenSaasAU/stack/commit/38337ccc17a9c3e78b3767bf2422d0ca9ea16230)]:
  - @opensaas/stack-core@0.11.0

## 0.10.0

### Minor Changes

- [#259](https://github.com/OpenSaasAU/stack/pull/259) [`9aa5d8f`](https://github.com/OpenSaasAU/stack/commit/9aa5d8f60578abfdf7c36f3460b61b2fcfea6066) Thanks [@list({](https://github.com/list({), [@relationship({](https://github.com/relationship({)! - Add db.foreignKey configuration for one-to-one relationships

  Fixes issue #258 where one-to-one relationships generated invalid Prisma schemas with foreign keys on both sides. You can now explicitly control which side of a one-to-one relationship stores the foreign key.

  **Usage:**

  ```typescript
  // Specify which side has the foreign key
  lists: {

      fields: {
        account: relationship({
          ref: 'Account.user',
          db: { foreignKey: true }
        })
      }
    }),
    Account: list({
      fields: {
   ref: 'User.account' })
      }
    })
  }
  ```

  **Default behavior (without explicit db.foreignKey):**

  For one-to-one relationships without explicit configuration, the foreign key is placed on the alphabetically first list name. For example, in a `User ↔ Profile` relationship, the `Profile` model will have the `userId` foreign key.

  **Generated Prisma schema:**

  ```prisma
  model User {
    id        String   @id @default(cuid())
    accountId String?  @unique
    account   Account? @relation(fields: [accountId], references: [id])
  }

  model Account {
    id   String @id @default(cuid())
    user User?
  }
  ```

  **Validation:**
  - `db.foreignKey` can only be used on single relationships (not many-side)
  - Cannot be set to `true` on both sides of a one-to-one relationship
  - Only applies to bidirectional relationships (with target field specified)

### Patch Changes

- Updated dependencies [[`9aa5d8f`](https://github.com/OpenSaasAU/stack/commit/9aa5d8f60578abfdf7c36f3460b61b2fcfea6066)]:
  - @opensaas/stack-core@0.10.0

## 0.9.0

### Minor Changes

- [#255](https://github.com/OpenSaasAU/stack/pull/255) [`8489a01`](https://github.com/OpenSaasAU/stack/commit/8489a01623fa61c1590509b88fee40071a18b0ca) Thanks [@borisno2](https://github.com/borisno2)! - Add `extendPrismaSchema` function to database configuration

  You can now modify the generated Prisma schema before it's written to disk using the `extendPrismaSchema` function in your database config. This is useful for advanced Prisma features not directly supported by the config API.

  Example usage - Add multi-schema support for PostgreSQL:

  ```typescript
  export default config({
    db: {
      provider: 'postgresql',
      prismaClientConstructor: (PrismaClient) => {
        const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
        const adapter = new PrismaPg(pool)
        return new PrismaClient({ adapter })
      },
      extendPrismaSchema: (schema) => {
        let modifiedSchema = schema

        // Add schemas array to datasource
        modifiedSchema = modifiedSchema.replace(
          /(datasource db \{[^}]+provider\s*=\s*"postgresql")/,
          '$1\n  schemas = ["public", "auth"]',
        )

        // Add @@schema("public") to all models
        modifiedSchema = modifiedSchema.replace(
          /^(model \w+\s*\{[\s\S]*?)(^}$)/gm,
          (match, modelContent) => {
            if (!modelContent.includes('@@schema')) {
              return `${modelContent}\n  @@schema("public")\n}`
            }
            return match
          },
        )

        return modifiedSchema
      },
    },
    // ... rest of config
  })
  ```

  Common use cases:
  - Multi-schema support for PostgreSQL
  - Custom model or field attributes
  - Prisma preview features
  - Output path modifications

### Patch Changes

- Updated dependencies [[`8489a01`](https://github.com/OpenSaasAU/stack/commit/8489a01623fa61c1590509b88fee40071a18b0ca)]:
  - @opensaas/stack-core@0.9.0

## 0.8.0

### Minor Changes

- [#253](https://github.com/OpenSaasAU/stack/pull/253) [`595aa82`](https://github.com/OpenSaasAU/stack/commit/595aa82ccd93e11454b2a70cbd90e5ace2bb5ae3) Thanks [@list({](https://github.com/list({), [@relationship({](https://github.com/relationship({)! - Add support for flexible relationship refs (list-only refs)

  You can now specify relationship refs using just the list name, without requiring a corresponding field on the target list. This matches Keystone's behavior and simplifies one-way relationships.

  **Bidirectional refs** (existing behavior, still works):

  ```typescript
  lists: {

      fields: {
        posts: relationship({ ref: 'Post.author', many: true }),
      },
    }),
    Post: list({
      fields: {
   ref: 'User.posts' }),
      },
    }),
  }
  ```

  **List-only refs** (new feature):

  ```typescript
  lists: {
    Category: list({
      fields: {
        name: text(),
        // No relationship field needed!
      },
    }),
    Post: list({
      fields: {
        title: text(),
        // Just reference the list name
        category: relationship({ ref: 'Category' }),
      },
    }),
  }
  ```

  The generator automatically creates a synthetic field `from_Post_category` on the Category model with a named Prisma relation to avoid ambiguity. This is useful when you only need one-way access to the relationship.

### Patch Changes

- Updated dependencies [[`595aa82`](https://github.com/OpenSaasAU/stack/commit/595aa82ccd93e11454b2a70cbd90e5ace2bb5ae3)]:
  - @opensaas/stack-core@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [[`6717469`](https://github.com/OpenSaasAU/stack/commit/6717469344f08e1250fed8342a05dd4b08208e92)]:
  - @opensaas/stack-core@0.7.0

## 0.6.2

### Patch Changes

- [#227](https://github.com/OpenSaasAU/stack/pull/227) [`6d7c1a2`](https://github.com/OpenSaasAU/stack/commit/6d7c1a2aee112c3b60588f89bcabd8aeb28886f0) Thanks [@borisno2](https://github.com/borisno2)! - Fix Claude settings format in migrate command to use object for enabledPlugins and path for GitHub marketplace source

- Updated dependencies []:
  - @opensaas/stack-core@0.6.2

## 0.6.1

### Patch Changes

- [#224](https://github.com/OpenSaasAU/stack/pull/224) [`d90b8c0`](https://github.com/OpenSaasAU/stack/commit/d90b8c00ec3b94683e2be8fa80e7ae497c71ae7a) Thanks [@borisno2](https://github.com/borisno2)! - Migrate plugin installation to marketplace architecture, removing need for separate .mcp.json file

- Updated dependencies []:
  - @opensaas/stack-core@0.6.1

## 0.6.0

### Minor Changes

- [#223](https://github.com/OpenSaasAU/stack/pull/223) [`7f7270e`](https://github.com/OpenSaasAU/stack/commit/7f7270e5fa8e7ba6df4d4dedb9dfa1351756312a) Thanks [@borisno2](https://github.com/borisno2)! - Migrate AI migration assistant to Claude Code plugin system

  The `opensaas migrate --with-ai` command now uses a Claude Code plugin instead of writing templated files to the user's `.claude/` directory. This provides several benefits:

  **What changed:**
  - Migration assistant is now distributed as a plugin within `@opensaas/stack-cli`
  - CLI writes project metadata to `.claude/opensaas-project.json` instead of templated files
  - Plugin is automatically configured in `.claude/settings.json`

  **Benefits:**
  - Migration assistant content can be updated by upgrading `@opensaas/stack-cli`
  - Cleaner separation between generic content and project-specific data
  - Easier to maintain and update migration logic

  **Usage remains the same:**

  ```bash
  npx @opensaas/stack-cli migrate --with-ai
  ```

  Then open the project in Claude Code and ask: "Help me migrate to OpenSaaS Stack"

  The migration assistant agent will read your project metadata and guide you through the migration wizard as before.

### Patch Changes

- [#219](https://github.com/OpenSaasAU/stack/pull/219) [`f2d78e5`](https://github.com/OpenSaasAU/stack/commit/f2d78e5946c28be0b9ae61dae76ee2534b9a4efc) Thanks [@borisno2](https://github.com/borisno2)! - Fix MCP configuration and add agent/skill support to migration wizard

  **MCP Configuration:**
  - Fixed MCP server configuration to use correct `.mcp.json` format at project root
  - Added `type: 'stdio'` field and proper structure
  - Added `-y` flag to npx command for auto-accepting prompts

  **Migration Assistant Agent:**
  - Added required YAML frontmatter with `name`, `description`, `model`, and `skills` fields
  - Agent is now properly discoverable by Claude Code
  - Auto-loads the `opensaas-migration` skill for expert knowledge

  **Migration Skill:**
  - Created comprehensive `opensaas-migration` skill with migration guidance
  - Includes access control patterns, field type mappings, database configs
  - Provides migration checklist and best practices
  - Stored in `.claude/skills/opensaas-migration/SKILL.md`

  When users run `opensaas migrate --with-ai`, they now get a fully configured Claude Code environment with agents, skills, and MCP tools working together.

- Updated dependencies []:
  - @opensaas/stack-core@0.6.0

## 0.5.0

### Minor Changes

- [#198](https://github.com/OpenSaasAU/stack/pull/198) [`c84405e`](https://github.com/OpenSaasAU/stack/commit/c84405e669e03dbc38fb094e813a105abbb448b8) Thanks [@borisno2](https://github.com/borisno2)! - Add Phase 2 MCP migration tools and enhanced documentation provider

  This update adds 6 new MCP server tools to assist with project migration:

  **New MCP Tools:**
  - `opensaas_start_migration`: Start migration wizard for Prisma/Keystone/Next.js projects
  - `opensaas_answer_migration`: Answer migration wizard questions
  - `opensaas_introspect_prisma`: Analyze Prisma schema files
  - `opensaas_introspect_keystone`: Analyze KeystoneJS config files
  - `opensaas_search_migration_docs`: Search local and online documentation
  - `opensaas_get_example`: Retrieve curated code examples

  **Enhanced Documentation Provider:**
  - Local CLAUDE.md file search with relevance scoring
  - Curated code examples for common patterns (blog-with-auth, access-control, relationships, hooks, custom-fields)
  - Project-specific migration guides for Prisma, KeystoneJS, and Next.js

  **Dependencies:**
  - Added `fs-extra` and `glob` for local file search capabilities
  - Added `@types/fs-extra` for TypeScript support

  Note: Migration wizard and introspectors are currently stubs and will be fully implemented in future phases.

- [#196](https://github.com/OpenSaasAU/stack/pull/196) [`2f364b6`](https://github.com/OpenSaasAU/stack/commit/2f364b6b8295dfd205dfb3d0a11eb0bdb5ea2621) Thanks [@borisno2](https://github.com/borisno2)! - Add `opensaas migrate` CLI command for project migration

  Implements a new CLI command that helps users migrate existing Prisma, KeystoneJS, and Next.js projects to OpenSaaS Stack. The command provides both automatic project analysis and AI-guided migration through Claude Code integration.

  Features:
  - Auto-detects project type (Prisma, KeystoneJS, Next.js)
  - Analyzes existing schema (models, fields, database provider)
  - Optional AI-guided migration with `--with-ai` flag
  - Creates `.claude/` directory with migration assistant agent
  - Generates command files for schema analysis and config generation
  - Provides clear next steps and documentation links

  Usage:

  ```bash
  opensaas migrate           # Analyze current project
  opensaas migrate --with-ai # Enable AI-guided migration
  opensaas migrate --type prisma # Force project type
  ```

### Patch Changes

- Updated dependencies []:
  - @opensaas/stack-core@0.5.0

## 0.4.0

### Minor Changes

- [#170](https://github.com/OpenSaasAU/stack/pull/170) [`3c4db9d`](https://github.com/OpenSaasAU/stack/commit/3c4db9d8318fc73d291991d8bdfa4f607c3a50ea) Thanks [@list({](https://github.com/list({)! - Add support for virtual fields with proper TypeScript type generation

  Virtual fields are computed fields that don't exist in the database but are added to query results at runtime. This feature enables derived or computed values to be included in your API responses with full type safety.

  **New Features:**
  - Added `virtual()` field type for defining computed fields in your schema
  - Virtual fields are automatically excluded from database schema and input types
  - Virtual fields appear in output types with full TypeScript autocomplete
  - Virtual fields support `resolveOutput` hooks for custom computation logic

  **Type System Improvements:**
  - Generated Context type now properly extends AccessContext from core
  - Separate Input and Output types (e.g., `UserOutput` includes virtual fields, `UserCreateInput` does not)
  - UI components now accept `AccessContext<any>` for better compatibility with custom context types
  - Type aliases provide convenience (e.g., `User = UserOutput`)

  **Example Usage:**

  ```typescript
  import { list, text, virtual } from '@opensaas/stack-core'

  export default config({
    lists: {

        fields: {
          name: text(),
          email: text(),
          displayName: virtual({
            type: 'string',
            hooks: {
              resolveOutput: async ({ item }) => {
                return `${item.name} (${item.email})`
              },
            },
          }),
        },
      }),
    },
  })
  ```

  The `displayName` field will automatically appear in query results with full TypeScript support, but won't be part of create/update operations or the database schema.

### Patch Changes

- [#154](https://github.com/OpenSaasAU/stack/pull/154) [`edf1e5f`](https://github.com/OpenSaasAU/stack/commit/edf1e5fa4cfefcb7bc09bf45d4702260e6d0d3aa) Thanks [@renovate](https://github.com/apps/renovate)! - Update dependency chokidar to v5

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

- Updated dependencies [[`527b677`](https://github.com/OpenSaasAU/stack/commit/527b677ab598070185e23d163a9e99bc20f03c49), [`929a2a9`](https://github.com/OpenSaasAU/stack/commit/929a2a9a2dfa80b1d973d259dd87828d644ea58d), [`3c4db9d`](https://github.com/OpenSaasAU/stack/commit/3c4db9d8318fc73d291991d8bdfa4f607c3a50ea)]:
  - @opensaas/stack-core@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies []:
  - @opensaas/stack-core@0.3.0

## 0.2.0

### Minor Changes

- [#107](https://github.com/OpenSaasAU/stack/pull/107) [`f4f3966`](https://github.com/OpenSaasAU/stack/commit/f4f3966faedba07d2cf412fab826d81e30c63a6c) Thanks [@borisno2](https://github.com/borisno2)! - # Add MCP Server for AI-Assisted Development

  ## New Features

  ### CLI Package (@opensaas/stack-cli)
  - **New `opensaas mcp` command group** for AI-assisted development:
    - `opensaas mcp install` - Install MCP server in Claude Code
    - `opensaas mcp uninstall` - Remove MCP server from Claude Code
    - `opensaas mcp start` - Start MCP server directly (for debugging)
  - **Feature-driven development tools**:
    - Interactive feature implementation wizards (authentication, blog, comments, file-upload, semantic-search)
    - Live documentation search from stack.opensaas.au
    - Code generation following OpenSaaS best practices
    - Smart feature suggestions based on your current app
    - Config validation
  - **MCP tools available in Claude Code**:
    - `opensaas_implement_feature` - Start feature wizard
    - `opensaas_feature_docs` - Search documentation
    - `opensaas_list_features` - Browse available features
    - `opensaas_suggest_features` - Get personalized recommendations
    - `opensaas_validate_feature` - Validate implementations

  ### create-opensaas-app
  - **Interactive MCP setup prompt** during project creation
  - Option to enable AI development tools automatically
  - Automatic installation of MCP server if user opts in
  - Helpful instructions if MCP installation is declined or fails

  ## Installation

  Enable AI development tools for an existing project:

  ```bash
  npx @opensaas/stack-cli mcp install
  ```

  Or during project creation:

  ```bash
  npm create opensaas-app@latest my-app
  # When prompted: Enable AI development tools? → yes
  ```

  ## Benefits
  - **Build apps faster**: Describe what you want to build, get complete implementations
  - **Feature-driven development**: Work with high-level features instead of low-level config
  - **Best practices baked in**: Generated code follows OpenSaaS Stack patterns
  - **Live documentation**: Always up-to-date docs from the official site
  - **Single toolkit**: All developer commands in one CLI

  ## Example Usage

  With Claude Code installed and the MCP server enabled, you can:

  ```
  You: "I want to build a food tracking app"

  Claude Code uses MCP tools to:
  1. Ask clarifying questions about requirements
  2. Implement authentication feature (wizard)
  3. Create custom Food and FoodLog lists
  4. Generate complete code with UI and access control
  5. Provide testing and deployment guidance
  ```

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

### Patch Changes

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

- Updated dependencies [[`fcf5cb8`](https://github.com/OpenSaasAU/stack/commit/fcf5cb8bbd55d802350b8d97e342dd7f6368163b), [`3851a3c`](https://github.com/OpenSaasAU/stack/commit/3851a3cf72e78dc6f01a73c6fff97deca6fad043), [`f4f3966`](https://github.com/OpenSaasAU/stack/commit/f4f3966faedba07d2cf412fab826d81e30c63a6c)]:
  - @opensaas/stack-core@0.2.0

## 0.1.7

### Patch Changes

- 372d467: Add sudo to context to bypass access control
- Updated dependencies [372d467]
  - @opensaas/stack-core@0.1.7

## 0.1.6

### Patch Changes

- 39996ca: Fix missing StoredEmbedding type import in generated types. Fields can now declare TypeScript imports needed for their types via the new `getTypeScriptImports()` method. This resolves the type error where `StoredEmbedding` was referenced but not imported in the generated `.opensaas/types.ts` file.
- 39996ca: Add plugin mechanism
- Updated dependencies [39996ca]
- Updated dependencies [39996ca]
  - @opensaas/stack-core@0.1.6

## 0.1.5

### Patch Changes

- 17eaafb: Update package urls
- Updated dependencies [17eaafb]
  - @opensaas/stack-core@0.1.5

## 0.1.4

### Patch Changes

- d2d1720: clean up dependency
- Updated dependencies [d013859]
  - @opensaas/stack-core@0.1.4

## 0.1.3

### Patch Changes

- @opensaas/stack-core@0.1.3
- @opensaas/stack-mcp@0.1.3

## 0.1.2

### Patch Changes

- 7bb96e6: Fix up init command to work
  - @opensaas/stack-core@0.1.2
  - @opensaas/stack-mcp@0.1.2

## 0.1.1

### Patch Changes

- f8ebc0e: Add base mcp server
- 045c071: Add field and image upload
- Updated dependencies [9a3fda5]
- Updated dependencies [f8ebc0e]
- Updated dependencies [045c071]
  - @opensaas/stack-core@0.1.1
  - @opensaas/stack-mcp@0.1.1
