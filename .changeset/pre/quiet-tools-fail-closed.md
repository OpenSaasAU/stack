---
'@opensaas/stack-core': patch
---

A list MCP custom tool that omits `scopes` now requires the configured write scope when `mcp.scopes` is set; pass `scopes: []` to opt out.
