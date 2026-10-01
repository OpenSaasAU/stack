---
'@opensaas/stack-core': patch
---

Refuse an MCP custom or plugin tool whose name collides with a built-in `list_<x>_<op>` tool or another custom tool, instead of advertising it twice and never running it.
