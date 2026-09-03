---
'@opensaas/stack-core': patch
---

Fix `_count` ignoring a relationship's field-level `read` access, letting the true count of a hidden relationship leak through both the admin list view and a caller-supplied `_count`.
