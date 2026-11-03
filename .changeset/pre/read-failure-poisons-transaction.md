---
'@opensaas/stack-core': patch
---

Fix a caught failing secured read inside a transaction silently rolling it back: read terminals now poison the transaction owner, so the call rejects with `TransactionRolledBackError`.
