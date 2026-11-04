---
'@opensaas/stack-cli': patch
---

`migrate fk-renames` now also renames multi-column indexes and uniques whose Prisma 7 name was built from a renamed FK column.
