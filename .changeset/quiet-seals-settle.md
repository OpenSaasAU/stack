---
'@opensaas/stack-core': patch
---

A singleton's `get()` auto-create no longer fails when a defaulted field denies `create` or is `write: 'hooks'`, and concurrent first `get()` calls resolve to the one row.
