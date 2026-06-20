# @opensaas/stack-core

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
    db: {
      /* ... */
    },
    lists: {
      /* ... */
    },
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
    lists: {
      /* ... */
    },
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
    fields: {
      /* ... */
    },
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
