---
'@opensaas/stack-core': patch
---

Fix root `update`/`delete` re-resolving the target under the row lock with the outer context, which deadlocked access rules that read `context.db` on a single-connection database.
