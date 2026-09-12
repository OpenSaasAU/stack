---
'@opensaas/stack-core': patch
---

Fix MCP read path: a throwing field-level access rule no longer leaks its raw error text to the client, and no longer fails a `fields`-bearing query for a field the caller never named.
