---
'@opensaas/stack-storage-vercel': patch
---

Fix `delete()`/`download()` for `@vercel/blob` v2, which rejects `head()` with `BlobNotFoundError` for missing blobs instead of resolving `null`. `delete()` of a missing blob is now a no-op and no longer round-trips through `head()`.
