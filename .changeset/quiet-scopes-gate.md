---
'@opensaas/stack-core': minor
---

Opt-in OAuth scope enforcement for MCP tools

```typescript
mcp: { enabled: true, scopes: { read: 'mcp:read', write: 'mcp:write' } }
```

`query` tools require the `read` scope(s); `create`/`update`/`delete` require `write`. A list's `mcp.scopes` overrides the config-level value, and a custom tool or `registerMcpTool` tool can declare `scopes: ['reports:run']`. A token missing a scope gets a tool error naming it and the tool is omitted from `tools/list`. With nothing configured, behaviour is unchanged.
