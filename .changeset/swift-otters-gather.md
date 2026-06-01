---
'@opensaas/stack-core': patch
---

Refactor the write path into a single Write Pipeline. The canonical secured write sequence (hooks, validation, access, writable-field filtering, nested operations, persistence, after-hooks, Field Visibility) now lives in one module; create/update/delete are thin adapters over it parameterised by a per-operation strategy. Internal refactor only — no public API or behaviour change.
