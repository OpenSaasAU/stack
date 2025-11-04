---
'@opensaas/stack-core': patch
'@opensaas/stack-auth': patch
'@opensaas/stack-mcp': patch
---

**BREAKING CHANGE**: Migrate MCP functionality into core and auth packages

The `@opensaas/stack-mcp` package has been deprecated and its functionality has been split into:

- `@opensaas/stack-core/mcp` - Auth-agnostic MCP runtime and handlers
- `@opensaas/stack-auth/mcp` - Better Auth OAuth adapter

**Migration required:**

```typescript
// Before
import { createMcpHandlers } from '@opensaas/stack-mcp'
const { GET, POST, DELETE } = createMcpHandlers({ config, auth, getContext })

// After
import { createMcpHandlers } from '@opensaas/stack-core/mcp'
import { createBetterAuthMcpAdapter } from '@opensaas/stack-auth/mcp'
const { GET, POST, DELETE } = createMcpHandlers({
  config,
  getSession: createBetterAuthMcpAdapter(auth),
  getContext,
})
```

**Why this change?**

- Reduces package count in the monorepo
- Core package handles auth-agnostic MCP protocol
- Auth package provides Better Auth specific adapter
- Better-auth is no longer a dependency of core
- Enables support for custom auth providers beyond Better Auth

**New features:**

- `McpSessionProvider` type for custom auth integration
- More generic `McpAuthConfig` type supporting custom auth providers
- Core MCP functionality available without auth dependencies
