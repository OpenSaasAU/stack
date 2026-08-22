# @opensaas/stack-storage-vercel

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

## 0.32.0

## 0.31.1

## 0.31.0

### Minor Changes

- [#777](https://github.com/OpenSaasAU/stack/pull/777) [`7098878`](https://github.com/OpenSaasAU/stack/commit/70988788afc311906d7541c23f68e3b04e472b63) Thanks [@borisno2](https://github.com/borisno2)! - Honour `public: false` with real private-blob support. Uploads now map `public: false` to `access: 'private'` (previously ignored); `download()` reads both public and private blobs through `@vercel/blob`'s authorized `get()` path instead of a plain `fetch(url)`, and rejects with a descriptive "File not found" error for a missing blob instead of an unrelated failure; a new `getSignedUrl(filename, expiresIn?)` returns a time-limited signed URL for serving private files through developer-controlled routes.

  ```typescript
  storage: {
    documents: vercelBlobStorage({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      public: false,
    }),
  }

  const provider = createStorageProvider(config, 'documents')
  const signedUrl = await provider.getSignedUrl('report.pdf', 3600)
  ```

  This also bumps the `@vercel/blob` dependency from `^2.3.1` to `^2.6.1`, which adds the `issueSignedToken`/`presignUrl` APIs `getSignedUrl()` relies on.

- [#786](https://github.com/OpenSaasAU/stack/pull/786) [`7cd3eb4`](https://github.com/OpenSaasAU/stack/commit/7cd3eb49d0f9515a26984e096c1d3bc4b9dab530) Thanks [@borisno2](https://github.com/borisno2)! - Add `allowOverwrite` config option to `vercelBlobStorage`. The Vercel Blob API rejects uploads to an existing pathname unless this is sent, which made stable-filename replace workflows (`generateUniqueFilenames: false`, e.g. a field with `cleanupOnReplace`) throw "blob already exists". `allowOverwrite` now defaults to `true` when `generateUniqueFilenames` is `false`, and `false` otherwise; an explicit setting always wins.

  ```typescript
  vercelBlobStorage({
    token: process.env.BLOB_READ_WRITE_TOKEN,
    generateUniqueFilenames: false,
    allowOverwrite: false, // opt back into reject-on-overwrite with stable names
  })
  ```

- [#778](https://github.com/OpenSaasAU/stack/pull/778) [`5f8fd73`](https://github.com/OpenSaasAU/stack/commit/5f8fd731d30d040438d4447c54052d97d0ec2f73) Thanks [@borisno2](https://github.com/borisno2)! - Add Vercel OIDC authentication support to the Vercel Blob storage provider

  The provider no longer requires a static read-write token. New `storeId` and `oidcToken` config options enable Vercel OIDC auth — the `@vercel/blob` SDK exchanges the deployment's `VERCEL_OIDC_TOKEN` for blob credentials automatically:

  ```typescript
  storage: {
    uploads: vercelBlobStorage({
      storeId: process.env.BLOB_STORE_ID, // or omit and just set BLOB_STORE_ID
      pathPrefix: 'uploads',
    }),
  }
  ```

  Credential precedence (resolved by the SDK on every call): explicit `token` → OIDC token (`oidcToken` or `VERCEL_OIDC_TOKEN`) plus store id (`storeId` or `BLOB_STORE_ID`) → `BLOB_READ_WRITE_TOKEN` environment variable.

  The constructor no longer throws when no static token is configured — previously this blocked OIDC-authenticated deployments before the SDK's credential resolution could run. When no credentials are available at all, the SDK now throws a descriptive error on the first storage operation instead. Requires `@vercel/blob` 2.4.1+ (dependency floor bumped from 2.3.1).

### Patch Changes

- [#779](https://github.com/OpenSaasAU/stack/pull/779) [`4a1d9be`](https://github.com/OpenSaasAU/stack/commit/4a1d9be5aee15691e0d8a7c5b3d16c802e62bc84) Thanks [@borisno2](https://github.com/borisno2)! - Fix `getUrl()` returning a fabricated host that never resolves. It now derives the store ID from the configured token/store ID (the same way the SDK does internally) and embeds it along with the access mode, matching the real URL the SDK returns at upload time. A token that doesn't yield a store ID now throws a descriptive error instead of producing a silently wrong URL.

- [#792](https://github.com/OpenSaasAU/stack/pull/792) [`fe1ed5c`](https://github.com/OpenSaasAU/stack/commit/fe1ed5cd2226ea59b2b0b15e4c5f89379c98df2e) Thanks [@borisno2](https://github.com/borisno2)! - Fix unique filename generation to use `path.extname` semantics (matching the local provider) so extension-less originals no longer get the whole name appended, and pass through an explicit `cacheControlMaxAge: 0` instead of dropping it.

- [#776](https://github.com/OpenSaasAU/stack/pull/776) [`030d540`](https://github.com/OpenSaasAU/stack/commit/030d540cfb1fc4495da5177cda0bc1915c0cb354) Thanks [@borisno2](https://github.com/borisno2)! - Fix `delete()`/`download()` for `@vercel/blob` v2, which rejects `head()` with `BlobNotFoundError` for missing blobs instead of resolving `null`. `delete()` of a missing blob is now a no-op and no longer round-trips through `head()`.

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

### Patch Changes

- Updated dependencies []:
  - @opensaas/stack-storage@0.2.0

## 0.1.7

### Patch Changes

- @opensaas/stack-storage@0.1.7

## 0.1.6

### Patch Changes

- @opensaas/stack-storage@0.1.6

## 0.1.5

### Patch Changes

- 17eaafb: Update package urls
- Updated dependencies [17eaafb]
  - @opensaas/stack-storage@0.1.5

## 0.1.4

### Patch Changes

- @opensaas/stack-storage@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies [efe2357]
  - @opensaas/stack-storage@0.1.3

## 0.1.2

### Patch Changes

- @opensaas/stack-storage@0.1.2

## 0.1.1

### Patch Changes

- 045c071: Add field and image upload
- Updated dependencies [045c071]
  - @opensaas/stack-storage@0.1.1
