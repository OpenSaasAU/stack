---
'@opensaas/stack-core': patch
---

Refuse `count()` and `combine` count branches through a synthetic back-relation whose source field has a row-dependent `read` rule, closing a count oracle (#1910).
