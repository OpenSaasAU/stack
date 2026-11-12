---
'@opensaas/stack-core': patch
---

Field-level `beforeOperation` now fires for a multi-column field on create and update, and list and field hooks all see the logical `resolvedData` (#2161).
