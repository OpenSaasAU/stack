---
'@opensaas/stack-auth': patch
---

Fix `consumeOne` on the root auth adapter opening a second transaction inside better-auth's transaction, which hung sign-up on the Dev database.
