---
'@opensaas/stack-core': minor
---

Serve procedures as MCP tools

Pass the procedure registry to `createMcpHandlers`, and each procedure whose `expose` names `'mcp'` becomes a tool named after it, with its description and its input schema as JSON Schema. A call runs the same pipeline as `createProcedureHandler` under the agent's session, and the tool result's text is the result envelope as JSON (`{ success, data }` or `{ success: false, error: { code, message, fieldErrors? } }`), with `isError` set on a failure. A procedure not exposed to `'mcp'` answers as an unknown tool.

```typescript
import * as z from 'zod'
import { createMcpHandlers } from '@opensaas/stack-core/mcp'
import { procedure } from '@/.opensaas/procedures'

const publishPost = procedure({
  description: 'Publish one of your draft posts',
  input: z.object({ postId: z.string() }),
  output: z.object({ id: z.string() }),
  access: ({ session }) => session !== null,
  expose: ['web', 'mcp'],
  scopes: ['posts:publish'], // omitted: requires mcp.scopes.write; [] requires none
  run: async ({ input, context }) => {
    const post = await context.db.Post.update({
      where: { id: input.postId },
      data: { status: 'published' },
    })
    if (post === null) throw new Error('Post was not published')
    return post
  },
})

export const { GET, POST, DELETE } = createMcpHandlers({
  config: await config,
  getSession,
  getContext,
  procedures: { publishPost },
  onUnexpectedProcedureError: (error, name) => console.error(name, error),
})
```

A procedure is listed only when the token holds its scopes and its access rule admits the session, and both are checked again on every call; a missing scope is `DENIED` with the scope named. The registry is checked when the handlers are created, and an MCP-exposed procedure's input must be a `z.object`.
