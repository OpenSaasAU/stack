---
'@opensaas/stack-core': patch
---

Fix a read-gate bypass: a caller-shaped `include` (`where`/`limit`/`offset`/`select`) on a declared dependency no longer changes what field `read` rules and `resolveOutput` hooks see.
