---
'@opensaas/stack-cli': patch
---

`db.indexes` generation now fails with a descriptive error for an empty `fields` array, and for a single-field entry that duplicates a column already indexed by that field's own `isIndexed` — previously these silently produced invalid or duplicate Prisma.
