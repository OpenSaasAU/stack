# @opensaas/stack-storage

## 0.44.0

### Minor Changes

- [#1674](https://github.com/OpenSaasAU/stack/pull/1674) [`e39a4b5`](https://github.com/OpenSaasAU/stack/commit/e39a4b5f9983fae97738bcba0afe6e59ba1358b4) Thanks [@borisno2](https://github.com/borisno2)! - Fix a stored-XSS vulnerability: `acceptedMimeTypes` was checked against the client-declared MIME type, and every provider stored the upload under the client's own filename extension — an `.html` file declared `application/pdf` passed a PDF-only field and was served same-origin as `text/html`.

  `file()` and `image()` now validate and store under the **effective** MIME type — the declared type (or the type looked up from the filename when none is declared) for `file()`, and the bytes sharp actually decodes for `image()`, ignoring whatever the client claimed. The stored extension and the content type handed to the storage provider always derive from that effective type, never from the client's filename:

  ```typescript
  // x.html declared as application/pdf is now stored as `<name>.pdf` with
  // mimeType: 'application/pdf' — never served back as .html.
  await context.db.Post.create({
    data: { attachment: new File([bytes], 'x.html', { type: 'application/pdf' }) },
  })
  ```

  Active content types (`text/html`, `image/svg+xml`, `application/xhtml+xml`, `text/xml`, `application/xml`, and the JavaScript MIME types) are now **refused by default**, even for a `file()`/`image()` field with no `validation` config at all. Opt in explicitly per field to accept one:

  ```typescript
  richTextUpload: file({
    storage: 'files',
    validation: { acceptedMimeTypes: ['text/html'] },
  }),
  ```

  No sniffing was added for `file()` — the declared type is still trusted, since the extension/content-type fix above means a false declaration now only produces a correctly-typed, inert file. `image()` already reads the bytes to get dimensions, so it uses that same read to determine the effective type instead of trusting the declared one.

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

- [#1673](https://github.com/OpenSaasAU/stack/pull/1673) [`c267d3c`](https://github.com/OpenSaasAU/stack/commit/c267d3c1aa2423374ae1f0b9e24e9b4f8bdf4b7c) Thanks [@borisno2](https://github.com/borisno2)! - Fix a critical security issue ([#1619](https://github.com/OpenSaasAU/stack/issues/1619)): `image()`/`file()` fields trusted a caller-supplied metadata-shaped value (`{ filename, url, ... }`) verbatim, so cleanup would later delete whatever path it named through whatever provider it named — arbitrary file deletion via a traversal `filename`, and cross-row deletion by copying another row's metadata.

  A metadata-shaped write is now accepted only when it deep-equals the field's own currently stored value (the admin form's resubmit-unchanged case), or when the write runs under `sudo()` (seed/migration scripts pointing a new row at an already-uploaded asset):

  ```typescript
  // Non-sudo create with metadata-shaped input is refused — upload a File instead.
  await context.db.Doc.create({ data: { attachment: someMetadata } }) // throws

  // Sudo may still point a new row at an existing asset.
  await context.sudo().db.Doc.create({ data: { attachment: someMetadata } })

  // Non-sudo update succeeds only when the value matches what's already stored.
  await context.db.Doc.update({ where: { id }, data: { attachment: row.attachment } }) // OK
  await context.db.Doc.update({ where: { id }, data: { attachment: otherRowsMetadata } }) // throws
  ```

  Cleanup (`cleanupOnDelete`/`cleanupOnReplace`) now always deletes through the field's own configured `storage` provider, never the `storageProvider` a stored value happens to name, and `LocalStorageProvider` resolves every `filename` it's given (`upload`, `download`, `delete`, `getUrl`) against `uploadDir`, refusing anything that isn't a plain filename strictly inside it. With `generateUniqueFilenames: false`, a traversal-shaped upload name is reduced to a safe basename instead of being written verbatim.

  `ImageTransformationResult` (`@opensaas/stack-core`) gains an optional `filename` field, populated from the provider's own upload result, so `deleteImage` deletes a transformation variant by the key the upload recorded rather than by parsing it out of the stored `url`.

- [#1485](https://github.com/OpenSaasAU/stack/pull/1485) [`6cfe96c`](https://github.com/OpenSaasAU/stack/commit/6cfe96c248889a268b9505178db1da9b177dafe6) Thanks [@borisno2](https://github.com/borisno2)! - Rewrite public API docblocks (and the `opensaas generate` CLI description) that still described the generator's output in Prisma-schema-language terms (`@@map`/`@@schema`/`@@unique`/`@@index`/`multiSchema`/`@default(...)`/`@db.<type>`) — the Prisma 8 pipeline emits a TypeScript contract, not a `.prisma` schema (ADR-0040), and no such attributes are ever produced. Affected options include `ListConfig.db.map`/`db.schema`/`db.indexes`/`db.nativeType`, `SelectField.db.type`/`db.enumName`/`db.isNullable`, `RelationshipField.isIndexed`/`db.isNullable`, `DatabaseConfig.schemas`/`db.timestamps`, `OpenSaasConfig.output`, `Plugin.beforeGenerate`, and the equivalent auth-plugin model config (`AuthModelConfig.tableName`/`fields`/`schema`, `AuthConfig.schema`/`rateLimit`/`betterAuthOptions`). Docs now describe what the contract actually carries: a model's `table`/`namespace`, a column's `map`/type/nullability, a declared `enums` entry, and `unique`/`index` constraints.

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

- [#1852](https://github.com/OpenSaasAU/stack/pull/1852) [`f1ed144`](https://github.com/OpenSaasAU/stack/commit/f1ed144dd42fa69023960838b5cc28f046f48aae) Thanks [@borisno2](https://github.com/borisno2)! - Fix `cleanupOnDelete` on `file()` and `image()` removing the stored asset when the delete's transaction rolls back; cleanup now runs after commit.

- [#1706](https://github.com/OpenSaasAU/stack/pull/1706) [`04f4249`](https://github.com/OpenSaasAU/stack/commit/04f4249576e12894420d0ed469575ffd3bdfb46a) Thanks [@borisno2](https://github.com/borisno2)! - Fix `cleanupOnReplace` and `cleanupOnDelete` never firing for `file()`/`image()` fields in multi-column (`columns: 'keystone'`) mode.

- [#1489](https://github.com/OpenSaasAU/stack/pull/1489) [`d94a2e3`](https://github.com/OpenSaasAU/stack/commit/d94a2e3dcd77cb289620818fa862bd3163e5ab59) Thanks [@borisno2](https://github.com/borisno2)! - Fix `createStorageUtils().uploadFile`/`uploadImage` accepting invalid `validation`/`transformations` options (e.g. a string `maxFileSize`) and silently disabling validation instead of refusing.

- [#1729](https://github.com/OpenSaasAU/stack/pull/1729) [`8d8a338`](https://github.com/OpenSaasAU/stack/commit/8d8a338ea4606b03ef859c4128b93b40a5fc9a21) Thanks [@borisno2](https://github.com/borisno2)! - Publish only `dist`, and docs; tarballs no longer include src, tests, compiled test files or build logs.

- [#1688](https://github.com/OpenSaasAU/stack/pull/1688) [`00c2208`](https://github.com/OpenSaasAU/stack/commit/00c22086b1f33a126b7010f83e8087f937860119) Thanks [@borisno2](https://github.com/borisno2)! - `file()`/`image()` with `cleanupOnReplace` now delete the replaced file only after the write commits, and remove the new upload when the write is refused or rolled back.

- [#1843](https://github.com/OpenSaasAU/stack/pull/1843) [`8cca21a`](https://github.com/OpenSaasAU/stack/commit/8cca21a2e681a4afed908b93802ed260290ea319) Thanks [@borisno2](https://github.com/borisno2)! - `file()`/`image()` now compose a user `hooks.resolveInput`/`afterOperation` with the built-in ones instead of replacing them, so upload, the metadata-trust check and delete cleanup survive.

- [#1522](https://github.com/OpenSaasAU/stack/pull/1522) [`c322241`](https://github.com/OpenSaasAU/stack/commit/c322241a7a8a293ce6824df13dcb9765cd9479a2) Thanks [@borisno2](https://github.com/borisno2)! - Add a `typecheck` script to every package, covering `tests/**/*` alongside `src/**/*` (not just what `build` compiles), and fix the type errors it surfaced in existing test files.

- [#1420](https://github.com/OpenSaasAU/stack/pull/1420) [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03) Thanks [@borisno2](https://github.com/borisno2)! - Declare the Node >=22.18.0 floor in `engines`.

- [#1860](https://github.com/OpenSaasAU/stack/pull/1860) [`501decb`](https://github.com/OpenSaasAU/stack/commit/501decb746a6b6507ac22dc61dbeb9338b6ef77f) Thanks [@borisno2](https://github.com/borisno2)! - Track every upload when two writes in one transaction share a data object, so a rollback removes them all.

- [#1525](https://github.com/OpenSaasAU/stack/pull/1525) [`7fd56ac`](https://github.com/OpenSaasAU/stack/commit/7fd56ac747df69ecdb65e728006e55cfdc122075) Thanks [@borisno2](https://github.com/borisno2)! - Add Test-context coverage against a real column for `image()`/`file()` (single-column and multi-column/keystone modes, split-on-write and assembly-on-read, field-level access on the logical key) and for `richText()`.

- [#1534](https://github.com/OpenSaasAU/stack/pull/1534) [`bb37e04`](https://github.com/OpenSaasAU/stack/commit/bb37e04003946eea4396efc90d42d067de6276e3) Thanks [@borisno2](https://github.com/borisno2)! - Fix a field-level `resolveOutput`/`resolveInput` hook typing `value` as `unknown` at the real `list<Lists.X.TypeInfo>({...})` instantiation. `BaseFieldConfig` and every field builder now take a second `TKey` type parameter pinning the field's own key, so e.g. a `text()` field's `resolveOutput` sees `string` instead of `unknown`, and a mismatched return type is a compile error ([#1306](https://github.com/OpenSaasAU/stack/issues/1306)).

  Compatibility note: a third-party field builder that hasn't adopted the new `TKey` parameter (the single-parameter `BaseFieldConfig<TTypeInfo>` shape the docs previously showed) now fails to compile — not merely loses hook precision — when mounted inside a `list<Lists.X.TypeInfo>({...})`-typed config, even with no custom `hooks` declared. The no-explicit-`TypeInfo` authoring flow (`list({ fields: {...} })`) is unaffected either way. Every field builder in this monorepo (core, tiptap, rag, storage) is already updated.

- [#1532](https://github.com/OpenSaasAU/stack/pull/1532) [`f9b4e2c`](https://github.com/OpenSaasAU/stack/commit/f9b4e2cd5ee2e6db5ad23ca3e13e07635291747d) Thanks [@borisno2](https://github.com/borisno2)! - Fail a package's vitest run with a named, actionable error when its `dist/` was not built from its current `src/`, instead of silently testing stale built output through a cross-package import or a spawned CLI binary.

- [#1499](https://github.com/OpenSaasAU/stack/pull/1499) [`bcea6de`](https://github.com/OpenSaasAU/stack/commit/bcea6dea0766f510da59188cb70fb41b2fd2573b) Thanks [@borisno2](https://github.com/borisno2)! - Add the missing `[key: string]: unknown` index member to `S3StorageConfig` so it matches `LocalStorageConfig` and `VercelBlobStorageConfig` and is assignable to core's `BaseStorageConfig`:

  ```typescript
  import type { BaseStorageConfig } from '@opensaas/stack-storage'
  import { s3Storage } from '@opensaas/stack-storage-s3'

  // Previously a type error: S3StorageConfig was not assignable to BaseStorageConfig.
  const slot: BaseStorageConfig = s3Storage({ bucket: 'my-bucket', region: 'us-east-1' })
  ```

  `@opensaas/stack-storage` and `@opensaas/stack-storage-vercel` each gain a test pinning their own provider config's assignability to `BaseStorageConfig`, alongside the new S3 one, so a future provider can't regress this.

- [#1848](https://github.com/OpenSaasAU/stack/pull/1848) [`1c8f2a0`](https://github.com/OpenSaasAU/stack/commit/1c8f2a0b35ca2dd167151c9c68096f9b810981c3) Thanks [@borisno2](https://github.com/borisno2)! - Peer ranges on `@opensaas/stack-core`, `@opensaas/stack-storage` and `@opensaas/stack-ui` now track the release version instead of `^0`, so a mismatched minor is flagged.
- Updated dependencies [[`2daa64f`](https://github.com/OpenSaasAU/stack/commit/2daa64f5722b6e85653a0cf834353db070541ab3), [`df052c2`](https://github.com/OpenSaasAU/stack/commit/df052c26942001262ad90670ec60139b2fbc9689), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`05fc094`](https://github.com/OpenSaasAU/stack/commit/05fc0949071feb6c69cb735a82494421e1c7c189), [`de2bd7a`](https://github.com/OpenSaasAU/stack/commit/de2bd7a035ee60fc09d0718885148eeaafecd798), [`dcf3a89`](https://github.com/OpenSaasAU/stack/commit/dcf3a891161bedcab679f79f0332176ab4bafe67), [`ef3060c`](https://github.com/OpenSaasAU/stack/commit/ef3060c89a6a122bade9a6a7bb3492c4877e6ab5), [`0ef9495`](https://github.com/OpenSaasAU/stack/commit/0ef9495d0f7f53c0a84ac6e5fd0fe3f8da183e4b), [`6e0db6b`](https://github.com/OpenSaasAU/stack/commit/6e0db6bdc39f047f4eb62523765054826327214e), [`a0d613f`](https://github.com/OpenSaasAU/stack/commit/a0d613fe344e7cc6eca8d1b35171bbbfc0ae2a5b), [`b7aee49`](https://github.com/OpenSaasAU/stack/commit/b7aee491198c6dc7216e7323705ff36e1646e5c5), [`274b0a5`](https://github.com/OpenSaasAU/stack/commit/274b0a57b3e2d307a9d5563b08f8a9d60b3ff7b4), [`6f1a94c`](https://github.com/OpenSaasAU/stack/commit/6f1a94c005b231ea78be8bb9ce0163937bf37fa3), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`d4c0ecd`](https://github.com/OpenSaasAU/stack/commit/d4c0ecd103bd2d31b2a4f459529fc200506874e2), [`5334468`](https://github.com/OpenSaasAU/stack/commit/5334468181b2716897c0fce29965fc590b1dc239), [`be9466e`](https://github.com/OpenSaasAU/stack/commit/be9466e947d04a8091030ffef2588ba5bec431b0), [`28795bb`](https://github.com/OpenSaasAU/stack/commit/28795bb0b39c4a6f73c860d16c1b5240aa238f8f), [`7f287d4`](https://github.com/OpenSaasAU/stack/commit/7f287d48579a815c67441c8336b1372d9f41c61e), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`00c3760`](https://github.com/OpenSaasAU/stack/commit/00c3760449f890f5d365798f5b3b3e1367333762), [`17bb5d5`](https://github.com/OpenSaasAU/stack/commit/17bb5d5a3afa78007afdd80eaa5a09f27a408890), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`b79436b`](https://github.com/OpenSaasAU/stack/commit/b79436b34e1f1ad84c70efc2c4aaad1a64e27717), [`b1f838b`](https://github.com/OpenSaasAU/stack/commit/b1f838b2df2aae4e6edf2598b28b6bec2b8bfba7), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`71714f6`](https://github.com/OpenSaasAU/stack/commit/71714f6ea2859455af0203bea6fbd13371a80cb9), [`0c33f68`](https://github.com/OpenSaasAU/stack/commit/0c33f68b5d9449b4cdaecc792815bbd64afd7e9f), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`e5ea5b3`](https://github.com/OpenSaasAU/stack/commit/e5ea5b3bd803106ed00a892ddffcdc365f4cde1e), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`d8d5822`](https://github.com/OpenSaasAU/stack/commit/d8d58220e809ef64d7c63ee26ce9f0f491ac836d), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`5aa3815`](https://github.com/OpenSaasAU/stack/commit/5aa38159fe5a54f3f0c294cc47f439ec9175d544), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`21bd0d5`](https://github.com/OpenSaasAU/stack/commit/21bd0d53860d8ad2f801c65e83637e523adc19f6), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`8d8a338`](https://github.com/OpenSaasAU/stack/commit/8d8a338ea4606b03ef859c4128b93b40a5fc9a21), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`6b40b3a`](https://github.com/OpenSaasAU/stack/commit/6b40b3aaa6174530a990a8f258778993f9501c98), [`e6a7fb2`](https://github.com/OpenSaasAU/stack/commit/e6a7fb28b57c56743537804231ed40e9d36ca4df), [`99d9870`](https://github.com/OpenSaasAU/stack/commit/99d98700398539b2e145a87b18ab6e6d4df6fac4), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`f097958`](https://github.com/OpenSaasAU/stack/commit/f097958cba46015072b7b118d1ca78471700571e), [`ee0d3d3`](https://github.com/OpenSaasAU/stack/commit/ee0d3d3e20201e2ad3859f081597fb5e623518eb), [`c1b689a`](https://github.com/OpenSaasAU/stack/commit/c1b689ae2c8783426a684af19e7962346af15124), [`a1dbf13`](https://github.com/OpenSaasAU/stack/commit/a1dbf1360fd2beef632b3575d82d464db6af136a), [`2d5d159`](https://github.com/OpenSaasAU/stack/commit/2d5d159dab277af9b6e29f3b07ce69debeeacce5), [`3e298af`](https://github.com/OpenSaasAU/stack/commit/3e298af86ebfa9c359fb4fbbd8fcde4262fb84c7), [`b784cd9`](https://github.com/OpenSaasAU/stack/commit/b784cd94e44f2a34420a125aff5c099c15e21ba0), [`548dd00`](https://github.com/OpenSaasAU/stack/commit/548dd0014551b07c3ff3fefccb2945bb025c6864), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`ad294d8`](https://github.com/OpenSaasAU/stack/commit/ad294d8e934bda0606870078e72e3d0c01a9c9f8), [`c322241`](https://github.com/OpenSaasAU/stack/commit/c322241a7a8a293ce6824df13dcb9765cd9479a2), [`405951c`](https://github.com/OpenSaasAU/stack/commit/405951cd67f1127701246364c873b457e39afd04), [`d94c528`](https://github.com/OpenSaasAU/stack/commit/d94c528ab490245a081d7e84b53287559f224866), [`6b9e24e`](https://github.com/OpenSaasAU/stack/commit/6b9e24e348b711a92c9610df554f03098bde97c7), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`e70ab87`](https://github.com/OpenSaasAU/stack/commit/e70ab87f7bae9eccc0212f0d43d58b9dd427394c), [`5c23069`](https://github.com/OpenSaasAU/stack/commit/5c23069861fda7ebfd77ac0726200800b597d60a), [`2b17424`](https://github.com/OpenSaasAU/stack/commit/2b1742453308c34e8294785e48f979bee25e75a3), [`e1f93c0`](https://github.com/OpenSaasAU/stack/commit/e1f93c0a9cd2c5e0a5ccb82b8a2cfcce9ef1db0e), [`4cb0892`](https://github.com/OpenSaasAU/stack/commit/4cb0892c7ec815d8f75fd04c8f29f315e98f7c83), [`5432400`](https://github.com/OpenSaasAU/stack/commit/54324009f724168a02b3a5577b0877011748732e), [`f51ca12`](https://github.com/OpenSaasAU/stack/commit/f51ca12b793c2131e04f6d997af24eb42f2198f0), [`721b7c0`](https://github.com/OpenSaasAU/stack/commit/721b7c0eeca000966c7a419e3946d34cef9b2bc1), [`cae8c1e`](https://github.com/OpenSaasAU/stack/commit/cae8c1e562bf6f780bd2d870948f407dbabbf4fe), [`bc2614f`](https://github.com/OpenSaasAU/stack/commit/bc2614f3ebd662737d22d5e47bf03f26a1aca5a6), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`c3ce7b6`](https://github.com/OpenSaasAU/stack/commit/c3ce7b6f23240144ae424d47685c71c0e553b877), [`7ffacbf`](https://github.com/OpenSaasAU/stack/commit/7ffacbfe1cee35ae7d9922519e94a68c13d0b34b), [`a2c8e59`](https://github.com/OpenSaasAU/stack/commit/a2c8e59e39d303c97dbdb51875261fff0169be8d), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`4af852c`](https://github.com/OpenSaasAU/stack/commit/4af852c8d166e80e9197a7ba97779ff784f42156), [`cf575b0`](https://github.com/OpenSaasAU/stack/commit/cf575b0330f8709096c6097e0a97e9a1ba1291e2), [`f06fbf4`](https://github.com/OpenSaasAU/stack/commit/f06fbf4055f51946d89c72985176d54f43af217d), [`6d8c6c7`](https://github.com/OpenSaasAU/stack/commit/6d8c6c78d590f0dc804578fd3f8f2b32b02677ce), [`5cfa783`](https://github.com/OpenSaasAU/stack/commit/5cfa7832f48f905391c5a76b979a9ca93024d207), [`42b141b`](https://github.com/OpenSaasAU/stack/commit/42b141b644fbf90d3d976431557e15a90e9ce518), [`0a18d1f`](https://github.com/OpenSaasAU/stack/commit/0a18d1f74117a61f495870c26c975c49802a1547), [`407c1b8`](https://github.com/OpenSaasAU/stack/commit/407c1b842a35829c4cdfc3b0f4ff99b1e62ce032), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`c7284be`](https://github.com/OpenSaasAU/stack/commit/c7284be4eb17d27f3dd6b36feee604561df98986), [`96dfeee`](https://github.com/OpenSaasAU/stack/commit/96dfeee7648c0431cb956f15cd5ca4c2210b0afb), [`e11271b`](https://github.com/OpenSaasAU/stack/commit/e11271b523cf92f9d60236ea02715b1fa87c6028), [`3cb2d50`](https://github.com/OpenSaasAU/stack/commit/3cb2d504e90128dfc7952b19bbea49eabab13f0d), [`caf883a`](https://github.com/OpenSaasAU/stack/commit/caf883a88629ac5eeb41375e220d9c11427edaee), [`32b9afa`](https://github.com/OpenSaasAU/stack/commit/32b9afadab65cbe6445dcd15da8df54218880f7b), [`8fe4ea2`](https://github.com/OpenSaasAU/stack/commit/8fe4ea2a52e2e0202c4568fca46d1da76a87652d), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`b1fec28`](https://github.com/OpenSaasAU/stack/commit/b1fec28fa5c07fe5aa8d3ba15e07f269bf1c645b), [`27d91d5`](https://github.com/OpenSaasAU/stack/commit/27d91d54fcd79122dfe695b5dea94c14572a2b98), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`477a75b`](https://github.com/OpenSaasAU/stack/commit/477a75bbfd2ee6e95ed78941b837cad7eea6a5f1), [`22f03bc`](https://github.com/OpenSaasAU/stack/commit/22f03bca2f190a9c1d854e22efe5beb3807da264), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`12bd183`](https://github.com/OpenSaasAU/stack/commit/12bd183112000abe7d34487ee0f8c874b5623507), [`53f2d20`](https://github.com/OpenSaasAU/stack/commit/53f2d202d5a58bcdb4d016aef929ae68a5151ed4), [`d40c4bb`](https://github.com/OpenSaasAU/stack/commit/d40c4bb1700bc4f52203d4082cc13fb9efaa098a), [`95cb6dc`](https://github.com/OpenSaasAU/stack/commit/95cb6dc70a6c622c70c8cd74a14abb53f25bc95f), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`04a00f4`](https://github.com/OpenSaasAU/stack/commit/04a00f4ae87611b879829b9d20fbfe9cdb656da2), [`3d0d4db`](https://github.com/OpenSaasAU/stack/commit/3d0d4db7923a75cf77f665ef8f915edcf99a408d), [`80b3e20`](https://github.com/OpenSaasAU/stack/commit/80b3e204d20f60aded2d6d10cd9a04b8da5119da), [`c267d3c`](https://github.com/OpenSaasAU/stack/commit/c267d3c1aa2423374ae1f0b9e24e9b4f8bdf4b7c), [`6eab4e2`](https://github.com/OpenSaasAU/stack/commit/6eab4e28e2a42168db2fb8bb99c94c1f22d527cd), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`c63d79f`](https://github.com/OpenSaasAU/stack/commit/c63d79fd92c6265030eddae6dcfb4a5faa4a5a69), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`5d0ec1b`](https://github.com/OpenSaasAU/stack/commit/5d0ec1b3961fe63fad41a33096802faa4111507d), [`d59945a`](https://github.com/OpenSaasAU/stack/commit/d59945a36ba6615823e22822f366fb2507fbad68), [`d9b4b37`](https://github.com/OpenSaasAU/stack/commit/d9b4b3740df3573d090b140eb32daaec5c319485), [`9fe6917`](https://github.com/OpenSaasAU/stack/commit/9fe6917f37f4110740e2aa9ee174355699f8b36d), [`d049f38`](https://github.com/OpenSaasAU/stack/commit/d049f3804cc2974b98c854ff4ecfd1660e6d5a75), [`2739ad8`](https://github.com/OpenSaasAU/stack/commit/2739ad8923ab3db893eefb718d21fcb2d079a519), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`bb37e04`](https://github.com/OpenSaasAU/stack/commit/bb37e04003946eea4396efc90d42d067de6276e3), [`aa9296c`](https://github.com/OpenSaasAU/stack/commit/aa9296cd3af11e3e0c1b13969d986915e7673c9a), [`3fb20e0`](https://github.com/OpenSaasAU/stack/commit/3fb20e05ce986e25d317910280cfd45abb034c8a), [`4dd1dd0`](https://github.com/OpenSaasAU/stack/commit/4dd1dd0b555a6838a989d2ee43399c676742be0c), [`7242781`](https://github.com/OpenSaasAU/stack/commit/7242781e1d27e6e7a4a08ed63d7ecb544e20db6e), [`52b79a7`](https://github.com/OpenSaasAU/stack/commit/52b79a7519eadce9a2dc812e63a32df022f3c578), [`781b819`](https://github.com/OpenSaasAU/stack/commit/781b8196064835637b93e34ec31e6a3dc959ccae), [`f9b4e2c`](https://github.com/OpenSaasAU/stack/commit/f9b4e2cd5ee2e6db5ad23ca3e13e07635291747d), [`6cfe96c`](https://github.com/OpenSaasAU/stack/commit/6cfe96c248889a268b9505178db1da9b177dafe6), [`cfb397a`](https://github.com/OpenSaasAU/stack/commit/cfb397ad72f1b27c854b0a765ebb249fbc7dab3e), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`dbb52c7`](https://github.com/OpenSaasAU/stack/commit/dbb52c79021880302e361d13570765d2fee4e4af), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`6975d3e`](https://github.com/OpenSaasAU/stack/commit/6975d3e76cb0280d9960461698e079276b56f8c0), [`eedb0f7`](https://github.com/OpenSaasAU/stack/commit/eedb0f7b4b856fea9927c2a06f827d38fc28f75c), [`a4227e9`](https://github.com/OpenSaasAU/stack/commit/a4227e9dd8097a38ec80a430b725dc5f0838f8c2), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`7ffacbf`](https://github.com/OpenSaasAU/stack/commit/7ffacbfe1cee35ae7d9922519e94a68c13d0b34b), [`b0317b4`](https://github.com/OpenSaasAU/stack/commit/b0317b475ecd2cff6f11fe42ef964c80696c60ec), [`bed0cc3`](https://github.com/OpenSaasAU/stack/commit/bed0cc3197cd4b1ab5aebf40eda6289ae8a955fd), [`0a3cba5`](https://github.com/OpenSaasAU/stack/commit/0a3cba5197d98ff780036a0805d660af84dfbc50), [`1ecc97e`](https://github.com/OpenSaasAU/stack/commit/1ecc97ec31580d778d138122f89798f4be651744), [`4f65926`](https://github.com/OpenSaasAU/stack/commit/4f65926af88e62a053ac1c795e1b9e214744267b), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`8b7eb1f`](https://github.com/OpenSaasAU/stack/commit/8b7eb1f902b73e89579f4a7ca3256c8d8a3ef950), [`7adac1b`](https://github.com/OpenSaasAU/stack/commit/7adac1bfdbce5c49c8f09a3f69bd9684a77d4cc2), [`07999bb`](https://github.com/OpenSaasAU/stack/commit/07999bb4c6e7748f8b3434ce82db780dbf6a8e9f), [`7ebd6ee`](https://github.com/OpenSaasAU/stack/commit/7ebd6ee5f78f5773b566dc6cac66d73b640c3c03), [`b84c28d`](https://github.com/OpenSaasAU/stack/commit/b84c28d2fd5088fdb56a7ba30e719e4f52b57d7d)]:
  - @opensaas/stack-core@0.44.0

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
