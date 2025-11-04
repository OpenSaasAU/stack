# @opensaas/stack-mcp

> **⚠️ DEPRECATED:** This package has been migrated into `@opensaas/stack-core/mcp` and `@opensaas/stack-auth/mcp`.
>
> Please update your imports:
>
> - `@opensaas/stack-mcp` → `@opensaas/stack-core/mcp` (MCP runtime and handlers)
> - `@opensaas/stack-mcp/auth` → `@opensaas/stack-auth/mcp` (Better Auth adapter)
>
> See the [Migration Guide](#migration-guide) below for detailed instructions.

---

MCP (Model Context Protocol) server integration for OpenSaaS Stack with Better Auth OAuth authentication.

## Overview

This package enables your OpenSaaS Stack application to expose its data and operations through MCP tools that can be consumed by AI assistants like Claude Desktop. It automatically creates CRUD tools for each list in your configuration and respects all access control rules.

## Features

- 🔐 **Better Auth OAuth Integration** - Secure authentication using Better Auth's MCP plugin
- 🛠️ **Automatic CRUD Tools** - Read, create, update, and delete operations for each list
- 🔒 **Access Control** - All tools respect your existing access control configuration
- ⚙️ **Configurable** - Enable/disable tools per list or globally
- 🎯 **Custom Tools** - Add custom tools for specific business logic
- 🔄 **Runtime-Based** - No code generation, works like `@opensaas/stack-ui`

## Installation

```bash
pnpm add @opensaas/stack-mcp @opensaas/stack-auth
```

## Quick Start

### 1. Configure MCP in your OpenSaaS config

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'

export default config({
  db: { provider: 'sqlite', url: 'file:./dev.db' },

  mcp: {
    enabled: true,
    basePath: '/api/mcp',
    auth: {
      type: 'better-auth',
      loginPage: '/sign-in',
    },
  },

  lists: {
    Post: list({
      fields: {
        /* ... */
      },
      // Optional: customize MCP tools for this list
      mcp: {
        tools: {
          read: true,
          create: true,
          update: true,
          delete: false, // Disable delete tool
        },
      },
    }),
  },
})
```

### 2. Set up Stack Auth with MCP plugin

Update your config to use `withAuth` and enable the MCP plugin:

```typescript
// opensaas.config.ts
import { withAuth, authConfig } from '@opensaas/stack-auth'

export default withAuth(
  config({
    // ... your config
    mcp: {
      enabled: true,
      basePath: '/api/mcp',
      auth: {
        type: 'better-auth',
        loginPage: '/sign-in',
      },
    },
  }),
  authConfig({
    emailAndPassword: { enabled: true },
    plugins: [
      {
        name: 'mcp',
        config: {
          loginPage: '/sign-in',
        },
      },
    ],
  }),
)
```

Create your auth instance:

```typescript
// lib/auth.ts
import { createAuth } from '@opensaas/stack-auth/server'
import config from '../opensaas.config'
import { rawOpensaasContext } from '@/.opensaas/context'

export const auth = createAuth(config, rawOpensaasContext)
```

### 3. Create API route

```typescript
// app/api/mcp/[[...transport]]/route.ts
import { createMcpHandlers } from '@opensaas/stack-mcp'
import config from '@/opensaas.config'
import { auth } from '@/lib/auth'
import { getContext } from '@/.opensaas/context'

const { GET, POST, DELETE } = createMcpHandlers({
  config,
  auth,
  getContext,
})

export { GET, POST, DELETE }
```

### 4. Add Better Auth API route

```typescript
// app/api/auth/[...all]/route.ts
import { auth } from '@/lib/auth'

export const GET = auth.handler
export const POST = auth.handler
```

### 5. Add OAuth discovery routes

```typescript
// app/.well-known/oauth-authorization-server/route.ts
export async function GET(req: Request) {
  const authUrl = new URL('/api/auth/.well-known/oauth-authorization-server', req.url)
  return fetch(authUrl.toString(), { headers: req.headers })
}
```

```typescript
// app/.well-known/oauth-protected-resource/route.ts
export async function GET(req: Request) {
  const authUrl = new URL('/api/auth/.well-known/oauth-protected-resource', req.url)
  return fetch(authUrl.toString(), { headers: req.headers })
}
```

## Usage with Claude Desktop

Add to your Claude Desktop MCP configuration:

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

## Generated Tools

For each list with MCP enabled, the following tools are generated:

### Read Tool

```typescript
// Tool: list_post_query
// Query posts with filters
{
  where?: { /* Prisma where clause */ },
  take?: number,
  skip?: number
}
```

### Create Tool

```typescript
// Tool: list_post_create
// Create a new post
{
  data: {
    /* field values */
  }
}
```

### Update Tool

```typescript
// Tool: list_post_update
// Update an existing post
{
  where: { id: string },
  data: { /* field values */ }
}
```

### Delete Tool

```typescript
// Tool: list_post_delete
// Delete a post
{
  where: {
    id: string
  }
}
```

## Custom Tools

Add custom tools to lists for specialized operations:

```typescript
// opensaas.config.ts
import { z } from 'zod'

Post: list({
  fields: {
    /* ... */
  },
  mcp: {
    customTools: [
      {
        name: 'publishPost',
        description: 'Publish a draft post',
        inputSchema: z.object({
          postId: z.string(),
        }),
        handler: async ({ input, context }) => {
          const post = await context.db.post.update({
            where: { id: input.postId },
            data: { status: 'published', publishedAt: new Date() },
          })
          return { success: !!post, post }
        },
      },
    ],
  },
})
```

## Configuration Options

### Global MCP Config

```typescript
mcp: {
  enabled: boolean         // Enable MCP globally (default: false)
  basePath: string        // API route path (default: "/api/mcp")
  auth: {
    type: 'better-auth'
    loginPage: string     // Required: path to login page
    scopes?: string[]     // OAuth scopes (default: ["openid", "profile", "email"])
    oidcConfig?: { /* ... */ }
  }
  defaultTools: {         // Default tool config for all lists
    read: boolean         // Default: true
    create: boolean       // Default: true
    update: boolean       // Default: true
    delete: boolean       // Default: true
  }
  resource?: string       // OAuth resource identifier
}
```

### List-Level MCP Config

```typescript
mcp: {
  enabled: boolean        // Enable MCP for this list (default: true)
  tools: {                // Override global tool settings
    read: boolean
    create: boolean
    update: boolean
    delete: boolean
  }
  customTools: [...]      // Custom tools for this list
}
```

## Access Control

All MCP tools respect your existing access control configuration:

- **Operation-level access** - Controls which operations users can perform
- **Filter-based access** - Automatically scopes queries to accessible records
- **Field-level access** - Controls which fields are readable/writable
- **Silent failures** - Returns `null` or `[]` on access denial (no info leakage)

Example:

```typescript
Post: list({
  fields: {
    /* ... */
  },
  access: {
    operation: {
      query: () => true, // Anyone can query
      create: isSignedIn, // Must be signed in to create
      update: isAuthor, // Only author can update
      delete: isAuthor, // Only author can delete
    },
  },
})
```

The generated MCP tools will automatically enforce these rules.

## Architecture

```
┌─────────────────┐
│  Claude Desktop │
└────────┬────────┘
         │ OAuth
         ↓
┌─────────────────┐
│   Better Auth   │ ← MCP Plugin
│   (OAuth Flow)  │
└────────┬────────┘
         │ Access Token
         ↓
┌─────────────────┐
│   MCP Server    │ ← Generated Tools
│  (Your API)     │
└────────┬────────┘
         │ Access Control
         ↓
┌─────────────────┐
│ OpenSaaS Stack  │ ← Your Data
│  (Context + DB) │
└─────────────────┘
```

## Migration Guide

### Updating from `@opensaas/stack-mcp`

The MCP functionality has been split into two packages for better separation of concerns:

**Before:**

```typescript
// app/api/mcp/[[...transport]]/route.ts
import { createMcpHandlers } from '@opensaas/stack-mcp'
import config from '@/opensaas.config'
import { auth } from '@/lib/auth'
import { getContext } from '@/.opensaas/context'

const { GET, POST, DELETE } = createMcpHandlers({
  config,
  auth,
  getContext,
})

export { GET, POST, DELETE }
```

**After:**

```typescript
// app/api/mcp/[[...transport]]/route.ts
import { createMcpHandlers } from '@opensaas/stack-core/mcp'
import { createBetterAuthMcpAdapter } from '@opensaas/stack-auth/mcp'
import config from '@/opensaas.config'
import { auth } from '@/lib/auth'
import { getContext } from '@/.opensaas/context'

const { GET, POST, DELETE } = createMcpHandlers({
  config,
  getSession: createBetterAuthMcpAdapter(auth),
  getContext,
})

export { GET, POST, DELETE }
```

**Key changes:**

1. Import `createMcpHandlers` from `@opensaas/stack-core/mcp` instead of `@opensaas/stack-mcp`
2. Import `createBetterAuthMcpAdapter` from `@opensaas/stack-auth/mcp`
3. Replace `auth` parameter with `getSession: createBetterAuthMcpAdapter(auth)`
4. Remove `@opensaas/stack-mcp` from your package.json dependencies

**Why this change?**

- Core package (`@opensaas/stack-core`) now handles auth-agnostic MCP runtime
- Auth package (`@opensaas/stack-auth`) provides Better Auth specific adapter
- Reduces dependencies and package count in the monorepo
- Enables custom auth providers beyond Better Auth

## License

MIT
