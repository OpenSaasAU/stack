---
'@opensaas/stack-core': patch
---

A write that returns `null` after its hooks ran now rolls those hooks' writes back (and poisons an enclosing transaction), so `afterTransaction`'s `rolled-back` matches the database.
