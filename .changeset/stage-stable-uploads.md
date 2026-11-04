---
'@opensaas/stack-storage': patch
'@opensaas/stack-storage-s3': patch
'@opensaas/stack-storage-vercel': patch
---

With `generateUniqueFilenames: false`, a rejected write no longer overwrites the stored file: uploads are staged and moved onto the stable key only once the write commits. Storage providers gain an optional `move(from, to)`.
