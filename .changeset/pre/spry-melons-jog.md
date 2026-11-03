---
'@opensaas/stack-core': patch
---

Make an empty-value filter token (`role:` or a bare `""`) an explicit, tested no-op in `buildFilterWhere` instead of a silent drop that relied on JS falsy-string truthiness.
