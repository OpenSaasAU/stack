---
'@opensaas/stack-core': patch
---

MCP: a relation into a list whose read tool is off or whose `mcp.enabled` is false is no longer selectable, connectable, or filterable through its foreign-key column, and `orderBy` refuses it too.
