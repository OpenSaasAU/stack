---
'@opensaas/stack-core': patch
---

Fix `create()`, `update()` and `delete()` results returning a to-one's `<field>Id` that a `first()` of the same row hides; write results now go through the same foreign-key narrowing as reads.
