---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
---

Refuse a non-Postgres `DATABASE_URL` (such as a 0.43 `file:./dev.db`) with an error naming the variable and scheme, in the runtime lookup and before `opensaas dev` starts anything.
