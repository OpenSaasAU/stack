---
'@opensaas/stack-ui': patch
---

Fix the RelationshipTable ✕ disconnect sending no `parentId`, so a stale table can no longer unlink a row that now belongs to another parent; the "linked elsewhere" conflict is shown on the row.
