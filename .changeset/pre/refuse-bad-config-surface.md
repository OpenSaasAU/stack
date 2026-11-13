---
'@opensaas/stack-core': patch
---

`opensaas generate` now refuses a `db.provider` other than `'postgresql'`, a stray `db.url`, a lower-case list key, and a relationship ref to an undeclared list (naming the list and field).
