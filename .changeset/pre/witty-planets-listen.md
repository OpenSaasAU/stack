---
'@opensaas/stack-core': patch
---

Fix the row-lock terminal's name in error messages: it now reads `forUpdate().all()`/`forUpdate().first()`, matching the order that actually type-checks.
