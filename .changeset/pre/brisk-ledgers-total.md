---
'@opensaas/stack-core': patch
---

Fix `create`, `update` and `delete` throwing or returning a wrong value on a list whose computed field declares a relation in `needs`; a write now returns that field exactly as `first()` does.
