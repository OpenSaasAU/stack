---
'@opensaas/stack-core': patch
---

Field-level `beforeOperation` now fires for a multi-column field on create and update (#2161). List and field hooks now see the logical key in `resolvedData` rather than the split physical columns.
