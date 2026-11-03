---
'@opensaas/stack-core': patch
---

A root write's own transaction now carries a row-lock lane, so list- and field-level `resolveInput`, `validate`, `beforeOperation` and `afterOperation` hooks can call `forUpdate()` instead of throwing `RowLockUnavailableError`.
