---
'@opensaas/stack-storage-s3': patch
---

Derive the uploaded object's file extension with `path.extname` so extension-less or dotted-directory names can no longer put the client filename or a `/` into the S3 key.
