---
'@opensaas/stack-core': patch
---

`findMany`/`count` now reject an undeclared `where`/`orderBy` key (including nested inside `AND`/`OR`/`NOT` or a relation filter), closing the same back-relation surface #564 closed on writes. `sudo` still bypasses.
