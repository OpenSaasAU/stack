---
'@opensaas/stack-core': patch
'create-opensaas-app': patch
---

The engine context answers whether a singleton's row is stored, so `serializeItemForForm` can read a singleton without triggering `get()`'s auto-create.
