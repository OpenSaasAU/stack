---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
---

Fix `context.unsafe.sql`/`.raw` degrading to `object` through the generated `Context`/`BaseContext`/`TransactionContext` types. The generated bundle now keys the Unsafe surface to the app's own Prisma 8 client, so a migration script gets Prisma's own typed SQL builder and raw tag with no cast.
