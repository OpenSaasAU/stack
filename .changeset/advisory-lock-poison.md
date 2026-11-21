---
'@opensaas/stack-core': patch
---

`tx.advisoryLock()` now poisons its transaction when the lock statement fails, so a caught failure still rolls back with the original cause.
