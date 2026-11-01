---
'@opensaas/stack-core': patch
---

A `context.transaction()` owner now rolls back and rejects with the new `TransactionRolledBackError` (first failure on `cause`) when a joined `context.db` write threw or the database aborted the transaction, even if the callback caught the error. A callback that swallowed a child failure previously committed; it now rejects. `afterTransaction` receives `rolled-back`.
