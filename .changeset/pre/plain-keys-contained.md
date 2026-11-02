---
'@opensaas/stack-storage-s3': patch
'@opensaas/stack-storage-vercel': patch
---

S3 and Vercel Blob providers refuse a filename that is not a single plain segment (`/`, `\`, NUL, `.`, `..`), matching `LocalStorageProvider`.
