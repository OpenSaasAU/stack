# MCP Demo Example

This example demonstrates how to integrate the Model Context Protocol (MCP) with OpenSaaS Stack using Better Auth OAuth authentication.

## Features

- 🔐 **Stack Auth Integration** - Uses `@opensaas/stack-auth` with MCP plugin
- 🛠️ **Automatic CRUD Tools** - Read, create, update, delete operations for all lists
- 🎯 **Custom Tools** - Publish/unpublish post operations
- 🔒 **Access Control** - All tools respect access control rules
- 📊 **Per-List Configuration** - Enable/disable tools per list
- 👤 **Auto-Generated User List** - User authentication handled by stack-auth

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Set Up Environment

```bash
cp .env.example .env
```

### 3. Generate Schema

```bash
pnpm generate
```

This generates:

- `prisma/schema.prisma` - Prisma schema
- `.opensaas/types.ts` - TypeScript types
- `.opensaas/context.ts` - Context factory
- `.opensaas/mcp/tools.json` - MCP tool reference (metadata only)
- `.opensaas/mcp/README.md` - Usage instructions

### 4. Push Schema to Database

```bash
pnpm db:push
```

### 5. Start Development Server

```bash
pnpm dev
```

The app runs at `http://localhost:3000`

## MCP Configuration

### Global Configuration

In `opensaas.config.ts`:

```typescript
mcp: {
  enabled: true,
  basePath: '/api/mcp',
  auth: {
    type: 'better-auth',
    loginPage: '/sign-in',
    scopes: ['openid', 'profile', 'email']
  },
  defaultTools: {
    read: true,
    create: true,
    update: true,
    delete: true
  }
}
```

### List-Level Configuration

```typescript
Post: list({
  fields: {/* ... */},
  mcp: {
    tools: {
      read: true,
      create: true,
      update: true,
      delete: true,
    },
    customTools: [
      {
        name: 'publishPost',
        description: 'Publish a draft post',
        inputSchema: z.object({ postId: z.string() }),
        handler: async ({ input, context }) => {
          // Custom logic with full access control
        },
      },
    ],
  },
})
```

## Generated MCP Tools

### Post Tools

- **list_post_query** - Query posts with filters

  ```json
  {
    "where": { "status": { "equals": "published" } },
    "take": 10,
    "skip": 0
  }
  ```

- **list_post_create** - Create a new post

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

- **list_post_update** - Update an existing post

  ```json
  {
    "where": { "id": "post-id" },
    "data": { "status": "published" }
  }
  ```

- **list_post_delete** - Delete a post

  ```json
  {
    "where": { "id": "post-id" }
  }
  ```

- **publishPost** (custom) - Publish a draft post

  ```json
  {
    "postId": "post-id"
  }
  ```

- **unpublishPost** (custom) - Unpublish a post
  ```json
  {
    "postId": "post-id"
  }
  ```

### User Tools

- **list_user_query** - Query users
- **list_user_create** - Create a new user
- **list_user_update** - Update user information
- (delete disabled for safety)

## Claude Desktop Integration

Add to your Claude Desktop MCP configuration (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "opensaas-demo": {
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

Restart Claude Desktop, and the tools will be available in the conversation.

## Access Control

All MCP tools respect the access control rules defined in `opensaas.config.ts`:

### Operation-Level Access

```typescript
access: {
  operation: {
    query: ({ session }) => {
      // Non-authenticated users can only see published posts
      if (!session?.userId) {
        return { status: { equals: 'published' } }
      }
      return true
    },
    create: isSignedIn,
    update: isAuthor,
    delete: isAuthor
  }
}
```

### Field-Level Access

```typescript
title: text({
  access: {
    read: () => true,
    create: isSignedIn,
    update: isAuthor,
  },
})
```

## Testing MCP Tools

You can test MCP tools directly via HTTP:

```bash
# List available tools
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{"method": "tools/list", "params": {}}'

# Call a tool
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
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

## File Structure

```
examples/mcp-demo/
├── opensaas.config.ts           # MCP configuration
├── lib/
│   └── auth.ts                  # Better Auth setup
├── app/
│   ├── api/
│   │   └── mcp/
│   │       └── [[...transport]]/
│   │           └── route.ts     # MCP route handler (uses createMcpHandlers)
│   └── .well-known/
│       ├── oauth-authorization-server/
│       │   └── route.ts         # OAuth discovery
│       └── oauth-protected-resource/
│           └── route.ts         # Resource metadata
└── .opensaas/                   # Generated
    ├── types.ts
    ├── context.ts
    └── mcp/
        ├── tools.json           # Tool reference (metadata)
        └── README.md            # Usage instructions
```

## Next Steps

1. **Add Authentication UI** - Create sign-in/sign-up pages
2. **Customize Access Control** - Add more granular rules
3. **Add More Custom Tools** - Extend MCP capabilities
4. **Deploy** - Deploy to production with proper OAuth setup

## Learn More

- [Better Auth MCP Plugin](https://www.better-auth.com/docs/plugins/mcp)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [OpenSaaS Stack Documentation](../../README.md)
