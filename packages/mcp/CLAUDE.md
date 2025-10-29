# @opensaas/stack-mcp

Model Context Protocol server integration for OpenSaas Stack, enabling AI assistants to interact with your application's data.

## Purpose

Exposes OpenSaas Stack data and operations as MCP tools consumable by AI assistants like Claude Desktop. All operations respect existing access control rules.

## Key Files & Exports

### Runtime (`src/runtime/index.ts`)
- `createMcpServer(config, auth, getContext)` - Generates MCP server with CRUD tools
- `getMcpTools(config)` - Returns array of tool definitions for all enabled lists

### Handler (`src/runtime/handler.ts`)
- `createMcpHandlers({ config, auth, getContext })` - Creates Next.js route handlers
- Returns `{ GET, POST, DELETE }` for `/api/mcp/[[...transport]]/route.ts`

### Auth (`src/auth/better-auth.ts`)
- `createBetterAuthAdapter(auth)` - OAuth adapter for Better-auth MCP plugin
- Validates access tokens and retrieves user sessions

### Main Export (`src/index.ts`)
- Re-exports `createMcpHandlers` for easy import

## Architecture

### Tool Generation
For each list with `mcp.enabled !== false`, four tools are created:
- `list_{listKey}_query` - Query records with filters
- `list_{listKey}_create` - Create new record
- `list_{listKey}_update` - Update existing record
- `list_{listKey}_delete` - Delete record

Tool names use snake_case of camelCase list keys (e.g., `list_blog_post_query`).

### Access Control Integration
All tool operations flow through context:
```typescript
const context = getContext({ session }) // Session from OAuth token
const result = await context.db.post.findMany(input)
// Access control automatically applied
```

### OAuth Flow
1. AI assistant initiates OAuth via Better-auth MCP plugin
2. User signs in at `loginPage` (e.g., `/sign-in`)
3. Access token issued and stored in AI assistant
4. Tool requests include token in Authorization header
5. `createBetterAuthAdapter` validates token and loads session
6. Context uses session for access control

## Configuration Patterns

### Global MCP Config
```typescript
config({
  mcp: {
    enabled: true,
    basePath: '/api/mcp',
    auth: {
      type: 'better-auth',
      loginPage: '/sign-in'
    },
    defaultTools: {
      read: true,
      create: true,
      update: true,
      delete: true
    }
  }
})
```

### List-Level Config
```typescript
Post: list({
  fields: {...},
  mcp: {
    enabled: true,
    tools: {
      delete: false // Disable delete tool
    },
    customTools: [
      {
        name: 'publishPost',
        description: 'Publish a draft post',
        inputSchema: z.object({ postId: z.string() }),
        handler: async ({ input, context }) => {
          const post = await context.db.post.update({
            where: { id: input.postId },
            data: { status: 'published' }
          })
          return { success: !!post, post }
        }
      }
    ]
  }
})
```

## Integration Points

### With @opensaas/stack-core
- Reads config to generate tools
- Uses context for all database operations
- Respects all access control and hooks

### With @opensaas/stack-auth
- Requires Better-auth instance with MCP plugin
- Requires `rawOpensaasContext` for session provider:
```typescript
import { rawOpensaasContext } from '@/.opensaas/context'
export const auth = createAuth(config, rawOpensaasContext)
```

### With Next.js
Route setup:
```typescript
// app/api/mcp/[[...transport]]/route.ts
import { createMcpHandlers } from '@opensaas/stack-mcp'
import config from '@/opensaas.config'
import { auth } from '@/lib/auth'
import { getContext } from '@/.opensaas/context'

const { GET, POST, DELETE } = createMcpHandlers({
  config,
  auth,
  getContext
})

export { GET, POST, DELETE }
```

OAuth discovery routes:
```typescript
// app/.well-known/oauth-authorization-server/route.ts
export async function GET(req: Request) {
  const authUrl = new URL('/api/auth/.well-known/oauth-authorization-server', req.url)
  return fetch(authUrl.toString(), { headers: req.headers })
}

// app/.well-known/oauth-protected-resource/route.ts
export async function GET(req: Request) {
  const authUrl = new URL('/api/auth/.well-known/oauth-protected-resource', req.url)
  return fetch(authUrl.toString(), { headers: req.headers })
}
```

## Common Patterns

### Complete Setup
```typescript
// 1. Config with MCP enabled
export default withAuth(
  config({
    mcp: {
      enabled: true,
      basePath: '/api/mcp',
      auth: { type: 'better-auth', loginPage: '/sign-in' }
    },
    lists: { Post: list({...}) }
  }),
  authConfig({
    emailAndPassword: { enabled: true },
    plugins: [{ name: 'mcp', config: { loginPage: '/sign-in' } }]
  })
)

// 2. Auth server with MCP plugin
import { rawOpensaasContext } from '@/.opensaas/context'
export const auth = createAuth(config, rawOpensaasContext)

// 3. MCP route
export const { GET, POST, DELETE } = createMcpHandlers({
  config,
  auth,
  getContext
})
```

### Custom Tools
Add specialized operations:
```typescript
mcp: {
  customTools: [
    {
      name: 'bulkPublishPosts',
      description: 'Publish multiple posts at once',
      inputSchema: z.object({
        postIds: z.array(z.string())
      }),
      handler: async ({ input, context }) => {
        const results = await Promise.all(
          input.postIds.map(id =>
            context.db.post.update({
              where: { id },
              data: { status: 'published', publishedAt: new Date() }
            })
          )
        )
        return { published: results.filter(Boolean).length }
      }
    }
  ]
}
```

### Tool Filtering by Access Control
Tools automatically respect access rules:
```typescript
Post: list({
  access: {
    operation: {
      query: () => true,
      create: ({ session }) => !!session,
      update: ({ session, item }) => session?.userId === item.authorId,
      delete: ({ session }) => session?.role === 'admin'
    }
  }
})
// MCP tools enforce these rules - non-admins can't delete via MCP
```

## Claude Desktop Configuration

```json
{
  "mcpServers": {
    "my-app": {
      "url": "http://localhost:3000/api/mcp",
      "transport": { "type": "http" },
      "auth": {
        "type": "oauth2",
        "authorizationUrl": "http://localhost:3000/.well-known/oauth-authorization-server"
      }
    }
  }
}
```

## Type Safety

Tool schemas are generated from field types using Zod:
- Input validation via `getZodSchema()` on field configs
- Runtime type checking on all tool inputs
- TypeScript types for custom tool handlers
