# @opensaas/stack-storage

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
