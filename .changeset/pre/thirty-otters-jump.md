---
'@opensaas/stack-storage-s3': minor
'@opensaas/stack-storage': patch
'@opensaas/stack-storage-vercel': patch
---

Add the missing `[key: string]: unknown` index member to `S3StorageConfig` so it matches `LocalStorageConfig` and `VercelBlobStorageConfig` and is assignable to core's `BaseStorageConfig`:

```typescript
import type { BaseStorageConfig } from '@opensaas/stack-storage'
import { s3Storage } from '@opensaas/stack-storage-s3'

// Previously a type error: S3StorageConfig was not assignable to BaseStorageConfig.
const slot: BaseStorageConfig = s3Storage({ bucket: 'my-bucket', region: 'us-east-1' })
```

`@opensaas/stack-storage` and `@opensaas/stack-storage-vercel` each gain a test pinning their own provider config's assignability to `BaseStorageConfig`, alongside the new S3 one, so a future provider can't regress this.
