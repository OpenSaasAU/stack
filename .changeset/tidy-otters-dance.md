---
'@opensaas/stack-core': patch
---

Fix `UndefinedAccessFilterError`'s suggested sample code, which only used the first path segment and so rendered an invalid shape for a nested or composite condition (an `AND`/`OR` branch, an operator, or a relation quantifier).
