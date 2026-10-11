---
'@opensaas/stack-core': patch
'@opensaas/stack-ui': patch
---

Clamp admin `?pageSize=` and `relationshipOptions` `take` to 200 (non-integer `take` throws `ValidationError`); URL-encode the standalone `SearchBar` term.
