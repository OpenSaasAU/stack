---
'@opensaas/stack-auth': patch
---

Fix the Auth adapter's typed-SQL `where` rendering `= NULL` for null `eq`/`ne` and ignoring `mode: 'insensitive'` on `in`/`not_in`, matching the ORM lowering.
