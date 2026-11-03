---
'@opensaas/stack-core': patch
---

A `delete()` that returns `null` after its hooks ran now rolls back the hooks' writes, and poisons an enclosing transaction, matching create and update.
