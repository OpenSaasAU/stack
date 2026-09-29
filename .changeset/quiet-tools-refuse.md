---
'@opensaas/stack-core': patch
---

MCP `tools/call` now refuses disabled lists, disabled operations, and custom tools on disabled or query-denied lists, matching what `tools/list` advertises.
