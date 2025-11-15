# MCP Setup Guide

Learn how to integrate the Model Context Protocol (MCP) with OpenSaaS Stack to enable AI assistants like Claude to interact with your application's data.

## Overview

The MCP integration in OpenSaaS Stack provides:

- **Automatic CRUD Tools** - Read, create, update, delete operations for all lists
- **Custom Tools** - Add specialized operations for your business logic
- **Better Auth OAuth** - Secure authentication flow with AI assistants
- **Access Control** - All tools respect your existing access control rules
- **Per-List Configuration** - Enable/disable tools per list

## Prerequisites

Before setting up MCP, you need:

1. A working OpenSaaS Stack application
2. Better Auth configured (see [Authentication Guide](/docs/guides/authentication))
3. Claude Desktop or another MCP client

## Installation

MCP functionality is built into the core packages - no additional installation required!

You'll need:

- `@opensaas/stack-core` - MCP handlers and tool generation
- `@opensaas/stack-auth` - Better Auth OAuth adapter

## Configuration

### 1. Enable Auth Plugin with MCP

In your `opensaas.config.ts`, configure the auth plugin with the MCP plugin:

```typescript
import { config, list } from '@opensaas/stack-core'
import { authPlugin } from '@opensaas/stack-auth'
import { mcp } from '@opensaas/stack-auth/plugins'

export default config({
  plugins: [
    authPlugin({
      emailAndPassword: { enabled: true },
      // Add MCP plugin to Better Auth
      betterAuthPlugins: [mcp({ loginPage: '/sign-in' })],
    }),
  ],

  // ... rest of config
})
```

### 2. Enable MCP in Config

Add MCP configuration to your config:

```typescript
export default config({
  // ... plugins

  mcp: {
    enabled: true,
    basePath: '/api/mcp',
    auth: {
      type: 'better-auth',
      loginPage: '/sign-in',
      scopes: ['openid', 'profile', 'email'],
    },
    // Global defaults for all lists
    defaultTools: {
      read: true,
      create: true,
      update: true,
      delete: true,
    },
  },

  // ... lists
})
```

### 3. Configure List-Level Tools

Control which tools are available per list:

```typescript
lists: {
  Post: list({
    fields: {
      // ... your fields
    },

    // MCP configuration for this list
    mcp: {
      tools: {
        read: true,
        create: true,
        update: true,
        delete: true,
      },
    },
  }),
}
```

### 4. Add Custom Tools (Optional)

Create specialized operations for your lists:

```typescript
import { z } from 'zod'

lists: {
  Post: list({
    fields: {
      title: text(),
      status: select({
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
      }),
      publishedAt: timestamp(),
    },

    mcp: {
      tools: { read: true, create: true, update: true, delete: true },

      // Add custom tools
      customTools: [
        {
          name: 'publishPost',
          description: 'Publish a draft post and set publishedAt timestamp',
          inputSchema: z.object({
            postId: z.string(),
          }),
          handler: async ({ input, context }) => {
            const post = await context.db.post.update({
              where: { id: input.postId },
              data: {
                status: 'published',
                publishedAt: new Date(),
              },
            })

            if (!post) {
              return {
                error: 'Failed to publish post. Access denied or post not found.',
              }
            }

            return {
              success: true,
              message: `Post "${post.title}" published successfully`,
              post,
            }
          },
        },
      ],
    },
  }),
}
```

## Setup Route Handlers

### 1. Create MCP API Route

Create `app/api/mcp/[[...transport]]/route.ts`:

```typescript
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

### 2. Create OAuth Discovery Endpoints

Better Auth provides OAuth endpoints automatically, but some MCP clients need them at specific paths.

Create `app/.well-known/oauth-authorization-server/route.ts`:

```typescript
export async function GET(req: Request) {
  // Delegate to Better Auth's built-in handler
  const authUrl = new URL('/api/auth/.well-known/oauth-authorization-server', req.url)

  return fetch(authUrl.toString(), {
    headers: req.headers,
  })
}
```

Create `app/.well-known/oauth-protected-resource/route.ts`:

```typescript
export async function GET() {
  const baseUrl = process.env.BETTER_AUTH_URL || 'http://localhost:3000'

  return Response.json({
    resource: baseUrl,
    authorization_servers: [`${baseUrl}/api/auth`],
  })
}
```

## Generate Schema

Run the generator to create your MCP tools:

```bash
pnpm generate
```

This creates:

- `.opensaas/mcp/tools.json` - Tool metadata reference
- `.opensaas/mcp/README.md` - Usage instructions

## Configure Claude Desktop

Add your MCP server to Claude Desktop's configuration file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "my-app": {
      "url": "http://localhost:3000/api/mcp",
      "transport": {
        "type": "http"
      },
      "auth": {
        "type": "oauth2",
        "authorizationUrl": "http://localhost:3000/.well-known/oauth-authorization-server"
      }
    }
  }
}
```

**For production deployments**, replace `localhost:3000` with your production URL.

## Authentication Flow

When Claude Desktop connects to your MCP server:

1. **OAuth Discovery** - Claude fetches OAuth metadata from `.well-known` endpoints
2. **Authorization** - Claude opens your login page in a browser
3. **User Login** - User signs in using your auth UI
4. **Token Exchange** - Better Auth issues access token
5. **MCP Connection** - Claude uses token to authenticate tool calls
6. **Access Control** - All operations respect your access control rules

## Generated Tools

The generator creates CRUD tools for each list:

### Query Tool

**Tool Name:** `list_{listKey}_query`

**Description:** Query records with filters, sorting, and pagination

**Input Schema:**

```typescript
{
  where?: Record<string, any>,  // Prisma where filters
  orderBy?: Record<string, 'asc' | 'desc'>,
  take?: number,
  skip?: number,
}
```

**Example:**

```json
{
  "where": { "status": { "equals": "published" } },
  "orderBy": { "createdAt": "desc" },
  "take": 10
}
```

### Create Tool

**Tool Name:** `list_{listKey}_create`

**Description:** Create a new record

**Input Schema:**

```typescript
{
  data: Record<string, any> // Fields to set
}
```

**Example:**

```json
{
  "data": {
    "title": "My Post",
    "slug": "my-post",
    "content": "Post content",
    "status": "draft"
  }
}
```

### Update Tool

**Tool Name:** `list_{listKey}_update`

**Description:** Update an existing record

**Input Schema:**

```typescript
{
  where: { id: string },
  data: Record<string, any>
}
```

**Example:**

```json
{
  "where": { "id": "post-123" },
  "data": { "status": "published" }
}
```

### Delete Tool

**Tool Name:** `list_{listKey}_delete`

**Description:** Delete a record

**Input Schema:**

```typescript
{
  where: {
    id: string
  }
}
```

**Example:**

```json
{
  "where": { "id": "post-123" }
}
```

## Access Control

All MCP tools respect your existing access control rules defined in `opensaas.config.ts`.

### Operation-Level Access

Controls whether a user can perform an operation at all:

```typescript
access: {
  operation: {
    query: ({ session }) => {
      // Anonymous users can only see published posts
      if (!session) {
        return { status: { equals: 'published' } }
      }
      return true
    },
    create: isSignedIn,
    update: isAuthor,
    delete: isAuthor,
  },
}
```

### Field-Level Access

Controls which fields can be read or modified:

```typescript
fields: {
  title: text({
    access: {
      read: () => true,
      create: isSignedIn,
      update: isAuthor,
    },
  }),
  internalNotes: text({
    access: {
      read: isAuthor,  // Only author can see
      create: isAuthor,
      update: isAuthor,
    },
  }),
}
```

### Silent Failures

When access is denied, tools return empty results rather than errors. This prevents information leakage about whether records exist.

## Testing MCP Tools

### Using Claude Desktop

1. Restart Claude Desktop after updating config
2. Start a new conversation
3. Ask Claude to interact with your data:

```
Can you show me all published posts?
Can you create a new post titled "Test Post"?
Can you update post-123 to published status?
```

### Using HTTP Requests

Test tools directly via HTTP:

```bash
# Get access token (login first to get session)
ACCESS_TOKEN="your-token-here"

# List available tools
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"method": "tools/list", "params": {}}'

# Call a tool
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "list_post_query",
      "arguments": {
        "where": { "status": { "equals": "published" } },
        "take": 10
      }
    }
  }'
```

## Architecture

```
┌─────────────────┐
│  Claude Desktop │
└────────┬────────┘
         │ OAuth 2.0
         ↓
┌─────────────────┐
│   Better Auth   │ ← MCP Plugin
│   (OAuth Flow)  │
└────────┬────────┘
         │ Access Token
         ↓
┌─────────────────┐
│   MCP Server    │ ← Generated Tools
│ (.opensaas/mcp) │
└────────┬────────┘
         │ context.db
         ↓
┌─────────────────┐
│ Access Control  │ ← Your Rules
│     Engine      │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│   Prisma DB     │ ← Your Data
└─────────────────┘
```

## Best Practices

### Security

1. **Always use access control** - Never set all operations to `() => true` in production
2. **Validate custom tool inputs** - Use Zod schemas for type safety
3. **Use HTTPS in production** - OAuth requires secure connections
4. **Scope tokens appropriately** - Only request needed OAuth scopes

### Tool Design

1. **Keep tools focused** - Each custom tool should do one thing well
2. **Provide clear descriptions** - Help AI understand when to use each tool
3. **Return meaningful errors** - Help debug issues without leaking sensitive info
4. **Test with real data** - Verify access control works as expected

### Performance

1. **Limit query results** - Use `take` parameter to prevent large responses
2. **Index frequently filtered fields** - Mark fields with `isIndexed: true`
3. **Batch operations carefully** - Consider rate limits in custom tools

## Troubleshooting

### Claude Desktop Can't Find Server

**Problem:** "Failed to connect to MCP server"

**Solutions:**

1. Verify your app is running: `pnpm dev`
2. Check the MCP URL in `claude_desktop_config.json`
3. Ensure OAuth endpoints are accessible
4. Restart Claude Desktop after config changes

### Authentication Fails

**Problem:** OAuth flow redirects but doesn't complete

**Solutions:**

1. Verify `BETTER_AUTH_URL` environment variable is set
2. Check that login page exists at the configured path
3. Ensure Better Auth is properly configured
4. Check browser console for errors during OAuth flow

### Tools Return Empty Results

**Problem:** Tools run but return no data

**Possible Causes:**

1. **Access control denying access** - Check your access rules
2. **No matching records** - Verify data exists in database
3. **Session not found** - OAuth token may have expired

**Debug Steps:**

1. Check database directly: `pnpm db:studio`
2. Test access control with direct context calls
3. Verify session is being passed to context

### Custom Tools Not Working

**Problem:** Custom tool defined but not available

**Solutions:**

1. Run `pnpm generate` to regenerate tools
2. Restart development server
3. Verify Zod schema is valid
4. Check handler function returns correct format

## Example Project

See the complete working example at `examples/mcp-demo/` in the repository:

- Full configuration with custom tools
- OAuth setup with Better Auth
- Access control patterns
- Testing scripts

## Next Steps

- [Authentication Guide](/docs/guides/authentication) - Setup Better Auth
- [Access Control](/docs/core-concepts/access-control) - Secure your data
- [Hooks System](/docs/core-concepts/hooks) - Add business logic
- [Better Auth MCP Plugin](https://www.better-auth.com/docs/plugins/mcp) - OAuth details
- [Model Context Protocol](https://modelcontextprotocol.io) - MCP specification
