---
'@opensaas/stack-core': patch
---

MCP `where`: a throwing `query` rule on an unnamed list no longer fails the query, `__proto__` is refused like on `context.db`, and `in`/`notIn` length and over-deep `AND` get the named cap refusal first.
