# @opensaas/stack-ui

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

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - The admin list view reads through the secured surface, and its total is an `aggregate`

  The list table now composes one secured read instead of calling `findMany`/`count`: the filter engine's Where vocabulary value goes to `.where()`, a to-one relationship is an `.include()` and a to-many displayed as a count column is the native count reducer, and the header's total is `.aggregate((a) => ({ total: a.count() }))` over the same scoped read — so the number above the table always equals the number of rows the session may page through.

  Sorting by a to-many relationship count is gone with the `_count` include that powered it: `orderBy` takes the list's own scalar columns, so a `?sort=` naming a relationship is ignored exactly the way a read-denied field's sort already was, and the count column's header no longer offers a sort affordance it cannot honour. The count itself still displays through the reducer.

  ```
  ?search=orders:0     → orders: { none: {} }
  ?search=orders:>0    → orders: { some: {} }
  ?search=orders:>5    → falls back to free text, rather than erroring
  ?search=name:ada     → matches "Ada" (text eq/contains are case-insensitive)
  ```

  A count comparison the vocabulary cannot express no longer errors: the token falls back to free text, so `orders:>5` searches the list's free-text fields for `5` — and on a list with no free-text field the token is dropped altogether, leaving the read unfiltered by it.

  The URL grammar is unchanged, so a bookmarked filter keeps parsing identically.

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

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - `serializeFieldConfigs` is exported from `@opensaas/stack-ui/server`

  A page that hands `config.lists.Post.fields` straight to a `'use client'`
  component fails at render: a field config carries its own methods
  (`getZodSchema`, `getContractField`, `getFilterSpec`, …) and its `hooks` and
  `access` rules are functions, and React refuses to serialise a function across
  the boundary. `ItemCreateForm` and `ItemEditForm` already sanitise internally,
  but by then the props have crossed the boundary at the caller's own client
  component — so the caller needs the sanitiser too, and until now had to
  hand-roll one.

  ```typescript
  // app/posts/page.tsx — a Server Component
  import { serializeFieldConfigs } from '@opensaas/stack-ui/server'

  <CreatePostDialog fields={serializeFieldConfigs((await config).lists.Post.fields)} />
  ```

  ```typescript
  // components/CreatePostDialog.tsx
  'use client'
  import type { SerializableFieldConfig } from '@opensaas/stack-ui/server'

  export function CreatePostDialog({ fields }: { fields: Record<string, SerializableFieldConfig> }) {
  ```

  `serializeFieldConfig` and the `SerializableFieldConfig` type are exported
  alongside it. This is the same allowlist the admin UI uses, so it stays complete
  as `FieldConfig` grows.

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

- [#1454](https://github.com/OpenSaasAU/stack/pull/1454) [`62a8696`](https://github.com/OpenSaasAU/stack/commit/62a8696f88aef1df2ad723b017dd8ed8ecb1f238) Thanks [@borisno2](https://github.com/borisno2)! - The admin item form (create and edit) now respects a field's own CREATE/UPDATE field-level access: a field this session may not write renders read-only, with a reason shown beneath it, instead of an editable control whose value the save would then have to discard.

  Previously, any list carrying a field with `access: { create: () => false, update: () => false }` — the default for `embedding()` fields, among others — was uneditable through the admin entirely: the form resubmitted every field on save, and the write pipeline refused the whole update ("Cannot update \"x\": field-level access denied."), leaving even the fields the session could write unsaved.

  No config change is required — this is resolved automatically wherever `prepareItemForm` builds a form (the full admin item view, the singleton editor, and the Relationship-table's pre-linked create drawer).

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

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Declare the Node >=22.18.0 floor in `engines`.

- [#1468](https://github.com/OpenSaasAU/stack/pull/1468) [`5aa3815`](https://github.com/OpenSaasAU/stack/commit/5aa38159fe5a54f3f0c294cc47f439ec9175d544) Thanks [@borisno2](https://github.com/borisno2)! - Update a stale doc comment on `composeItemViewRead` that cited the now-fixed [#1236](https://github.com/OpenSaasAU/stack/issues/1236) as the reason a Relationship table's own relationship columns aren't nested-included. No behavior change.

- [#1462](https://github.com/OpenSaasAU/stack/pull/1462) [`5d54a02`](https://github.com/OpenSaasAU/stack/commit/5d54a02f096b59ecefba4c507df8a82ec200a23d) Thanks [@borisno2](https://github.com/borisno2)! - Fix the relationship-table pre-linked create drawer showing the new row optimistically instead of depending on `router.refresh()` reliably observing the write it just made ([#1376](https://github.com/OpenSaasAU/stack/issues/1376)).

## 0.43.0

### Minor Changes

- [#1427](https://github.com/OpenSaasAU/stack/pull/1427) [`d5d6f6e`](https://github.com/OpenSaasAU/stack/commit/d5d6f6ec6a3d0ff95ed1e4d501b4e4d55a744325) Thanks [@borisno2](https://github.com/borisno2)! - Render `calendarDay()` fields in the admin UI

  `calendarDay()` had no registered UI component, so a field declared with it
  logged `No component registered for field type: calendarDay` and rendered
  nothing in the item form. It now has both a form component and a list-table
  cell, registered under `calendarDay` in the usual registries — no wiring
  needed:

  ```typescript
  // opensaas.config.ts
  fields: {
    publishDate: calendarDay({ validation: { isRequired: false } }),
  }
  ```

  A calendar day names a day, not an instant, so the value read from and written
  back to `context.db` is the same `YYYY-MM-DD` string core documents, resolved
  through local-time components in both directions — the day shown is the day
  stored, in any timezone.

  Both components are exported for custom UIs, alongside the date-only
  `DatePicker` primitive they are built on:

  ```typescript
  import { CalendarDayField } from '@opensaas/stack-ui/fields'
  import { DatePicker } from '@opensaas/stack-ui/primitives'
  import { CalendarDayCell } from '@opensaas/stack-ui'
  ```

## 0.42.3

## 0.42.2

## 0.42.1

## 0.42.0

## 0.41.0

## 0.40.0

### Minor Changes

- [#1020](https://github.com/OpenSaasAU/stack/pull/1020) [`8e6707a`](https://github.com/OpenSaasAU/stack/commit/8e6707adcca9d7e062bc1747ec79a29082c09ef9) Thanks [@borisno2](https://github.com/borisno2)! - Replace the admin UI's hardcoded `password`/`createdAt`/`updatedAt` default-column exclusion with curation driven by each field's declared `ui.listView.defaultColumn` (issue [#1018](https://github.com/OpenSaasAU/stack/issues/1018)). The list view, related-list tables, and the `ListTable` standalone component now share one implementation (`computeDefaultColumns`) instead of three independent name/type-matching copies, and a list's structural `createdAt`/`updatedAt` timestamp columns are identified from its own timestamp configuration rather than by name.

  **Behavior change:** an application field literally named (or typed) `password`, `createdAt`, or `updatedAt` that does NOT declare `ui.listView.defaultColumn: false` — and isn't your list's actual auto-timestamp column — is no longer hidden from default admin columns purely by name/type match. Real password fields (built with `password()`) and real system timestamps are unaffected; they're excluded via the declared flag instead.

  `ListTable` gains an optional `fields?: Record<string, SerializableFieldConfig>` prop to supply this curation metadata; without it (as before), every `fieldTypes` column shows absent an explicit `columns` list.

- [#1016](https://github.com/OpenSaasAU/stack/pull/1016) [`98465a5`](https://github.com/OpenSaasAU/stack/commit/98465a553178d8ff8b6dbb0c7fe413965646debf) Thanks [@borisno2](https://github.com/borisno2)! - Password columns are now identified by field type, not field name, across the list view, standalone `ListTable`, and item-view Relationship tables. A field declared `secret: password()` is now excluded from default columns even though it isn't named `password`; a field merely named `password` (e.g. `password: text()`) is no longer excluded unless it is actually a `password()` field.

  A `password` Cell is now registered in the cell registry, so a password-typed column shown via an explicit `columns` prop renders a fixed `••••••••` mask instead of the raw value.

  BREAKING (shipped as minor — pre-1.0 packages ship breaking changes as minor): the unused `getFieldDisplayValue` export has been removed from `@opensaas/stack-ui`. It had no callers in the rendering path — Cells render each field type directly — so nothing in this package depended on it; a consumer importing it directly should port to a project-local formatter.

### Patch Changes

- [#971](https://github.com/OpenSaasAU/stack/pull/971) [`dfdca11`](https://github.com/OpenSaasAU/stack/commit/dfdca11490a29490a6dc4961a07f8e75675c75a7) Thanks [@borisno2](https://github.com/borisno2)! - Remove comments that restated the line below them or duplicated rationale already stated elsewhere in `packages/ui/src`. No behavior changes.

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

## 0.39.2

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

### Patch Changes

- [#929](https://github.com/OpenSaasAU/stack/pull/929) [`94802ee`](https://github.com/OpenSaasAU/stack/commit/94802eee3b2fdc64fab4b576945820a6df9311c5) Thanks [@borisno2](https://github.com/borisno2)! - Fix: a relation filter in `where` (`some`/`every`/`none`/`is`/`isNot`) no longer bypasses the related list's `query` access — it is now scoped exactly like `include` already is, recursing through every hop of a chain, on both `findMany` and `count`. A filter through a related list that denies query access now throws `RelationFilterAccessDeniedError` instead of silently running unscoped; field-level `read` access on the related list also now applies to keys named inside the filter. `@opensaas/stack-ui`'s admin list view no longer needs its own relationship label-filter access fold, since the engine now covers it.

## 0.38.0

## 0.37.0

## 0.36.0

## 0.35.0

## 0.34.0

## 0.33.0

### Minor Changes

- [#829](https://github.com/OpenSaasAU/stack/pull/829) [`7158905`](https://github.com/OpenSaasAU/stack/commit/71589058b6079f896e8c9cebca62727161493da5) Thanks [@borisno2](https://github.com/borisno2)! - Add an admin chrome slot for host-supplied navigation (ADR-0021, issue [#823](https://github.com/OpenSaasAU/stack/issues/823)).

  `AdminUI` now accepts a `navigation` prop that replaces the built-in sidebar wholesale (skipping nav-count resolution), and a `navItems` prop that adds one or more links to the built-in sidebar's new children region:

  ```tsx
  // Add a link to the built-in sidebar
  <AdminUI {...props} navItems={[{ label: 'Back to App', href: '/' }]} />

  // Or replace the sidebar entirely
  <AdminUI {...props} navigation={<MyOwnSidebar />} />
  ```

  `NavLink` is now exported from `@opensaas/stack-ui` (with `active` and `icon` optional) so host-supplied entries render identically to built-in ones, and `deriveCurrentPath` is exported to derive the same `currentPath` `AdminUI` computes internally, for host-owned chrome that needs it.

### Patch Changes

- [#828](https://github.com/OpenSaasAU/stack/pull/828) [`ec5dc88`](https://github.com/OpenSaasAU/stack/commit/ec5dc8892bc6c6805545339ae6aefd273190a77d) Thanks [@borisno2](https://github.com/borisno2)! - Fix virtual fields rendering "Unsupported field type: virtual" in the Admin UI item view — they now display their resolved value read-only, and are never offered as an editable control or included in create/update payloads.

- [#827](https://github.com/OpenSaasAU/stack/pull/827) [`c79c556`](https://github.com/OpenSaasAU/stack/commit/c79c556198821e1a7288008e68c47cfe514fe0f2) Thanks [@borisno2](https://github.com/borisno2)! - Fix the admin item form fetching relationship options serially (N sequential round-trips before first paint). Fetches now run concurrently via `Promise.all`.

## 0.32.0

## 0.31.1

### Patch Changes

- [#798](https://github.com/OpenSaasAU/stack/pull/798) [`35bdbf3`](https://github.com/OpenSaasAU/stack/commit/35bdbf31c6ce2e303c9cd9ee2920dc473b718513) Thanks [@borisno2](https://github.com/borisno2)! - Fix Save failing on the edit page for any list with a `many: true` relationship table: strip the synthetic `_count` payload before it reaches the details form data, and harden `transformItemFormData` to drop any submitted key with no matching field.

## 0.31.0

### Minor Changes

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

- [#750](https://github.com/OpenSaasAU/stack/pull/750) [`047487a`](https://github.com/OpenSaasAU/stack/commit/047487adf502f10f7f6774ff52c38c70d465f533) Thanks [@borisno2](https://github.com/borisno2)! - Add row selection and a built-in Bulk action Delete to the admin list view

  The list table now renders a selection checkbox column when the list's delete
  access is not statically false. The header checkbox toggles the visible page,
  per-row checkboxes accumulate an explicit id set across pages, and the selection
  clears when the filter changes. A selection bar shows the count, a Clear action,
  a named `data-slot="selection-actions"` seam for future custom bulk actions, and
  — only when delete access allows — a Delete that confirms first, deletes each
  selected row through the secured context honouring Silent failure, and reports
  "N of M deleted" (partial access denials are visible without revealing which or
  why).

  The admin list view also honours an optional `?pageSize=` URL param, preserved
  across sorting, searching and paging.

  New exports: `RowSelectionBar` (with `RowSelectionBarProps` /
  `RowSelectionBarClassNames`) and the `useRowSelection` hook plus the pure
  `isPageFullySelected` / `getPageCheckboxState` helpers.

  ```tsx
  import { RowSelectionBar, useRowSelection } from '@opensaas/stack-ui'

  const selection = useRowSelection('Post', filterKey)
  <RowSelectionBar
    count={selection.selectedCount}
    onClear={selection.clear}
    onDelete={async () => {
      /* delete the selected ids through the secured context */
    }}
  />
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

- [#788](https://github.com/OpenSaasAU/stack/pull/788) [`613902c`](https://github.com/OpenSaasAU/stack/commit/613902c13e092f29939618f87c6d3dfeac74a60d) Thanks [@borisno2](https://github.com/borisno2)! - Standalone `ListTable` now routes every cell through the shared cell registry (`CellRenderer`), matching `ListView`. The bespoke relationship renderer and `fieldTypes[column] === 'relationship'` branch are gone in favour of `RelationshipCell`, which already handles link navigation and `stopPropagation`.

  A new optional `fieldOptions` prop lets `select` columns resolve label mapping and `ui.variant` badge colour, exactly like `ListView`:

  ```tsx
  <ListTable
    items={posts}
    fieldTypes={{ title: 'text', status: 'select' }}
    fieldOptions={{
      status: [
        { label: 'Published', value: 'published', ui: { variant: 'success' } },
        { label: 'Draft', value: 'draft' },
      ],
    }}
    columns={['title', 'status']}
  />
  ```

  Existing `ListTable` call sites keep working unchanged.

### Patch Changes

- [#780](https://github.com/OpenSaasAU/stack/pull/780) [`55d55e0`](https://github.com/OpenSaasAU/stack/commit/55d55e0a1ed9521b6e31283524d9194a9420059a) Thanks [@borisno2](https://github.com/borisno2)! - Fix a to-one relationship filter token (e.g. `author:Ada`) leaking related-list data by ANDing the related list's `query` access filter into the nested condition instead of running it unscoped.

- [#775](https://github.com/OpenSaasAU/stack/pull/775) [`2fcb582`](https://github.com/OpenSaasAU/stack/commit/2fcb5820bc00d9d432265d1ba01404097e296e8e) Thanks [@borisno2](https://github.com/borisno2)! - Exclude json columns from relationship-table inline editing so an unchanged json cell no longer wastes a secured update round-trip

## 0.30.0

## 0.29.0

### Minor Changes

- [#723](https://github.com/OpenSaasAU/stack/pull/723) [`a7babf9`](https://github.com/OpenSaasAU/stack/commit/a7babf9c6f579c333462adf58018a594d09790c6) Thanks [@borisno2](https://github.com/borisno2)! - Admin chrome polish pass: consistent page headers, designed empty states, skeleton coverage, nav active states, and table density (issue [#710](https://github.com/OpenSaasAU/stack/issues/710)).

  The prebuilt admin now shares a restrained, token-driven chrome across every screen. Two new composable components are exported and used throughout:

  - `PageHeader` — the consistent title/description/back-link/actions pattern used by the dashboard, list, item, and singleton screens. Exposes `data-slot` parts (`page-header`, `page-header-title`, `page-header-description`, `page-header-actions`, `page-header-back`, `page-header-icon`) and a structured `classNames` contract. An opt-in `gradient` prop frames the dashboard — the design system's single signature gradient moment.
  - `EmptyState` — a designed empty surface (icon + title + description + actions) now shown on every list and relationship surface. Also exposes `data-slot` parts and a `classNames` contract.

  ```tsx
  import { PageHeader, EmptyState } from '@opensaas/stack-ui'

  <PageHeader title="Posts" description="12 items" actions={<CreateButton />} />

  <EmptyState
    icon={<Inbox />}
    title="No items yet"
    description="Create your first record to see it listed here."
    actions={<CreateButton />}
  />
  ```

  Also included:

  - Full-screen skeleton fallbacks (`DashboardSkeleton`, `ListViewSkeleton`, `ItemFormSkeleton`, `PageHeaderSkeleton`) wired through a `Suspense` boundary in `AdminUI`, so every data-loading screen streams behind a placeholder of the same shape.
  - Navigation active states now use `aria-current="page"` and a flat solid brand fill (no gradient/pulse); nav and dashboard icons use `lucide-react` instead of emoji.
  - Tables right-align numeric columns and use tabular numerals; a new `isNumericField(fieldType)` helper is exported.
  - Gradient usage is limited to the dashboard header accent and avatar fallbacks per the spec; the brand wordmark and active nav are now solid tokens.

  No new capabilities and no information-architecture changes — this is a visual/chrome polish pass consuming existing tokens.

- [#718](https://github.com/OpenSaasAU/stack/pull/718) [`713409b`](https://github.com/OpenSaasAU/stack/commit/713409b88abdb5d23ebad5e86759eea4dbdd0717) Thanks [@borisno2](https://github.com/borisno2)! - Re-curate the theme presets (`modern` / `classic` / `neon`) in the token vocabulary

  Each preset now defines every color token in both light and dark — including the
  `success`/`warning` intent colors and the gradient pair — so switching `preset`
  fully reskins the admin with no token falling through to another preset. Presets
  also carry their own shape and elevation, and the theme compiler merges them
  under any config overrides:

  - `modern` (default): the restrained, low-chroma direction with one saturated
    brand color and the gradient pair as garnish. Inherits the stylesheet's radius
    and soft shadows (kept in sync with `globals.css`).
  - `classic`: flat and enterprise-safe — blue primary, no gradient, squared-off
    radius, and elevation removed (`--shadow-*: none`).
  - `neon`: the high-chroma cyan/purple/pink personality — pink primary, purple
    accent, a cyan→pink signature gradient, and a rounder radius.

  Preset-only configs upgrade unchanged (the names are preserved):

  ```ts
  ui: {
    theme: {
      preset: 'neon'
    }
  }
  ```

- [#716](https://github.com/OpenSaasAU/stack/pull/716) [`316f976`](https://github.com/OpenSaasAU/stack/commit/316f9765336b3fc2aa2a743dcd6d33e53e01488b) Thanks [@borisno2](https://github.com/borisno2)! - Add user-controllable dark mode: `ThemeToggle` and `ThemeScript`

  The admin chrome now ships a light/dark/system color-scheme control built on the
  `light-dark()` token contract. A `data-theme` attribute on the document root pins
  `color-scheme` (overriding the OS preference); its absence follows the system.

  - `ThemeToggle` — a client component that cycles light → dark → system, writes
    `data-theme` on `<html>`, persists the choice to `localStorage`
    (`opensaas-theme`), and restores it on mount. It appears in the default Admin
    chrome's user menu and is opt-out via composition (custom chrome omits it).
  - `ThemeScript` — a server-safe inline `<script>` for the document `<head>` that
    applies the saved choice before first paint, preventing a flash of the wrong
    scheme.

  ```tsx
  import { ThemeScript } from '@opensaas/stack-ui'

  export default function RootLayout({ children }) {
    return (
      <html lang="en" suppressHydrationWarning>
        <head>
          <ThemeScript />
        </head>
        <body>{children}</body>
      </html>
    )
  }
  ```

  To pin the admin to a single scheme, omit both and set the attribute statically,
  e.g. `<html data-theme="dark">`. The `ThemeChoice` type and the
  `applyThemeChoice` / `readStoredChoice` / `themeInitScript` / `THEME_STORAGE_KEY`
  helpers are also exported for building custom controls.

- [#720](https://github.com/OpenSaasAU/stack/pull/720) [`c44b678`](https://github.com/OpenSaasAU/stack/commit/c44b678d9a3108c6e5a4d446e3966fded63687b6) Thanks [@borisno2](https://github.com/borisno2)! - Design system pass for field components and standalone composites: token-only styling, structured `classNames` slots, status tokens, and shared form rhythm.

  **Field components** now share one label / help / error rhythm via a small shell (`FieldRoot`, `FieldLabel`, `FieldHelp`, `FieldError`, `FieldWarning`, `FieldReadValue`). Every field consumes theme tokens only — the previously hardcoded status colours (a green upload check, an amber JSON warning) now use the `success` / `warning` tokens. All fields accept a consistent `helpText` prop.

  **Composites accept structured, strongly-typed `classNames` slots** merged per part via tailwind-merge, and every part carries a stable `data-slot`:

  - `ListTable` — `classNames={{ root, frame, table, header, headerRow, headerCell, body, row, cell, actionsHeader, actionsCell, empty }}`; root `data-slot="list-table"`.
  - `SearchBar` — `classNames={{ root, form, inputWrapper, input, clearButton, submit }}`; root `data-slot="search-bar"`.
  - `DeleteButton` — `classNames={{ button, error }}`; error `data-slot="delete-button-error"`.
  - `ItemCreateForm` / `ItemEditForm` — `classNames={{ root, error, fields, actions, submit, cancel }}`; roots `data-slot="item-create-form"` / `"item-edit-form"`.
  - `RelationshipManager` — `classNames={{ root, label, frame, row, cell, emptyState, actions, connectButton, error }}`; root `data-slot="relationship-manager"`.

  **New `Badge` primitive** for status rendering, with `success` / `warning` / `destructive` / `default` / `secondary` / `outline` variants driven entirely by tokens:

  ```tsx
  import { Badge } from '@opensaas/stack-ui/primitives'

  ;<Badge variant={post.status === 'published' ? 'success' : 'warning'}>{post.status}</Badge>
  ```

  Example: restyle just the rows of a table without forking it:

  ```tsx
  <ListTable
    items={posts}
    fieldTypes={{ title: 'text', status: 'select' }}
    classNames={{ frame: 'shadow-sm', headerCell: 'uppercase text-xs', row: 'hover:bg-accent/40' }}
  />
  ```

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

- [#719](https://github.com/OpenSaasAU/stack/pull/719) [`c04590e`](https://github.com/OpenSaasAU/stack/commit/c04590e9b79399c29295f2001717241058f224d1) Thanks [@borisno2](https://github.com/borisno2)! - Restyle every primitive onto the design system tokens, with a stable `data-slot` contract and a tailwind-merge'd `className` on every part

  Following Button ([#705](https://github.com/OpenSaasAU/stack/issues/705)), all remaining primitives — Input, Textarea, Label,
  Checkbox, Card, Table, Dialog, Select, Popover, Calendar, TimePicker,
  DateTimePicker, and Combobox — now consume only theme tokens (no hardcoded
  colours or shadows remain; e.g. the Dialog no longer uses `bg-white` /
  `border-gray-200` / `shadow-2xl` / `bg-black/80`).

  Every primitive and composite part now carries a documented, stable `data-slot`
  attribute, and merges a caller `className` via tailwind-merge so instance
  overrides win:

  ```tsx
  // Instance override (tailwind-merge — caller wins over the default radius)
  <Card className="rounded-none" />

  // Deep restyle from plain CSS, no Tailwind pipeline required (ADR-0016)
  [data-slot='table-row']:nth-child(even) { background: rgba(0, 0, 0, 0.04); }
  ```

  The `data-slot` name set is a public compatibility promise. Full contract:
  `input`, `textarea`, `label`, `checkbox`, `checkbox-indicator`, `card`,
  `card-header`, `card-title`, `card-description`, `card-content`, `card-footer`,
  `table-container`, `table`, `table-header`, `table-body`, `table-footer`,
  `table-row`, `table-head`, `table-cell`, `table-caption`, `dialog-overlay`,
  `dialog-content`, `dialog-header`, `dialog-footer`, `dialog-title`,
  `dialog-description`, `dialog-close`, `select-trigger`, `select-content`,
  `select-viewport`, `select-label`, `select-item`, `select-separator`,
  `select-scroll-up-button`, `select-scroll-down-button`, `popover-content`,
  `calendar`, `time-picker`, `datetime-picker`, `combobox-trigger`,
  `combobox-content`, `combobox-search`, `combobox-list`, `combobox-empty`,
  `combobox-item`, `combobox-separator` (plus `button` from [#705](https://github.com/OpenSaasAU/stack/issues/705)).

- [#724](https://github.com/OpenSaasAU/stack/pull/724) [`e180821`](https://github.com/OpenSaasAU/stack/commit/e180821e7f9537eceb0d889eda098dd8304a3e53) Thanks [@borisno2](https://github.com/borisno2)! - Add optional `nonce` prop to `ThemeScript` for strict-CSP compatibility

  `ThemeScript` renders the flash-prevention code as an inline `<script>`, which a
  strict nonce-based `script-src` Content-Security-Policy blocks unless the tag
  carries a matching `nonce`. You can now forward the per-request nonce:

  ```tsx
  import { headers } from 'next/headers'
  import { ThemeScript } from '@opensaas/stack-ui'

  export default async function RootLayout({ children }) {
    const nonce = (await headers()).get('x-nonce') ?? undefined
    return (
      <html lang="en" suppressHydrationWarning>
        <head>
          <ThemeScript nonce={nonce} />
        </head>
        <body>{children}</body>
      </html>
    )
  }
  ```

  The prop is optional — omitting it is byte-identical to before (no `nonce`
  attribute emitted). When provided, the value is forwarded only to the
  `<script>`'s `nonce` attribute; it is never interpolated into the script body.

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

### Patch Changes

- [#726](https://github.com/OpenSaasAU/stack/pull/726) [`ababdc3`](https://github.com/OpenSaasAU/stack/commit/ababdc302c1c52d8085cf827a4d015b599af9d48) Thanks [@borisno2](https://github.com/borisno2)! - Derive the stylesheet's `modern` color defaults from `presetThemes.modern` via a `generate:css` codegen step (wired into build), so the preset and `globals.css` can no longer drift. No visual or behavioral change — the emitted CSS is byte-identical to the previous values.

## 0.28.0

## 0.27.1

## 0.27.0

### Minor Changes

- [#638](https://github.com/OpenSaasAU/stack/pull/638) [`95560e4`](https://github.com/OpenSaasAU/stack/commit/95560e4db69ae390131f02c357c7c0e0b82d4304) Thanks [@borisno2](https://github.com/borisno2)! - Wire the edit page onto the relationship-options primitive so relationship dropdowns are fast and live-searchable. The item-form preparation now fetches a bounded, take-limited window via `getRelationshipOptions` instead of an unbounded `findMany({})` per relationship field, always unioning the current value's id(s) so its label renders even outside the window.

  `ComboboxField` (single) and `RelationshipManager` (many) gain debounced live search: typing narrows results against the label field via the `relationshipOptions` serverAction op, without any wiring changes required in host apps — `ItemForm`/`SingletonView` already pass `serverAction` and `listKey` through.

  ```typescript
  // No config changes needed — AdminUI's edit page picks this up automatically.
  // A field's relationship dropdown now:
  // 1. Renders a bounded initial window (default 50) with the current value's label always visible
  // 2. Debounces typed input and searches server-side via context.serverAction({ action: 'relationshipOptions', ... })
  ```

  Components without a wired `serverAction` (e.g. custom usages of `ComboboxField`/`RelationshipManager`) fall back to client-side filtering over the initial window, unchanged from previous behavior.

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

- [#639](https://github.com/OpenSaasAU/stack/pull/639) [`3b2beb7`](https://github.com/OpenSaasAU/stack/commit/3b2beb7fbe64ce34510a5f59e0403a9b2fdab52d) Thanks [@borisno2](https://github.com/borisno2)! - List-page relationship cells now render their label via the shared label seam (`getItemLabel`), honouring a related list's `ui.labelField` instead of an inline `name → title → label → id` guess that had drifted from the item form.

- [#664](https://github.com/OpenSaasAU/stack/pull/664) [`37838ef`](https://github.com/OpenSaasAU/stack/commit/37838efbf726b27baa5e1da448d44223c6953e3f) Thanks [@borisno2](https://github.com/borisno2)! - Upgrade TypeScript to v7. `typescript` now resolves to the `@typescript/typescript6` compatibility shim (keeping the classic compiler API available for `typescript-eslint` and Next.js's build-time type-checking, neither of which support TS 7's restructured package yet), while `@typescript-eslint/eslint-plugin` is bumped to 8.63.0 to match. The CLI's Node-build compiler step (ADR-0011) now shells out to `tsc` instead of the removed synchronous `Program` API, using its own pinned native TS 7 binary via a new `@typescript/native` dependency.

## 0.26.0

## 0.25.0

### Patch Changes

- [#607](https://github.com/OpenSaasAU/stack/pull/607) [`61547be`](https://github.com/OpenSaasAU/stack/commit/61547beb5ec7d4aff30753849e36a738c49c91e4) Thanks [@borisno2](https://github.com/borisno2)! - Fix `ui.listView.initialSort` applying sort client-side instead of as a DB-level `orderBy`

  Previously, `initialSort` was applied to the already-fetched page in memory, meaning a 500-row list with `initialSort: { field: 'sentAt', direction: 'desc' }` would only show the 50 most recent rows of the _current page_ rather than the 50 most recent rows overall. The sort is now passed as `orderBy` to `findMany` so pagination and sorting compose correctly.

  Column-header clicks also now navigate with a `?sort=field:direction` URL param (instead of mutating local state), so subsequent sorts are also DB-level and work correctly across pages.

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

### Minor Changes

- [#543](https://github.com/OpenSaasAU/stack/pull/543) [`4de6a3b`](https://github.com/OpenSaasAU/stack/commit/4de6a3b35ff2337fbd32f285e6c0cc63a0b2d2cf) Thanks [@borisno2](https://github.com/borisno2)! - Handle `autoCreate: false` singletons and access-denied reads in the AdminUI singleton editor.

  When a singleton's `get()` returns no record, `SingletonView` now disambiguates the two reasons a singleton can be empty and renders the safe affordance:
  - **`autoCreate: false` with no row yet** (query + create allowed): renders a create-on-first-save form (reuses `ItemFormClient` in `mode="create"`). Core assigns the singleton `id` and enforces the single-record constraint on save, so the form sends only the user-entered field data.
  - **`query` access denied**: renders a friendly "no access" message — never an editable or create form.
  - **create denied (autoCreate: false, no row)**: renders a friendly "no record yet" message instead of an unusable form.

  An update-denied singleton still renders the edit form, but the save fails gracefully via the server action's denied envelope. The happy path (a record exists → edit form) and non-singleton lists are unchanged.

- [#542](https://github.com/OpenSaasAU/stack/pull/542) [`ef6ce9a`](https://github.com/OpenSaasAU/stack/commit/ef6ce9a3d9c8c129626d98640004c2c0bf84b656) Thanks [@borisno2](https://github.com/borisno2)! - Render a single-record editor for `isSingleton` lists in `AdminUI`

  A list configured with `isSingleton: true` now renders a single-record editor at
  its bare `[list]` route instead of a list table. The new `SingletonView`
  component resolves the record via the singleton `get()` operation (which
  auto-creates the row with field defaults when absent) and reuses the existing
  `ItemFormClient` in edit mode, so field rendering, validation, and the existing
  `serverAction` save path all apply unchanged. Non-singleton lists are
  unaffected and still render the table.

  ```typescript
  // opensaas.config.ts
  lists: {
    SiteSettings: list({
      isSingleton: true,
      fields: {
        siteName: text(),
        supportEmail: text(),
      },
    }),
  }
  ```

  Visiting `/admin/site-settings` now shows an "Edit Site Settings" form for the
  single record rather than a one-row list.

- [#544](https://github.com/OpenSaasAU/stack/pull/544) [`581ef89`](https://github.com/OpenSaasAU/stack/commit/581ef89975e41a359b0a92c4808fbcdee7fe1607) Thanks [@borisno2](https://github.com/borisno2)! - Add first-class singleton presentation to the admin Navigation and Dashboard

  Singleton lists (`isSingleton`) are now visually distinguished from ordinary lists:
  - **Navigation:** singletons render under a dedicated "Settings" group with a gear
    icon, separate from the standard "Lists" group. Each still links to its
    single-record editor (`/<basePath>/<url>`). The "Settings" group is omitted when
    there are no singletons (and the "Lists" group is omitted when there are only
    singletons).
  - **Dashboard:** singletons appear in their own "Settings" section with a
    "Configure" affordance instead of the misleading "N items" count (a singleton's
    count is always 0 or 1). The Dashboard no longer calls `count()` for singletons.

  Non-singleton lists are unchanged.

- [#545](https://github.com/OpenSaasAU/stack/pull/545) [`f2cc754`](https://github.com/OpenSaasAU/stack/commit/f2cc754e34b07a427168ddb11cfc33d74457af82) Thanks [@borisno2](https://github.com/borisno2)! - Suppress create/delete affordances and redirect sub-routes for singleton lists in the admin UI.

  Singleton lists (`isSingleton: true`) have a single record edited at their bare `[list]` route, so the create and delete affordances no longer apply:
  - The Dashboard "Quick Actions" no longer renders a "Create {list}" link for singletons (only standard lists). The Quick Actions card is hidden entirely in a singleton-only admin.
  - The singleton editor (`SingletonView`) no longer renders a Delete control. A new optional `canDelete` prop (default `true`) on `ItemFormClient` controls this; non-singleton edit forms keep their Delete button.
  - The singleton sub-routes `/admin/<list>/create` and `/admin/<list>/<id>` now server-side `redirect()` to the bare editor `/admin/<list>`, so old links keep working.

  Non-singleton create/delete affordances and routing are unchanged.

## 0.22.0

## 0.21.0

### Minor Changes

- [#417](https://github.com/OpenSaasAU/stack/pull/417) [`ed1c9f5`](https://github.com/OpenSaasAU/stack/commit/ed1c9f532b77ef59d7a845731e6a6116904a859e) Thanks [@borisno2](https://github.com/borisno2)! - Unify the item-form logic behind a shared `useItemForm` engine

  The AdminUI form (`ItemFormClient`) and the standalone `ItemCreateForm`/
  `ItemEditForm` each carried their own near-identical copy of the form state,
  the relationship-to-`connect` submit transform, the clear-error-on-change
  behaviour, and the error/pending handling. That logic now lives once in a
  `useItemForm` hook (with pure, exported `transformItemFormData`,
  `transformInitialData`, and `getEditableFields` helpers); each form supplies
  only an `onSubmit` adapter and renders the returned state.

  Behaviour is unified to the superset: every form now applies the relationship
  transform, the password `{ isSet }` skip for unchanged passwords, and
  system-field filtering. The transform logic is covered by unit tests for the
  first time.

  No public API change — `ItemCreateForm`, `ItemEditForm`, and the AdminUI form
  keep their existing props.

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

- [#412](https://github.com/OpenSaasAU/stack/pull/412) [`9696f98`](https://github.com/OpenSaasAU/stack/commit/9696f9800284f94e21e14c31a716de4b48d736e5) Thanks [@borisno2](https://github.com/borisno2)! - Refactor `FieldRenderer` to use data-presence checks instead of `fieldConfig.type` comparisons

  `FieldRenderer` no longer checks `fieldConfig.type` to decide which props to pass to field
  components. Field-specific UI props (select options, relationship items/key/many) are now derived
  from the serialised field config using data-presence checks (`fieldConfig.options`, `fieldConfig.ref`)
  — the same self-contained pattern used for Prisma and TypeScript generation.

  **For users:** no changes required. Field rendering behaviour is unchanged.

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

## 0.1.7

### Patch Changes

- Updated dependencies [372d467]
  - @opensaas/stack-core@0.1.7

## 0.1.6

### Patch Changes

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

- Updated dependencies [d013859]
  - @opensaas/stack-core@0.1.4

## 0.1.3

### Patch Changes

- efe2357: fix getting started package imports
  - @opensaas/stack-core@0.1.3

## 0.1.2

### Patch Changes

- @opensaas/stack-core@0.1.2

## 0.1.1

### Patch Changes

- 9a3fda5: Add JSON field
- 045c071: Add field and image upload
- Updated dependencies [9a3fda5]
- Updated dependencies [f8ebc0e]
- Updated dependencies [045c071]
  - @opensaas/stack-core@0.1.1
