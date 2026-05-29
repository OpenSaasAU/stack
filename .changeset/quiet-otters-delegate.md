---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
---

Move relationship Prisma schema generation into the relationship field builder

The relationship field now exposes a `getPrismaRelation()` method that returns its complete Prisma schema contribution (FK line, relation line, synthetic back-relation). The Prisma generator delegates to this method instead of special-casing relationships, keeping it a neutral coordinator. Generated schemas are unchanged.
