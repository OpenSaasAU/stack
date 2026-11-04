---
'@opensaas/stack-core': patch
---

Remove the dead `FindManyArgs`, `FindUniqueArgs` and `CountArgs` exports left behind by a prior delegate removal, and advertise/validate MCP `connect.id` at the related list's own id type instead of assuming every list is string-keyed.
