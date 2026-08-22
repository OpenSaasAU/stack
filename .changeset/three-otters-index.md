---
'@opensaas/stack-auth': patch
---

The derived `Session.user` / `Account.user` foreign keys now default their column to better-auth's own `userId` name (was the generator's Keystone-parity default of `user`) and are indexed (`isIndexed: true`, was `false`); `Verification.identifier` is now indexed too. This matches what a live better-auth database actually has — `session_userId_idx`, `account_userId_idx`, `verification_identifier_idx` — so `prisma migrate diff` against a real better-auth install no longer reads these as a column rename plus three dropped indexes, and `Session`/`Account` lookups by `userId` are no longer unindexed. Existing projects will see a migration on their next `prisma migrate dev`/`db push` renaming the FK column and adding the three indexes.
