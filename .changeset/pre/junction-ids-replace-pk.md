---
'@opensaas/stack-cli': patch
---

`opensaas migrate junction-ids` now replaces the composite `("A","B")` primary key of Prisma 6+ implicit many-to-many tables with a surrogate `id` and the pair unique, in one transaction.
