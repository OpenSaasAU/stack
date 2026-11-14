---
'@opensaas/stack-core': patch
---

A field `read` rule that calls `structuredClone` on a nested value now denies instead of failing the write with `DataCloneError`.
