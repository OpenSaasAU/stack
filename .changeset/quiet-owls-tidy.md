---
'@opensaas/stack-core': patch
'@opensaas/stack-auth': patch
---

Remove pre-Prisma-8 residue: the dead `resolveForeignKeyVisibility` module, the never-thrown `RelationFilterAccessDeniedError` (removed export), and the `authPlugin` TSDoc's sqlite example.
