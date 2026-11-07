---
'@opensaas/stack-core': patch
---

MCP `where` relation predicates into a list with `mcp.enabled: false`, `mcp.tools.read: false` or denied query access are now refused as an unknown key.
