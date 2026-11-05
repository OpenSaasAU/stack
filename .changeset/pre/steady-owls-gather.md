---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
---

Support `@prisma/orm-*` 8.0.0-rc.12: drop the removed `strategy` lowering key and keep `createdAt`'s database `now()` default, which rc.12's `createdAtString()` preset no longer emits.
