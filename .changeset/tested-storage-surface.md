---
'@opensaas/stack-core': minor
'@opensaas/stack-storage': minor
---

A Test context can exercise `file()` and `image()` fields

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
