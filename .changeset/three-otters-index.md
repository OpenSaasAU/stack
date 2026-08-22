---
'@opensaas/stack-auth': patch
---

The derived `Session.user` / `Account.user` foreign keys are now indexed (`isIndexed: true`, was `false`), and `Verification.identifier` is now indexed too — matching the three indexes better-auth itself declares (`session_userId_idx`, `account_userId_idx`, `verification_identifier_idx`). `prisma migrate diff` against a real better-auth install no longer reads these as three dropped indexes, and `Session`/`Account` lookups by `userId` are no longer unindexed.

**Migration note:** existing projects will see a migration on their next `prisma migrate dev`/`db push` adding the three indexes.
