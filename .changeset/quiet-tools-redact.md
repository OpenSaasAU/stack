---
'@opensaas/stack-core': patch
---

MCP custom and plugin tool errors, `tools/list` failures and non-object `data` are now redacted or refused cleanly; throw `McpToolError` to return a message to the client.
