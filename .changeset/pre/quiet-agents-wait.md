---
'@opensaas/stack-core': minor
'create-opensaas-app': patch
---

MCP write tools are now opt-in per list. This changes a default.

Enabling MCP gives each list its `list_<list>_query` tool and no generated `create`, `update` or `delete` tool. A list enables each write tool deliberately in its own `mcp.tools`; a write tool it has not enabled is neither listed nor callable (`Unknown tool`). An enabled tool still runs the list's access control, hooks and scopes. Custom and plugin tools are unchanged.

```typescript
Post: list({
  fields: { title: text() },
  mcp: { tools: { create: true, update: true } }, // delete stays off
})
```

`mcp.defaultTools` now takes `read` only. A config setting `create`, `update` or `delete` there, even to `false`, is refused by `config()` and `createMcpHandlers` with an error naming `lists.<List>.mcp.tools.<operation>`. `config()` refuses it even when `mcp.enabled` is not `true`, so an app with MCP switched off and the old `defaultTools` shape must remove those keys too.

To keep a list's write tools, move them onto the list:

```typescript
// Before
mcp: { enabled: true, defaultTools: { read: true, create: true, update: true, delete: true } }

// After
mcp: { enabled: true, defaultTools: { read: true } }
// and on each list agents may write to:
Post: list({ fields: { /* ... */ }, mcp: { tools: { create: true, update: true, delete: true } } })
```
