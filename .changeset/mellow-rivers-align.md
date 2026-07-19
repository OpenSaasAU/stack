---
'@opensaas/stack-core': minor
---

MCP runtime: serve plugin-registered tools, support Zod input schemas, and pass custom session fields through to access control

- Tools registered by plugins via `registerMcpTool` (e.g. the RAG plugin's `semantic_search_*` tools) are now listed by `tools/list` and callable via `tools/call` — previously they were stored but never served.
- Custom tool `inputSchema` may now be a Zod schema or a plain JSON Schema object. Zod schemas are converted to JSON Schema for `tools/list` and validated on `tools/call` (invalid input returns a JSON-RPC `-32602` error):

```typescript
mcp: {
  customTools: [
    {
      name: 'publish_post',
      description: 'Publish a draft post',
      inputSchema: z.object({ id: z.string() }),
      handler: async ({ input, context }) => {
        return context.db.post.update({
          where: { id: input.id },
          data: { status: 'published' },
        })
      },
    },
  ]
}
```

- MCP sessions now pass custom fields through to access control. Transport fields (`accessToken`, `expiresAt`, `scopes`) are stripped; everything else — `userId` plus any fields your session provider attaches (email, role, ...) — reaches `context.session`, so session-based access rules behave consistently over MCP.
