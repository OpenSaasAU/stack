---
'@opensaas/stack-storage': patch
---

`StorageProvider.delete()` is now documented as idempotent; the local provider swallows `ENOENT` on delete instead of throwing.
