---
'@opensaas/stack-core': patch
---

Fix a relation that is both reduced (`.count()`/`.combine()`) and a live declared dependency of a computed field or field-level `read` rule: it now satisfies both instead of the dependency computing over the reduction's masked `[]`.
