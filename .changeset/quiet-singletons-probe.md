---
'@opensaas/stack-core': patch
'create-opensaas-app': patch
---

Add `singletonRowStored` to `@opensaas/stack-core/internal`, so `serializeItemForForm` can read a singleton without triggering `get()`'s auto-create.
