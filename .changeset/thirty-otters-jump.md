---
'@opensaas/stack-storage-s3': minor
---

Add the missing `[key: string]: unknown` index member to `S3StorageConfig` so it matches `LocalStorageConfig` and `VercelBlobStorageConfig` and is assignable to core's `BaseStorageConfig`, unblocking any code that passes an `s3Storage({ ... })` config through a `BaseStorageConfig`-typed slot.
