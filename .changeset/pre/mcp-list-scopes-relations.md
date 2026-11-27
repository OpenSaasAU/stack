---
'@opensaas/stack-core': patch
---

MCP per-list scopes now apply through relations (`fields`, `where`, `orderBy`, `connect`), and `create`/`update` return only the `id` to a token without the list's read scope or read tool.
