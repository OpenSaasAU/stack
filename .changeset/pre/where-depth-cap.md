---
'@opensaas/stack-core': patch
---

Cap caller `where` predicates at 5 nested relation quantifiers and 256 entries; exceeding either throws a `ValidationError` before any access rule runs.
