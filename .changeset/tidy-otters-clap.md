---
'@opensaas/stack-auth': patch
---

Fix `Session.user`/`Account.user` foreign key generating a `user` physical column instead of `userId`, mismatching better-auth's own schema and breaking clean-diff adoption (ADR-0007). An explicit `fields: { userId: ... }` override is unaffected.

**Migration note:** existing greenfield projects need to rename the column on `Session` and `Account` (e.g. `ALTER TABLE "Session" RENAME COLUMN "user" TO "userId";` and the same for `Account`) to match the new generated schema.
