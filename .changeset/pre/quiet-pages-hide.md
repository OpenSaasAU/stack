---
'@opensaas/stack-core': patch
---

Refuse `limit`, `offset` and `orderBy` on a synthetic back-relation include whose source field has a row-dependent `read` rule, closing a paging existence oracle (#1970).
