---
'@opensaas/stack-core': minor
'@opensaas/stack-storage': minor
---

A Test context can exercise `file()` and `image()` fields

`createTestContext` built its context with no storage surface, so any write to a storage-backed field threw `No storage providers configured` — the Test context could not cover the storage package at all. It now takes one:

```ts
import { createTestContext } from '@opensaas/stack-core/testing'
import { createStorageUtils } from '@opensaas/stack-storage/runtime'

const harness = await createTestContext(config, null, {
  storage: createStorageUtils(config),
})

const user = await harness.context.db.User.create({
  data: { name: 'Ada', avatar: new File([bytes], 'avatar.png', { type: 'image/png' }) },
})
```

`createStorageUtils(config)` is new in `@opensaas/stack-storage/runtime` and is the supported way to build that surface. `StorageUtils` types its option and metadata arguments as `unknown`, because core is this package's dependency and cannot name its types; the factory is the one place that re-narrows them, so a consumer building a context by hand no longer writes that conversion itself.

Omitting the option is unchanged: a config with no storage still throws on a storage-backed write, exactly as an application with none does.
