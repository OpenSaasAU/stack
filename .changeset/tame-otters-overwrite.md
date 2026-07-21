---
'@opensaas/stack-storage-vercel': minor
---

Add `allowOverwrite` config option to `vercelBlobStorage`. The Vercel Blob API rejects uploads to an existing pathname unless this is sent, which made stable-filename replace workflows (`generateUniqueFilenames: false`, e.g. a field with `cleanupOnReplace`) throw "blob already exists". `allowOverwrite` now defaults to `true` when `generateUniqueFilenames` is `false`, and `false` otherwise; an explicit setting always wins.

```typescript
vercelBlobStorage({
  token: process.env.BLOB_READ_WRITE_TOKEN,
  generateUniqueFilenames: false,
  allowOverwrite: false, // opt back into reject-on-overwrite with stable names
})
```
