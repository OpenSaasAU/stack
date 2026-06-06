---
'@opensaas/stack-storage': minor
---

Add a storage provider registration API so non-`local` and custom providers are constructable.

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
