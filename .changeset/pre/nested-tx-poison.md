---
'@opensaas/stack-core': patch
---

A caught nested `tx.transaction()` callback rejection now poisons the owning transaction, so the outer transaction rolls back instead of committing the inner unit's writes.
