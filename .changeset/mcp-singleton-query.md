---
'@opensaas/stack-core': patch
---

Fix MCP `list_<singleton>_query` failing with an internal error; it now reads the singleton through `get()` and returns `{ items: [row], count: 1 }`.
