---
'@opensaas/stack-cli': patch
---

`opensaas mcp start` no longer leaves the MCP server running as an orphan: it forwards SIGTERM/SIGINT/SIGHUP, the server exits when stdin closes, and the child runs under `process.execPath`.
