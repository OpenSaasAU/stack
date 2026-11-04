---
'@opensaas/stack-core': patch
---

A `password()` field is no longer accepted in `where`, `orderBy` or `distinct`, so an MCP client cannot extract a hash with `contains`; it is refused as an unknown column is.
