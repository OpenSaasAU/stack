---
'@opensaas/stack-core': patch
---

Fix a concurrent first `tx.db.<Singleton>.get()` in two transactions aborting the loser's transaction: the auto-create now takes a transaction-scoped advisory lock and re-reads first.
