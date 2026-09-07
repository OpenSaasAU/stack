---
'@opensaas/stack-cli': patch
---

Fix a regression from 0.42.1 (#1264): the generated `findUnique`/`findFirst`/`findMany` (and singleton `get`) delegates were not assignable to a plain structural seam, and `Parameters<>` over them resolved to `never`. Restores 0.42.0's behavior for both.
