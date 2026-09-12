# @opensaas/stack-core

## 0.44.0

### Minor Changes

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - `connect` on the foreign-key-owning field, with `null` as its counterpart

  A write payload's `field: { connect: { id } }` is lowered onto the column the
  row actually carries. The terminal issues the reachability query first — the
  target list's `query` access ANDed with the identity criterion — then writes
  the scalar foreign key, both inside the terminal's origin. `field: null`
  clears the same column, which is what replaces nested `disconnect`
  (ADR-0050).

  ```typescript
  await context.db.Post.create({ data: { title: 'Hello', author: { connect: { id: userId } } } })
  await context.db.Post.update({ where: { id }, data: { author: null } })
  ```

  An unreadable target and one that does not exist are the same answer: the
  write returns `null`, with no error and nothing written, so a foreign key
  cannot become a probing oracle.

  Three refusals name what a payload may carry on a relationship key:

  - `NonOwningRelationInputError` — relation input on a field that owns no
    foreign key (an inverse to-many, the non-owning half of a one-to-one, a
    junction list's inverse, a synthetic back-relation). The generated input
    types carry no member for those, so this is the runtime half of a compile
    error.
  - `MalformedRelationInputError` — an owning field carrying neither
    `{ connect: { id } }` nor `null`.
  - `RelationTargetMissingError` — a `connect` whose ref names a list the config
    does not declare.

  The relationship table's remove control follows the same rule: removing a row
  through a to-one back-reference assigns `null` to it and the row survives,
  while removing a junction row deletes it under that list's own delete access.

  A relationship whose foreign key lives on the related row — a to-many, or the
  non-owning half of a one-to-one — is not writable through the surfaces that
  carry a payload for a single row, so neither surface offers it any more:

  - The admin item form renders it read-only, stating that the related record
    holds the link, instead of a picker whose selection had nowhere to go. An
    item form ignores a change for any field it rendered read-only, so a field
    component that does not honour the read mode it is handed cannot stage a
    value the submit transform would then have to drop.
  - The standalone `ItemCreateForm` / `ItemEditForm` take optional `listKey` and
    `config` props. Given both, they mark the non-owning half of a one-to-one
    the same way — a field config alone cannot answer which end holds the
    column, so without them that end still renders a picker whose selection the
    engine refuses at save.
  - The MCP create/update tools omit it from the advertised `data` properties,
    so a client cannot spell a call that could only fail.

  On the end that does hold the column, the MCP schema now advertises `null`
  alongside `connect`, so both spellings of an edge the engine accepts are
  describable through the tool surface — and only those: the object form
  requires `connect`, requires `id` within it, and admits no other key, matching
  what the engine lowers rather than leaving the difference to prose.

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

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - A plugin's hooks survive on a list that declares hooks of its own

  `extendList`'s hook merge copied only `resolveInput`, `validateInput`, `beforeOperation`
  and `afterOperation`. When a list declared any hook itself, every other kind a plugin
  added — `validate`, `beforeTransaction`, `afterTransaction` — was dropped on the floor, so
  the plugin's side of the list silently stopped running:

  ```typescript
  Article: list({
    fields: { content: searchable(text()) },
    // Before: this one hook made ragPlugin's afterTransaction disappear, and the
    // row was persisted with a null embedding, with nothing said.
    hooks: { resolveInput: async ({ resolvedData }) => resolvedData },
  })
  ```

  All hook kinds now merge, the list's own running first and the plugin's after it — the
  order `resolveInput` already used.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - A denied write to a multi-column field now throws instead of silently dropping the key

  `splitMultiColumnFields` — the phase that turns a multi-column field's logical value into
  its physical columns — dropped the key and continued when field-level write access denied
  it, so the write "succeeded" while doing less than asked. `filterWritableFields` has
  thrown for a denied single-column field since [#568](https://github.com/OpenSaasAU/stack/issues/568); this brings the multi-column path in
  line with it.

  ```typescript
  // A field whose write is denied — @opensaas/stack-storage's multi-column
  // image()/file(), or @opensaas/stack-rag's embedding()
  await context.db.Article.update({
    where: { id },
    data: { contentEmbedding: myVector },
  })
  // Before: resolved successfully, and the vector was discarded.
  // Now:    throws ValidationError
  //         'Cannot update "contentEmbedding": field-level access denied.'
  ```

  Sudo is unchanged: `checkFieldAccess` returns `true` under sudo, so an elevated write never
  reaches the throw. A caller that relied on the silent drop to pass a denied field through
  an ordinary write must stop sending the key, or write under `sudo()`.

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

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - MCP's `tools/list` now gates its published vocabulary at field grain, per session

  A field whose access rule the session alone decides — a rule that never reaches
  into the row or the payload — and which denies, no longer appears in what MCP
  advertises: not in the `query` tool's `fields` projection at either level, and
  not in the `create`/`update` tools' `data` schemas. A rule that does reach into
  the row stays advertised, because it may pass for rows the session owns.

  ```typescript
  Memo: list({
    fields: {
      title: text(),
      // Row-independent: never advertised to a non-admin session.
      internal: text({ access: { read: () => false, update: () => false } }),
      // Row-dependent: stays advertised to everyone.
      ownerNotes: text({
        access: { read: ({ session, item }) => item?.ownerId === session?.userId },
      }),
    },
  })
  ```

  A list whose `create` needs a field the session can never write no longer
  advertises a `create` tool at all, rather than offering one that refuses every
  call. Naming a field the schema withheld — including a relation whose target
  list this session cannot reach — is refused with the same message an unknown
  field name gets, so the refusal discloses nothing the schema held back.

  A field rule that throws while `tools/list` decides whether to advertise the
  field costs that one field its advertisement rather than the whole listing, and
  is reported on the server console. The rule still throws when the field is
  actually read or written.

  Classification runs per session and is not cached. No configuration is
  required — the behaviour follows from the field-level access rules already in
  your config.

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

- [#1468](https://github.com/OpenSaasAU/stack/pull/1468) [`5aa3815`](https://github.com/OpenSaasAU/stack/commit/5aa38159fe5a54f3f0c294cc47f439ec9175d544) Thanks [@borisno2](https://github.com/borisno2)! - Fix a to-one relation's foreign-key column colliding with the relation's own alias ([#1236](https://github.com/OpenSaasAU/stack/issues/1236)). This broke nested to-one includes (`column reference "…" is ambiguous`) and could make a field-level rule that reads `item.<relation>Id` directly answer wrong — an allow flipping to a deny, or a deny flipping to a **disclosure**, depending on whether the caller happened to include the relation.

  The fix changes the foreign key's default physical column name, which is a **schema change** for any list using a to-one relationship that did not set `db.foreignKey.map` explicitly: the physical column moves from the relation's own name (`author`) to the contract member's name (`authorId`) — the two are no longer forced to disagree.

  Before deploying this version against an existing database, rename each affected column so the deploy reconciles against a schema that already matches (no destructive diff for a rename-detection tool to get wrong):

  ```sql
  ALTER TABLE "Post" RENAME COLUMN "author" TO "authorId";
  ```

  Run one such statement per to-one relationship field that relies on the default (i.e. every one that does not set `db.foreignKey.map`). There is no way to opt out and keep the old column name — `db.foreignKey.map` set to the field's own name is now a generate-time refusal, because that is exactly the collision this release closes.

  The read-boundary workaround this collision required (`restoreForeignKeys` and its helpers, and `NestedToOneIncludeError`) is removed now that the collision cannot occur — a nested to-one include just works:

  ```typescript
  await context.db.User.include('posts', (posts) => posts.include('author')).all()
  ```

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - The nested-write access gap reported in [#1384](https://github.com/OpenSaasAU/stack/issues/1384) is closed by refusal, not by gating

  Nested `set`, `updateMany` and `deleteMany` under a relationship key used to
  reach the database as an unchecked pass-through: the target list's access was
  never consulted, no hooks ran, and an unscoped `where` could reach rows well
  outside the parent's own subtree. Nested `disconnect` could name a target row
  the caller could not read.

  Both are closed here by ADR-0050 rather than by per-kind access machinery:
  `create`, `update`, `delete`, `connectOrCreate`, `disconnect`, `set`,
  `updateMany` and `deleteMany` under a relationship key are refused with
  `NestedRelationInputError`. `connect` is not among them — it lowers onto a
  foreign-key column the row being written owns, and survives unchanged. The
  refusal is unconditional — `sudo()` does not lift it — which is strictly
  stronger than the interim non-sudo-only refusal [#1385](https://github.com/OpenSaasAU/stack/issues/1385) shipped on the previous
  line.

  Clearing an edge is `null` on the relationship field **that owns the foreign
  key**. On a field that owns none — a to-many, the non-owning half of a
  one-to-one, a synthetic back-relation — `null` is refused in turn with
  `NonOwningRelationInputError`, exactly as `connect` is there, so clearing that
  edge is an update against the target list:

  ```typescript
  // `Author.posts` owns no column, so the write goes to `Post`:
  await context.db.Post.update({ where: { id: postId }, data: { author: null } })
  ```

  Every other refused kind is likewise a write against the target list, wrapped in
  `context.transaction()` when it must land atomically.

  See `rugged-terminals-persist.md` for the full write-surface change.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - MCP's `fields` projection is a translator onto the secured surface

  The `query` tool's `fields` argument keeps the wire shape it has always had, and now lowers onto the secured read instead of a Prisma `include` bag that MCP trimmed by hand afterwards. Root scalars and virtuals become one `.select()` with `id` forced at every level; a relation becomes one `.include()` refinement carrying its own selection, `where`, `orderBy` and per-parent page under the standing nested caps; and `count: true` becomes a single `combine({ items, count })` — one include, one correlated subquery, and the `{ items, count }` shape the tool already returned, reduced to the bare number when the caller asked for the count alone. The count is taken off the unpaged relation, so it counts the relation rather than the page beside it.

  A projected row now also carries `createdAt` and `updatedAt` alongside `id`, whether or not the caller named them. They are system fields, always readable and outside access control, and MCP gets them because a projected row is the engine's to shape rather than something MCP trims afterwards.

  Negative `take` and `skip` are refused at the root of the `query` tool as they already were inside a relation entry, rather than reaching the driver.

  `where` and `orderBy`, at the root and inside a relation entry, are the Where vocabulary, and the tools' schema descriptions say which operators that is:

  ```jsonc
  {
    "where": { "title": { "contains": "release" }, "comments": { "some": { "approved": true } } },
    "orderBy": { "title": "asc" },
    "fields": {
      "title": true,
      "comments": {
        "fields": { "body": true },
        "where": { "approved": true },
        "take": 5,
        "count": true,
      },
    },
  }
  ```

  The `query`, `update` and `delete` tools' `where.id` is typed from the list's own id strategy: an `int autoincrement` list advertises an integer, takes `"3"` off the wire as `3`, and answers a malformed id exactly as a missing row is answered.

  `pickFields`, the MCP field-selection type, `projectMcpResult` and the `_count` folding are gone — the engine's exact selection is the only authority on what a caller receives, and the projection module does no post-query trimming of its own.

  A relation's rows may now be `combine`d beside a reducer on the secured surface — `include('posts', (posts) => posts.combine({ items: posts.limit(5), total: posts.count() }))` — with those rows going through Field Visibility exactly as an unreduced relation's do. At most one branch may be the rows.

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

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - `getContractField` replaces the PSL pair at the field self-containment gate

  `validateConfigFields` — the check `pnpm generate` runs over every stored field before it
  reads any contract — used to require the PSL-shaped `getPrismaType` and `getTypeScriptType`
  from every non-virtual field. Those two describe one Prisma column and one TypeScript type,
  and neither is read by anything on the contract-era generators: columns come from
  `getContractField`, and the emitted types come from `outputType`/`inputType`, else from
  the column's own codec. Both members are removed from the field-builder contract in this
  same release.

  For a field spanning several columns of different types there was no honest single
  `getPrismaType` to give, so the gate was forcing field packages to declare a plausible but
  false one purely to pass it — `@opensaas/stack-rag`'s `embedding()` is a `vector(n)` column
  plus a `jsonb` column, and had to claim `Json?`.

  `getContractField` is now what satisfies the gate for a stored field, with no PSL method in
  the picture at all. `getZodSchema` is still required of it — no contract supplies
  validation — and a field with no single column to be typed from must also declare
  `outputType`. That is decided by the descriptor: `kind: 'columns'`, or `kind: 'computed'`
  whether or not the builder also sets the `virtual` flag core's own `virtual()` sets
  alongside it. A relationship field needs only `getContractField`. A stored field that
  declares no contract now fails the gate outright: there is no PSL pair left to satisfy it
  with.

  ```typescript
  // A field package can now describe its columns once, to the contract:
  export function myField(): MyField {
    return {
      type: 'myField',
      getZodSchema: () => /* … */,
      getContractField: (fieldName) => ({ kind: 'columns', columns: [/* … */] }),
      outputType: "import('@my/pkg').MyValue | null",
      inputType: "import('@my/pkg').MyValue | null",
    }
  }
  ```

  This affects field packages, not applications: a field package migrates by describing its
  columns to `getContractField` once, and no application config has to be edited.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Add `.include()` refinements to the secured read surface

  `context.db.<List>.include(name, refine?)` reaches one hop into a relation and returns a new query value. The refinement is a related read with `where`, `orderBy`, `limit`, `offset` and a nested `include` — and no terminal, because the parent's terminal is the only thing that runs.

  ```typescript
  const users = await context.db.User.include('posts', (posts) =>
    posts
      .where({ published: { equals: true } })
      .orderBy({ createdAt: 'desc' })
      .limit(5),
  ).all()
  ```

  The related list's `query` access rides in as a refinement `where`, so a to-one the session cannot read comes back `null` and a to-many `[]` — with the key present and the parent row kept, whatever the session. Every key inside a refinement, and every synthetic back-relation (`from_<SourceList>_<field>`), is validated and scoped exactly as a top-level one; a relation whose own `read` rule is row-independent and denies is left out of the include before the query unless a live declared dependency set names it, and Field Visibility re-checks every relation it is handed regardless. An include tree deeper than `READ_INCLUDE_MAX_DEPTH` is refused with `AccessScopeDepthExceededError`.

  A to-one's foreign-key column follows the relation's own visibility: it carries the related row's id when the relation is visible and `null` when it is not — scoped away by the Access Filter or stripped by Field Visibility alike — whatever `db: { foreignKey: { map } }` names the column. A relationship field the session cannot read is equally unqueryable under its foreign key, so `where({ authorId })` is refused exactly as an undeclared key is.

  Naming the same relation twice in one read throws `DuplicateIncludeError` — neither merging the two refinements nor letting one win is a safe silent answer.

  A read's include narrowing is derived from the contract's relation graph: a to-one reads as `Row<Target> | null` whatever its foreign key's nullability, a to-many as `Row<Target>[]`.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Add the origin module — the ambient Engine stamp, its tripwire and its refusal error

  `@opensaas/stack-core/origin` is the one component a declared surface installs to mark the
  queries it executes, and the one the ORM refuses unmarked queries with (ADR-0059). The
  generated context and the test harness install the same value.

  ```ts
  import { originTripwire, withOrigin, preserveOrigin } from '@opensaas/stack-core/origin'

  // Installed once, where the client is constructed.
  const client = postgres({ contractJson, middleware: [originTripwire] })

  // A surface that materialises enters the origin around exactly its ORM call,
  // with the await inside — hooks therefore run outside the mark. The terminal
  // returns Prisma's `AsyncIterableResult`, a `PromiseLike` rather than a
  // `Promise`, which is what `withOrigin` accepts.
  const rows: Post[] = await withOrigin('engine', () => orm.Post.where({ id }).all())

  // A surface that hands a lazy result back wraps it, so `then`, `toArray`,
  // `first`, `firstOrThrow` and the async iterator's `next` each re-enter the
  // scope and the query executes marked wherever the caller consumes it. The
  // caller's own continuations still run under the caller's origin.
  return preserveOrigin('unsafe', client.runtime().query(plan))
  ```

  Any plan compiled with no origin in scope throws `UnmarkedQueryError` from `beforeCompile`,
  in every environment — there is no warn mode and no dev-only mode. The store carries
  `'engine' | 'unsafe'` and nothing else: no session, no policy. Scoping a query to a session
  stays an ordinary rebind of the secured context.

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

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - A directly-written foreign key now takes the same reachability check `connect` does, so the two spellings of one edge give the same answer ([#1331](https://github.com/OpenSaasAU/stack/issues/1331)).

  Writing the column (`data: { authorId }`) and writing the relationship field (`data: { author: { connect: { id } } }`) are the same edge, and ADR-0050 pairs both access components with it: the owning field's write access, and query access on the target row evaluated in the database. Only the first half applied to the column, so a target the caller could not see was linked anyway, and a target that did not exist raised a database error instead — success versus an error told an invisible row from an absent one, which is the probing oracle the check exists to close.

  Both spellings now run one implementation, in `lowerRelationInput`. An unreadable target and an absent one are the same silent `null` for either, `sudo` bypasses the target's `query` rule for both and the row's existence for neither, and the owning field's write access still applies first.

  ```typescript
  // With Author.query denying this session, both are now null.
  await context.db.Post.create({ data: { title: 't', author: { connect: { id } } } })
  await context.db.Post.create({ data: { title: 't', authorId: id } })
  ```

  A foreign-key column carrying something that is neither a row id nor `null` — an ORM scalar wrapper such as `{ set: … }` — is now refused with `MalformedForeignKeyInputError` rather than reaching the driver, since lowering it would write the edge without the reachability query. Like every other payload-shape refusal, it is raised before the transaction opens, so a malformed payload runs no hooks.

  A payload spelling one edge both ways is refused with the new `ConflictingRelationInputError`. The generated input type is an intersection of independent optional members, so `{ author: { connect: { id: a } }, authorId: b }` type-checks; only one of the two values could reach the row, and the discarded one was still checked for reachability — so an unreadable `b` denied a write whose applied value, `a`, was perfectly reachable. Write one spelling.

  ```typescript
  // Refused: two spellings of one edge.
  await context.db.Post.create({ data: { author: { connect: { id: a } }, authorId: b } })
  ```

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

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - `.select()` is honoured exactly, and the fragment API is deleted

  The breaks below are real and are documented in full. They ship on `minor`
  because the whole Prisma 8 line is released as one major at the end of it,
  which is the convention every other changeset on this line follows.

  A read on the secured surface is narrowed with `.select(...fields)`, which the
  engine honours exactly: it widens the query by the declared dependency sets of
  the computed fields the read will return and by anything a row-dependent field
  `read` rule has to see, then strips `widened ∖ caller` as a recursive set
  difference at every nesting level. `.select()` replaces on call rather than
  accumulating, names this list's own fields only, and a computed field is
  selectable whether or not the columns it reads were named. An `.include()`
  refinement carries its own `.select()`.

  ```typescript
  // `wordCount` declares `needs: ['body']`. The engine reads `body`, computes the
  // field, and `body` is not in the result — the caller did not ask for it.
  const rows = await context.db.Post.select('wordCount')
    .include('author', (author) => author.select('name'))
    .all()
  ```

  `.select()` is on the generated typed surface, so a projected read's row type
  is exactly the keys it named plus the list's system fields — an unselected
  column, and anything the engine widened the query by, is a compile error rather
  than an absent value. A relation named in `.select()` is refused at compile
  time and, at runtime, with `RelationSelectError` (now exported from the package
  root).

  `.limit(count)` joins the composed read as well, bounding `.all()`.

  Relation-valued `needs` are now folded into the read on the new terminals, so
  `.all()` / `.first()` and the legacy read path agree on a computed field with a
  relation dependency.

  Two behaviours change on every read path, per ADR-0051:

  - **A `resolveOutput` hook's `item` is exactly its own declared dependency set
    plus the list's system fields.** A hook that reads a key it did not declare in
    `needs` now finds nothing there. Migration: find `resolveOutput` hooks whose
    `item` reads a key absent from that field's `needs`, and declare it.
  - **A declaration outranks a caller-facing `read` denial** on the same column or
    relation. The value reaches the hook and is still stripped before the caller
    sees it, so adding a `read` rule elsewhere can no longer silently change a
    computed field's value — and `needs: ['passwordHash']` is a deliberate way to
    surface a denied column's derived value.

  `defineFragment`, `runQuery`, `runQueryOne`, `ResultOf`, `RelationSelector`,
  `QueryArgs`, `Fragment`, `FieldSelection`, `buildInclude`, `pickFields` and the
  `query:` argument on `findMany` / `findFirst` / `findUnique` are removed.

  Migration:

  ```typescript
  // Before
  const postFragment = defineFragment<Post>()({ id: true, title: true } as const)
  const posts = await context.db.post.findMany({ query: postFragment, where: { published: true } })

  // After
  const posts = await context.db.Post.where({ published: { equals: true } })
    .select('title')
    .all()
  ```

  A nested fragment or `RelationSelector` becomes an `.include()` refinement:

  ```typescript
  // Before
  defineFragment<Post>()({
    id: true,
    comments: { query: commentFragment, where: { approved: true }, take: 5 },
  } as const)

  // After
  context.db.Post.select('title').include('comments', (comments) =>
    comments
      .where({ approved: { equals: true } })
      .limit(5)
      .select('body'),
  )
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

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - `richText()` is generic over `TTypeInfo`, so it composes with a typed list

  Every other field builder — core's `text()`/`json()`, storage's `file()`/`image()` — carries the list's `TypeInfo` through, but `richText()` was pinned to the default. A field declared inside a `list<Lists.Article.TypeInfo>()` therefore failed to type-check with `Type 'string' is not assignable to type '"Article"'`, and the only way to use the field was to drop the generated TypeInfo from the list.

  ```ts
  import { richText } from '@opensaas/stack-tiptap/fields'
  import type { Lists } from '@/.opensaas/lists'

  Article: list<Lists.Article.TypeInfo>({
    fields: {
      // now infers TTypeInfo from the surrounding list, so the field's own
      // hooks see `listKey: 'Article'` and the list's field keys
      content: richText({ validation: { isRequired: true } }),
    },
  })
  ```

  No call-site change is required: the parameter is inferred, and an untyped `list({ … })` keeps the previous default.

  A required `richText()` field can also be left out of a partial update again. Its update schema was `z.union([z.any(), z.undefined()])`, which is still a _required_ key inside `z.object()`, so any update that did not mention the field — editing only an article's title, say — was refused with `expected nonoptional, received undefined`. The schema is now `.optional()`, matching core's `json()`; a present `null` is still rejected, because required means non-null.

  The matching hole on **create** is closed too. The create schema was a bare `z.any()`, which inside `z.object()` rejects an absent key but accepts a present `null` or explicit `undefined` — so a required field could be created empty and the write reached a non-nullable column with nothing in it. It now carries the same refinement core's `json()` uses.

  `TiptapField` no longer resets the document while you type. Its `onChange` was typed as `UseEditorOptions['onUpdate']` and handed the whole editor-update payload straight to the field's `onChange`, rather than the JSON value the field stores; the props are now `value: JSONContent | null` and `onChange: (value: JSONContent) => void`, and the component calls `editor.getJSON()` itself. The accompanying `useEffect` compared `value` against `editor.getJSON()` by identity — `getJSON()` allocates a fresh object every call, so the check never matched and `setContent` re-ran on every keystroke, dropping the caret. It now short-circuits on the object it last emitted, and otherwise compares the serialised forms, so it fires only on a genuinely external change.

  **`TiptapField` also no longer reports an edit nobody made.** Two Tiptap calls emit an `update` by default, and this component forwarded both to `onChange`:

  - `setContent(content)` — `emitUpdate` defaults to `true`, so mounting with a `null` value pushed `{"type":"doc","content":[{"type":"paragraph"}]}` into form state;
  - `setEditable(editable)` — its second argument is `emitUpdate`, also defaulted to `true`, so merely becoming editable counted as a content change.

  Between them, creating a record while touching neither rich-text field submitted both as empty documents: an **optional** `richText()` column was written an empty doc instead of `null`, and a **required** one was satisfied without the user typing anything. Both calls now pass `false`, and a suite covers mount, editability changes, the controlled keystroke round trip, an externally reloaded row, and a form resetting the field to `null`.

  `formatFieldName` is now exported from `@opensaas/stack-core/extend`, the third-party field-authoring surface:

  ```ts
  import { formatFieldName } from '@opensaas/stack-core/extend'

  formatFieldName('internalNotes') // 'Internal Notes'
  ```

  `richText()` uses it, so its validation messages address a field the same way core's `json()` does — a form carrying both no longer says `content is required` for one and `Content is required` for the other.

  `@opensaas/stack-tiptap` gains a test suite (`pnpm test`); it had none. It runs under `happy-dom` so the component's behaviour is covered against a real ProseMirror document, not just the schema.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - The write terminals run over the rc.8 collection, and nested relation input leaves the payload

  `create`, `update` and `delete` now reach the database through the Prisma 8
  collection itself — `collection.create(row)`, `collection.where(…).update(row)`,
  `collection.where(…).delete()` — instead of the Prisma 7 delegate names. Every
  write still opens a transaction, and the phase order is unchanged: operation
  access outside the transaction, then hooks, validation, writable-field
  filtering, persistence, after-hooks and Field Visibility.

  `update` and `delete` target a row by its identity and nothing else. The engine
  lowers `id` alone into a write's predicate, so a `where` naming another column —
  a secondary unique one included — is now a compile error against
  `ListIdentityWhere`, and a thrown caller-shape error at runtime for a payload
  that arrived untyped. It never silently writes nothing:

  ```typescript
  // Compile error, and a throw at runtime: `email` selects no row to write.
  await context.db.User.update({ where: { email: 'a@b.com' }, data: { name: 'Ada' } })

  // Find the row, then write it by its id.
  const user = await context.db.User.findUnique({ where: { email: 'a@b.com' } })
  if (user) await context.db.User.update({ where: { id: user.id }, data: { name: 'Ada' } })
  ```

  `update` and `delete` now merge the list's Access Filter into the predicate of
  the write itself, beside the row's identity, so the statement acts on the same
  rows the read would return:

  ```typescript
  Post: list({
    access: {
      operation: {
        update: ({ session }) => ({ authorId: { equals: session?.userId } }),
      },
    },
  })

  // Runs `UPDATE … WHERE id = … AND "authorId" = …`; a row the filter excludes
  // answers `null`, denied-or-gone, exactly as a denied read does.
  await context.db.Post.update({ where: { id }, data: { title: 'edited' } })
  ```

  Because the filter is lowered through the same Where vocabulary a read uses, an
  Access Filter must now name fields the list declares — a rule that scoped by an
  undeclared column is refused rather than silently passed through.

  Nested relation input leaves the write payload, `connect` excepted (ADR-0050).
  `create`/`update`/`delete`/`connectOrCreate`/`disconnect`/`set`/`updateMany`/`deleteMany`
  under a relationship key are a compile error against the generated input types
  and a `NestedRelationInputError` at runtime; `{ connect: { id } }` survives,
  because it lowers onto a foreign-key column the row being written owns.

  `disconnect` has a direct replacement on the side that owns that column — assign
  `null` to the relationship field, which is the same column and the same
  lowering. On a field owning no column, `null` is refused in turn with
  `NonOwningRelationInputError`, so that edge is cleared by an update against the
  target list. The remaining kinds have no replacement in the payload at all:
  write the related rows yourself and wrap them in `context.transaction` when they
  must land together:

  ```typescript
  await context.transaction(async (tx) => {
    const author = await tx.db.Author.create({ data: { name: 'Ada' } })
    await tx.db.Post.create({ data: { title: 'Notes', authorId: author.id } })
  })
  ```

  `connect` is the one spelling ADR-0050 keeps, and the engine lowers it onto the
  column the row carries — see `amber-keys-reach.md` for the reachability query it
  issues first. An owning field carrying neither `{ connect: { id } }` nor `null`
  is refused by name with a `MalformedRelationInputError` naming the list and the
  field, rather than reaching the driver as a column value and failing as a raw
  type error that names neither. Every refusal on this surface is checked against
  both the caller's payload and the data a `resolveInput` hook produced, and each
  recognises a synthetic `from_<List>_<field>` back-relation key rather than
  mistaking it for a column of this list.

  `afterTransaction` no longer reports `committed` for a write that persisted
  nothing. A write whose predicate matched no row — the row dropped by a
  `beforeOperation` hook, say — answers `null` to the caller and `rolled-back` to
  the bracket, so a compensator keyed on `committed` never acts on a write that
  did not happen.

  `context.db.<List>.createMany` and `updateMany` are removed — both ran one
  secured write per item, which `context.transaction` expresses directly — and
  `packages/core/src/context/nested-operations.ts` is deleted with them.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Add `aggregate`, include count reducers, `combine`, `distinct`/`distinctOn` and `cursor` to the secured read surface

  `aggregate` counts only the rows the session may see, so a count always equals the length of the same session's `.all()`. A denied read answers `0` under every key rather than throwing — the empty value of a count's type, indistinguishable from a genuinely empty scoped set.

  ```typescript
  const { total } = await context.db.Post.where({ published: { equals: true } }).aggregate(
    (aggregate) => ({ total: aggregate.count() }),
  )
  ```

  An include refinement can reduce a to-many relation to a count, scoped by both the related list's `query` access and the relationship field's own `read` rule. `combine` holds several counts over one relation, each its own independently scoped subquery:

  ```typescript
  const users = await context.db.User.include('posts', (posts) =>
    posts.combine({
      published: posts.where({ published: { equals: true } }).count(),
      total: posts.count(),
    }),
  ).all()
  // each row: { …user, posts: { published: number; total: number } }
  ```

  `distinct(...fields)`, `distinctOn(...fields)` and `cursor(values)` join the read subset. Every column they name goes through the same read gate a `where` key does, so a field this session cannot read is refused exactly as an undeclared one is — as is one that is declared but stored nowhere, such as a `virtual()` field. `cursor` requires a prior `orderBy`, and `distinctOn` requires one that leads with its own columns, so a pair Postgres would reject with `42P10` is refused by name instead. An empty column list, and a second `distinct` or `distinctOn` on the same read, are both refused rather than silently answering a different question.

  `nearest()` refuses a read that composed `distinct` or a cursor, as `aggregate` does: the ranking is that query's leading order, so a cursor has no axis left to resume along and a distinct would collapse rows the limit is already counted over.

  `groupBy`, the `*All` family, `*AndCount` and `upsert` remain absent from the surface: a method appears only where the engine knows how to scope it.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - The core test corpus is organised by guarantee and the coverage ratchet is re-baselined

  `packages/core/tests/` is gone. Every suite that stood the engine up on a hand-built
  object of `vi.fn()` per-model delegates has been rewritten against the Test context —
  an in-process Postgres per Vitest worker, honouring the `DATABASE_URL` escape
  (ADR-0057) — and the rest moved beside the module it covers, so the whole corpus now
  lives under `packages/core/src/`.

  The suites are named for the glossary term they protect: Silent failure, Access Filter,
  Field Visibility, the Where vocabulary, the Declared dependency set, the Write Pipeline,
  the Row lock and the Engine stamp.

  Nothing about writing a test against `@opensaas/stack-core/testing` changes:

  ```typescript
  import { createTestContext } from '@opensaas/stack-core/testing'

  const harness = await createTestContext(config, { userId: 'u1' })
  await harness.context.db.Post.create({ data: { title: 'ship it' } })
  expect(await harness.context.db.Post.all()).toHaveLength(1)
  await harness.close()
  ```

  ADR-0002's per-glob coverage ratchet is re-baselined once against the new corpus and
  still enforced by `pnpm --filter @opensaas/stack-core test:coverage`. No threshold was
  lowered and no path was excluded.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Framework components and `createAuth` accept the app's generated context; core is declared side-effect free

  The generated `Context` and the engine's `AccessContext` describe one request from two faces, and neither type is assignable to the other. `@opensaas/stack-ui`'s public components (`AdminUI`, `Dashboard`, `Navigation`, `ListView`, `ItemForm`, `SingletonView`, `RelationshipTable`) and `@opensaas/stack-auth`'s `createAuth` / `buildBetterAuthOptions` now take the app-facing context — what `getContext()` and `rawOpensaasContext` produce — so a page passes it straight through:

  ```tsx
  import { getContext, config } from '@/.opensaas/context'

  export default async function AdminPage() {
    return (
      <AdminUI context={await getContext()} config={await config} serverAction={serverAction} />
    )
  }
  ```

  Core exports the bridge for other framework code: `AnyStackContext` is the type of a context on either face, and `engineContextOf(context)` returns the engine's `AccessContext` for it (`EngineContextUnavailableError` for a hand-assembled object).

  **Watch for this when you upgrade.** The seven components above previously read `context.db[listKey]` and `context.session` and worked with any object carrying them. They now narrow through `engineContextOf`, which accepts a context the engine built or a full `AccessContext` and throws otherwise. A hand-assembled stand-in — a component test's double, a Storybook story, a wrapper that rebuilds `{ db, session, … }` by hand instead of passing `getContext()`'s result through — now throws at render. Pass a context from `getContext()`, or from `createTestContext` in `@opensaas/stack-core/testing`.

  Two engine fixes the first Next app on Prisma 8 exposed:

  - The origin store the tripwire reads, and the key an app-facing context carries its engine face under, are one per process rather than one per module instance. Next.js compiles the page layer and the route-handler layer separately, each with its own copy of the module, while the generated context caches one client for both: a query marked through one layer's Unsafe surface was refused as unmarked by the other layer's tripwire (every `/api/auth/*` route answered 500), and a context built by one layer's `getContext()` could not be narrowed by the other layer's `engineContextOf`. Both now resolve through one helper over the symbol registry `globalThis` shares.
  - On the include path the ORM hands an included to-one back under its foreign-key key as well as its own, so a row-dependent field `read` rule comparing `item.authorId` saw the related row rather than its id and denied the author. A field `read` rule is now answered against the row's own stored foreign key whichever way the row was read, so the same rule gives the same answer with and without `.include()` — including where the related list's Access Filter scopes the relation away, which previously made `item.authorId` read as `null` and could open a field whose rule tests for an absent relation. Every terminal (`all()`, `first()`, the `forUpdate()` lane, `nearest()`) returns rows through one funnel that runs both foreign-key passes; a read whose to-one include is narrowed costs one extra query to read the column the include's alias overwrites ([#1236](https://github.com/OpenSaasAU/stack/issues/1236)).

  Core's `package.json` now declares `"sideEffects": false`. The root barrel re-exports modules that import `node:fs` and `node:async_hooks`; a client component importing a value from the barrel — as the admin's own do — would otherwise pull them into the browser bundle and fail to compile under Turbopack. The declaration is truthful: no module in core has an import-time effect a consumer relies on.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Add the `nearest()` vector-search terminal to the secured read surface

  `context.db.<List>.where(…).nearest(field, vector, { limit, minScore })` runs one
  scoped similarity query over a native `Vector(n)` column and returns
  `{ item, score }`. The ranking, the `limit` and the `minScore` bound all sit
  inside the query alongside the Access Filter, so top-K is computed over the rows
  the session may see rather than filtered down afterwards, and the raw distance is
  never exposed. Searching requires read access to the embedding field: ordering by
  a vector measures its contents, so a session that cannot read it is refused with
  the message an undeclared key gets.

  ```typescript
  const hits = await context.db.Article.where({ published: true }).nearest(
    'embedding',
    queryVector,
    {
      limit: 5,
      minScore: 0.8,
    },
  )

  for (const { item, score } of hits) {
    console.log(item.title, score)
  }
  ```

  The database owns the ordering. `score` is the same distance function recomputed
  from the row's own vector, in float64 over a float4 column, so two tied rows can
  arrive in an order their scores do not reproduce — read it as the similarity, not
  as the sort key. A column that does not read back as a vector raises
  `VectorDecodeError` naming the list and field, rather than scoring `NaN`.

  A field declares its vector column through the new `getVectorColumn` member of
  `BaseFieldConfig`, which core reads to know the column, its dimension and the
  distance function (`cosine`, `l2` or `inner_product`) — a descriptor naming any
  other distance function is refused:

  ```typescript
  getVectorColumn: (fieldName) => ({
    column: fieldName,
    dimensions: 1536,
    distanceFunction: 'cosine',
  })
  ```

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - The item form writes to-many edges against the related list, and admin routing parses ids through the contract

  A to-many relationship's foreign key lives on the related row, so it can never ride in the record's own update payload — and connecting through an inverse field no longer compiles. The item form's multi-select now writes each edge as a write against the **related list**, under that list's own access control: adding one sets the related row's foreign key, removing one clears it. A denied write reverts the control to what the database actually holds and shows the reason, instead of navigating away on a save that never landed.

  The related-row writes go through two server actions, both keyed on the related list:

  ```typescript
  // Link an existing related row to the parent (new)
  await serverAction({
    listKey: 'Post',
    action: 'linkRelated',
    id: postId,
    field: 'author',
    parentId: userId,
  })

  // Unlink it again (unchanged)
  await serverAction({
    listKey: 'Post',
    action: 'removeRelated',
    mode: 'disconnect',
    id: postId,
    field: 'author',
  })
  ```

  Nothing needs configuring: a to-many whose back-reference owns a nullable foreign key becomes editable on the edit form automatically. A to-many with no writable edge — a list-only `ref`, a required foreign key (`db.isNullable: false` or `validation: { isRequired: true }`), or an edge across an explicit junction list — stays read-only with its reason.

  On the **default** edit route a to-many renders as a relationship table rather than a multi-select, so that table's "Link existing" control — until now offered only for an edge across a junction list — now also links an existing related row by writing its own foreign key, under the related list's update access. Selecting a post on a user's edit page therefore updates that post's foreign key whether the field is left at its default display or demoted to `ui.itemView.displayMode: 'picker'`.

  The edge writes commit before the record's own update and are not rolled back, so a record update that then fails reports the save as partial instead of as a plain failure.

  Ids now cross the wire through one contract-driven coercion (ADR-0048), which reads each list's id type from the contract:

  ```typescript
  import { parseListId } from '@opensaas/stack-core'

  parseListId(config, 'Post', '12') // { ok: true, value: 12 } on an int-keyed list
  parseListId(config, 'Post', 'not-an-int') // { ok: false }
  parseListId(config, 'Post', '3000000000') // { ok: false } — outside the int4 column
  ```

  Admin routing parses the URL's item id through it and **404s a malformed one**, so `/admin/post/not-an-int` on an integer-keyed list is a not-found rather than a query built on a `NaN`. The server actions parse their ids the same way.

  Nav counts are read through the secured `aggregate` reducer, so a badge again reports the rows the session may see.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Drive better-auth through a stack-authored Auth adapter over the Unsafe surface

  `@opensaas/stack-auth` no longer hands better-auth `prismaAdapter`. It builds its
  own adapter with better-auth's `createAdapterFactory`, running on the Unsafe
  surface a Prisma 8 context carries: eight methods on the ORM lane, and
  `incrementOne` plus an unconditional `deleteMany` as single typed-SQL statements
  through the surface's own executors. `consumeOne` is `where(…).delete()` inside one
  transaction on the surface's transaction-bound lanes, answering the row only
  when the delete itself claimed it — the at-most-one guarantee better-auth asks
  for, held against concurrent replays of the same token. See ADR-0060.

  `createAuth(config, rawOpensaasContext)` keeps its signature; nothing in an
  app's `lib/auth.ts` changes. Two new keys are refused at config time, alongside
  the existing `betterAuthOptions.database`:

  ```typescript
  authPlugin({
    betterAuthOptions: {
      // both throw: the database mints auth ids, and the adapter implements no joins
      advanced: { database: { generateId: () => id, joins: true } },
    },
  })
  ```

  `authPlugin` now pins `db.idField: 'uuid7'` on every list it injects, so auth
  ids are minted by the database like every other list's.

  `@opensaas/stack-core` gains the engine-owned LIKE-pattern escaping the adapter
  lowers `contains` / `starts_with` / `ends_with` and insensitive `eq` through
  (`escapeLikeLiteral` and the four pattern builders, on
  `@opensaas/stack-core/internal`) — one escaper, shared with the secured
  surface's Where vocabulary.

  Known limits of the adapter, all stated: no joins, no `createSchema` (so
  better-auth's CLI is unsupported against it), no better-auth transaction option
  yet, no issuer-scoped account uniqueness until the schema gap in [#986](https://github.com/OpenSaasAU/stack/issues/986) closes,
  and errors arrive as the driver's own rather than normalised.

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

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Drop transaction options and make database errors stack-owned

  `context.transaction(fn)` takes no options and runs at the connection's default isolation level — Read Committed on PostgreSQL. `isolationLevel`, `maxWait`, `timeout`, the `TransactionIsolationLevel` union, `TransactionOptions` and `TransactionOptionsUnsupportedError` are deleted, so asking for an isolation level is a compile error at the call site rather than a value the client silently downgrades.

  Every engine terminal now raises a stack-owned error in place of the driver's own, each with an `is*` predicate:

  ```typescript
  import { isUniqueConstraintViolation, isSerializationFailure } from '@opensaas/stack-core'

  try {
    await context.db.User.create({ data: { email } })
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      // { email: 'This email is already in use' }
      return { fieldErrors: error.fieldErrors }
    }
    if (isSerializationFailure(error)) return retry()
    throw error
  }
  ```

  A unique violation resolves through the constraint map the generator emits, so it names the OpenSaas **fields** the violated constraint covers. A constraint managed by hand in the database is not in that map and falls through to the generic `'A record with this value already exists'` with no fields — the map's limit, stated rather than hidden.

  Errors raised at `COMMIT` are normalised the same way, at the transaction owner's settle and before the deferred-hook flush, so a `DEFERRABLE INITIALLY DEFERRED` constraint never escapes as a raw driver error and ADR-0028's precedence rule (transaction errors ahead of hook errors) keeps operating on a normalised value.

  A `DatabaseError`'s message is always stack-authored; the driver's own text — which names columns, tables and constraint names — is on `cause`, for a server-side log rather than a browser. A failure the classification does not recognise carries `'The database refused this operation'`.

  `context.serverAction` — the surface the admin UI drives — logs that `cause` to the server console before returning the stack-authored message to the client, so a database failure stays diagnosable to the operator without the driver's text ever reaching the browser.

  An application's own error wins over the stack's. Catching a stack error and rethrowing your own with `{ cause }` reaches the caller as your error, not as the `UniqueConstraintViolation` underneath it.

  `context.unsafe` is deliberately excluded and still rejects with the driver's own error, consistent with its bypassing everything else.

  `DatabaseError.code` is removed along with every `P####` discriminant, the English-prose regex and the identifier stripping in `prisma-errors.ts`; `uniqueConstraintOf` and `UniqueConstraintInfo` are gone with them. Prisma 8 raises no such codes, so each was a string compare that would have failed silently. See ADR-0042.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - `createMcpHandlers` takes the app's own context factory

  The MCP route handler typed its `getContext` option as returning the engine's
  `AccessContext`, which the generated `getContext()` is deliberately not
  assignable to — the app-facing `Context` carries the secured `db` and none of
  the engine's plumbing. Wiring the documented route up therefore did not compile.
  It now takes `AnyStackContext` and narrows once with `engineContextOf`, the same
  boundary `AdminUI` and `createAuth` already sit on.

  The documented wiring is unchanged, and now type-checks:

  ```typescript
  // app/api/mcp/[[...transport]]/route.ts
  import { createMcpHandlers } from '@opensaas/stack-core/mcp'
  import { createBetterAuthMcpAdapter } from '@opensaas/stack-auth/mcp'
  import config from '@/opensaas.config'
  import { auth } from '@/lib/auth'
  import { getContext } from '@/.opensaas/context'

  const { GET, POST, DELETE } = createMcpHandlers({
    config: await config,
    getSession: createBetterAuthMcpAdapter(auth),
    getContext,
  })

  export { GET, POST, DELETE }
  ```

  A caller already passing an engine-face context keeps working — `engineContextOf`
  returns such a value unchanged.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Core derives the Prisma 8 contract from the config (ADR-0057)

  `deriveContract(config)` turns a resolved config into plain contract data — models with columns from each field builder's structured descriptor, ids by `db.idField` strategy (a singleton derives an integer id defaulting to 1), `temporal` auto-timestamps, `db.indexes` resolved to columns with named entries adopted as exact constraint names, the relation graph with foreign-key ownership, the one-to-one pair (owning column + foreign key + unique constraint + `belongsTo`; inverse `hasOne`), synthetic back-relations for list-only refs, native enums, the namespaces beyond `public` (`db.schemas` unioned with every list's `db.schema`) and the declared extension packs. `assertRelationGraphAgrees(derived, emitted)` checks an emitted contract against that graph and throws `RelationGraphDivergenceError` naming the first divergence.

  `@opensaas/stack-core/contract` adds `buildPrismaContract(data, { packs })`, which feeds the data into Prisma's contract builder in-process, and `toEmittedContract(contract)` for its JSON form:

  ```typescript
  import { deriveContract, assertRelationGraphAgrees } from '@opensaas/stack-core'
  import { buildPrismaContract, toEmittedContract } from '@opensaas/stack-core/contract'
  import pgvector from '@prisma/orm-extension-pgvector/pack'

  const data = deriveContract(config)
  const contract = buildPrismaContract(data, { packs: { pgvector } })
  assertRelationGraphAgrees(data, toEmittedContract(contract))
  ```

  `db.nativeType` is honoured for every Postgres constructor the contract can express — `Text`, `VarChar(n)`, `Char(n)`, `Uuid`, `Integer`, `SmallInt`, `BigInt`, `Decimal(p, s)`, `DoublePrecision`, `Real`, `Boolean`, `Date`, `Timestamp(p)`, `Timestamptz(p)`, `Time(p)`, `Json`, `JsonB`, `ByteA` — each lowering to its own column (`Real` is `float4`, `Json` is `json` as distinct from the `jsonb` a `json()` field defaults to, and a precision reaches the DDL). A spelling outside that list, a wrong argument count (`VarChar` with no length) or a precision outside 0–6 is a generate-time error naming the list and field; nothing is silently aliased or dropped. `decimal()` now forwards `db.nativeType` like every other scalar builder.

  A single-field unique `db.indexes` entry on the owning column of a one-to-one names the unique constraint that column already carries instead of being refused, and a relationship's default foreign-key index yields to a single-field entry the same way; a spelled-out `isIndexed` on the field remains a genuine duplicate.

  New generate-time refusals, each naming the list, the entry and the fix: `undeclared-extension-pack` (a stored field typed by a pack `db.extensions` does not declare), `field-descriptor-error` (a field whose `getContractField` throws, such as a default the contract cannot carry), `reserved-field-name` (a field named `id`), `foreign-key-column-collision` (a field whose column is the `<field>Id` another relationship on the list owns), `synthetic-relation-collision` (a field named `from_<List>_<field>` where a list-only ref synthesises that back-relation) and `inverse-mismatch` (a bidirectional `ref` whose other end does not ref back). `validateExtensionPacks` and `validateFieldNames` are exported and run as part of `validateDatabaseConfig`; `validateRelations` picks up `inverse-mismatch`.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Add `@opensaas/stack-core/testing`: a real, fully secured context over an in-process Postgres

  `createTestDatabase(config)` derives the contract from a config, seeds every declared
  extension pack's contract space, applies the schema once through the control client's
  `dbUpdate`, and binds a single-connection Prisma 8 client with the stack's own
  `originTripwire` installed. `createTestContext(config, session)` is the single-call form.
  No test fakes the secured surface.

  ```typescript
  import { createTestDatabase, createPlanRecorder } from '@opensaas/stack-core/testing'

  const recorder = createPlanRecorder()
  let db: TestDatabase

  beforeAll(async () => {
    db = await createTestDatabase(config, { middleware: [recorder.middleware] })
  }, 60_000)
  afterAll(async () => await db.close())
  beforeEach(async () => await db.truncate())

  test('the engine scopes the read', async () => {
    const context = db.context({ userId: 'user-1' })
    // …
    expect(recorder.plans.map((plan) => plan.origin)).toEqual(['engine'])
  })
  ```

  The map the engine reaches models through is checked as the harness builds it: a client
  exposing no collection for a model the contract declares throws
  `OrmCollectionMissingError`, naming the model, the namespace and the keys actually
  present, rather than building a context that would refuse every operation later.

  Set `DATABASE_URL` to a Postgres server and the identical suite runs there, each file in a
  database of its own, named `opensaas_test_<YYYYMMDDHHMMSS>_<uuid>` after the exported
  `ESCAPE_DATABASE_PREFIX` so a run killed before `close()` leaves orphans that are
  identifiable by age and sweepable; set to anything else the variable is refused by name
  rather than dialled. `readDatabaseEscape()` lets a test whose guarantee PGlite cannot
  exercise skip visibly when the escape is unset.

  PGlite, `@electric-sql/pglite-socket`, `@electric-sql/pglite-pgvector` and
  `@prisma/orm-toolchain` are optional peer dependencies, and `pg` — a real dependency of
  core, for `@opensaas/stack-core/client` — is imported lazily here too. Every one of them
  is loaded on demand by this subpath only, so a production install carries no WASM
  Postgres.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - A Test context can exercise `file()` and `image()` fields

  `createTestContext` built its context with no storage surface, so any write to a storage-backed field threw `No storage providers configured` — the Test context could not cover the storage package at all. It now takes one:

  ```ts
  import { createTestContext } from '@opensaas/stack-core/testing'
  import { createStorageUtils } from '@opensaas/stack-storage/runtime'

  // `config` is a promise whenever the config carries plugins, so resolve it
  // once and hand the same value to both.
  const resolved = await config

  const harness = await createTestContext(resolved, null, {
    storage: createStorageUtils(resolved),
  })

  const user = await harness.context.db.User.create({
    data: { name: 'Ada', avatar: new File([bytes], 'avatar.png', { type: 'image/png' }) },
  })
  ```

  `createStorageUtils(config)` is new in `@opensaas/stack-storage/runtime` and is the supported way to build that surface. `StorageUtils` types its option and metadata arguments as `unknown`, because core is this package's dependency and cannot name its types; the factory is the one place that re-narrows them, so a consumer building a context by hand no longer writes that conversion itself.

  `deleteImage` **refuses** a value that is not `ImageMetadata`, naming the keys it received, rather than resolving as a silent no-op. The generated context always calls `deleteImage`, so a harness that swallowed an unrecognised shape would be quieter than the application it stands in for — the one failure mode a test surface must not have.

  Omitting the option is unchanged: a config with no storage still throws on a storage-backed write, exactly as an application with none does.

  Two type predicates now check every member their consumers read, rather than a subset the compiler then takes on trust:

  - `isImageMetadata` checked 2 of `ImageMetadata`'s 9 required members and omitted `storageProvider`, which `deleteImage` dereferences first — a bogus value surfaced as `Storage provider 'undefined' not found in config` from inside the provider registry. It now checks all nine, plus the shape of the optional `metadata` and `transformations`.
  - `isFileLike` narrows to `File` but checked only `arrayBuffer`, while the upload path also reads `name`, `type` and `size` — so a value carrying only `arrayBuffer` was stored with an `originalFilename` of `undefined`. It now checks all four.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Put `aggregate`, `nearest`, `combine`, `count`, `distinct`, `distinctOn`, `cursor` and `offset` on the typed read surface

  These shipped on the engine's deliberately-untyped composed read alone, so a generated project could not call any of them — `context.db.Post.aggregate(…)` was `TS2339`, and the examples the previous two changesets published did not compile. They are now on `ListQuery` / `ListRefinement` with contract-derived types, the same way `select` and `include` already are.

  ```typescript
  const { total } = await context.db.Post.where({ published: { equals: true } }).aggregate(
    (aggregate) => ({ total: aggregate.count() }),
  )

  const users = await context.db.User.include('posts', (posts) =>
    posts.combine({
      published: posts.where({ published: { equals: true } }).count(),
      total: posts.count(),
    }),
  ).all()
  // each row: { …user, posts: { published: number; total: number } }

  const hits = await context.db.Article.where({ published: true }).nearest(
    'embedding',
    queryVector,
    {
      limit: 5,
      minScore: 0.8,
    },
  )
  for (const { item, score } of hits) console.log(item.title, score)
  ```

  `nearest()` reads as `{ item, score }` (`NearestMatch`), with `item` honouring the read's own `select()` and includes, and its `field` names one of the list's vector columns — a list that declares none has no callable `nearest`. `distinct`, `distinctOn` and `cursor` name this list's stored columns, so a computed field or a misspelling is a compile error rather than a runtime refusal. A relation an include reduced reads as its count — `number` for `count()`, one number per key for `combine()` — in place of the rows; `.count()` and `.combine()` appear on a to-many refinement that has composed nothing but `where()`, so `ReducedToOneIncludeError` and `UnreducibleRefinementError` are compile errors too. `Aggregations` and `CountReduction` are exported, so a builder factored out of the call site can be named.

  A singleton list carries `get` and the CRUD delegate and no composed read, which is what its runtime has always done — `context.db.Settings.where/all/first/aggregate/nearest/offset/distinct/distinctOn/cursor` type-checked and threw `TypeError` before.

  `offset(count)` joins the top-level read, where it previously existed on an include refinement alone. It pages inside the Access Filter, and `all()` and `first()` both honour it — `first()` has no offset of its own, so `.orderBy(…).offset(10).first()` is the eleventh row. `aggregate()` and `nearest()` refuse a composed `offset` (and `aggregate()` a composed `limit`) rather than answer a different question in silence, the way both already refuse `distinct` and `cursor`; the refusal runs after the access check, so a denied caller still gets `0` or `[]`.

  Each terminal now declares what it does with every member of a resolved plan, so a member it neither applies nor refuses is a compile error rather than a silent drop.

  `groupBy`, the `*All` family, `*AndCount` and `upsert` remain absent: a method appears only where the engine knows how to scope it.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Adding an edge across a junction is a create of the junction row, under that list's own create access

  A many-to-many is an explicit junction list (ADR-0048), so an edge is one of its rows and adding one is a create — never a nested write on either parent. `context.serverAction({ listKey, action: 'addRelated', field, parentId, targetId })` names the **parent** list and its to-many field; the junction list, its back-reference and its far-endpoint field are resolved from the config on the server, so a caller can neither name a junction list of its own choosing nor set a column of the edge row beyond the two endpoints.

  ```ts
  // Post.tags: relationship({ ref: 'PostTag.post', many: true })
  // PostTag  : { post: relationship({ ref: 'Post.tags' }), tag: relationship({ ref: 'Tag.posts' }) }
  await context.serverAction({
    listKey: 'Post',
    action: 'addRelated',
    field: 'tags',
    parentId: post.id,
    targetId: tag.id,
  })
  // → { added: true, id } — a PostTag row, gated on PostTag's own create access
  ```

  The create is evaluated against the junction list, so a caller denied `create` there cannot add the edge and the denial is the usual silent one: `{ added: false }` with a generic reason, nothing written, nothing raised. Both endpoints go through `connect`, so an endpoint the caller cannot read is indistinguishable from one that does not exist, and both are indistinguishable from that operation-level denial — one generic reason covers all three. A **field-level** denial on an endpoint stays loud and names the field, as it does for every create in the framework ([#568](https://github.com/OpenSaasAU/stack/issues/568)); this does not change that.

  `resolveJunctionEdge(config, parentListKey, fieldName)` is exported for callers that need the same answer. It returns `null` — leaving the ordinary to-many treatment in place — for a list-only `ref`, a junction with a third foreign key or none, and a junction carrying any stored field of its own. That last rule is what keeps an ordinary two-parent child row (`Comment { body, article, author }`) from being read as an edge: it owns two foreign keys like a junction does, and no requiredness flag separates the two, so the column it carries is the only evidence. The cost is that a junction with a genuinely optional annotation column keeps its ordinary treatment too.

  In the admin UI, a to-many section that is such an edge gains a **"Link"** control beside "+ Add", offered only when the junction list's own `create` access is not statically denied. The item form's to-many picker stays read-only — an edge can never ride in the parent's write payload — but its stated reason now points at that table rather than at another list's edit page. The item view renders such a field as the table itself rather than as a field of the details card, so the reason is what the create page and the standalone forms show; a field demoted to `ui.itemView.displayMode: 'picker'` has no table anywhere and keeps the original reason.

### Patch Changes

- [#1465](https://github.com/OpenSaasAU/stack/pull/1465) [`0c33f68`](https://github.com/OpenSaasAU/stack/commit/0c33f68b5d9449b4cdaecc792815bbd64afd7e9f) Thanks [@borisno2](https://github.com/borisno2)! - Fix `context.unsafe.sql`/`.raw` degrading to `object` through the generated `Context`/`BaseContext`/`TransactionContext` types. The generated bundle now keys the Unsafe surface to the app's own Prisma 8 client, so a migration script gets Prisma's own typed SQL builder and raw tag with no cast.

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

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Make the secured-surface distinct, cursor and indistinguishability tests falsifiable — no runtime change. The `distinct` case now composes a caller `where` whose answers differ from the unfiltered ones on both the scoped and unscoped sides, and every refusal message is pinned to the literal `unqueryableKey` text beside its `ValidationError` class check.

- [#1460](https://github.com/OpenSaasAU/stack/pull/1460) [`21bd0d5`](https://github.com/OpenSaasAU/stack/commit/21bd0d53860d8ad2f801c65e83637e523adc19f6) Thanks [@borisno2](https://github.com/borisno2)! - Fix a relation that is both reduced (`.count()`/`.combine()`) and a live declared dependency of a computed field or field-level `read` rule: it now satisfies both instead of the dependency computing over the reduction's masked `[]`.

- [#1455](https://github.com/OpenSaasAU/stack/pull/1455) [`27d91d5`](https://github.com/OpenSaasAU/stack/commit/27d91d54fcd79122dfe695b5dea94c14572a2b98) Thanks [@borisno2](https://github.com/borisno2)! - Fix MCP read path: a throwing field-level access rule no longer leaks its raw error text to the client, and no longer fails a `fields`-bearing query for a field the caller never named.

- [#1466](https://github.com/OpenSaasAU/stack/pull/1466) [`95cb6dc`](https://github.com/OpenSaasAU/stack/commit/95cb6dc70a6c622c70c8cd74a14abb53f25bc95f) Thanks [@borisno2](https://github.com/borisno2)! - Fix three spots that assumed every list carries `createdAt`/`updatedAt` (timestamps are opt-in, ADR-0004): the migration generator no longer drops a source model's timestamp columns — it opts the list into `db.timestamps` when they match the auto-managed shape, or declares them as ordinary fields otherwise; the MCP fields projection no longer advertises or accepts `createdAt`/`updatedAt` on a list that doesn't have them; and the blog feature generator's scaffolded Post list now opts into `db.timestamps`, since its generated pages read `post.createdAt`.

- [#1451](https://github.com/OpenSaasAU/stack/pull/1451) [`d59945a`](https://github.com/OpenSaasAU/stack/commit/d59945a36ba6615823e22822f366fb2507fbad68) Thanks [@borisno2](https://github.com/borisno2)! - Fix `calendarDay` writing and filtering a JS `Date` against its now-string-codec column, which could silently drift the stored date by a day under a negative-UTC-offset server timezone.

- [#1479](https://github.com/OpenSaasAU/stack/pull/1479) [`9fe6917`](https://github.com/OpenSaasAU/stack/commit/9fe6917f37f4110740e2aa9ee174355699f8b36d) Thanks [@borisno2](https://github.com/borisno2)! - Fix an intermittent failure in `include.test.ts` caused by a substring assertion matching a UUID by chance.

- [#1467](https://github.com/OpenSaasAU/stack/pull/1467) [`2739ad8`](https://github.com/OpenSaasAU/stack/commit/2739ad8923ab3db893eefb718d21fcb2d079a519) Thanks [@borisno2](https://github.com/borisno2)! - Fix a list/field hook's `context.db` resolving through core's unkeyed default instead of the app's own generated `db` surface, so `context.db.typoedListName` compiled inside a hook and a real list lost its row type. `TypeInfo` now carries the generated `db`, and every hook-args type keys `context` to it.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Fix a rejected lazy Prisma import in `secured/lower.ts` being cached permanently — a transient import failure no longer poisons every later secured read for the life of the process; the next call retries, and a successful import is still cached.

- [#1459](https://github.com/OpenSaasAU/stack/pull/1459) [`3fb20e0`](https://github.com/OpenSaasAU/stack/commit/3fb20e05ce986e25d317910280cfd45abb034c8a) Thanks [@borisno2](https://github.com/borisno2)! - Redact raw error text from MCP `create`/`update`/`delete` tool responses when a field-level access rule throws while Field Visibility filters the write's own result, matching the fix already applied to the `query` path in [#1361](https://github.com/OpenSaasAU/stack/issues/1361).

- [#1481](https://github.com/OpenSaasAU/stack/pull/1481) [`4dd1dd0`](https://github.com/OpenSaasAU/stack/commit/4dd1dd0b555a6838a989d2ee43399c676742be0c) Thanks [@borisno2](https://github.com/borisno2)! - Fix `removeRelated`/`createRelated`/`linkRelated` refusing a non-owning back-reference (the inverse half of a one-to-one, or a synthetic `from_<List>_<field>` back-relation) by checking `many === true` instead of foreign-key ownership.

- [#1464](https://github.com/OpenSaasAU/stack/pull/1464) [`7242781`](https://github.com/OpenSaasAU/stack/commit/7242781e1d27e6e7a4a08ed63d7ecb544e20db6e) Thanks [@borisno2](https://github.com/borisno2)! - Fix a regression from the previous MCP redaction fix ([#1459](https://github.com/OpenSaasAU/stack/issues/1459)): `DatabaseError` (and its `UniqueConstraintViolation`/`SerializationFailure` subclasses) and `ResolveOutputCycleError` are safe, framework-authored messages and are now allowlisted again on the MCP `create`/`update`/`delete` path instead of being flattened to a generic "failed due to an internal error" message.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Fix `filterWritableFields` silently dropping a directly-written foreign-key column (`authorId`) instead of writing it, gated by the owning relationship field's write access exactly like `connect`.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Harden the test harness's pgvector probe: it now redials a server that is not accepting connections yet and throws once the deadline passes, so an unreachable server can never be recorded as one without pgvector

- [#1463](https://github.com/OpenSaasAU/stack/pull/1463) [`1ecc97e`](https://github.com/OpenSaasAU/stack/commit/1ecc97ec31580d778d138122f89798f4be651744) Thanks [@borisno2](https://github.com/borisno2)! - Fix a denied to-one relation's foreign-key column leaking the related row's id on a read that never included the relation.

- [#1478](https://github.com/OpenSaasAU/stack/pull/1478) [`7adac1b`](https://github.com/OpenSaasAU/stack/commit/7adac1bfdbce5c49c8f09a3f69bd9684a77d4cc2) Thanks [@borisno2](https://github.com/borisno2)! - Fix `virtual()` and `resolveOutput` TSDoc examples to declare `needs` for the sibling/relation columns they read off `item`.

## 0.43.0

### Minor Changes

- [#1385](https://github.com/OpenSaasAU/stack/pull/1385) [`1da6535`](https://github.com/OpenSaasAU/stack/commit/1da6535a840596a7ef4ec3f7ba742da62ef117df) Thanks [@borisno2](https://github.com/borisno2)! - Close an access-control gap in nested relationship writes ([#1384](https://github.com/OpenSaasAU/stack/issues/1384)). Non-sudo `context.db` writes carrying a nested `set`, `updateMany` or `deleteMany` under a relationship key previously reached Prisma as an unchecked pass-through — the target list's `operation.update`/`operation.delete` access was never consulted, no hooks ran, and an unscoped `where` could reach rows well outside the parent's own subtree. These three kinds are now refused outright for non-sudo contexts, throwing a new `NestedRelationInputError` (exported from `@opensaas/stack-core`) that names the list, the relationship field, and the offending kind(s):

  ```typescript
  import { NestedRelationInputError } from '@opensaas/stack-core'

  try {
    await context.db.post.update({
      where: { id },
      data: { tags: { deleteMany: {} } },
    })
  } catch (err) {
    if (err instanceof NestedRelationInputError) {
      // err.listKey / err.fieldKey / err.kinds
    }
  }
  ```

  Replace a nested `set`/`updateMany`/`deleteMany` with writes against the target list directly (`context.db.<targetList>`), wrapped in `context.transaction()` when they must land atomically with the parent write. `context.sudo()` still accepts all three kinds unchanged, matching every other access-control escape hatch in the write pipeline.

  Nested `disconnect`'s target-row form (`{ disconnect: { id } }`, as opposed to the to-one `{ disconnect: true }`) is now gated by the target list's `operation.query` access, the same reachability check `connect` already applies — a caller can no longer disconnect a row it cannot read. This closes the last unchecked nested-write shape from the same report.

## 0.42.3

### Patch Changes

- [#1337](https://github.com/OpenSaasAU/stack/pull/1337) [`1a616c1`](https://github.com/OpenSaasAU/stack/commit/1a616c1e2ff31de1afe970a5fcfcc25ea7cbedb0) Thanks [@borisno2](https://github.com/borisno2)! - Core's `AugmentedFindUnique`/`AugmentedFindFirst`/`AugmentedFindMany` now carry the same trailing non-generic overload the generator's `CustomDB` already emits ([#1287](https://github.com/OpenSaasAU/stack/issues/1287)), and `getContext` takes a third, unconstrained, defaulted `TDb` type parameter so a caller can ask for `StackContext<TPrisma, CustomDB>` directly. The generated `.opensaas/context.ts` factory uses this to drop its `as unknown as Context<TSession>` casts down to a single, honest `as Context<TSession>`.

  Observable side effect: since `Parameters<>`/`ReturnType<>` resolve against an overloaded type's LAST member, `Parameters<AccessControlledDB<P>[K]['findMany' | 'findFirst' | 'findUnique']>[0]` now resolves to the new trailing member's argument type (Prisma's args shape minus `select`/`include`/`query`) instead of the full original Prisma args — anyone introspecting these types directly via `Parameters<>` will see this narrower shape.

## 0.42.2

## 0.42.1

### Patch Changes

- [#1268](https://github.com/OpenSaasAU/stack/pull/1268) [`2976f57`](https://github.com/OpenSaasAU/stack/commit/2976f57a0d80687c3a27e11c3b7ec7fa9830cdb7) Thanks [@borisno2](https://github.com/borisno2)! - Fix a hook's `context.db` under-describing rows: `TypeInfo` now carries a `db` member (the generator points it at the generated `CustomDB`), so a hook reading a virtual or transformed field off `context.db.<list>` type-checks instead of failing with `TS2339`.
  Run `opensaas generate` after upgrading to pick up the new member on `Lists.<List>.TypeInfo`.

- [#1264](https://github.com/OpenSaasAU/stack/pull/1264) [`2e1ee3d`](https://github.com/OpenSaasAU/stack/commit/2e1ee3de446639f24331c5cebd01aeed37ca3e31) Thanks [@borisno2](https://github.com/borisno2)! - Fix `context.db.<list>.findUnique`/`findFirst`/`findMany` (and singleton `get`) in the generated `CustomDB` silently losing fragment narrowing: passing a `query` fragment compiled but the result stayed typed as the unnarrowed list payload instead of `ResultOf<typeof fragment>`. These methods now carry the same fragment overload as core's `AccessControlledDB`, so an unselected field is a compile error on the result.

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

## 0.41.0

### Minor Changes

- [#1179](https://github.com/OpenSaasAU/stack/pull/1179) [`67dce2e`](https://github.com/OpenSaasAU/stack/commit/67dce2e9d96afdc5c69f0a2f1c8b395346d4e942) Thanks [@borisno2](https://github.com/borisno2)! - A list/field `resolveInput` / `validate` / `beforeOperation` / `afterOperation` hook's `context` is now a full secured context — `sudo()`, `withSession()`, `transaction()` and `serverAction` — bound to the write's OWN transaction client, exactly like the `txContext` a `context.transaction()` callback receives.

  ```typescript
  Order: list({
    hooks: {
      beforeOperation: async ({ context }) => {
        // Elevated AND atomic with this write — rolls back together if it throws.
        await context.sudo().db.auditLog.create({ data: { action: 'order-write' } })
      },
    },
  })
  ```

  Previously this `context` had no `sudo()`/`withSession()`/`transaction()` at all, forcing a workaround (`getContext(session).sudo()`) that opened a SEPARATE connection from the write's transaction — its writes could survive a rollback, and it could deadlock on a single-connection adapter. `context.transaction()` called from inside one of these hooks now joins the write's transaction rather than opening a nested one. `beforeTransaction`/`afterTransaction` are unaffected — they keep the plain access-checked context bound to the base client, always. A field's `resolveOutput` keeps the same context type as before; which client it's bound to already depended on how the read arose (a plain read: the base client; a create/update's own Field Visibility pass: that write's transaction client), unchanged by this release.

### Patch Changes

- [#1108](https://github.com/OpenSaasAU/stack/pull/1108) [`2260539`](https://github.com/OpenSaasAU/stack/commit/2260539c5488dae0ee6e7f86ccd913e5c898ccdb) Thanks [@borisno2](https://github.com/borisno2)! - Fix: a relation quantifier (`some`/`every`/`none`/`is`/`isNot`) nested inside an `include` entry's own `where` is now scoped by the deeper related list's `query` access and field-read access too, reusing `buildAccessScopedWhere` ([#916](https://github.com/OpenSaasAU/stack/issues/916)) — closing a residual probing-oracle gap in [#1092](https://github.com/OpenSaasAU/stack/issues/1092)'s fix.

- [#1102](https://github.com/OpenSaasAU/stack/pull/1102) [`aa34cca`](https://github.com/OpenSaasAU/stack/commit/aa34cca65877759b9625da1538c65c53ed54385a) Thanks [@borisno2](https://github.com/borisno2)! - Fix: a `where`/`orderBy` nested inside a caller's `include` entry now validates against the related list's config, closing a probing oracle over undeclared or read-denied fields one hop into a relation ([#1092](https://github.com/OpenSaasAU/stack/issues/1092)).

- [#1041](https://github.com/OpenSaasAU/stack/pull/1041) [`182153c`](https://github.com/OpenSaasAU/stack/commit/182153cb976b14ef67673d0eeef7925d950bfa10) Thanks [@borisno2](https://github.com/borisno2)! - Upgrade Prisma packages to `^7.9.1`, keeping the CLI, client, and driver adapters on the same release. Scaffolded PostgreSQL projects now pin `@prisma/adapter-pg` to `^7.9.1`.

- [#1101](https://github.com/OpenSaasAU/stack/pull/1101) [`682795f`](https://github.com/OpenSaasAU/stack/commit/682795f7c7f0d0194ffd08e993d452c368bcd847) Thanks [@borisno2](https://github.com/borisno2)! - Fix a query fragment read (`{ query: fragment }`) skipping the Access Filter's scoping walk, so a related list's `query` access, row filters, and the read-include depth cap were never enforced. Fragment reads may now return fewer related rows — those rows were never authorised.

- [#1110](https://github.com/OpenSaasAU/stack/pull/1110) [`73d1b6a`](https://github.com/OpenSaasAU/stack/commit/73d1b6aba9a9b789a8111105d56257a1de66a883) Thanks [@borisno2](https://github.com/borisno2)! - A caller-supplied `_count` in `include` is now scoped by each named relation's own `query` access (a row filter is folded into the count, a fully denied relation counts `0`), closing a cardinality leak where counts previously reached the caller unscoped.

- [#1091](https://github.com/OpenSaasAU/stack/pull/1091) [`f1e8792`](https://github.com/OpenSaasAU/stack/commit/f1e8792ce580d92a5874599dfb8a8ccde4d6c8b3) Thanks [@borisno2](https://github.com/borisno2)! - Fix a read naming a list-only ref's synthetic back-relation (`from_<List>_<field>`) in `include`: it now resolves to the declared relationship it stands for and is scoped by that list's `query` access, its field-level `read` gates, and its virtual fields — instead of being returned unscoped. An `include` key that resolves to neither a declared relationship, a synthetic back-relation, nor `_count` is now rejected rather than silently passed through. Responses will shrink for callers relying on either gap — the extra rows and fields they received were never authorised.

- [#1120](https://github.com/OpenSaasAU/stack/pull/1120) [`9eb7c77`](https://github.com/OpenSaasAU/stack/commit/9eb7c7766d212e92b02d53a1ba3aaead4faf1496) Thanks [@borisno2](https://github.com/borisno2)! - Fix `_count` ignoring a relationship's field-level `read` access, letting the true count of a hidden relationship leak through both the admin list view and a caller-supplied `_count`.

- [#1090](https://github.com/OpenSaasAU/stack/pull/1090) [`5b478de`](https://github.com/OpenSaasAU/stack/commit/5b478de64f3564d837d2f9f912972e49008be884) Thanks [@borisno2](https://github.com/borisno2)! - Fix nested update/delete (e.g. `post.update({ data: { author: { update: {...} } } })`) silently treating a Prisma filter returned by the target list's `update`/`delete` access as an unconditional allow. It is now re-checked against the target row in the database, matching top-level write behavior.

- [#1115](https://github.com/OpenSaasAU/stack/pull/1115) [`d335122`](https://github.com/OpenSaasAU/stack/commit/d335122323b3402c0838aa50873fab0c085fbb01) Thanks [@borisno2](https://github.com/borisno2)! - Fix a denied to-many relation coming back `undefined` instead of `[]` on both the caller-`include:` and fragment `query` read paths.

## 0.40.0

### Minor Changes

- [#1020](https://github.com/OpenSaasAU/stack/pull/1020) [`8e6707a`](https://github.com/OpenSaasAU/stack/commit/8e6707adcca9d7e062bc1747ec79a29082c09ef9) Thanks [@borisno2](https://github.com/borisno2)! - Add `ui.listView.defaultColumn` to field config — a declared, presentation-only flag (default `true`) controlling whether a field belongs in a list/related-list table's default column set. Naming a field explicitly in `ui.listView.initialColumns` or a relationship's `ui.itemView.columns` always shows it regardless of this flag.

  ```typescript
  fields: {
    internalScore: integer({ ui: { listView: { defaultColumn: false } } }),
  }
  ```

  `password()` now sets this flag to `false` by default instead of the admin UI matching on field type — a password field can opt back into default columns with `ui: { listView: { defaultColumn: true } } }`.

- [#1011](https://github.com/OpenSaasAU/stack/pull/1011) [`afd1a60`](https://github.com/OpenSaasAU/stack/commit/afd1a60a6ddaa558bf14887e45fa1c007e6669b0) Thanks [@borisno2](https://github.com/borisno2)! - `OperationAccess.create` now throws `InvalidCreateAccessResultError` when the rule returns anything other than `true`/`false` — most notably a Prisma filter, which previously fell through the `create` access check unrecognised and was silently treated as a full allow (both the top-level write pipeline and nested-create paths were affected).

  Create has no existing row to scope a filter against, so a filter can no longer be honoured here:

  ```typescript
  // Before: type-checked, read as row-scoped, actually allowed everyone
  create: ({ session }) => ({ ownerId: { equals: session.userId } })

  // Now throws InvalidCreateAccessResultError. Scope ownership in a hook instead:
  hooks: {
    resolveInput: async ({ resolvedData, context, operation }) => {
      if (operation === 'create') {
        return { ...resolvedData, ownerId: context.session?.userId }
      }
      return resolvedData
    },
  },
  access: {
    operation: {
      create: ({ session }) => !!session, // boolean only
    },
  },
  ```

  `create: () => false` still denies via Silent failure as before; only a non-boolean result now throws.

- [#984](https://github.com/OpenSaasAU/stack/pull/984) [`51ae299`](https://github.com/OpenSaasAU/stack/commit/51ae299b7624f97e890f85b3075c62d8e114cec2) Thanks [@borisno2](https://github.com/borisno2)! - Extend `isIndexed` to `integer`, `timestamp`, and `select`, matching `text`, `decimal`, `bigInt`, `calendarDay`, and `relationship`.

  ```typescript
  fields: {
    rank: integer({ isIndexed: true }),
    publishedAt: timestamp({ isIndexed: true }),
    status: select({
      options: [{ label: 'Draft', value: 'draft' }],
      isIndexed: 'unique',
    }),
  }
  ```

  `isIndexed: true` generates a block-level `@@index([field])`; `isIndexed: 'unique'` generates an inline `@unique`. `select` supports both under the default string column and a native-enum column (`db: { type: 'enum' }`). No field type's default indexing behavior changes — an existing config generates the same schema as before.

- [#1007](https://github.com/OpenSaasAU/stack/pull/1007) [`4ce64b4`](https://github.com/OpenSaasAU/stack/commit/4ce64b4f9868eca0f34cc0676e46440b3d8f16ce) Thanks [@borisno2](https://github.com/borisno2)! - The derived MCP `query` tool now accepts an optional `fields` projection — the wire form of the runtime's existing fragment field selection — so an assistant can select scalars and nested relation fields (with `where`/`orderBy`/`take`/`skip`, and a to-many's row count) in a single call instead of following a foreign key with a second one. Omitting `fields` is unchanged, a bare read exactly as before.

  ```json
  {
    "name": "list_post_query",
    "arguments": {
      "fields": {
        "title": true,
        "author": { "fields": { "name": true } },
        "comments": {
          "fields": { "text": true },
          "where": { "approved": { "equals": true } },
          "take": 5,
          "count": true
        }
      }
    }
  }
  ```

  The generated tool schema enumerates two levels of each list's own fields and relations, per session, and refuses (as an `isError` tool result, never a protocol error) anything it doesn't advertise — an unknown field, or a relation named a third level deep. See the ADR (`docs/adr/0033-mcp-tools-advertise-a-bounded-projection.md`) for the full design.

  **Behaviour change:** `tools/list` is now evaluated per session. A list whose operation-level `query` access denies the session outright no longer appears in the tool listing at all — none of its four CRUD tools, and no relation entry elsewhere pointing at it. Previously every list's tools were listed regardless of session.

- [#1002](https://github.com/OpenSaasAU/stack/pull/1002) [`48d2762`](https://github.com/OpenSaasAU/stack/commit/48d27626dfb636c481301116e46c826ef3156124) Thanks [@borisno2](https://github.com/borisno2)! - Fix admin UI URL round-trip for a list keyed with anything other than strict PascalCase (issue [#991](https://github.com/OpenSaasAU/stack/issues/991)). `getListKeyFromUrl` reconstructs a list key by string transformation, which is lossy for a non-PascalCase key — a real example is a better-auth plugin's derived list (e.g. `oauthApplication`, from the `mcp` plugin's OAuth tables). Such a list appeared in navigation but its own link resolved to a key that did not exist in `config.lists`, rendering "List not found".

  `@opensaas/stack-core` adds `resolveListKeyFromUrl(urlSegment, listKeys)` alongside the existing `getListKeyFromUrl`, which is unchanged and still exported. The new resolver matches a URL segment against the config's actual list keys via `getUrlKey` — the same helper that builds the URL — instead of reconstructing one, so route lookup and URL generation cannot drift apart. It returns `undefined` for a segment matching no list (so callers keep rendering their existing "not found" state), and throws if two distinct list keys would produce the same URL segment.

  ```typescript
  import { resolveListKeyFromUrl } from '@opensaas/stack-core'

  resolveListKeyFromUrl('oauth-application', Object.keys(config.lists)) // 'oauthApplication'
  resolveListKeyFromUrl('does-not-exist', Object.keys(config.lists)) // undefined
  ```

  `@opensaas/stack-ui`'s `AdminUI` now uses `resolveListKeyFromUrl` for its route resolution, fixing the broken link for any such list.

  `@opensaas/stack-auth`'s `convertBetterAuthSchema` now PascalCases a better-auth plugin's camelCase `modelName` when deriving a list key (`oauthApplication` → `OauthApplication`, `rateLimit` → `RateLimit`), matching the repo's PascalCase list-key convention and fixing the same round-trip bug at the source for these lists.

  **Schema-affecting for `@opensaas/stack-auth` users with a better-auth plugin that declares extra tables** (e.g. `mcp`'s OAuth tables, or `rateLimit.storage: 'database'` with no `modelName` remap configured): the generated Prisma **model name** changes to match the new PascalCase list key. The physical **table name** does not change — the previous camelCase name is preserved via `db.map` (`@@map`) — so `prisma db push` / `prisma migrate dev` sees a model rename, not a table rename, and `context.db.oauthApplication` (the camelCase db accessor) keeps working unchanged. Regenerate (`pnpm generate`) and re-run your migration/push step after upgrading.

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

- [#983](https://github.com/OpenSaasAU/stack/pull/983) [`16da817`](https://github.com/OpenSaasAU/stack/commit/16da8176114826d18d6747d27abedf75de6c3262) Thanks [@borisno2](https://github.com/borisno2)! - Fix `HashedPassword.toJSON()` returning the raw bcrypt hash, so `JSON.stringify` of a row (e.g. a server→client prop, `Response.json()`, an MCP tool response) no longer leaks the stored hash for a `password()` field.

  `toJSON()` now returns `{ isSet: boolean }`, matching the redaction the admin UI already applies via `valueForClientSerialization`. `toString()`, `valueOf()`, `[Symbol.toPrimitive]`, and `==` comparison against the hash are unchanged. If you parse `JSON.stringify`'d rows and read the password field as a string, update that code to read `.isSet` instead — this is a visible output/type change on `HashedPassword.toJSON()`, though the field's read access remains the application's to configure (unchanged).

- [#999](https://github.com/OpenSaasAU/stack/pull/999) [`f85c7d1`](https://github.com/OpenSaasAU/stack/commit/f85c7d1b92e76d5e8ae090f93c0ff94e0d6c36c1) Thanks [@borisno2](https://github.com/borisno2)! - MCP derived CRUD tool and custom tool failures (access denial, thrown engine/database errors, input schema validation) now return a successful JSON-RPC response with `result.isError: true` instead of a JSON-RPC `error` object, so the calling model can see and recover from them. Genuine protocol failures (unknown method, malformed request, unknown tool name) are unchanged. Note: the wire shape of tool failures changes — a consumer asserting on the old `error` shape will need to update.

- [#1006](https://github.com/OpenSaasAU/stack/pull/1006) [`0f2e12a`](https://github.com/OpenSaasAU/stack/commit/0f2e12a69710e759d8749b8536fd5b31836226e9) Thanks [@borisno2](https://github.com/borisno2)! - `relationship({ ref: 'ListName' })` list-only refs now accept `db.foreignKey: { map: '...' }` to rename the foreign key column. The boolean form (`true`/`false`) is still rejected there since ownership is implicit on a list-only ref.

- [#1004](https://github.com/OpenSaasAU/stack/pull/1004) [`05c747a`](https://github.com/OpenSaasAU/stack/commit/05c747a18284ac769860f751a660b72591570571) Thanks [@borisno2](https://github.com/borisno2)! - Fix a nested create/update/delete through a list-only ref's synthetic reverse relation (`from_<List>_<field>`) silently bypassing the target list's hooks and validation. It now runs the same pipeline a declared relationship field's nested write gets. Under `sudo()`, an undeclared key that isn't a synthetic reverse relation is now refused rather than passed through unchecked.

- [#1000](https://github.com/OpenSaasAU/stack/pull/1000) [`0b5b51e`](https://github.com/OpenSaasAU/stack/commit/0b5b51e52787ea9e945206a109a7a56dc38e78e5) Thanks [@borisno2](https://github.com/borisno2)! - Fix `P2002` unique-constraint errors losing per-field detail under Prisma 7 driver adapters (`@prisma/adapter-pg`, PGlite), where `meta.target` is left empty. The error handler now recovers the violated columns and constraint name from the adapter's error shape, and a new `uniqueConstraintOf(error)` helper exposes this to callers of `context.db.*` directly. Unique-violation messages under driver adapters change from the generic fallback back to field-specific text.

  > **Superseded.** The code literal above is dead — the ORM raises no `P`-prefixed codes (ADR-0042). A unique violation now arrives as a stack-owned `UniqueConstraintViolation` carrying the same per-field detail, tested with `isUniqueConstraintViolation(error)`.

- [#1001](https://github.com/OpenSaasAU/stack/pull/1001) [`52dfdd2`](https://github.com/OpenSaasAU/stack/commit/52dfdd2c051aa2f4b4cbd96a459213c34c3bf85c) Thanks [@borisno2](https://github.com/borisno2)! - Fix `include` on a to-one relationship throwing `PrismaClientValidationError` when the related list's `query` access resolves to a filter (Prisma only accepts a nested `where` on a to-many include). The relation is now fetched and access-scoped via a batched existence check instead, returning `null` for an excluded related row rather than throwing — a caller relying on the previous exception, or whose types assumed a non-null relation, should re-check nullability.

## 0.39.2

### Patch Changes

- [#960](https://github.com/OpenSaasAU/stack/pull/960) [`77ca919`](https://github.com/OpenSaasAU/stack/commit/77ca91931bc3de4051c1a40cc00b77158b8192e6) Thanks [@borisno2](https://github.com/borisno2)! - Fix `OutputConfig.opensaasDir`'s doc comment, which still listed the now-removed generated `prisma-extensions.ts` module among the bundle files.

## 0.39.1

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

- [#919](https://github.com/OpenSaasAU/stack/pull/919) [`cbb03fc`](https://github.com/OpenSaasAU/stack/commit/cbb03fc26047869d23513fbb156c6194d9be389b) Thanks [@borisno2](https://github.com/borisno2)! - Fix a fail-open bug where a field-level access rule returning a Prisma filter (instead of a boolean) silently granted the field full access. `checkFieldAccess` now throws `InvalidFieldAccessResultError` for any non-boolean result instead of defaulting to allow.

  This narrows `FieldAccessControl`'s return type from `boolean | PrismaFilter | Promise<...>` to `boolean | Promise<boolean>` — field-level access was already documented (ADR-0001) to be boolean-only; the type had drifted from that. If a field rule returned a filter, it will now fail to compile (or throw at runtime for untyped/JS configs) instead of silently granting access. Evaluate the condition yourself and return a boolean instead, e.g.:

  ```ts
  // Before (silently granted full access on read/write)
  someField: text({
    access: {
      update: ({ session }) => ({ ownerId: { equals: session?.userId } }),
    },
  })

  // After
  someField: text({
    access: {
      update: ({ session, item }) => !!session && session.userId === item?.ownerId,
    },
  })
  ```

  See `docs/adr/0030-field-level-access-fails-closed-on-a-non-boolean-result.md` for the full reasoning.

- [#925](https://github.com/OpenSaasAU/stack/pull/925) [`6f9a64d`](https://github.com/OpenSaasAU/stack/commit/6f9a64d2f25212e91181adc2b67add326a540f6a) Thanks [@borisno2](https://github.com/borisno2)! - Fix a field-level `read` gate withholding a field's VALUE but leaving its PREDICATE unconstrained: a read-denied field could still be named in a `where`/`orderBy`, letting its value (or relative order) be recovered by probing — `count()` is the cleanest instrument, since it answers a predicate while returning no rows at all. `findMany`/`count` now reject a `where`/`orderBy` key naming a field the session cannot read (including nested inside `AND`/`OR`/`NOT`), throwing instead of returning a silently narrowed or empty result. A `read` rule that depends on the fetched row (`item`) cannot be evaluated before the query runs and now resolves to a denial rather than being skipped — see `docs/adr/0031-a-predicate-cannot-name-a-field-the-session-cannot-read.md`. `sudo` is unaffected.

  This was independently reachable through the admin UI's own list view: `collectFilterSpecs`, `buildListFilterWhere`, and `collectFilterSuggestions` (`@opensaas/stack-core`) now take a required `{ session, context }` argument and return a `Promise`, excluding a read-denied field from the collected Filter specs so the UI never suggests, autocompletes, or submits a filter the engine is going to reject — a `field:value` token for such a field now degrades to free text instead. The list view's sort validation (`@opensaas/stack-ui`) excludes the same fields from what a `?sort=` URL param may activate.

  ```ts
  // Before
  const specs = collectFilterSpecs(listConfig, listKey, config)
  const where = buildListFilterWhere(query, listConfig, listKey, config)
  const suggestions = collectFilterSuggestions(listConfig, listKey, config)

  // After — pass the session/context the field's `read` access is checked against
  const specs = await collectFilterSpecs(listConfig, listKey, config, { session, context })
  const where = await buildListFilterWhere(query, listConfig, listKey, config, { session, context })
  const suggestions = await collectFilterSuggestions(listConfig, listKey, config, {
    session,
    context,
  })
  ```

- [#934](https://github.com/OpenSaasAU/stack/pull/934) [`9a399d6`](https://github.com/OpenSaasAU/stack/commit/9a399d68e4d3f384d4cef5ccd5fc8ec6802a40a5) Thanks [@list({](https://github.com/list({)! - `afterTransaction` now fires when the OUTERMOST transaction a write participates in settles, and can report `status: 'rolled-back'` where it always reported `'committed'` before (ADR-0028, fixes [#899](https://github.com/OpenSaasAU/stack/issues/899)).

  A write that joins a transaction it did not open — inside `context.transaction()`, or a hook's own `context.db` write — used to fire its `afterTransaction` bracket optimistically as soon as its own write returned, even though the enclosing transaction was still open and could still roll back. It now defers that bracket until the transaction owner (`context.transaction()`, or the Write Pipeline when it opened the transaction) observes the real commit/rollback, then reports the outcome as a conjunction: `committed` if and only if the write itself succeeded **and** the enclosing transaction committed (the write's own error always wins over the transaction's outcome). `beforeTransaction` is unaffected — it still runs eagerly, before its write.

  ```typescript

    hooks: {
      afterTransaction: async ({ status, item, error }) => {
        if (status === 'rolled-back') {
          // Now correctly fires even when this write itself succeeded but the
          // OUTER context.transaction() callback later threw.
          await billing.releaseSeat(error)
        } else {
          await billing.confirmSeat(item.seatId)
        }
      },
    },
  })
  ```

  Three behavior changes to be aware of when upgrading:

  > **Superseded in part.** The precedence rule below still holds, but the error it names does not: the ORM raises no `P`-prefixed codes, so a retry loop written against the code literal quoted below matches nothing (ADR-0042). A serialization failure is now a stack-owned error, tested with `isSerializationFailure(error)`.
  - A `context.transaction()` call can now **reject** with `AfterTransactionError` even after its underlying transaction already committed, if a deferred `afterTransaction` hook throws. A transaction/serialization error (e.g. `P2034`) still takes precedence and propagates unwrapped, so an existing `P2034` retry loop is unaffected.
  - The deferred `item` a joined write's `afterTransaction` receives on commit is the row **as that write persisted it**, captured at write time — not re-read at flush — so it can be stale if a later write in the same transaction touches the same record.
  - Transaction-boundary hooks (`beforeTransaction`/`afterTransaction`) on a joined write now always receive a context bound to the base client, never the transaction client — matching what top-level writes already did.

  A write with no transaction owner at all (an app-managed `prisma.$transaction`, or a client that cannot open one, e.g. a bare test mock) is unaffected and still fires `afterTransaction` optimistically at write time.

  See `docs/adr/0028-a-transaction-boundary-hook-reports-the-outermost-transaction.md` and the "In-transaction vs transaction-boundary hooks" section of the hooks concept doc.

- [#924](https://github.com/OpenSaasAU/stack/pull/924) [`05c9ad4`](https://github.com/OpenSaasAU/stack/commit/05c9ad40f8c4e76718d870e0c1c02511a3475943) Thanks [@borisno2](https://github.com/borisno2)! - Fix `FieldAccess['read']` typing `item` as absent when Field Visibility always passes the fetched row. A field `read` rule that reads a property off `item` now compiles without a cast, `any`, or non-null assertion:

  ```ts
  // Before (required a cast/assertion — `item` was typed `undefined`)
  internalNotes: text({
    access: {
      read: ({ item, session }) => item!.ownerId === session?.userId,
    } as FieldAccessControl,
  })

  // After (compiles as written — `item` is typed as the row)
  internalNotes: text({
    access: { read: ({ item, session }) => item.ownerId === session?.userId },
  })
  ```

  `FieldAccess['read']` now accepts only the single `operation: 'read'` call shape (rather than the full `read | create | update` union `FieldAccess['create']`/`FieldAccess['update']` still accept), so a rule written for the `read` slot never needs to narrow on `operation` to use `item`. The `create` branch — where there genuinely is no row yet — is unchanged.

### Patch Changes

- [#947](https://github.com/OpenSaasAU/stack/pull/947) [`5f00c3a`](https://github.com/OpenSaasAU/stack/commit/5f00c3a456295a1125281a4227309a8f8c6d853d) Thanks [@borisno2](https://github.com/borisno2)! - Clean up comments across `access/`, `config/`, `fields/`, `filter/`, `hooks/`, `lib/`, `mcp/`, `query/`, `utils/` and `validation/` per the CLAUDE.md Comments rule. No behavior changes.

- [#946](https://github.com/OpenSaasAU/stack/pull/946) [`4d8b654`](https://github.com/OpenSaasAU/stack/commit/4d8b654d099ce13d00893ebc4ce904fa69f2c47a) Thanks [@borisno2](https://github.com/borisno2)! - Restore two comments in `src/context/` that were trimmed too far in a prior comment cleanup ([#945](https://github.com/OpenSaasAU/stack/issues/945)). No behavior changes.

- [#920](https://github.com/OpenSaasAU/stack/pull/920) [`e0baadd`](https://github.com/OpenSaasAU/stack/commit/e0baaddade059cfea639d232f6953fc8c339f6f4) Thanks [@borisno2](https://github.com/borisno2)! - `findMany`/`count` now reject an undeclared `where`/`orderBy` key (including nested inside `AND`/`OR`/`NOT` or a relation filter), closing the same back-relation surface [#564](https://github.com/OpenSaasAU/stack/issues/564) closed on writes. `sudo` still bypasses.

- [#945](https://github.com/OpenSaasAU/stack/pull/945) [`ab4a5dd`](https://github.com/OpenSaasAU/stack/commit/ab4a5ddd83eebcf85d4a98f210cd378b974725f5) Thanks [@borisno2](https://github.com/borisno2)! - Clean up comments in `src/context/` per the CLAUDE.md Comments rule. No behavior changes.

- [#929](https://github.com/OpenSaasAU/stack/pull/929) [`94802ee`](https://github.com/OpenSaasAU/stack/commit/94802eee3b2fdc64fab4b576945820a6df9311c5) Thanks [@borisno2](https://github.com/borisno2)! - Fix: a relation filter in `where` (`some`/`every`/`none`/`is`/`isNot`) no longer bypasses the related list's `query` access — it is now scoped exactly like `include` already is, recursing through every hop of a chain, on both `findMany` and `count`. A filter through a related list that denies query access now throws `RelationFilterAccessDeniedError` instead of silently running unscoped; field-level `read` access on the related list also now applies to keys named inside the filter. `@opensaas/stack-ui`'s admin list view no longer needs its own relationship label-filter access fold, since the engine now covers it.

- [#931](https://github.com/OpenSaasAU/stack/pull/931) [`114302b`](https://github.com/OpenSaasAU/stack/commit/114302b95129484fadb6a1a640435ab1a5d2d102) Thanks [@borisno2](https://github.com/borisno2)! - Correct `ListIndex`/`db.indexes` doc comments, which wrongly claimed an entry must span two or more fields — a single-field entry is fully supported and now documented as such.

## 0.38.0

### Minor Changes

- [#873](https://github.com/OpenSaasAU/stack/pull/873) [`b21d8b2`](https://github.com/OpenSaasAU/stack/commit/b21d8b2af43f7a2a7ea10a89cfb39140a856bd68) Thanks [@borisno2](https://github.com/borisno2)! - Naming a relation in an `include` now fetches only that relation's own columns and stops, at every level — not just the root. This completes ADR-0024 (a bare read fetches scalars, never relations): reaching a relation's own relations means naming them too, e.g. `include: { author: { include: { organization: true } } }` rather than relying on `include: { author: true }` to pull `organization` in automatically. A relation nobody named (caller `include`, fragment `query`, or a field's `needs`) never has its list's operation-level `query` access evaluated at all.

  **This is a silent break — detect it before you upgrade.** An `include` that named a relation bare and read past it (`item.<named>[0].<unnamed>`) now gets `undefined` for the unnamed part, with no error. Grep your codebase for `include: {` calls whose consumers read a second hop off a bare-named relation, and add the deeper relation explicitly:

  ```typescript
  // Before: relied on `author` auto-expanding its own `organization` relation
  const post = await context.db.post.findUnique({
    where: { id },
    include: { author: true },
  })
  post.author.organization // silently undefined now

  // After: name the relation you actually need
  const post = await context.db.post.findUnique({
    where: { id },
    include: { author: { include: { organization: true } } },
  })
  post.author.organization // present
  ```

  `AccessScopeDepthExceededError` (thrown when an `include` names a relation past `READ_INCLUDE_MAX_DEPTH`) keeps its type, fields, and throw sites — only its message wording changed, from describing an inability to scope to describing a cost refusal, since the depth cap is now a cost limit rather than a security boundary (nothing walks the relationship graph unprompted anymore).

- [#890](https://github.com/OpenSaasAU/stack/pull/890) [`17eb72f`](https://github.com/OpenSaasAU/stack/commit/17eb72f0a9a4b7508e3f318da66bb8d4c6cbd705) Thanks [@list({](https://github.com/list({)! - A computed field — any field carrying a `resolveOutput` hook, virtual or not — is now computed if and only if a read is actually going to return it. A fragment `query` that selects three fields no longer runs every `resolveOutput` on the list and discards the rest: an unselected field's field-level read access is never evaluated and its hook never runs. Its declared relations (`needs`, ADR-0025) are fetched under exactly the same condition, folded recursively at every nesting level — a nested fragment selecting a subset computes only that subset, while a nested `include` still computes every computed field at that level, matching bare and `include`-based reads, which are unaffected: they still compute every computed field on the list, exactly as before. See ADR-0027.

  **This is a silent break — detect it before you upgrade, the same way ADR-0024's and ADR-0026's were.** Two independent behaviors changed with no thrown error:

  1. **A hook's `item` never carries another computed field's resolved output, on any read path.** Previously a virtual field received the already-assembled, already-resolved object, so a virtual field could read an _earlier-declared_ virtual (or any field carrying its own `resolveOutput`, e.g. a `password()`'s wrapper or a formatted display field) and see its resolved value — working only by declaration order, with reordering two fields silently changing the result. Now every computed field's hook sees only the row's stored columns and its own declared dependencies; reaching for a sibling that is itself computed finds nothing there (or its raw stored form, never the wrapped/resolved value), the same as reaching for a field that was never declared. **Grep your config for a `resolveOutput` whose `item` reads a field that is itself computed** — virtual fields reading other virtual fields, or a hook reading a stored field that carries its own `resolveOutput` (a password wrapper, a formatted date) — and recompute from the shared stored columns instead of relying on another field's hook having already run.
  2. **A field's hook no longer runs just because it's on the list — only because a read selects it.** If you relied on a `resolveOutput` hook running for a side effect (logging, cache warming) on every read regardless of a fragment's own field selection, that side effect now only fires when the fragment actually names the field. **Grep for a fragment `query` that intentionally omits a field whose hook you were relying on for a side effect**, and select that field explicitly (or move the side effect to a hook that isn't projection-gated, e.g. `afterOperation`).

  A hookless virtual field (one with `access.read` but no `resolveOutput`) no longer has its read access evaluated at all on any read — such a field can never produce output, so under this rule it does no work at all.

  ```typescript
  // Before: `displayName` (declared after `fullNameCached`) could read the
  // latter's resolved value purely because of declaration order.

    fields: {
      firstName: text(),
      lastName: text(),
      fullNameCached: virtual({
        type: 'string',
        hooks: { resolveOutput: ({ item }) => `${item.firstName} ${item.lastName}` },
      }),
      displayName: virtual({
        type: 'string',
        // item.fullNameCached is now always undefined here — recompute from
        // the shared stored columns instead.
        hooks: { resolveOutput: ({ item }) => `${item.fullNameCached} (${item.firstName[0]}.)` },
      }),
    },
  })

  // After: compute from the stored columns both fields actually share.
  displayName: virtual({
    type: 'string',
    hooks: {
      resolveOutput: ({ item }) => `${item.firstName} ${item.lastName} (${item.firstName[0]}.)`,
    },
  }),
  ```

### Patch Changes

- [#873](https://github.com/OpenSaasAU/stack/pull/873) [`b21d8b2`](https://github.com/OpenSaasAU/stack/commit/b21d8b2af43f7a2a7ea10a89cfb39140a856bd68) Thanks [@borisno2](https://github.com/borisno2)! - Fix `needs` declarations being dropped beneath a caller-named relation that revisits a list (e.g. `include: { author: { include: { posts: true } } }`, or a self-referential `parent`), which left the revisited list's computed fields resolving over `undefined`.

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

- [#870](https://github.com/OpenSaasAU/stack/pull/870) [`7b6189f`](https://github.com/OpenSaasAU/stack/commit/7b6189fa60119a45082ba62dd71d915d93de529c) Thanks [@relationship({](https://github.com/relationship({)! - A relationship field's foreign key can now be declared non-nullable via `db.isNullable: false` — the generated FK column and its relation field lose their `?` together. Omitting the option leaves every existing relationship unchanged (still nullable by default).

  ```typescript

    ref: 'User.sessions',
    db: { isNullable: false },
  })
  // Generates: userId String  (was String?)
  //            user   User    @relation(...)  (was User?)
  ```

  `@opensaas/stack-auth`'s derived Auth lists now use this to match better-auth's own Prisma schema: `Session.expiresAt`, `Verification.expiresAt`, and the `Session.user`/`Account.user` foreign keys generate as required instead of nullable.

  **Migration note:** this changes the generated schema for existing greenfield apps. Running `opensaas generate` followed by `prisma db push`/`prisma migrate dev` will produce a migration that adds `NOT NULL` to `Session.expiresAt`, `Verification.expiresAt`, `Session.userId`, and `Account.userId`. Since better-auth's own adapter always writes these columns, no existing row should violate the new constraint — but back up production data before applying, as with any schema migration.

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

## 0.34.0

### Minor Changes

- [#846](https://github.com/OpenSaasAU/stack/pull/846) [`fedc858`](https://github.com/OpenSaasAU/stack/commit/fedc858f41bf5cacf001f64e7b710112f2fce20b) Thanks [@borisno2](https://github.com/borisno2)! - Fix unbounded recursion when a `resolveOutput` hook issues its own read ([#844](https://github.com/OpenSaasAU/stack/issues/844)): a hook's read could return rows whose own `resolveOutput` hooks issued further reads with no bound, driving the process to the V8 heap limit on a cyclic readable-relationship graph.

  Reads are now tracked with a resolve chain — the ordered `(list, field)` pairs a read has entered via `resolveOutput` hooks. A hook that would re-enter a pair already on its own chain throws the new `ResolveOutputCycleError` naming the full chain, instead of recursing forever:

  ```ts
  import { ResolveOutputCycleError } from '@opensaas/stack-core'

  try {
    await context.db.user.findMany({})
  } catch (err) {
    if (err instanceof ResolveOutputCycleError) {
      // err.chain: readonly { listKey: string; fieldKey: string }[]
    }
  }
  ```

  An acyclic chain that runs deeper than `RESOLVE_CHAIN_MAX_LENGTH` (a cost limit, not a correctness guard) omits the field and logs a single `console.warn` instead of throwing — a legitimately terminating hook chain (e.g. a virtual field reading another virtual field several hops deep) is never denied.

  This also fixes a related bug where a plain top-level read running concurrently with an unrelated in-flight `resolveOutput` hook could have its own nested auto-include silently collapsed, because the previous implementation tracked "am I inside a hook?" on one mutable counter shared by the whole request.

  **Breaking (internal plumbing only):** `AccessContext`'s underscore-prefixed `_resolveOutputCounter: { depth: number }` is replaced by `_resolveOutputChain: readonly { listKey: string; fieldKey: string }[]`. Application code never reads this field. Hand-built `AccessContext` mocks in tests need a one-line update:

  ```ts
  // Before
  _resolveOutputCounter: {
    depth: 0
  }
  // After
  _resolveOutputChain: []
  ```

## 0.33.0

### Minor Changes

- [#838](https://github.com/OpenSaasAU/stack/pull/838) [`0caf680`](https://github.com/OpenSaasAU/stack/commit/0caf68007e41b69f1a5d5f74fb15df2548a559dc) Thanks [@borisno2](https://github.com/borisno2)! - **Behavior change:** reads that previously returned deeply-nested relation data unscoped now throw instead. A caller-supplied `include` nested past the Access Filter's read-include depth cap (`READ_INCLUDE_MAX_DEPTH`, 5) used to fail OPEN — the relation was fetched with no row filter and its fields were never access-checked or `resolveOutput`-processed. It now fails CLOSED: the read throws a new `AccessScopeDepthExceededError` (exported from `@opensaas/stack-core`) naming the list, relation field, and depth reached, instead of returning unscoped data.

  ```typescript
  import { AccessScopeDepthExceededError } from '@opensaas/stack-core'

  try {
    await context.db.post.findMany({
      include: { author: { include: {/* … nested past the depth cap */} } },
    })
  } catch (err) {
    if (err instanceof AccessScopeDepthExceededError) {
      // err.listKey / err.fieldKey / err.depth — restructure into shallower reads.
    }
  }
  ```

  An ordinary read with no caller `include`, or one within the depth limit, is unaffected — the auto-include still stops silently at the cap, matching prior behavior. A read issued from inside a `resolveOutput`/virtual-field hook now also row-scopes its immediate relations (previously it skipped scoping entirely at that point). Field-level read access and `resolveOutput` hooks are now applied at every nesting depth on the returned rows, with no independent cap of their own. See ADR-0022 and issue [#830](https://github.com/OpenSaasAU/stack/issues/830).

### Patch Changes

- [#839](https://github.com/OpenSaasAU/stack/pull/839) [`1a3f51d`](https://github.com/OpenSaasAU/stack/commit/1a3f51d5837d6e5244ccf04c3d14c41c264701c3) Thanks [@borisno2](https://github.com/borisno2)! - Fix `beforeTransaction`/`afterTransaction` hooks not firing for lists reachable only past the involved-list enumeration's old fixed depth cap. These hooks now fire for every list a write touches regardless of nesting depth, so compensation logic that previously never ran will start running — that was a bug, not a contract.

## 0.32.0

## 0.31.1

## 0.31.0

### Minor Changes

- [#750](https://github.com/OpenSaasAU/stack/pull/750) [`047487a`](https://github.com/OpenSaasAU/stack/commit/047487adf502f10f7f6774ff52c38c70d465f533) Thanks [@borisno2](https://github.com/borisno2)! - Add a `bulkDelete` server action for list-level bulk deletion

  `context.serverAction` now accepts `{ listKey, action: 'bulkDelete', ids }`. It
  deletes each id row-by-row through the secured context, honouring Silent failure
  (a denied or missing row returns `null` and is not counted; one row's error does
  not abort the rest), and returns `{ deleted, total }`.

  The result is deliberately a count shape rather than the single-op `{ success }`
  shape, so a UI `serverAction` wrapper that redirects on a single-item success
  (the item-form pattern) does not hijack a list-level bulk operation.

  ```ts
  const result = await context.serverAction({
    listKey: 'Post',
    action: 'bulkDelete',
    ids: ['a', 'b', 'c'],
  })
  // result: { deleted: 2, total: 3 }  // one row was denied/missing
  ```

- [#755](https://github.com/OpenSaasAU/stack/pull/755) [`9cd06dd`](https://github.com/OpenSaasAU/stack/commit/9cd06dddb45512966affc3a6b3455e97595c0de2) Thanks [@list({](https://github.com/list({)! - Admin chrome polish: opt-in nav counts and avatar label cells ([#735](https://github.com/OpenSaasAU/stack/issues/735))

  Two per-list opt-ins for the admin UI, both off by default.

  **Nav counts** — set `ui.navCount: true` on a list to show an access-scoped
  record count next to its nav item. The count is fetched through the secured
  context, so it only ever reflects what the current session may see; no count
  query runs for lists that don't opt in, and a list whose query access is
  statically denied renders no count rather than a misleading zero.

  ```typescript
  lists: {
    Post: list({
      fields: {
        /* ... */
      },
      ui: { navCount: true },
    }),
  }
  ```

  **Avatar label cells** — set `ui.avatar: true` to render a list's label column
  with a deterministic initials bubble ahead of the emphasized Item label. The
  initials and colour derive from the row; the palette is Theme-token-derived (no
  raw hex). A per-field cell override (`ui.cell`) on the label field still wins.

  ```typescript
  lists: {

      fields: {
        /* ... */
      },
      ui: { avatar: true },
    }),
  }
  ```

  New exports:

  - `@opensaas/stack-core`: `resolveNavCounts`, `isListQueryStaticallyDenied`
  - `@opensaas/stack-ui`: `Avatar` primitive, `AvatarLabelCell`, and the
    `getInitials`, `getAvatarTone`, `AVATAR_TONES` helpers. New Slots:
    `avatar`, `cell-avatar-label`, `nav-count`.

- [#759](https://github.com/OpenSaasAU/stack/pull/759) [`b190813`](https://github.com/OpenSaasAU/stack/commit/b190813a4531bd01b3206845b2c531099e0a204a) Thanks [@borisno2](https://github.com/borisno2)! - Add custom Bulk actions from list config (admin list view)

  A list can now declare list-specific Bulk actions under `ui.listView.bulkActions`. Each action's button renders in the list view's selection bar (in declaration order) alongside the built-in Delete. The action's server-side `handler` receives the selected ids and the secured context, so all its work runs through access control and hooks — a denied row is a Silent failure absorbed into the outcome, never leaked.

  ```typescript
  Post: list({
    fields: { title: text(), status: select({ options: [/* ... */] }) },
    ui: {
      listView: {
        bulkActions: [
          {
            key: 'publish',
            label: 'Publish',
            // Optional: `variant`, `destructive` (confirm first),
            // `hasAccess` (server-side visibility gate).
            handler: async ({ ids, context }) => {
              let n = 0
              for (const id of ids) {
                const updated = await context.db.post.update({
                  where: { id },
                  data: { status: 'published' },
                })
                if (updated) n++
              }
              return { message: `Published ${n} of ${ids.length}` }
            },
          },
        ],
      },
    },
  })
  ```

  Only serialisable metadata (`key`/`label`/`variant`/`destructive`) crosses to the client; the `handler`/`hasAccess` functions stay on the server. Clicking the button sends the `key` and selected ids back through the generic server action, which looks the handler up and runs it with a freshly-rebuilt secured context. Selection is enabled for a list that has custom actions even when Delete is denied. CSV export is documented as a recipe using this surface rather than shipping as a built-in.

- [#754](https://github.com/OpenSaasAU/stack/pull/754) [`f67cd79`](https://github.com/OpenSaasAU/stack/commit/f67cd798724712a90d7ada8f28202d3d6371693f) Thanks [@borisno2](https://github.com/borisno2)! - Add the Filter builder input UI for the admin list view ([#731](https://github.com/OpenSaasAU/stack/issues/731))

  The admin list view now ships a `FilterBuilder` that constructs the `?search=`
  filter query the filter engine already consumes (ADR-0017) — a free-text search
  box plus structured field / operator / value rows. Available fields, operators,
  and value suggestions are derived entirely from each field's self-contained
  `getFilterSpec` (via the serializable `collectFilterSuggestions` metadata), so
  there is no field-type `switch` and no functions cross the server/client
  boundary. Applied filters flow through the same secured `context.db`, so
  filtering can only ever narrow what a session may see.

  `@opensaas/stack-core` gains `serializeFilterQuery(tokens)` — the exact inverse
  of `parseFilterQuery` — so the builder produces the grammar the engine parses
  with the quoting and operator-prefix rules kept next to the parser.

  The `FilterBuilder` is composable (exported from `@opensaas/stack-ui` and
  `@opensaas/stack-ui/standalone`) with theme-token styling and `data-slot` parts
  for extension:

  ```tsx
  import { FilterBuilder } from '@opensaas/stack-ui/standalone'
  import { collectFilterSuggestions } from '@opensaas/stack-core'

  // Server component: collect serializable suggestion metadata for the list.
  const suggestions = collectFilterSuggestions(listConfig, 'Post', config)

  // Client: build and apply a `?search=` query.
  <FilterBuilder
    suggestions={suggestions}
    defaultValue={search}
    onApply={(query) => router.push(`/admin/post?search=${encodeURIComponent(query)}`)}
  />
  ```

  The list view wires this in automatically; existing `?search=` URLs keep
  working unchanged.

- [#746](https://github.com/OpenSaasAU/stack/pull/746) [`dcb10e2`](https://github.com/OpenSaasAU/stack/commit/dcb10e27c28a8a8f9a5e625f550ac5c750436eb6) Thanks [@borisno2](https://github.com/borisno2)! - Add the admin UI filter engine: a Filter spec field-builder contract and URL-driven server-side list filtering (ADR-0017).

  Fields now declare their filtering capability through a new optional `getFilterSpec` method — a peer of `getPrismaType`/`getTypeScriptType` on the field-builder contract. It reports the operators a field supports, a pure token→condition mapper, and serializable suggestion metadata. Core field types implement it (text contains + free text, integer/decimal/timestamp/calendarDay comparisons, select/checkbox equality against enumerated values, relationship by label lookup). A field without a spec — `password`, `json`, `virtual`, or any third-party field that hasn't adopted one — is simply not filterable, so the addition degrades gracefully everywhere.

  The admin list view now parses the URL filter query (the list's `search` param) through the engine and merges the result into the access-controlled query via the secured context, so filtering runs server-side and can only ever narrow — never widen — what a session may see. This replaces the previous hard-coded `type === 'text'` search; free-text behavior is now driven by each text field's Filter spec.

  Grammar (ADR-0017): implicit-AND tokens, quoted multi-word values, `>`/`>=`/`<`/`<=` comparisons on numeric/date fields, and bare words as free text. Unknown syntax degrades to free text, never errors.

  Multi-word free-text UX shift (intentional, per ADR-0017): bare words now combine with AND, so `hello world` requires each word to match separately (not the literal substring `hello world`). To match a contiguous phrase, quote it: `"hello world"`. A pasted URL such as `http://x` is treated as a single free-text token and searched verbatim — the `http:` prefix is not parsed as a field.

  New exports from `@opensaas/stack-core`:

  ```typescript
  import {
    parseFilterQuery, // (query) => FilterToken[]  — pure
    buildFilterWhere, // (tokens, specs) => where   — pure
    collectFilterSpecs, // (listConfig, listKey, config) => specs
    buildListFilterWhere, // (query, listConfig, listKey, config) => where
    collectFilterSuggestions, // serializable autocomplete metadata
  } from '@opensaas/stack-core'

  // e.g. "status:Published views:>10 author:\"Ada Lovelace\" beta"
  const where = buildListFilterWhere(query, listConfig, listKey, config)
  const rows = await context.db.post.findMany({ where }) // ANDed with the access filter
  ```

  Third-party field authors can implement `FilterSpec` (exported from `@opensaas/stack-core/extend`) to make their field filterable.

- [#760](https://github.com/OpenSaasAU/stack/pull/760) [`f8b6f02`](https://github.com/OpenSaasAU/stack/commit/f8b6f02c18322d0d04a7c3cc82e579d0ba9a2da9) Thanks [@borisno2](https://github.com/borisno2)! - Add inline cell editing to admin Relationship tables

  Cells in a to-many Relationship table on the item view are now editable in place.
  Click a cell to edit it, commit with Enter or blur, cancel with Escape. Each
  commit is a single-field update on the **related** row through the secured
  context, so the related list's own operation- and field-level update access plus
  its hooks/validation apply — never the parent's. The update is optimistic and
  reverts, with a visible reason, on a Silent failure (access denied / row gone) or
  a validation error (inline field errors surface too). Committed values re-render
  through the Cell registry, so select cells stay coloured badges.

  A field the session cannot write — or a table whose related-list update access is
  statically denied — renders read-only with no edit affordance; row-level
  (filter-scoped) denials surface at commit as a revert. Non-editable cells keep
  click-to-navigate; main list tables are unchanged (this is Relationship-table
  only).

  - `@opensaas/stack-core`: the generic server action gains a distinct
    `updateRelated` result shape (`{ updated, error?, fieldErrors? }`), and
    `checkFieldAccess` is exposed on `@opensaas/stack-core/internal` so the UI can
    decide the edit affordance without a parallel field-access evaluator.
  - `@opensaas/stack-ui`: `RelationshipTableClient` accepts `editableColumns`; the
    editable cell reuses the field-component registry for its editor and the Cell
    registry for its display (new Slots: `relationship-table-cell-display`,
    `relationship-table-cell-editor`, `relationship-table-cell-edit-trigger`,
    `relationship-table-cell-error`).

- [#757](https://github.com/OpenSaasAU/stack/pull/757) [`c05701e`](https://github.com/OpenSaasAU/stack/commit/c05701e523815b8f411a6d39e57bbb9317dc2a9d) Thanks [@borisno2](https://github.com/borisno2)! - Add a pre-linked create drawer to read-only Relationship tables (issue [#738](https://github.com/OpenSaasAU/stack/issues/738))

  The item view's read-only Relationship tables now offer a "+ Add" control that
  opens a drawer hosting the related list's create form, with the back-reference to
  the current record preset and hidden. On submit the new row is created through
  the secured context already linked to the parent, then the drawer closes and the
  table refreshes.

  Create-and-link semantics (ADR-0018): the create runs on the RELATED list, so
  the related list's own `create` access control, hooks, and field-level access
  apply — never the parent's. The back-reference is set on the server from the
  field/parent id (never trusted from the client payload). The "+ Add" is shown
  only when a back-reference exists to preset the link and the related list's
  `create` access is not statically denied; a filter/function-scoped denial
  surfaces at commit time as a generic error (no denied-vs-absent leak).

  New generic server action (`@opensaas/stack-core`):

  ```ts
  await context.serverAction({
    listKey: 'Post', // the RELATED list
    action: 'createRelated',
    data: { title: 'Hello', slug: 'hello' },
    field: 'author', // the back-reference field on Post
    parentId: user.id, // the record being edited
  })
  // → { created: true, id } | { created: false, error?, fieldErrors? }
  ```

  The drawer (`RelationshipCreateDrawer` from `@opensaas/stack-ui`) mounts on the
  existing `relationship-table-toolbar` seam and reuses the shared item-form engine
  and field-component registry, so the related list's full validation and required
  fields are enforced even when a required field is not one of the table's columns.

- [#756](https://github.com/OpenSaasAU/stack/pull/756) [`8199238`](https://github.com/OpenSaasAU/stack/commit/81992382290f356071955f16efd14f7771045a16) Thanks [@list({](https://github.com/list({)! - Add relationship-table row removal to the admin item view (ADR-0018)

  Each read-only Relationship table row now has a ✕ removal control. By default it
  **disconnects** the related row from the current record (non-destructive — the
  row survives and still appears on its own list), gated on the related list's
  update access. A per-relationship opt-in truly deletes the related row (behind a
  confirmation, gated on the related list's delete access), or hides the control
  entirely. Where the schema makes disconnect impossible (a required foreign key on
  the related side) the control is hidden unless delete is opted in. Removals run
  through the secured context, so an access-denied removal is a Silent failure: the
  row stays with a visible reason.

  Configure per relationship via `ui.itemView.removeAction`:

  ```typescript

    fields: {
      // Default: ✕ disconnects the post (it still exists).
      posts: relationship({ ref: 'Post.author', many: true }),
      // Opt in to destructive delete (confirmed).
      notes: relationship({
        ref: 'Note.owner',
        many: true,
        ui: { itemView: { removeAction: 'delete' } }, // 'disconnect' (default) | 'delete' | 'none'
      }),
    },
  })
  ```

  `@opensaas/stack-core` adds a `removeRelated` server action (distinct
  `{ removed }` result shape, like `bulkDelete`, so a redirect-on-success wrapper
  never hijacks an in-place removal) and the `RelationshipItemViewConfig.removeAction`
  option.

- [#745](https://github.com/OpenSaasAU/stack/pull/745) [`4d99e91`](https://github.com/OpenSaasAU/stack/commit/4d99e910b61c6196564a7248abf3d32b1d6be883) Thanks [@borisno2](https://github.com/borisno2)! - Add a Cell registry with default cells for core field types

  List tables now render every value through a **Cell** resolved by a
  cell-component registry that mirrors the form-field registry's priority chain:
  per-field override → custom type registry → field-type registry → plain-text
  fallback. Each core field type ships a default Cell — text (plain), integer
  (tabular figures), select (coloured Badge), timestamp (formatted date), checkbox
  (mark), and to-one relationship (Item label link). Unknown/third-party types
  without a registered Cell fall back to plain text.

  Select options gain optional, additive per-option UI metadata mapping a value to
  a badge variant. Existing options keep working unchanged; unmapped options render
  the neutral badge.

  ```typescript
  // opensaas.config.ts — colour a status value in list-table cells
  status: select({
    options: [
      { label: 'Draft', value: 'draft', ui: { variant: 'secondary' } },
      { label: 'Published', value: 'published', ui: { variant: 'success' } },
    ],
  })
  ```

  Register a Cell for a custom/third-party field exactly as you register its form
  component, or override a single field's Cell:

  ```typescript
  'use client'
  import { registerCellComponent } from '@opensaas/stack-ui'
  registerCellComponent('myField', MyCell)

  // or per-field override (highest priority)
  price: integer({ ui: { cell: CurrencyCell } })
  ```

- [#751](https://github.com/OpenSaasAU/stack/pull/751) [`20459b5`](https://github.com/OpenSaasAU/stack/commit/20459b5a7f8b2578342509442d36017cfa2f08f6) Thanks [@list({](https://github.com/list({)! - Derive the admin item view from the list shape, with read-only Relationship tables and a totals footer ([#734](https://github.com/OpenSaasAU/stack/issues/734))

  A record's edit page now derives its layout from the list's shape. Scalar and
  to-one fields stay in a details card (whole-form Save/Cancel, unchanged), and
  each to-many relationship renders as a read-only **Relationship table**: one
  to-many relationship gives a two-column split, none gives a single centered
  card, several stack. Table columns default to the related list's own column
  curation minus the back-reference to the parent, cells come from the cell
  registry, and a totals footer always shows the row count plus sums for any
  explicitly-configured numeric columns (each formatted by that column's Cell).
  Rows are fetched through the secured context, so only access-visible data shows.
  Rows are read-only here — a row click navigates to the related record.

  `@opensaas/stack-core` gains additive item-view config (no breaking changes):

  ```typescript
  lists: {

      fields: {
        posts: relationship({
          ref: 'Post.author',
          many: true,
          ui: {
            itemView: {
              // Override the Relationship table's columns…
              columns: ['title', 'status', 'viewCount'],
              // …and sum numeric columns in the totals footer.
              sum: ['viewCount'],
              // Or demote it back to the compact picker in the details card:
              // displayMode: 'picker',
            },
          },
        }),
      },
      // Reorder the Relationship-table sections:
      ui: { itemView: { order: ['posts'] } },
    }),
  }
  ```

  New `@opensaas/stack-ui` exports: `RelationshipTable`, `RelationshipTableClient`,
  and the pure `deriveItemViewLayout` helper (with `ItemViewLayout`,
  `ItemViewArrangement`, `RelationshipTableSection`). The Relationship table ships
  named Slots (`relationship-table`, `relationship-table-toolbar`,
  `relationship-table-row`, `relationship-table-cell`, `relationship-table-footer`)
  as extension seams for the follow-up inline-edit, create-drawer, and row-removal
  work.

- [#774](https://github.com/OpenSaasAU/stack/pull/774) [`62a1612`](https://github.com/OpenSaasAU/stack/commit/62a16127c7b6610a35fb239911eff3486de585be) Thanks [@borisno2](https://github.com/borisno2)! - Bound the admin item-view Relationship tables with a `take` and a "showing N of M" footer

  The read-only Relationship tables on a record's edit page (issue [#734](https://github.com/OpenSaasAU/stack/issues/734)) previously
  fetched every related row unbounded. They now fetch a bounded page of related rows
  and surface the full access-scoped total in the footer.

  - **Bounded fetch:** each to-many Relationship table fetches at most a default cap
    of related rows (`DEFAULT_ITEM_VIEW_TAKE`, 10), overridable per relationship via
    `ui.itemView.take`. Rows are still fetched through the secured context, so only
    access-visible rows come back.
  - **"Showing N of M" footer:** the totals footer now reads `Showing N of M rows`,
    where N is the rendered (bounded) count and M is the full access-scoped total,
    fetched via a filtered `_count` that folds the related list's own `query` access
    in (mirroring the list view's count columns). A fully-denied related list reads
    `Showing 0 of 0` and never leaks a true total. The row count is always shown,
    including the zero-column footer path.

  ```typescript
  sessions: relationship({
    ref: 'Session.user',
    many: true,
    // Cap this table at 5 rows; the footer still shows the full access-scoped total.
    ui: { itemView: { take: 5 } },
  })
  ```

  Core: `mergeIncludeWithAccessControl` now preserves a caller-supplied `take` on a
  to-many relation include (it only narrows the fetch, never widening past the access
  `where`), so the secured `findUnique`/`findMany` include can bound related-row reads.

- [#764](https://github.com/OpenSaasAU/stack/pull/764) [`c210319`](https://github.com/OpenSaasAU/stack/commit/c210319c3b25ff74d832d3c2ec5d3253d5d8b832) Thanks [@list({](https://github.com/list({)! - Admin list view: to-many relationship columns render an access-visible count, sort by relation count, and filter by numeric count comparisons (issue [#732](https://github.com/OpenSaasAU/stack/issues/732)). Virtual fields render via their Cell but are excluded from sorting and filtering.

  A to-many relationship used as a list column now shows the count of the related rows the session may see — fetched in the SAME query via a filtered Prisma `_count`, with the related list's `query` access folded into the count's `where`, so it never counts rows the session cannot read and issues no per-row query. Clicking the column header sorts by relation `_count`, and its Filter spec offers numeric comparisons on the count (`posts:>5`) in the filter builder and in shared URLs.

  Because Prisma cannot compare a relation count in a `where`, a to-many relationship's Filter spec emits a structured count marker that is resolved to an access-scoped `{ id: { in } }` before the query runs, through the secured context.

  New `@opensaas/stack-core` exports: `buildRelationshipCountSelect`, `resolveRelationshipCountFilters`, `isToManyRelationshipField`, and `RELATIONSHIP_COUNT_FILTER_KEY` (with the `RelationshipCountFilterMarker` type).

  ```ts
  // A to-many relationship column now shows an access-scoped count and is
  // sortable / filterable by that count — zero config:

    fields: {
      name: text(),
      posts: relationship({ ref: 'Post.author', many: true }),
    },
  })
  // List view: the `posts` column renders the count; its header sorts by count;
  // `posts:>5` filters by count in the builder and in a shared URL.
  ```

### Patch Changes

- [#773](https://github.com/OpenSaasAU/stack/pull/773) [`5a60291`](https://github.com/OpenSaasAU/stack/commit/5a602916f30535604b590b875c363f21930a109f) Thanks [@borisno2](https://github.com/borisno2)! - Harden `createRelated` server action: reject malformed calls that supply only one of `field`/`parentId`, and validate that the back-reference names a relationship field before injecting the parent connect.

- [#775](https://github.com/OpenSaasAU/stack/pull/775) [`2fcb582`](https://github.com/OpenSaasAU/stack/commit/2fcb5820bc00d9d432265d1ba01404097e296e8e) Thanks [@borisno2](https://github.com/borisno2)! - Return a generic "Action failed" message (and log the real error server-side) when a custom bulk-action handler throws an unexpected non-Prisma error, instead of surfacing its internal message to the client

- [#771](https://github.com/OpenSaasAU/stack/pull/771) [`85c7fc3`](https://github.com/OpenSaasAU/stack/commit/85c7fc3b3a0090a986cafa0e46b1798f237264da) Thanks [@borisno2](https://github.com/borisno2)! - Harden relationship count-filter resolution: preserve any sibling conditions co-present in a `_countFilter` marker's AND-member instead of replacing it wholesale, and document why the secured count read intentionally keeps its full projection (`context.db` does not honour `select`).

- [#780](https://github.com/OpenSaasAU/stack/pull/780) [`55d55e0`](https://github.com/OpenSaasAU/stack/commit/55d55e0a1ed9521b6e31283524d9194a9420059a) Thanks [@borisno2](https://github.com/borisno2)! - Fix a to-one relationship filter token (e.g. `author:Ada`) leaking related-list data by ANDing the related list's `query` access filter into the nested condition instead of running it unscoped.

- [#794](https://github.com/OpenSaasAU/stack/pull/794) [`96e1067`](https://github.com/OpenSaasAU/stack/commit/96e1067661c7ebc8e23896086fec7428e475dd03) Thanks [@borisno2](https://github.com/borisno2)! - Fix multi-column fields (e.g. storage `image()`/`file()` in Keystone-parity mode) writing an unrecognised value silently instead of failing validation. The column split now runs after `validateFieldRules`, not before, at the top-level and nested write paths.

## 0.30.0

### Minor Changes

- [#744](https://github.com/OpenSaasAU/stack/pull/744) [`5e135ef`](https://github.com/OpenSaasAU/stack/commit/5e135ef635dd7cd97ab106f46fbf808250aa079e) Thanks [@borisno2](https://github.com/borisno2)! - MCP runtime: serve plugin-registered tools, support Zod input schemas, and pass custom session fields through to access control

  - Tools registered by plugins via `registerMcpTool` (e.g. the RAG plugin's `semantic_search_*` tools) are now listed by `tools/list` and callable via `tools/call` — previously they were stored but never served.
  - Custom tool `inputSchema` may now be a Zod schema or a plain JSON Schema object. Zod schemas are converted to JSON Schema for `tools/list` and validated on `tools/call` (invalid input returns a JSON-RPC `-32602` error):

  ```typescript
  mcp: {
    customTools: [
      {
        name: 'publish_post',
        description: 'Publish a draft post',
        inputSchema: z.object({ id: z.string() }),
        handler: async ({ input, context }) => {
          return context.db.post.update({
            where: { id: input.id },
            data: { status: 'published' },
          })
        },
      },
    ]
  }
  ```

  - MCP sessions now pass custom fields through to access control. Transport fields (`accessToken`, `expiresAt`, `scopes`) are stripped; everything else — `userId` plus any fields your session provider attaches (email, role, ...) — reaches `context.session`, so session-based access rules behave consistently over MCP.

### Patch Changes

- [#741](https://github.com/OpenSaasAU/stack/pull/741) [`afa865f`](https://github.com/OpenSaasAU/stack/commit/afa865f62ed7968b494a87e0621cf71bacd36f39) Thanks [@borisno2](https://github.com/borisno2)! - Update documentation links to the restructured docs site URLs (Diátaxis layout)

## 0.29.0

### Minor Changes

- [#725](https://github.com/OpenSaasAU/stack/pull/725) [`f51cef8`](https://github.com/OpenSaasAU/stack/commit/f51cef876d6376e4e2bc8ac990229ff60e232bb1) Thanks [@borisno2](https://github.com/borisno2)! - Wire field help text through the admin renderer via `ui.description`

  Field authors can now set help/description text on a field's `ui.description`
  and have it render beneath the control in the prebuilt admin UI. `FieldRenderer`
  surfaces `ui.description` to the rendered field component as its `helpText` prop,
  which displays through the shared field-shell `FieldHelp` (data-slot="field-help").
  Previously `helpText` only worked when a field component was composed by hand.

  ```typescript
  fields: {
    slug: text({
      ui: { description: 'URL-friendly identifier, lowercase only.' },
    }),
  }
  ```

  The option is optional and non-breaking; fields without a description render no
  help text, exactly as before.

- [#713](https://github.com/OpenSaasAU/stack/pull/713) [`56e9f9b`](https://github.com/OpenSaasAU/stack/commit/56e9f9b0a4d1920662cf0564682e767993917b56) Thanks [@borisno2](https://github.com/borisno2)! - Add the theming token contract and a pure `ui.theme` compiler, proven end-to-end through Button.

  The UI package stylesheet now defines the full Theme token vocabulary as a single, un-driftable contract: the shadcn color set plus `success`/`warning` (with foregrounds) and a `gradientFrom`/`gradientTo` pair, `--font-sans`/`--font-mono`/`--font-heading` (heading defaults to sans), a single `--radius` knob with derived sm/md/lg sizes, and `--shadow-sm`/`--shadow-md`/`--shadow-lg` — all with light and dark values side by side via `light-dark()`.

  `ThemeConfig` is a clean break (ADR-0015). Colors accept any valid CSS color string and are emitted verbatim — the compiler never parses colors. Bare HSL triplets (`'220 20% 97%'`) are no longer accepted and fire a dev-mode warning suggesting an `hsl()` wrap.

  ```typescript
  ui: {
    theme: {
      preset: 'modern', // 'modern' | 'classic' | 'neon'
      colors: { primary: '#16a34a' }, // hex, oklch(...), rgb(...), hsl(...)
      darkColors: { primary: '#4ade80' },
      fonts: { sans: 'var(--font-inter), system-ui, sans-serif' }, // compose with next/font
      radius: 0.5, // rem
      shadows: { sm: 'none', md: 'none', lg: 'none' }, // flat theme
    },
  }
  ```

  The config layer compiles onto the same CSS custom properties the stylesheet declares, so the two can never drift. `Button` is restyled to consume only these tokens (color, radius, shadow, font) and carries a stable `data-slot="button"`.

  Migration: wrap any old bare-triplet color value in `hsl()` (`'220 20% 97%'` → `'hsl(220 20% 97%)'`). Preset-only configs need no changes.

## 0.28.0

### Minor Changes

- [#696](https://github.com/OpenSaasAU/stack/pull/696) [`0bcfb4a`](https://github.com/OpenSaasAU/stack/commit/0bcfb4a6f1183ee75017bee73566f5aaa3b5408e) Thanks [@borisno2](https://github.com/borisno2)! - `Plugin['runtime']` now receives a `sudo` helper as a second argument — `runtime(context, sudo)` — mirroring `StackContext.sudo()` one layer lower. Call `sudo().db` for reads/writes that must bypass access control but still run hooks, for example a plugin's identity lookup that shouldn't depend on the caller's own list access policy. `sudo` is a plain function argument, not a method on `context` (`AccessContext`) itself.

### Patch Changes

- [#690](https://github.com/OpenSaasAU/stack/pull/690) [`aec907f`](https://github.com/OpenSaasAU/stack/commit/aec907f29b31ca507831d729182938975ec4b4fa) Thanks [@borisno2](https://github.com/borisno2)! - Fix relationship live-search 500 when the target list's label field is a virtual field by ordering by `id` instead of the non-orderable virtual column

- [#695](https://github.com/OpenSaasAU/stack/pull/695) [`fd64913`](https://github.com/OpenSaasAU/stack/commit/fd64913ac65ed60440eaee210a34a6f8e3824c21) Thanks [@borisno2](https://github.com/borisno2)! - Fix a plugin's `extendList()` silently overwriting a pre-existing list's operation-level access. Per ADR-0013, an extension that carries `access.operation` for an existing list now throws a config-time error naming the plugin and the list; the auth plugin no longer forwards its own access when extending a list an app already declared.

## 0.27.1

### Patch Changes

- [#674](https://github.com/OpenSaasAU/stack/pull/674) [`1bd4f12`](https://github.com/OpenSaasAU/stack/commit/1bd4f1258f9b3ac77ca048ac657ee31b0299821f) Thanks [@borisno2](https://github.com/borisno2)! - Fix stack overflow when auto-including relationships on a cyclic readable-relationship graph. The auto-include now stops at cycle back-edges (a relation that closes a cycle is fetched flat) instead of re-descending to MAX_DEPTH.

## 0.27.0

### Minor Changes

- [#635](https://github.com/OpenSaasAU/stack/pull/635) [`18c39c8`](https://github.com/OpenSaasAU/stack/commit/18c39c8b8ffc0b0c5c4551385bb67054448e5781) Thanks [@borisno2](https://github.com/borisno2)! - Add a label seam for the admin UI: `getLabelFieldName(listConfig)` resolves the field that represents a list's rows as a single label (`ui.labelField` → `name` → `title` → `id`), and `getItemLabel(listConfig, item)` reads that field off a row, falling back to `id` when it's missing. Both are exported from the root entry point.

  ```typescript
  import { getLabelFieldName, getItemLabel } from '@opensaas/stack-core'

  Post: list({
    fields: { title: text() },
    ui: { labelField: 'title' },
  })

  getLabelFieldName(listConfig) // 'title'
  getItemLabel(listConfig, item) // item.title, or item.id if title is missing
  ```

- [#636](https://github.com/OpenSaasAU/stack/pull/636) [`a15e566`](https://github.com/OpenSaasAU/stack/commit/a15e5660d736c8ea2d4b804c5ef6891510b2ea3d) Thanks [@borisno2](https://github.com/borisno2)! - Add a relationship-options read primitive: `getRelationshipOptions(context, config, relatedListKey, { search?, take?, selectedIds? })` returns a bounded, projected `{ id, label }[]` for relationship editors. It selects only `id` and the resolved label field (via `getLabelFieldName`), so no depth-5 auto-include ever runs; `search` filters via `contains` when the label field is text; results are ordered by the label field; and currently-selected `selectedIds` are always unioned into the result even when outside the `search`/`take` window. Operation-level `query` access on the related list still applies (denied → `[]`).

  Also adds a `relationshipOptions` op on `context.serverAction` so hosts can resolve options from a client without a bespoke endpoint:

  ```typescript
  await context.serverAction({
    listKey: 'Post',
    action: 'relationshipOptions',
    field: 'author',
    search: 'ada',
    take: 20,
    selectedIds: ['user-123'],
  })
  // => { success: true, data: [{ id: 'user-123', label: 'Ada Lovelace' }, ...] }
  ```

  `getRelationshipOptions` is exported from `@opensaas/stack-core` and re-exported from `@opensaas/stack-ui` for server components that already hold a context.

### Patch Changes

- [#664](https://github.com/OpenSaasAU/stack/pull/664) [`37838ef`](https://github.com/OpenSaasAU/stack/commit/37838efbf726b27baa5e1da448d44223c6953e3f) Thanks [@borisno2](https://github.com/borisno2)! - Upgrade TypeScript to v7. `typescript` now resolves to the `@typescript/typescript6` compatibility shim (keeping the classic compiler API available for `typescript-eslint` and Next.js's build-time type-checking, neither of which support TS 7's restructured package yet), while `@typescript-eslint/eslint-plugin` is bumped to 8.63.0 to match. The CLI's Node-build compiler step (ADR-0011) now shells out to `tsc` instead of the removed synchronous `Program` API, using its own pinned native TS 7 binary via a new `@typescript/native` dependency.

- [#633](https://github.com/OpenSaasAU/stack/pull/633) [`9d9c7f8`](https://github.com/OpenSaasAU/stack/commit/9d9c7f8e5afd0b4afb01dc40cb16217f8d675354) Thanks [@borisno2](https://github.com/borisno2)! - Fix virtual fields named in `include`/`select` throwing a Prisma "Unknown field" error. Virtual field keys are now stripped from the query payload while their value is still computed via `resolveOutput`.

- [#637](https://github.com/OpenSaasAU/stack/pull/637) [`002e755`](https://github.com/OpenSaasAU/stack/commit/002e755ca405c23127b3c88378955127cc8b3f67) Thanks [@borisno2](https://github.com/borisno2)! - Fix `calendarDay` writes 500ing on Prisma 7 `@db.Date` columns — a `resolveInput` hook now coerces a `YYYY-MM-DD` string to a UTC-midnight `Date` before validation, and the field's zod schema accepts either shape.

## 0.26.0

### Minor Changes

- [#616](https://github.com/OpenSaasAU/stack/pull/616) [`322d5b6`](https://github.com/OpenSaasAU/stack/commit/322d5b64d11c3e3401493511e0c0e3a1fa20e210) Thanks [@borisno2](https://github.com/borisno2)! - Add `context.transaction()` — an interactive, hook-firing transaction

  You can now run multiple access-checked `context.db.*` operations atomically in one transaction while preserving the access/hook boundary (unlike raw `prisma.$transaction`, which bypasses both). The callback receives a full context whose `db.*` operations enforce access control and run list/field hooks, but persist against a single interactive transaction — so a throw anywhere rolls the whole transaction back.

  > **Superseded — do not copy the example below.** This entry records 0.26.0 as it was released; the API it describes is gone. `context.transaction` now takes no options, so the `isolationLevel` argument does not exist (ADR-0042), and the ORM raises no `P`-prefixed error codes, so the `code` comparison in the retry loop below matches nothing — a caller who copies it gets a loop that silently never retries and rethrows every failure on the first pass. Today a serialization failure arrives as a stack-owned error, tested with `isSerializationFailure(error)`, and a capacity gate is written by taking a row lock on the contended parent with `.forUpdate()` before counting, rather than by retrying (ADR-0047). The transaction itself, and the access/hook boundary this entry is really about, still work as described.

  Options (notably `isolationLevel`, plus `maxWait`/`timeout`) pass through to Prisma, and serialization failures (Prisma `P2034`) propagate to the caller so you own the retry loop. This makes concurrency-sensitive invariants such as a capacity gate enforceable:

  ```typescript
  async function bookSlot(context, slotId) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await context.transaction(
          async (tx) => {
            const count = await tx.db.booking.count({ where: { slotId } })
            if (count >= CAPACITY) return { booked: false }
            return { booked: true, item: await tx.db.booking.create({ data: { slotId } }) }
          },
          { isolationLevel: 'Serializable' },
        )
      } catch (err) {
        // Serialization failures propagate — retry is caller-owned.
        if (err && typeof err === 'object' && 'code' in err && err.code === 'P2034') continue
        throw err
      }
    }
    throw new Error('exceeded retry budget')
  }
  ```

  Nested `context.db` writes inside the callback join the outer transaction. New `StackContext`, `TransactionOptions`, and `TransactionIsolationLevel` types are exported from `@opensaas/stack-core`. See ADR-0012.

### Patch Changes

- [#620](https://github.com/OpenSaasAU/stack/pull/620) [`0be254e`](https://github.com/OpenSaasAU/stack/commit/0be254e2b2e6bbc0c2f168438aea49d2e1cc7f0b) Thanks [@borisno2](https://github.com/borisno2)! - Apply a field's defaultValue to omitted inputs before create validation (resolve-then-validate, matching Keystone), so isRequired + defaultValue no longer fails on create.

  Note: because an omitted-but-defaulted field is now filled into `resolvedData` before validation, that field's create-side field-level `beforeOperation`/`afterOperation` hooks (gated on the field key being present in `resolvedData`) now fire for defaulted fields where they previously would not.

## 0.25.0

### Minor Changes

- [#602](https://github.com/OpenSaasAU/stack/pull/602) [`44ec937`](https://github.com/OpenSaasAU/stack/commit/44ec9375baa4dacab4e34b03cbefb27c8aec07c9) Thanks [@borisno2](https://github.com/borisno2)! - Make `calendarDay` a `YYYY-MM-DD` string end-to-end (Keystone's CalendarDay scalar)

  `calendarDay` is now a `YYYY-MM-DD` **string** at the `context.db` boundary in
  both directions, so its type, validation, and runtime value finally agree.
  Previously the field validated a `YYYY-MM-DD` string but its TypeScript type was
  `Date`, so a typed caller passing `new Date(...)` hit a runtime `ValidationError`.
  - The field/read type and the generated `CreateInput`/`UpdateInput` input types
    are now `string`.
  - Writes accept only a `YYYY-MM-DD` string; a malformed string or a `Date` is
    rejected at runtime by validation (a `ValidationError`).
  - Storage is unchanged: `DateTime @db.Date` on Postgres/MySQL, the SQLite TEXT
    fallback as before.

  **Behavioral change (reads):** reading a `calendarDay` now returns a
  `YYYY-MM-DD` string instead of a `Date`. A field `resolveOutput` transform
  normalises the value Prisma returns from the `@db.Date` column, using UTC
  components to avoid timezone off-by-one. Consumers that previously relied on a
  `Date` on read should update to the string form:

  ```typescript
  const event = await context.db.event.findUnique({ where: { id } })
  event?.startDate // => '2025-01-15' (string, not Date)

  // Writes: pass YYYY-MM-DD strings, not Date objects
  await context.db.event.create({ data: { startDate: '2025-01-15' } })
  ```

- [#593](https://github.com/OpenSaasAU/stack/pull/593) [`fadd9db`](https://github.com/OpenSaasAU/stack/commit/fadd9dbd17085f4dd15899371a054ec46f943ce4) Thanks [@{](https://github.com/{)! - Nested relation writes now run the full hook pipeline inside one transaction ([#569](https://github.com/OpenSaasAU/stack/issues/569))

  A record written via a nested `create`, `update`, or `delete` now fires the SAME
  list- and field-level `beforeOperation`/`afterOperation` hooks as the equivalent
  top-level write — so side effects (workflows, notifications, billing) are
  identical whether a record is written nested or top-level. Previously nested
  writes ran only `resolveInput`/`validate`/field-rules and silently skipped the
  before/after side-effect hooks.
  - Nested **create** runs `beforeOperation` (create) → persist → `afterOperation`
    receiving the created `item`.
  - Nested **update** runs `afterOperation` receiving both `originalItem` (the row
    before) and the updated `item`.
  - Nested **delete** runs `beforeOperation`/`afterOperation` receiving the
    `originalItem`.

  Existing access control, validation, silent-failure, sudo-bypass, and the [#578](https://github.com/OpenSaasAU/stack/issues/578)
  nested-`connect`/`connectOrCreate` read-access + DB-reachability behavior are
  unchanged. Pass-through nested kinds (`disconnect`/`set`/`updateMany`/
  `deleteMany`) are out of scope and behave as before. See ADR-0010.

  For to-many nested creates (`create: [{A},{B}]`), each created record's
  `afterOperation` now fires exactly once against its OWN distinct row, recovered
  by id-diff against the rows that existed before the write — so a pre-existing
  sibling is never passed as the "created" item, and multiple creates no longer
  collapse to a single row.

  BEHAVIOR CHANGE — every write is now transactional, and a throwing
  `beforeOperation`/`afterOperation` (or validation) rolls the whole write back.
  The entire operation (parent + all nested writes) now runs inside one
  `prisma.$transaction`, so it is atomic. Previously an `afterOperation` that threw
  left the row committed; now it rolls back with the transaction (more
  Keystone-correct). If you relied on a thrown `afterOperation` leaving the row
  persisted, move that work to run after the write returns.

  Inside a `beforeOperation`/`afterOperation` hook, `context.db` (and
  `context.prisma`) are now bound to the write's transaction, so any `context.db`
  write a hook performs participates in — and rolls back with — the same
  transaction. Externally-visible side effects that must survive a rollback should
  not use `context.db` from within these hooks (transaction-boundary hooks for
  that are deferred — see [#590](https://github.com/OpenSaasAU/stack/issues/590)).

  ```ts
  // Nested create now fires the related list's beforeOperation/afterOperation,
  // atomically with the parent — a throw anywhere rolls the whole write back.
  await context.db.post.update({
    where: { id },
    data: {
      title: 'Updated',
   create: { name: 'New Author' } }, // User hooks fire; atomic
    },
  })
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

- [#600](https://github.com/OpenSaasAU/stack/pull/600) [`a93cebb`](https://github.com/OpenSaasAU/stack/commit/a93cebb5a6ba6550d8cdbb94f010c902ad7e29f1) Thanks [@relationship({](https://github.com/relationship({)! - Gate nested `connect` by the owning relationship field's field-level access

  Nested `connect` (and the connect branch of `connectOrCreate`) is now gated by
  the owning relationship field's create/update field-level access, in addition to
  the target list's read/query access and DB-reachability check. This completes
  the Keystone-parity rule that a connect requires both read access on the target
  AND write access on the owning relationship field. `sudo` bypasses the check.

  ```typescript
  Post: list({
    fields: {
      // A non-sudo caller can only connect an author when this field's
      // update access permits it (and the target User is readable/reachable).

        ref: 'User.posts',
        access: { update: ({ session }) => session?.role === 'editor' },
      }),
    },
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

- [#601](https://github.com/OpenSaasAU/stack/pull/601) [`8f98e25`](https://github.com/OpenSaasAU/stack/commit/8f98e25fbef4ec0fc3ff0cba456ff7f2f7ba2ea8) Thanks [@borisno2](https://github.com/borisno2)! - Add `beforeTransaction` / `afterTransaction` transaction-boundary hooks (list- and field-level)

  These run OUTSIDE the write's database transaction (in addition to the in-transaction `beforeOperation`/`afterOperation`), for non-transactional side effects like external API calls that must not hold a transaction open and cannot be rolled back. They fire per `(list, operation)` involved in the write (the top-level list plus each nested create/update/delete list) and form a symmetric compensation bracket: `afterTransaction` always runs when its paired `beforeTransaction` ran, receiving the outcome (`status: 'committed' | 'rolled-back'` plus `error` on rollback). On commit it gets the persisted `item` (and `originalItem` for update/delete) **only for the top-level record** — for nested lists these are `undefined`, since the per-record persisted row is not recoverable outside the transaction; use the in-transaction `afterOperation` for per-record nested compensation. On rollback it gets no `item` so it can undo what `beforeTransaction` did. `connectOrCreate` is enumerated as a best-effort create involvement (a resolve-to-connect still fires the bracket with no write), so compensators should be idempotent.

  ```typescript
  list({
    fields: { name: text() },
    hooks: {
      // Runs before the transaction opens.
      beforeTransaction: async ({ operation, inputData }) => {
        await billing.reserveSeat(inputData.seatId)
      },
      // Always runs after the transaction settles.
      afterTransaction: async (args) => {
        if (args.status === 'rolled-back') {
          // The write did not persist (args.error explains why) — compensate.
          await billing.releaseSeat(args.inputData.seatId)
        } else {
          await billing.confirmSeat(args.item.seatId)
        }
      },
    },
  })
  ```

  A throwing `beforeTransaction` aborts the write (the transaction never opens) and fires `afterTransaction` (`rolled-back`) only for lists whose `beforeTransaction` already ran. A throwing `afterTransaction` does not stop the other compensators; errors are surfaced afterward. Sudo does not affect these hooks. This is an additive, non-Keystone extension and does not change the existing `beforeOperation`/`afterOperation` semantics.

### Patch Changes

- [#603](https://github.com/OpenSaasAU/stack/pull/603) [`be9a896`](https://github.com/OpenSaasAU/stack/commit/be9a8965ad6338c279e99cfe3bf24162e63ffb92) Thanks [@borisno2](https://github.com/borisno2)! - Enforce required json fields on create: an omitted key is now rejected while any
  present value (object, array, primitive, or null) is still accepted.

- [#583](https://github.com/OpenSaasAU/stack/pull/583) [`e39d6e9`](https://github.com/OpenSaasAU/stack/commit/e39d6e9e37be2337c8cf1979053e76877f14296c) Thanks [@borisno2](https://github.com/borisno2)! - Make non-sudo writes fail loud in `filterWritableFields` (Keystone parity).

  Undeclared `data` keys on create/update now throw instead of passing through unchecked ([#564](https://github.com/OpenSaasAU/stack/issues/564)), and fields denied by field-level access now throw instead of being silently stripped ([#568](https://github.com/OpenSaasAU/stack/issues/568)). `sudo` remains the single trusted bypass; system fields and relationship foreign keys still pass through. Raw multi-column split columns (e.g. `media_url`/`media_size` from an `image()`/`file()` field) are now gated by their owning field's write access — supplying them directly under non-sudo when that field denies the write throws, instead of bypassing the field's `access.create`/`access.update`.

  Behavioural narrowing: a list-level `resolveInput` hook that adds keys to `resolvedData` which are not declared fields will now be rejected by the undeclared-key throw. No production hook does this today.

- [#605](https://github.com/OpenSaasAU/stack/pull/605) [`ca4973b`](https://github.com/OpenSaasAU/stack/commit/ca4973b504eadb123d179e8f4d16d6ec8c9f8fc1) Thanks [@borisno2](https://github.com/borisno2)! - Required json fields now reject a present `null` during validation rather than failing later as a DB NOT NULL violation. Omitted keys on update are still allowed; the Prisma column nullability is unchanged.

- [#602](https://github.com/OpenSaasAU/stack/pull/602) [`44ec937`](https://github.com/OpenSaasAU/stack/commit/44ec9375baa4dacab4e34b03cbefb27c8aec07c9) Thanks [@borisno2](https://github.com/borisno2)! - Fix update validation rejecting omitted required fields under zod 4.4 by using key-optionality (`.optional()`) instead of `z.union([schema, z.undefined()])`. Partial updates that omit a required-on-create field now validate; present values still enforce their rules.

- [#587](https://github.com/OpenSaasAU/stack/pull/587) [`ecbf834`](https://github.com/OpenSaasAU/stack/commit/ecbf834059a072c428b0739d6ebcf4c74be8c893) Thanks [@borisno2](https://github.com/borisno2)! - Fix false denial of nested `connect` (and `connectOrCreate`'s connect branch): connect now requires read/query access on the target and evaluates filter results via DB reachability (`findFirst({ where: { AND: [connection, accessFilter] } })`), so nested-relation and `AND`/`OR`/`some`/`none`/`not` filters no longer always fail.

- [#589](https://github.com/OpenSaasAU/stack/pull/589) [`481d6e0`](https://github.com/OpenSaasAU/stack/commit/481d6e00be90b1159b0b30eff015e5079c840158) Thanks [@borisno2](https://github.com/borisno2)! - Fix row-level access bypass when an explicit `include` is passed to non-sudo `findUnique`/`findMany`. The caller's `include` is now merged with (not replaced by) the access-controlled include: denied relations are dropped, each relation's access `where` is AND-combined with any caller nested `where`, and nested includes are filtered at every level. Sudo and query-fragment paths are unchanged. When no access-controlled include is computed (inside a `resolveOutput`/virtual-field context, at max include depth, or for a list with no relationships), the caller's `include` is passed through unchanged rather than dropped — avoiding fail-closed data loss.

- [#586](https://github.com/OpenSaasAU/stack/pull/586) [`4622b5f`](https://github.com/OpenSaasAU/stack/commit/4622b5fa8fc731e2c8995011f1be0cfe341578da) Thanks [@borisno2](https://github.com/borisno2)! - Enforce unique-`where` for `context.db.<list>.findUnique` — a non-unique `where` now throws a clear error instead of silently returning a nondeterministic row. Use `findFirst` for non-unique single-row lookups.

## 0.24.0

### Minor Changes

- [#552](https://github.com/OpenSaasAU/stack/pull/552) [`66496b4`](https://github.com/OpenSaasAU/stack/commit/66496b487bae61f3cdea26fcfcaf605caaaa5520) Thanks [@borisno2](https://github.com/borisno2)! - Add list-level `ui.listView` config (mirroring Keystone) for default columns and sort

  Lists now support a `ui.listView` block in `opensaas.config.ts` that sets the
  admin list table's default column selection/order and default sort. Naming
  mirrors Keystone's `ui.listView` so migrators can map defaults directly.

  ```typescript
  lists: {
    Post: list({
      fields: {
        title: text(),
        status: text(),
        createdAt: timestamp(),
      },
      ui: {
        listView: {
          // Column selection AND order
          initialColumns: ['title', 'status'],
          // Default sort
          initialSort: { field: 'createdAt', direction: 'desc' },
        },
      },
    }),
  }
  ```

  When `ui.listView` is absent, behaviour is unchanged: the table shows all
  non-system fields and applies no default sort.

## 0.23.0

### Patch Changes

- [#535](https://github.com/OpenSaasAU/stack/pull/535) [`da4ba52`](https://github.com/OpenSaasAU/stack/commit/da4ba529161e2c8702e4c62ae1594e300f32cbb1) Thanks [@borisno2](https://github.com/borisno2)! - context.db findUnique/findMany now warn (once per list+op) when passed an ignored `select` — narrow reads via `include` or a fragment `query`.

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

- [#500](https://github.com/OpenSaasAU/stack/pull/500) [`309c666`](https://github.com/OpenSaasAU/stack/commit/309c666388b71e2bfbe16b7da3ee0f923b3bf716) Thanks [@borisno2](https://github.com/borisno2)! - Re-export the fragment query API (`defineFragment`, `runQuery`, `runQueryOne`, and the `ResultOf`, `RelationSelector`, `QueryArgs` types) from the package root so the documented `import { defineFragment, runQuery, runQueryOne, type ResultOf } from '@opensaas/stack-core'` resolves.

- [#511](https://github.com/OpenSaasAU/stack/pull/511) [`696f5c0`](https://github.com/OpenSaasAU/stack/commit/696f5c08c37d4a18107e48cb6b360c9492c7425c) Thanks [@borisno2](https://github.com/borisno2)! - Fix field-level write-access bypass for multi-column `image()`/`file()` fields. The per-part column split now respects the field's own `create`/`update` access (denied fields write none of their columns), matching single-column behaviour.

  Note the known lossy multi-column round-trip when assembling legacy Keystone columns: `originalFilename` collapses to `filename`, `uploadedAt` is `''`, and a NULL `contentType` reads back as `application/octet-stream`.

- [#518](https://github.com/OpenSaasAU/stack/pull/518) [`d152203`](https://github.com/OpenSaasAU/stack/commit/d1522035e21b6ad7ad1b89b05264c54c13dadcf1) Thanks [@borisno2](https://github.com/borisno2)! - Remove leftover debug console.log statements from runtime code (password field resolveInput and MCP tool call handler)

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

### Patch Changes

- [#441](https://github.com/OpenSaasAU/stack/pull/441) [`bc20bf4`](https://github.com/OpenSaasAU/stack/commit/bc20bf447cf724bd0ee153ea9a69d54cc26a6bb2) Thanks [@borisno2](https://github.com/borisno2)! - Validate field self-containment at config load instead of failing deep in generation

  Core now exports `validateFieldConfig(field, fieldKey, listKey?)` and `validateConfigFields(config)` (plus the `FieldConfigValidationError` type). They check each field implements its generation contract — `getPrismaType`, `getTypeScriptType`, and `getZodSchema` (or `getPrismaRelation` for relationships; virtual fields skip `getPrismaType`) — and return structured per-field errors. `opensaas generate` runs this first and fails fast with a clear message naming the list, field, and missing method, rather than throwing an opaque stack trace mid-generation.

- [#428](https://github.com/OpenSaasAU/stack/pull/428) [`50371ea`](https://github.com/OpenSaasAU/stack/commit/50371ea3dd134f6b3718f347fed2c0d3b7dc63ce) Thanks [@borisno2](https://github.com/borisno2)! - Fix outdated SQLite adapter guidance to match the installed `@prisma/adapter-better-sqlite3` API (`PrismaBetterSqlite3` constructed with `{ url }`), so copied examples actually run. Updates the CLI "missing adapter" error message and the migration config it generates, plus the `prismaClientConstructor` JSDoc example.

- [#440](https://github.com/OpenSaasAU/stack/pull/440) [`70b4f53`](https://github.com/OpenSaasAU/stack/commit/70b4f538d380bbf546af50a985d29b48a71d3b4d) Thanks [@borisno2](https://github.com/borisno2)! - Refactor nested-operation dispatch into a handler registry (internal, no behaviour change)

- [#397](https://github.com/OpenSaasAU/stack/pull/397) [`8e394ab`](https://github.com/OpenSaasAU/stack/commit/8e394abe9df2da53ba23b93836853516bb4e25d5) Thanks [@borisno2](https://github.com/borisno2)! - Move relationship Prisma schema generation into the relationship field builder

  The relationship field now exposes a `getPrismaRelation()` method that returns its complete Prisma schema contribution (FK line, relation line, synthetic back-relation). The Prisma generator delegates to this method instead of special-casing relationships, keeping it a neutral coordinator. Generated schemas are unchanged.

- [#455](https://github.com/OpenSaasAU/stack/pull/455) [`d3fdf2a`](https://github.com/OpenSaasAU/stack/commit/d3fdf2a2e5374302bc7fe1fe814cb0f567a349df) Thanks [@borisno2](https://github.com/borisno2)! - Exclude `**/dist/**` from Vitest test discovery and gate coverage on `src/access`, `src/context`, and `src/validation` via per-file thresholds.

- [#403](https://github.com/OpenSaasAU/stack/pull/403) [`0f9c644`](https://github.com/OpenSaasAU/stack/commit/0f9c644a115ad747e338e6138b4762b4a48a9144) Thanks [@borisno2](https://github.com/borisno2)! - Split the access engine into named two-phase-read modules: Access Filter (pre-query), Field Visibility (post-query), and a shared field-access evaluator. No behaviour or public API change.

- [#411](https://github.com/OpenSaasAU/stack/pull/411) [`96258b0`](https://github.com/OpenSaasAU/stack/commit/96258b00bb762d9e38cfb83eacae65ce670b161f) Thanks [@borisno2](https://github.com/borisno2)! - Deduplicate field-level hook execution helpers by promoting them to `hooks/index.ts`, and remove a stray `console.log` that ran on every create/update.

- [#439](https://github.com/OpenSaasAU/stack/pull/439) [`898e477`](https://github.com/OpenSaasAU/stack/commit/898e47747abc02e457a54e2a78939450d16da5fb) Thanks [@borisno2](https://github.com/borisno2)! - Internal refactor: extract the write transform+validate span into a single Hook Pipeline that the Write Pipeline delegates to. No behaviour change.

- [#438](https://github.com/OpenSaasAU/stack/pull/438) [`29966b2`](https://github.com/OpenSaasAU/stack/commit/29966b23597199bcf4233298b1d0de6401b91acd) Thanks [@borisno2](https://github.com/borisno2)! - Refactor the write path into a single Write Pipeline. The canonical secured write sequence (hooks, validation, access, writable-field filtering, nested operations, persistence, after-hooks, Field Visibility) now lives in one module; create/update/delete are thin adapters over it parameterised by a per-operation strategy. Internal refactor only — no public API or behaviour change.

## 0.20.1

## 0.20.0

### Minor Changes

- [#359](https://github.com/OpenSaasAU/stack/pull/359) [`28be231`](https://github.com/OpenSaasAU/stack/commit/28be23183bc7a9a072f86b3b7286c9c2109fdb11) Thanks [@authorFragment,](https://github.com/authorFragment,)! - Add fragment-based, type-safe query utilities and integrate them into `context.db` operations

  OpenSaaS Stack now ships `defineFragment`, `ResultOf`, and `RelationSelector` — composable query helpers that give you the same benefits as Keystone's GraphQL fragments (reuse, type inference, nesting) without a GraphQL runtime.

  **Define reusable fragments:**

  ```ts
  import type { User, Post } from '.prisma/client'
  import { defineFragment, type ResultOf } from '@opensaas/stack-core'

  const authorFragment = defineFragment<User>()({ id: true, name: true } as const)

  const postFragment = defineFragment<Post>()({
    id: true,
    title: true,
    // nested relationship
  } as const)

  // Types are inferred — no codegen step required
  type PostData = ResultOf<typeof postFragment>
  // → { id: string; title: string; author: { id: string; name: string } | null }
  ```

  **Pass fragments directly to `context.db` operations (primary API):**

  ```ts
  // List — typed to ResultOf<typeof postFragment>[]
  const posts = await context.db.post.findMany({
    query: postFragment,
    where: { published: true },
    orderBy: { publishedAt: 'desc' },
    take: 10,
  })

  // Single record — typed to ResultOf<typeof postFragment> | null
  const post = await context.db.post.findUnique({
    where: { id: postId },
    query: postFragment,
  })
  if (!post) return notFound()
  ```

  **Nested relationship filtering with `RelationSelector`:**

  ```ts
  const commentFragment = defineFragment<Comment>()({ id: true, body: true } as const)

  const postWithComments = defineFragment<Post>()({
    id: true,
    title: true,
    comments: {
      query: commentFragment,
      where: { approved: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    },
  } as const)

  const posts = await context.db.post.findMany({ query: postWithComments })
  ```

  **Standalone helpers also available** for use in hooks and utilities:

  ```ts
  import { runQuery, runQueryOne } from '@opensaas/stack-core'

  const posts = await runQuery(context, 'Post', postFragment, { where: { published: true } })
  const post = await runQueryOne(context, 'Post', postFragment, { id: postId })
  ```

  Fragments compose freely and can be nested to any depth. Access control is always enforced — the `query` parameter only controls the include structure and field shape, not security. `orderBy` is now also supported in `context.db.<list>.findMany()`.

  See `specs/keystone-migration.md` for a full migration guide from Keystone's `context.graphql.run`.

## 0.19.1

## 0.19.0

### Minor Changes

- [#353](https://github.com/OpenSaasAU/stack/pull/353) [`28f2834`](https://github.com/OpenSaasAU/stack/commit/28f2834b199b93200c74cefb1594ba3704f0a839) Thanks [@borisno2](https://github.com/borisno2)! - Add `db.isNullable` and `db.nativeType` support to all field types

  All field types now support two new `db` configuration options that were previously only available in Keystone 6:

  ### `db.isNullable`

  Controls DB-level nullability independently of `validation.isRequired`. This allows you to:
  - Make a field non-nullable at the DB level without making it API-required
  - Explicitly mark a field as nullable regardless of other settings

  ```typescript
  fields: {
    // DB non-nullable, but API optional (relies on a default value or hook)
    phoneNumber: text({
      db: { isNullable: false }
      // Generates: phoneNumber String (non-nullable)
    }),

    // DB nullable, explicitly set
    lastMessagePreview: text({
      db: { isNullable: true }
      // Generates: lastMessagePreview String? (nullable)
    }),

    // DB non-nullable without API validation (field must always be set via hooks or defaults)
    internalCode: integer({
      db: { isNullable: false }
      // Generates: internalCode Int (non-nullable)
    })
  }
  ```

  ### `db.nativeType`

  Overrides the native database column type. Generates a `@db.<nativeType>` attribute in the Prisma schema. Available types depend on your database provider.

  ```typescript
  fields: {
    // PostgreSQL: use TEXT instead of VARCHAR for long content
    medical: text({
      db: { isNullable: true, nativeType: 'Text' }
      // Generates: medical String? @db.Text
    }),

    // PostgreSQL: use SMALLINT for small numbers
    score: integer({
      db: { nativeType: 'SmallInt' }
      // Generates: score Int? @db.SmallInt
    }),

    // PostgreSQL: use TIMESTAMPTZ for timezone-aware timestamps
    scheduledAt: timestamp({
      db: { nativeType: 'Timestamptz' }
      // Generates: scheduledAt DateTime? @db.Timestamptz
    })
  }
  ```

  Both options are supported on `text`, `integer`, `password`, `json`, `timestamp`, `checkbox` (isNullable only), `decimal`, and `calendarDay` fields.

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

### Patch Changes

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

## 0.18.2

### Patch Changes

- [#329](https://github.com/OpenSaasAU/stack/pull/329) [`0b0f322`](https://github.com/OpenSaasAU/stack/commit/0b0f3223e3703014164d49c8f3b455752a6468c1) Thanks [@borisno2](https://github.com/borisno2)! - Fix infinite loop when virtual field resolveOutput hooks make database queries

  When a virtual field's resolveOutput hook called context.db methods, it could cause an infinite loop if the query included relationships back to the original entity. This is now prevented by tracking resolveOutput hook execution depth and skipping auto-inclusion of relationships when inside a hook.

## 0.18.1

### Patch Changes

- [#327](https://github.com/OpenSaasAU/stack/pull/327) [`3f59454`](https://github.com/OpenSaasAU/stack/commit/3f59454e03976f7ff4f401c661624d1934910a17) Thanks [@borisno2](https://github.com/borisno2)! - Fix async resolveOutput hooks not being awaited in filterReadableFields

  The `resolveOutput` hooks for fields (especially virtual fields) were being called but not awaited, causing Promise objects to appear in output instead of resolved values. This fix properly awaits async `resolveOutput` hooks using `Promise.resolve()` wrapper for backwards compatibility with sync hooks.

## 0.18.0

## 0.17.0

### Minor Changes

- [#315](https://github.com/OpenSaasAU/stack/pull/315) [`538bc20`](https://github.com/OpenSaasAU/stack/commit/538bc20698b7d0f3c6600741f4553306008dec64) Thanks [@borisno2](https://github.com/borisno2)! - Add `createMany` and `updateMany` batch operations to `context.db`

  You can now use `createMany` to create multiple items at once:

  ```typescript
  await context.db.billItem.createMany({
    data: [
      { billId: '1', name: 'Item 1', quantity: 2, amount: 100 },
      { billId: '1', name: 'Item 2', quantity: 1, amount: 50 },
      { billId: '1', name: 'Item 3', quantity: 3, amount: 75 },
    ],
  })
  ```

  And `updateMany` to update multiple items based on a filter:

  ```typescript
  await context.db.bill.updateMany({
    where: { id: { in: ['1', '2', '3'] } },
    data: { status: 'PAID' },
  })
  ```

  Both methods run individual operations in a loop to ensure all hooks and access control rules are properly executed for each item, maintaining data integrity and security.

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

## 0.15.0

### Minor Changes

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

- [#291](https://github.com/OpenSaasAU/stack/pull/291) [`ed25cc5`](https://github.com/OpenSaasAU/stack/commit/ed25cc5aba43709d40ad256c982364ca8a8b0f2e) Thanks [@borisno2](https://github.com/borisno2)! - Add access control function shorthand to ListConfig

  List configurations now support a function shorthand for access control that applies to all operations:

  ```typescript
  // Instead of this:
  Post: list({
    fields: { title: text() },
    access: {
      operation: {
        query: isAuthenticated,
        create: isAuthenticated,
        update: isAuthenticated,
        delete: isAuthenticated,
      },
    },
  })

  // You can now write:
  Post: list({
    fields: { title: text() },
    access: isAuthenticated,
  })
  ```

  The `list()` function normalizes the shorthand to the object form at runtime, so existing code continues to work unchanged.

  New exports:
  - `ListAccessControl<T>` - Union type accepting either a function or operation object
  - `ListConfigInput<TTypeInfo>` - Input type for `list()` function with flexible access control

  Fixes #285.

- [#297](https://github.com/OpenSaasAU/stack/pull/297) [`c2263d2`](https://github.com/OpenSaasAU/stack/commit/c2263d21cc7a4eaffc0b06af04eb7b3a1a3ce437) Thanks [@borisno2](https://github.com/borisno2)! - Add inputData parameter to field-level access control functions

  Field-level access control functions now receive an `inputData` parameter for create and update operations, allowing you to validate incoming data before it's written to the database.

  This is particularly useful for validating relationship connections:

  ```typescript
  lists: {
    Student: list({
      fields: {
        account: relationship({
          ref: 'Account.students',
          access: {
            create: ({ inputData, session }) => {
              // Ensure students can only connect to their own account
              if (session?.data?.role !== 'ADMIN') {
                return inputData?.account?.connect?.id === session?.data?.accountId
              }
              return true
            },
          },
        }),
      },
    }),
  }
  ```

  The `inputData` parameter contains the original input data passed to create/update operations:
  - For **create** operations: contains all input data including relationship connection syntax
  - For **update** operations: contains only the fields being updated
  - For **read** operations: `inputData` is undefined

  **Backward compatibility:**
  - Existing field access control functions continue to work without modification since `inputData` is optional
  - `AccessControl` functions (operation-level) can be reused in field-level contexts for convenience
  - If a filter is returned from field-level access, it's ignored and defaults to allowing access (only boolean results are used)

- [#293](https://github.com/OpenSaasAU/stack/pull/293) [`0c66ebc`](https://github.com/OpenSaasAU/stack/commit/0c66ebc4492fac47f2028569b080d496328c18bf) Thanks [@borisno2](https://github.com/borisno2)! - Export hook argument types for better TypeScript support

  You can now import and use hook argument types to annotate your hook parameters, eliminating implicit `any` errors with strict TypeScript settings:

  **List-level hooks:**

  ```typescript
  import type { AfterOperationHookArgs } from '@opensaas/stack-core'

  Post: list({
    hooks: {
      afterOperation: async (args: AfterOperationHookArgs) => {
        if (args.operation === 'update') {
          console.log('Updated:', args.item)
        }
      },
    },
  })
  ```

  **Field-level hooks:**

  ```typescript
  import type { FieldValidateHookArgs } from '@opensaas/stack-core'

  fields: {
    email: text({
      hooks: {
        validate: async (args: FieldValidateHookArgs) => {
          if (!args.resolvedData.email?.includes('@')) {
            args.addValidationError('Invalid email')
          }
        },
      },
    })
  }
  ```

  **Available types:**
  - List-level: `ResolveInputHookArgs`, `ValidateHookArgs`, `BeforeOperationHookArgs`, `AfterOperationHookArgs`
  - Field-level: `FieldResolveInputHookArgs`, `FieldValidateHookArgs`, `FieldBeforeOperationHookArgs`, `FieldAfterOperationHookArgs`, `FieldResolveOutputHookArgs`

  Additionally, field-level hooks now support `validateInput` as a deprecated alias for `validate` for backwards compatibility with Keystone patterns.

## 0.13.0

### Minor Changes

- [#281](https://github.com/OpenSaasAU/stack/pull/281) [`b979df4`](https://github.com/OpenSaasAU/stack/commit/b979df458ea39ce763dd92aa212fc70be207c416) Thanks [@borisno2](https://github.com/borisno2)! - Update hooks API to comply with Keystone hooks specification

  The hooks system now fully complies with Keystone's hooks API specification. Hook arguments have been updated to include additional context and follow consistent naming conventions.

  **List-level hooks now receive:**
  - `listKey` - The name of the list being operated on
  - `inputData` - The original data passed to the operation (before transformations)
  - `resolvedData` - The data after transformations
  - `validate` hook replaces `validateInput` (backward compatible via alias)

  **Field-level hooks now receive:**
  - `listKey` - The name of the list
  - `fieldKey` - The name of the field (replaces `fieldName` in most hooks)
  - `inputData` - The original input data
  - `resolvedData` - The transformed data
  - All hooks now support `validate` hook for field-level validation

  **Migration for existing hooks:**

  ```typescript
  // Before - List-level resolveInput
  resolveInput: async ({ resolvedData, item }) => {
    return { ...resolvedData, updatedAt: new Date() }
  }

  // After - List-level resolveInput
  resolveInput: async ({ listKey, operation, inputData, resolvedData, item, context }) => {
    return { ...resolvedData, updatedAt: new Date() }
  }

  // Before - Field-level resolveInput
  resolveInput: async ({ inputValue, operation, item }) => {
    return hashPassword(inputValue)
  }

  // After - Field-level resolveInput
  resolveInput: async ({
    listKey,
    fieldKey,
    operation,
    inputData,
    item,
    resolvedData,
    context,
  }) => {
    const fieldValue = resolvedData[fieldKey]
    return hashPassword(fieldValue)
  }

  // Before - validateInput
  validateInput: async ({ resolvedData, addValidationError }) => {
    if (resolvedData.title?.includes('spam')) {
      addValidationError('Title cannot contain spam')
    }
  }

  // After - validate (validateInput still works as alias)
  validate: async ({
    listKey,
    operation,
    inputData,
    resolvedData,
    item,
    context,
    addValidationError,
  }) => {
    if (operation === 'delete') return
    if (resolvedData.title?.includes('spam')) {
      addValidationError('Title cannot contain spam')
    }
  }
  ```

  **Key changes:**
  1. All hooks now receive `listKey` and `context` parameters
  2. Write operation hooks receive both `inputData` (original) and `resolvedData` (transformed)
  3. `afterOperation` hooks receive `originalItem` for comparing before/after state
  4. Field hooks use `fieldKey` parameter and access values via `resolvedData[fieldKey]`
  5. The `validate` hook is now the standard name (replaces `validateInput`, which remains as deprecated alias)

  See the updated CLAUDE.md documentation for complete hook argument specifications.

## 0.12.1

## 0.12.0

### Minor Changes

- [#277](https://github.com/OpenSaasAU/stack/pull/277) [`152e3bc`](https://github.com/OpenSaasAU/stack/commit/152e3bc7e7c703ad981ad54d32f5f7251233e66d) Thanks [@borisno2](https://github.com/borisno2)! - Add `db.nativeType` and `db.isNullable` options to text field

  You can now specify Prisma native database type attributes and control nullability independently:

  ```typescript
  // Use PostgreSQL Text type instead of default String
  fields: {
    description: text({
      validation: { isRequired: true },
      db: {
        nativeType: 'Text',
        isNullable: false,
      },
    }),
  }
  ```

  This generates:

  ```prisma
  description String @db.Text
  ```

  The `db.nativeType` option allows you to override the default Prisma type for your database provider (e.g., `Text`, `VarChar(255)`, `MediumText`), while `db.isNullable` lets you control nullability independently from the `isRequired` validation.

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

## 0.11.0

### Minor Changes

- [#271](https://github.com/OpenSaasAU/stack/pull/271) [`ec53708`](https://github.com/OpenSaasAU/stack/commit/ec53708898579dcc7de80eb9fc9a3a99c45367c9) Thanks [@borisno2](https://github.com/borisno2)! - Add decimal field type for precise numeric values

  You can now use the `decimal()` field type for storing precise decimal numbers, ideal for currency, measurements, and financial calculations:

  ```typescript
  import { decimal } from '@opensaas/stack-core/fields'

  fields: {
    price: decimal({
      precision: 10,
      scale: 2,
      validation: {
        isRequired: true,
        min: '0',
        max: '999999.99'
      }
    }),
    latitude: decimal({
      precision: 18,
      scale: 8,
      db: { map: 'lat' }
    })
  }
  ```

  Features:
  - Configurable precision (default: 18) and scale (default: 4)
  - Min/max validation with string values for precision
  - Database column mapping via `db.map`
  - Nullability control via `db.isNullable`
  - Index support (`isIndexed: true` or `isIndexed: 'unique'`)
  - Uses Prisma's Decimal type backed by decimal.js for precision
  - Generates proper TypeScript types with `import('decimal.js').Decimal`

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

- [#273](https://github.com/OpenSaasAU/stack/pull/273) [`bbe7f05`](https://github.com/OpenSaasAU/stack/commit/bbe7f051428013b327cbadc5fda7920d5885a6bc) Thanks [@borisno2](https://github.com/borisno2)! - Add `originalItem` parameter to `afterOperation` hooks for comparing previous and new values

  Both field-level and list-level `afterOperation` hooks now receive an `originalItem` parameter containing the item's state before the operation. This enables use cases like detecting field changes, cleaning up old files, tracking state transitions, and sending conditional notifications.

  Usage in list-level hooks:

  ```typescript
  Post: list({
    hooks: {
      afterOperation: async ({ operation, item, originalItem, context }) => {
        if (operation === 'update' && originalItem) {
          // Compare previous and new values
          if (originalItem.status !== item.status) {
            await notifyStatusChange(originalItem.status, item.status)
          }
        }
      },
    },
  })
  ```

  Usage in field-level hooks:

  ```typescript
  fields: {
    thumbnail: text({
      hooks: {
        afterOperation: async ({ operation, value, item, originalItem }) => {
          if (operation === 'update' && originalItem) {
            const oldValue = originalItem.thumbnail
            if (oldValue !== value && oldValue) {
              // Clean up old file when thumbnail changes
              await deleteFromCDN(oldValue)
            }
          }
        },
      },
    })
  }
  ```

  The `originalItem` parameter is:
  - `undefined` for `create` and `query` operations (no previous state)
  - The item before the update for `update` operations
  - The item before deletion for `delete` operations

### Patch Changes

- [#269](https://github.com/OpenSaasAU/stack/pull/269) [`ba9bfa8`](https://github.com/OpenSaasAU/stack/commit/ba9bfa80e88f125d00d621e3b7fe8e39ffaeb145) Thanks [@borisno2](https://github.com/borisno2)! - Fix select field ignoring validation.isRequired in Prisma schema generation

- [#274](https://github.com/OpenSaasAU/stack/pull/274) [`38337cc`](https://github.com/OpenSaasAU/stack/commit/38337ccc17a9c3e78b3767bf2422d0ca9ea16230) Thanks [@borisno2](https://github.com/borisno2)! - Fix hook argument types for operations

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

## 0.7.0

### Minor Changes

- [#251](https://github.com/OpenSaasAU/stack/pull/251) [`6717469`](https://github.com/OpenSaasAU/stack/commit/6717469344f08e1250fed8342a05dd4b08208e92) Thanks [@borisno2](https://github.com/borisno2)! - Add support for custom scalar types in virtual fields

  Virtual fields now support custom scalar types (like Decimal for financial precision) through three approaches:

  **1. Primitive type strings (existing, unchanged):**

  ```typescript
  fields: {
    fullName: virtual({
      type: 'string',
      hooks: {
        resolveOutput: ({ item }) => `${item.firstName} ${item.lastName}`,
      },
    })
  }
  ```

  **2. Import strings:**

  ```typescript
  fields: {
    totalPrice: virtual({
      type: "import('decimal.js').Decimal",
      hooks: {
        resolveOutput: ({ item }) => new Decimal(item.price).times(item.quantity),
      },
    })
  }
  ```

  **3. Type descriptor objects (recommended):**

  ```typescript
  import Decimal from 'decimal.js'

  fields: {
    totalPrice: virtual({
      type: { value: Decimal, from: 'decimal.js' },
      hooks: {
        resolveOutput: ({ item }) => new Decimal(item.price).times(item.quantity),
      },
    })
  }
  ```

  The TypeScript type generator automatically collects and generates the necessary import statements. This enables precise financial calculations and integration with third-party types while maintaining full type safety.

## 0.6.2

## 0.6.1

## 0.6.0

## 0.5.0

## 0.4.0

### Minor Changes

- [#190](https://github.com/OpenSaasAU/stack/pull/190) [`527b677`](https://github.com/OpenSaasAU/stack/commit/527b677ab598070185e23d163a9e99bc20f03c49) Thanks [@borisno2](https://github.com/borisno2)! - Fix nested operations to respect sudo mode, preventing access control checks when using context.sudo()

  When using `context.sudo()`, nested relationship operations (create, connect, update, connectOrCreate) were still enforcing access control checks, causing "Access denied" errors even when sudo mode should bypass all access control.

  This fix adds `context._isSudo` checks to all four nested operation functions in `packages/core/src/context/nested-operations.ts`:
  - `processNestedCreate()` - Now skips create access control in sudo mode
  - `processNestedConnect()` - Now skips update access control in sudo mode
  - `processNestedUpdate()` - Now skips update access control in sudo mode
  - `processNestedConnectOrCreate()` - Now skips update access control in sudo mode

  The fix ensures that when `context.sudo()` is used, all nested operations bypass access control checks while still executing hooks and validation.

  Comprehensive tests have been added to `packages/core/tests/sudo.test.ts` to verify nested operations work correctly in sudo mode.

  Fixes #134

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

## 0.3.0

## 0.2.0

### Minor Changes

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

- [#121](https://github.com/OpenSaasAU/stack/pull/121) [`3851a3c`](https://github.com/OpenSaasAU/stack/commit/3851a3cf72e78dc6f01a73c6fff97deca6fad043) Thanks [@borisno2](https://github.com/borisno2)! - Add strongly-typed session support via module augmentation

  This change enables developers to define custom session types with full TypeScript autocomplete and type safety throughout their OpenSaas applications using the module augmentation pattern.

  **Core Changes:**
  - Converted `Session` from `type` to `interface` to enable module augmentation
  - Updated all session references to properly handle `Session | null`
  - Added comprehensive JSDoc documentation with module augmentation examples
  - Updated `AccessControl`, `AccessContext`, and access control engine to support nullable sessions
  - Added "Session Typing" section to core package documentation

  **Auth Package:**
  - Added "Session Type Safety" section to documentation
  - Documented how Better Auth users can create session type declarations
  - Provided step-by-step guide for matching sessionFields to TypeScript types
  - Created `getSession()` helper pattern for transforming Better Auth sessions

  **Developer Experience:**

  Developers can now augment the `Session` interface to get autocomplete everywhere:

  ```typescript
  // types/session.d.ts
  import '@opensaas/stack-core'

  declare module '@opensaas/stack-core' {
    interface Session {
      userId?: string
      email?: string
      role?: 'admin' | 'user'
    }
  }
  ```

  This provides autocomplete in:
  - Access control functions
  - Hooks (resolveInput, validateInput, etc.)
  - Context object
  - Server actions

  **Benefits:**
  - Zero boilerplate - module augmentation provides types everywhere automatically
  - Full type safety for session properties
  - Autocomplete in all contexts that use session
  - Developer controls session shape (no assumptions about structure)
  - Works with any auth provider (Better Auth, custom, etc.)
  - Fully backward compatible - existing code continues to work
  - Follows TypeScript best practices (similar to NextAuth.js pattern)

  **Example:**

  ```typescript
  // Before: No autocomplete
  const isAdmin: AccessControl = ({ session }) => {
    return session?.role === 'admin' // ❌ 'role' is 'unknown'
  }

  // After: Full autocomplete and type checking
  const isAdmin: AccessControl = ({ session }) => {
    return session?.role === 'admin' // ✅ Autocomplete + type checking
    //             ↑ Shows: userId, email, role
  }
  ```

  **Migration:**

  No migration required - this is a fully backward compatible change. Existing projects continue to work with untyped sessions. Projects can opt-in to typed sessions by creating a `types/session.d.ts` file with module augmentation.

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

## 0.1.7

### Patch Changes

- 372d467: Add sudo to context to bypass access control

## 0.1.6

### Patch Changes

- 39996ca: Fix missing StoredEmbedding type import in generated types. Fields can now declare TypeScript imports needed for their types via the new `getTypeScriptImports()` method. This resolves the type error where `StoredEmbedding` was referenced but not imported in the generated `.opensaas/types.ts` file.
- 39996ca: Add plugin mechanism

## 0.1.5

### Patch Changes

- 17eaafb: Update package urls

## 0.1.4

### Patch Changes

- d013859: **BREAKING CHANGE**: Migrate MCP functionality into core and auth packages

  The `@opensaas/stack-mcp` package has been deprecated and its functionality has been split into:
  - `@opensaas/stack-core/mcp` - Auth-agnostic MCP runtime and handlers
  - `@opensaas/stack-auth/mcp` - Better Auth OAuth adapter

  **Migration required:**

  ```typescript
  // Before
  import { createMcpHandlers } from '@opensaas/stack-mcp'
  const { GET, POST, DELETE } = createMcpHandlers({ config, auth, getContext })

  // After
  import { createMcpHandlers } from '@opensaas/stack-core/mcp'
  import { createBetterAuthMcpAdapter } from '@opensaas/stack-auth/mcp'
  const { GET, POST, DELETE } = createMcpHandlers({
    config,
    getSession: createBetterAuthMcpAdapter(auth),
    getContext,
  })
  ```

  **Why this change?**
  - Reduces package count in the monorepo
  - Core package handles auth-agnostic MCP protocol
  - Auth package provides Better Auth specific adapter
  - Better-auth is no longer a dependency of core
  - Enables support for custom auth providers beyond Better Auth

  **New features:**
  - `McpSessionProvider` type for custom auth integration
  - More generic `McpAuthConfig` type supporting custom auth providers
  - Core MCP functionality available without auth dependencies

## 0.1.3

## 0.1.2

## 0.1.1

### Patch Changes

- 9a3fda5: Add JSON field
- f8ebc0e: Add base mcp server
- 045c071: Add field and image upload
