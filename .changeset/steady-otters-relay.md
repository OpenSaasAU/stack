---
'@opensaas/stack-core': minor
---

`createMcpHandlers` takes the app's own context factory

The MCP route handler typed its `getContext` option as returning the engine's
`AccessContext`, which the generated `getContext()` is deliberately not
assignable to — the app-facing `Context` carries the secured `db` and none of
the engine's plumbing. Wiring the documented route up therefore did not compile.
It now takes `AnyStackContext` and narrows once with `engineContextOf`, the same
boundary `AdminUI` and `createAuth` already sit on.

The documented wiring is unchanged, and now type-checks:

```typescript
// app/api/mcp/[[...transport]]/route.ts
import { createMcpHandlers } from '@opensaas/stack-core/mcp'
import { createBetterAuthMcpAdapter } from '@opensaas/stack-auth/mcp'
import config from '@/opensaas.config'
import { auth } from '@/lib/auth'
import { getContext } from '@/.opensaas/context'

const { GET, POST, DELETE } = createMcpHandlers({
  config: await config,
  getSession: createBetterAuthMcpAdapter(auth),
  getContext,
})

export { GET, POST, DELETE }
```

A caller already passing an engine-face context keeps working — `engineContextOf`
returns such a value unchanged.
