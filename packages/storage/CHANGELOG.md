# @opensaas/stack-storage

## 0.44.0

### Minor Changes

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - `file()`, `image()` and `richText()` describe their columns and their TypeScript face through the contract-shaped field-builder surface

  Each builder now carries `getContractField`, which is what `opensaas generate` reads to derive the Contract, and declares its TypeScript face through `outputType`/`inputType`. The `getTypeScriptType`/`getTypeScriptImports`/`resultExtension` members these replace are removed from the field-builder contract in this same release.

  `image()`/`file()` in Keystone-parity multi-column mode return the `kind: 'columns'` variant, so one logical field still emits its per-part physical columns:

  ```ts
  image({ storage: 'images', db: { columns: 'keystone' } })
  // image_url text, image_width int, image_height int, image_filesize int,
  // image_contentType text, image_contentDisposition text, image_pathname text
  ```

  The `db.map`, `db.isNullable` and `db.nativeType` overrides the single-column backing documents now reach the emitted column; previously they were declared but dropped. Two of them are a **schema change for a config that already sets them**:

  - **`db.isNullable: false` now emits a NOT NULL column**, and the field's TypeScript face and validation follow it: `outputType`/`inputType` lose their `| null`, `null` is rejected, and the key becomes required on create (still omittable on update). A config that set `isNullable: false` while relying on the previously-nullable column must drop the override, or backfill the column before migrating.
  - **`db.nativeType: 'Json'` now emits a `json` column, not `jsonb`.** The override was a no-op before, so the column was always `jsonb`; it is now honoured literally. `json` and `jsonb` differ in equality and indexing semantics, and the change generates a type-altering migration on an existing table. Set `nativeType: 'Jsonb'` (or drop the override) to keep the previous column type.

  A `db.nativeType` value outside the Postgres types the contract carries is now a `opensaas generate` error naming the list and field, where it was previously ignored.

  **`db.isNullable` alongside `db.columns` is now refused at generate time.** Multi-column mode has no single column for it to constrain — every part column is nullable, and an all-NULL row reads back as `null` — so `db: { isNullable: false, columns: 'keystone' }` could only ever be taken and dropped. It is now an `opensaas generate` error naming the list, the field and the fix, rather than a silently ignored option. Remove `db.isNullable`, or remove `db.columns` to use the single-`Json?` column the override applies to. `isNullable: true` alongside `db.columns` still passes, and single-column mode is unaffected.

  **Bug fix: a multi-column `file()` with a `parts` subset wrote to columns its schema does not carry.** `splitFileMetadata` seeded `filename`, `filesize` and `url` before consulting `parts`, so a field configured as `db: { columns: { mode: 'keystone', parts: ['url', 'contentType'] } }` emitted a write payload naming `<field>_filename` and `<field>_filesize` — columns the generated schema never declared, which Prisma rejects as unknown fields. This affects released `@opensaas/stack-storage`; only a `file()` in multi-column mode with a non-default `parts` is reachable, and `image()` and default-`parts` fields were never affected. Writes now name exactly the opted-in part columns, so such a field works without changing your config.

  `@opensaas/stack-tiptap` re-exports Tiptap's `JSONContent`, and `richText()` reads and writes as that type instead of `any`:

  ```ts
  const article = await context.db.article.findFirst()
  // `null` here is "no row, or the Access Filter denied it" — guard before reading.
  article?.body // import('@opensaas/stack-tiptap').JSONContent | null | undefined
  ```

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

### Patch Changes

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Declare the Node >=22.18.0 floor in `engines`.

## 0.43.0

## 0.42.3

## 0.42.2

## 0.42.1

## 0.42.0

## 0.41.0

## 0.40.0

### Patch Changes

- [#973](https://github.com/OpenSaasAU/stack/pull/973) [`8f76533`](https://github.com/OpenSaasAU/stack/commit/8f765333e3067c741c69f535927cc82115c60ed1) Thanks [@borisno2](https://github.com/borisno2)! - Comment cleanup only, no behavior change: removed restating/narration comments, kept TSDoc on public config options and field builders, and kept external API/behavior constraint notes (Prisma, S3, Vercel Blob, Keystone parity, Next.js SSR, Zod).

## 0.39.2

## 0.39.1

## 0.39.0

## 0.38.0

## 0.37.0

## 0.36.0

## 0.35.0

## 0.34.0

## 0.33.0

### Minor Changes

- [#816](https://github.com/OpenSaasAU/stack/pull/816) [`9113836`](https://github.com/OpenSaasAU/stack/commit/91138368c814a4898bea3aa22a4e4d9bc04c3d25) Thanks [@borisno2](https://github.com/borisno2)! - Add `pathname` and `contentType` as optional extra columns for `file()`'s `db.columns: 'keystone'` multi-column mode, matching the parts `image()`'s multi-column mode already supports.

  By default, multi-column `file()` fields still emit exactly the same three columns as before (`filename`/`filesize`/`url`) — no changes for existing configs. To opt into the extras (e.g. for a legacy Keystone `file` field that content-sniffs a MIME type or stores a storage-provider pathname), pass `parts`:

  ```typescript
  import { file } from '@opensaas/stack-storage/fields'
  import { FILE_COLUMN_PARTS } from '@opensaas/stack-storage'

  resume: file({
    storage: 'documents',
    db: {
      columns: {
        mode: 'keystone',
        parts: FILE_COLUMN_PARTS, // all five: filename, filesize, url, pathname, contentType
      },
    },
  })
  ```

  The two extras round-trip through `FileMetadata.metadata.pathname` / `FileMetadata.metadata.contentType`, the same way `image()`'s `contentDisposition` round-trips through `ImageMetadata.metadata`.

## 0.32.0

## 0.31.1

## 0.31.0

### Patch Changes

- [#795](https://github.com/OpenSaasAU/stack/pull/795) [`0e603b9`](https://github.com/OpenSaasAU/stack/commit/0e603b92fd93611c3e7e614c4bc213d1eae1f926) Thanks [@borisno2](https://github.com/borisno2)! - Add integration-style tests proving image()/file() reject unrecognised write value shapes end-to-end in both `db.columns: 'keystone'` (multi-column) and default single-column (JSON) modes, pinning the [#789](https://github.com/OpenSaasAU/stack/issues/789) fix as a regression guard.

- [#776](https://github.com/OpenSaasAU/stack/pull/776) [`030d540`](https://github.com/OpenSaasAU/stack/commit/030d540cfb1fc4495da5177cda0bc1915c0cb354) Thanks [@borisno2](https://github.com/borisno2)! - `StorageProvider.delete()` is now documented as idempotent; the local provider swallows `ENOENT` on delete instead of throwing.

## 0.30.0

## 0.29.0

## 0.28.0

## 0.27.1

## 0.27.0

### Patch Changes

- [#664](https://github.com/OpenSaasAU/stack/pull/664) [`37838ef`](https://github.com/OpenSaasAU/stack/commit/37838efbf726b27baa5e1da448d44223c6953e3f) Thanks [@borisno2](https://github.com/borisno2)! - Upgrade TypeScript to v7. `typescript` now resolves to the `@typescript/typescript6` compatibility shim (keeping the classic compiler API available for `typescript-eslint` and Next.js's build-time type-checking, neither of which support TS 7's restructured package yet), while `@typescript-eslint/eslint-plugin` is bumped to 8.63.0 to match. The CLI's Node-build compiler step (ADR-0011) now shells out to `tsc` instead of the removed synchronous `Program` API, using its own pinned native TS 7 binary via a new `@typescript/native` dependency.

## 0.26.0

### Patch Changes

- [#619](https://github.com/OpenSaasAU/stack/pull/619) [`29ca3a9`](https://github.com/OpenSaasAU/stack/commit/29ca3a9fdd90af4e34b9ff770ae9a5ae94df2337) Thanks [@borisno2](https://github.com/borisno2)! - Fix file()/image() fields being required on create/update: their Zod schema now uses key-optionality (.nullish()) so an omitted field validates and stores null (Zod 4).

## 0.25.0

## 0.24.0

### Minor Changes

- [#551](https://github.com/OpenSaasAU/stack/pull/551) [`fb979b8`](https://github.com/OpenSaasAU/stack/commit/fb979b8978f9bdefd2b4f81e87c1c198582200ae) Thanks [@borisno2](https://github.com/borisno2)! - Add a storage provider registration API so non-`local` and custom providers are constructable.

  `createStorageProvider` now resolves a provider `type` through a registry instead of a hardcoded `switch`, which previously only built `'local'` and threw for everything else. `'local'` is registered as a built-in default, so existing behaviour is unchanged. The host opts into the optional provider packages (`@opensaas/stack-storage-s3`, `@opensaas/stack-storage-vercel`) or a custom provider by registering it — `@opensaas/stack-storage` does not depend on the provider packages, keeping the AWS/Vercel SDKs off every storage user. Reads are unaffected: assembling existing asset metadata only stamps the provider name and never constructs a provider.

  ```typescript
  // lib/register-storage.ts (server-only, imported at app startup)
  import { registerStorageProvider } from '@opensaas/stack-storage/runtime'
  import { S3StorageProvider, type S3StorageConfig } from '@opensaas/stack-storage-s3'

  registerStorageProvider<S3StorageConfig>('s3', (config) => new S3StorageProvider(config))
  ```

  ```typescript
  // opensaas.config.ts — reference the registered provider by type
  import { s3Storage } from '@opensaas/stack-storage-s3'

  export default config({
    storage: {
      avatars: s3Storage({ bucket: 'user-avatars', region: 'us-east-1' }),
    },
    // ...
  })
  ```

  Custom providers register the same way: implement `StorageProvider`, give it a `type`, then call `registerStorageProvider(type, (config) => new MyProvider(config))`. An unregistered type throws a clear error pointing at `registerStorageProvider`.

## 0.23.0

## 0.22.0

### Minor Changes

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

### Patch Changes

- [#520](https://github.com/OpenSaasAU/stack/pull/520) [`6610687`](https://github.com/OpenSaasAU/stack/commit/66106876643f0e9903eb6a677b7713890d0630e4) Thanks [@borisno2](https://github.com/borisno2)! - Add `file()` field-builder-level tests for multi-column (Keystone-parity) mode (issue [#478](https://github.com/OpenSaasAU/stack/issues/478)): assemble/split of `FileMetadata` across the three Keystone columns through the `file()` builder, including only-`file_url` partial rows, empty-row → null, custom `@map` round-trip, and nullable/`Int`-typed column emission. Test-only; no behaviour change.

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

## 0.20.1

## 0.20.0

## 0.19.1

## 0.19.0

## 0.18.2

## 0.18.1

## 0.18.0

## 0.17.0

## 0.16.0

### Patch Changes

- [#313](https://github.com/OpenSaasAU/stack/pull/313) [`41349a4`](https://github.com/OpenSaasAU/stack/commit/41349a498faaf52fc5ed2c69b84bd84adfe06628) Thanks [@borisno2](https://github.com/borisno2)! - Fix image and file field typing in context.db operations

## 0.15.0

### Patch Changes

- [#308](https://github.com/OpenSaasAU/stack/pull/308) [`43dfa2e`](https://github.com/OpenSaasAU/stack/commit/43dfa2e15aa59d70e898ba52a014ed8d67ada7c6) Thanks [@borisno2](https://github.com/borisno2)! - Fix TypeScript type errors in image and file fields. Add missing index signature to VercelBlobStorageConfig and getTypeScriptImports() method to properly import ImageMetadata and FileMetadata types.

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

- 045c071: Add field and image upload
- Updated dependencies [9a3fda5]
- Updated dependencies [f8ebc0e]
- Updated dependencies [045c071]
  - @opensaas/stack-core@0.1.1
