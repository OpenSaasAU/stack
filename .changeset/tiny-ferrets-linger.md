---
'@opensaas/stack-core': patch
---

Fix a denied to-one relation's foreign-key column leaking the related row's id on a read that never included the relation.
