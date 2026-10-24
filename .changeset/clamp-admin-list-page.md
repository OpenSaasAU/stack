---
'@opensaas/stack-ui': patch
---

Admin list view renders page 1 for a non-numeric, zero or negative `?page=` instead of an empty list.
