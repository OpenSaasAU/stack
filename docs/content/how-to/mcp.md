# MCP Setup Guide

Learn how to integrate the Model Context Protocol (MCP) with Stack to enable AI assistants like Claude to interact with your application's data.

## Overview

The MCP integration in Stack provides:

- **Automatic CRUD Tools** - A query tool for every list, and create, update and delete tools on the lists that enable them
- **Custom Tools** - Add specialized operations for your business logic
- **Better Auth OAuth** - Secure authentication flow with AI assistants
- **Access Control** - All tools respect your existing access control rules
- **Per-List Configuration** - Enable/disable tools per list

## Prerequisites

Before setting up MCP, you need:

1. A working Stack application
2. Better Auth configured (see [Authentication Guide](/docs/how-to/authentication))
3. Claude Desktop or another MCP client

## Installation

MCP functionality is built into the core packages - no additional installation required!

You'll need:

- `@opensaas/stack-core` - MCP handlers and tool generation
- `@opensaas/stack-auth` - Better Auth OAuth adapter

## Configuration

### 1. Enable Auth Plugin with MCP

In your `opensaas.config.ts`, configure the auth plugin with the MCP plugin.

Four things about this block come from better-auth rather than from the stack,
and each is load-bearing:

- **`jwt()` sits beside `mcp()`.** Since better-auth 1.7, `mcp()` is built on the
  OAuth Provider, which issues JWT-based access tokens and requires better-auth's
  own `jwt()` plugin registered alongside it.
- **`mcp` is imported from `@opensaas/stack-auth/plugins`.** better-auth 1.7 split
  it out of `better-auth/plugins` into the optional `@better-auth/mcp` peer, which
  the stack re-exports.
- **`consentPage` is required**, and names the page where a user approves or
  denies an MCP client's requested scopes.
- **`resource` is the canonical protected-resource identifier** (RFC 8707/9728).
  It must match the `mcp.basePath` set in the next step, and `http` is accepted
  only on loopback hosts.

```typescript
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { authPlugin } from '@opensaas/stack-auth'
import { mcp } from '@opensaas/stack-auth/plugins'
import { jwt } from 'better-auth/plugins'

export default config({
  plugins: [
    authPlugin({
      emailAndPassword: { enabled: true },
      betterAuthPlugins: [
        jwt(),
        mcp({
          loginPage: '/sign-in',
          consentPage: '/consent',
          // Register the scopes the tool gate below requires
          scopes: ['openid', 'profile', 'email', 'mcp:read', 'mcp:write'],
          resource: `${process.env.BETTER_AUTH_URL || 'http://localhost:3000'}/api/mcp`,
        }),
      ],
    }),
  ],
  db: { provider: 'postgresql' },
  lists: {
    Post: list({
      fields: { title: text() },
      access: { operation: { query: () => true } },
    }),
  },
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
      scopes: ['openid', 'profile', 'email', 'mcp:read', 'mcp:write'],
    },
    // Enforce OAuth scopes per tool (see "Scopes" below)
    scopes: { read: 'mcp:read', write: 'mcp:write' },
    // App-wide default for the query tool; a list can override it
    defaultTools: { read: true },
  },

  // ... lists
})
```

`defaultTools` takes `read` only. There is no app-wide write default, and a
config that sets `create`, `update` or `delete` there, even to `false`, is
refused at startup with an error naming the per-list key to use instead.

### 3. Enable Write Tools Per List

Enabling MCP gives every reachable list a `list_<list>_query` tool and nothing
else. A list exposes `create`, `update` or `delete` to agents only when it turns
each one on:

```typescript
lists: {
  Post: list({
    fields: {
      // ... your fields
    },

    // Agents may create and update posts, but not delete them
    mcp: {
      tools: {
        create: true,
        update: true,
      },
    },
  }),
}
```

A write tool a list has not enabled is neither listed nor callable: calling it
answers `Unknown tool`, exactly like a name that never existed. An enabled tool
still runs the list's access control, hooks and scopes, so opening one decides
only whether agents can reach it, not what they may write. Custom and plugin
tools are unaffected by these switches.

### 4. Add Custom Tools (Optional)

Create specialized operations for your lists. A custom tool's handler reaches the
database through the same access-controlled `context.db` surface as the rest of
your app, so a denied write returns `null` rather than throwing — check it and
answer the client, as below:

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
      tools: { update: true },

      // Add custom tools
      customTools: [
        {
          name: 'publishPost',
          description: 'Publish a draft post and set publishedAt timestamp',
          inputSchema: z.object({
            postId: z.string(),
          }),
          handler: async ({ input, context }) => {
            const post = await context.db.Post.update({
              where: { id: input.postId },
              data: {
                status: 'published',
                publishedAt: new Date(),
              },
            })

            if (post === null) {
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

### 5. Expose Procedures as Tools

A [procedure](/docs/reference/core) is an action defined once, with typed input
and output, and served to every surface its `expose` names. Add `'mcp'` and pass
the registry to `createMcpHandlers`, and an agent can call it as a tool. This is
the recommended way to give an agent a write: it is one deliberate action, not a
generic write tool on the list.

```typescript
// lib/procedures.ts
import * as z from 'zod'
import type { ProcedureRegistry } from '@opensaas/stack-core/procedures'
import { procedure } from '@/.opensaas/procedures'
import type { Context } from '@/.opensaas/types'

const publishPost = procedure({
  description: 'Publish one of your draft posts',
  input: z.object({ postId: z.string() }),
  output: z.object({ id: z.string(), title: z.string() }),
  failures: { NOT_FOUND: 'No draft post with that id' },
  access: ({ session }) => session !== null,
  expose: ['web', 'mcp'],
  scopes: ['posts:publish'],
  run: async ({ input, context, fail }) => {
    const post = await context.db.Post.update({
      where: { id: input.postId },
      data: { status: 'published' },
    })
    if (post === null) throw fail('NOT_FOUND')
    return post
  },
})

export const procedures = { publishPost } satisfies ProcedureRegistry<Context>
```

```typescript
// app/api/mcp/[[...transport]]/route.ts
const { GET, POST, DELETE } = createMcpHandlers({
  config: await config,
  getSession: createBetterAuthMcpAdapter({ resource, baseURL }),
  getContext,
  procedures,
})
```

How a procedure behaves as a tool:

- **Only a procedure whose `expose` includes `'mcp'` reaches an agent.** One exposed to `'web'`
  alone is neither listed nor callable, and calling it answers `Unknown tool`,
  exactly as a name that does not exist.
- **The tool name is the procedure's name**, and the tool carries its
  `description` and its input schema as JSON Schema. An MCP-exposed procedure's
  input must be an object at its top level (a `z.object`, optionally wrapped in
  `.optional()`, `.meta()` or a transform), because a tool's arguments are one
  JSON object; a top-level union, discriminated union or `.nullable()` is refused.
- **It runs the same pipeline as the web host**: access, then input parsing,
  then `run`, then output parsing, under the agent's session. The access rule
  sees the agent actor (`session.actor.kind === 'agent'`), and list access and
  hooks apply to every `context.db` call inside `run`.
- **It is listed only when the session may call it.** The token must hold the
  procedure's `scopes`, or, when it names none, the configured `mcp.scopes.write`
  (`scopes: []` requires none), and its access rule must return `true`. Both are
  checked again on every call.
- **The tool result's text is the result envelope as JSON**, the same body the
  web host answers with: `{ "success": true, "data": … }`, or
  `{ "success": false, "error": { "code", "message", "fieldErrors"? } }` with
  `isError: true`. Branch on `error.code`: `DENIED` (access, or a missing scope,
  whose message names it), `INVALID_INPUT` and `VALIDATION` (with
  `fieldErrors`), `RETRY`, `CONFLICT`, `INTERNAL` (redacted; the detail goes to
  `onUnexpectedProcedureError`, default `console.error`), or one the procedure
  declares in `failures`.
- **Names are checked when the handlers are created.** A procedure named like a
  generated tool (`list_<list>_<operation>`), a list custom tool or a plugin tool
  is refused, as is a schema the registry check refuses on the web host.

Procedures work whether or not a list enables its generated write tools.

## Setup Route Handlers

### 1. Create MCP API Route

Create `app/api/mcp/[[...transport]]/route.ts`:

```typescript
import { createMcpHandlers } from '@opensaas/stack-core/mcp'
import { createBetterAuthMcpAdapter } from '@opensaas/stack-auth/mcp'
import config from '@/opensaas.config'
import { getContext } from '@/.opensaas/context'

const { GET, POST, DELETE } = createMcpHandlers({
  config: await config,
  getSession: createBetterAuthMcpAdapter({
    resource: 'https://example.com/api/mcp', // the `resource` passed to mcp()
    baseURL: 'https://example.com/api/auth', // Better Auth's base URL, including its base path
  }),
  getContext,
})

export { GET, POST, DELETE }
```

Pass `resourceMetadataUrl` to `createMcpHandlers` (for example `https://example.com/.well-known/oauth-protected-resource`) and the 401 challenge carries it as `resource_metadata`, per RFC 9728, so an MCP client can discover your authorization server. Serve that document with `createOAuthProtectedResourceHandler`, and the authorization server metadata with `createOAuthDiscoveryHandler`, both from `@opensaas/stack-auth/mcp`.

### 2. Create OAuth Discovery Endpoints

Better Auth provides OAuth endpoints automatically, but MCP clients look for them at the root `.well-known` paths. The helpers answer those paths in-process through your Better Auth instance: they make no outbound fetch, forward no request headers, and the request's host selects no server.

Create `app/.well-known/oauth-authorization-server/route.ts`:

```typescript
import { createOAuthDiscoveryHandler } from '@opensaas/stack-auth/mcp'
import { auth } from '@/lib/auth'

export const GET = createOAuthDiscoveryHandler(auth)
```

Create `app/.well-known/oauth-protected-resource/[[...resource]]/route.ts` (the optional catch-all also serves the resource-path variant, e.g. `/.well-known/oauth-protected-resource/api/mcp`):

```typescript
import { createOAuthProtectedResourceHandler } from '@opensaas/stack-auth/mcp'
import { auth } from '@/lib/auth'

export const GET = createOAuthProtectedResourceHandler(auth)
```

## How Tools Are Built

MCP tools are derived from your config **at request time** by `createMcpHandlers` — nothing MCP-specific is generated to disk. Every list gets a query tool (unless disabled via `mcp.enabled: false` on the list), write tools only on the lists that enable them in `mcp.tools`, plus any custom tools you define, any tools registered by plugins, and a tool per procedure in the `procedures` registry that exposes `'mcp'`.

You only need to run `pnpm generate` when your schema or lists change, to keep the Prisma schema and generated context in sync.

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

> **Machine clients are not supported.** A `client_credentials` token represents no user and carries the client id as its `sub`, so a token whose `sub` equals its `azp` claim is answered with a 401 (better-auth's verifier mirrors `azp` onto `client_id`, and a token with no `azp` is refused). Only user-delegated tokens are accepted.

## Generated Tools

The MCP handler creates a query tool for each list, and a create, update or delete tool only on a list that enables it in `mcp.tools`. `{dbKey}` is the camelCase form of the list key (`Post` → `list_post_query`, `BlogPost` → `list_blogPost_query`):

### Query Tool

**Tool Name:** `list_{dbKey}_query`

**Description:** Query records with filters, sorting, and pagination

**Input Schema:** `where` takes the secured read's own closed vocabulary, not a
Prisma filter — the same operators [Access Control](/docs/concepts/access-control)
lists. `fields` is a projection, covered under "Selecting Related Data" below.
`take` is capped at 100.

```typescript
{
  where?: Record<string, unknown>,
  orderBy?: Record<string, 'asc' | 'desc'>,
  take?: number,
  skip?: number,
  fields?: Record<string, unknown>,
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

#### Selecting Related Data with `fields`

By default `query` returns a record's own scalar and virtual fields — never its relations, matching how `context.db` reads behave. Reaching a relation without `fields` means following its foreign key with a second `query` call.

The optional `fields` argument lets the assistant select relation data in the same call, without paying for a full `include` (every column of every touched relation) when it only needed a couple of fields:

```json
{
  "fields": {
    "title": true,
    "author": {
      "fields": { "name": true, "email": true }
    },
    "comments": {
      "fields": { "text": true },
      "where": { "approved": { "equals": true } },
      "orderBy": { "createdAt": "desc" },
      "take": 5,
      "count": true
    }
  }
}
```

- **Scalars and virtuals** are selected with `true`.
- **A to-one relation** (`author` above) takes a nested `fields` only.
- **A to-many relation** (`comments` above) additionally accepts `where`, `orderBy`, `take`, and `skip`, scoped exactly like the equivalent `context.db` read — a nested `take` defaults to 5 when omitted and is clamped to a hard cap of 50, since nested pagination multiplies with the root `take`.
- **A to-many's row count** can be requested with `count: true`, in place of its rows (omit `fields` on that relation) or alongside them. A count answers to the relation's `read` rule as its rows do. Every relation read over MCP is paged, so a rule that reads the relation's own rows is not handed them unless a selected computed field declares the relation in `needs`, and it denies: the relation and its count are stripped, on every row, whether the rule is guarded (`Array.isArray(item.notes) && …`), reads absence as permission (`!item.notes?.some(…)`) or is unguarded (`item.logs.length === 0`). See [What a read rule sees](/docs/concepts/access-control#what-a-read-rule-sees). A rule that never reads the relation, such as an ownership check, is unaffected.

The generated tool schema enumerates exactly **two levels** of each list's own vocabulary — the list's own fields, and for each relation, the related list's own scalar/virtual fields. A relation named at that second level is not itself selectable further; reaching past it is a second `query` call, the same round-trip the bare-read default already assumes. This is what keeps the schema finite against a self-referential relationship (e.g. a `Category` with `parent`/`children`) and what makes an unadvertised request rare: naming a field the schema doesn't enumerate, or nesting a relation a third level deep, is refused as an `isError` tool result naming what was asked for — never served on a best-effort basis, and never a JSON-RPC protocol error.

The schema is generated **per session**: a relation whose related list denies this session's operation-level `query` access, or has `mcp.enabled: false`, is omitted from the vocabulary entirely — the same rule that governs whether a list gets tools at all (see "Access Control" below). Field-level `read` access cannot be evaluated at schema-generation time (it needs a fetched row), so it still applies only when the read actually runs, exactly as it does everywhere else.

### Create Tool

**Tool Name:** `list_{dbKey}_create`

**Description:** Create a new record. Listed only when the list sets `mcp.tools.create: true`

**Input Schema:**

The tool derives one property per writable field, so `data` is checked against
the list's own schema rather than accepting anything:

```typescript
{
  data: Record<string, unknown>
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

**Tool Name:** `list_{dbKey}_update`

**Description:** Update an existing record. Listed only when the list sets `mcp.tools.update: true`

**Input Schema:**

`where` is identity-only — exactly one key, `id`. A secondary unique column is
refused before the access gate runs.

```typescript
{
  where: { id: string },
  data: Record<string, unknown>
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

**Tool Name:** `list_{dbKey}_delete`

**Description:** Delete a record. Listed only when the list sets `mcp.tools.delete: true`

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

### Tool Listing Is Per-Session

`tools/list` is evaluated per session. A list whose operation-level `query` access denies the session outright (`=== false`) doesn't appear in the listing at all — none of its CRUD tools, and no relation entry elsewhere pointing at it (including in another list's `fields` projection schema, above). A list with `mcp.enabled: false` is omitted the same way, as a relation target as well as a tool owner. A list whose read tool is off (`tools.read: false`) is likewise not a relation target: the relation is absent from other lists' `fields`, `where` and `orderBy`, and from the create and update schemas, so `connect` into it is refused.

### Scopes

OAuth scopes are **not enforced unless you configure them**; a valid token otherwise gets every tool access control allows. Set `mcp.scopes` to gate tools by scope:

```typescript
mcp: {
  enabled: true,
  scopes: { read: 'mcp:read', write: ['mcp:write'] },
},
lists: {
  Report: list({
    // Overrides the config-level value for this list
    mcp: { scopes: { write: 'reports:write' } },
    // ...
  }),
}
```

- `query` tools need the `read` scope(s); `create`, `update` and `delete` need the `write` scope(s).
- A custom tool (`mcp.customTools` or a plugin's `registerMcpTool`) can declare `scopes: ['reports:run']`. A list custom tool that omits `scopes` requires the configured `write` scope (fail closed) when `mcp.scopes` is set; declare `scopes: []` to leave it open to any token.
- A procedure exposed to MCP takes its own `scopes`, or requires the configured `write` scope when it names none; `scopes: []` leaves it open to any token. With no `mcp.scopes` configured, a procedure that names none requires no scope at all.
- A procedure's scopes are the only scopes its call checks. List scopes gate the generated tools, not the `context.db` calls inside `run`, so a token holding only `read` can write a list through a procedure that declares `scopes: ['read']`. Give a procedure that writes a scope that says so.
- A token missing a scope gets a tool error naming it, and the tool is left out of that session's `tools/list`.
- A list's scope also applies through relations: a relation to a list whose `read` scope the token lacks cannot be selected, filtered or ordered on, and `connect` into a list needs its `write` scope. A `create` or `update` returns `{ success: true, id }` instead of the row when the token lacks that list's read tool or `read` scope. Access control still decides rows and fields.
- In your own route handlers, `hasScopes(session, [...])` from `@opensaas/stack-auth/mcp` does the same check.

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
      create: ({ session }) => !!session,
      update: ({ session, item }) => !!session && item?.authorId === session.userId,
    },
  }),
  internalNotes: text({
    access: {
      // Only the author can see it
      read: ({ session, item }) => !!session && item?.authorId === session.userId,
      create: ({ session }) => !!session,
      update: ({ session, item }) => !!session && item?.authorId === session.userId,
    },
  }),
}
```

A field rule returns a **boolean**, not a filter: it decides per fetched item.
The operation-level `isAuthor` above returns a filter and is not reusable here —
`FieldAccess` types the three slots as boolean-returning, so passing it is a type
error rather than a silent allow.

### Silent Failures

When access is denied, query tools return empty results rather than errors — this prevents information leakage about whether records exist. Create, update, and delete tools return a successful tool result marked `isError: true` that deliberately does not distinguish between a missing record and denied access — this is a recoverable tool failure, not a JSON-RPC protocol error, so the calling model can see it and adjust its request. Update and delete answer "Failed to update/delete record. Access denied or record not found."; create, which has no record to miss, answers "Failed to create record. Access denied or validation failed."

### Session Fields over MCP

The Better Auth MCP adapter's session carries `userId` and the token's signed custom claims. Access rules that rely on other session fields (e.g. `session.role`) will see them as `undefined` over MCP unless the token carries them or you use a custom session provider that loads and attaches those fields. Any extra field on the MCP session is passed through to access control.

### The Agent Actor

Every session the MCP handler builds carries `session.actor`:

```typescript
import type { AgentActor } from '@opensaas/stack-core'

const actor: AgentActor = {
  kind: 'agent',
  clientId: 'the-verified-oauth-client-id',
  onBehalfOf: 'the-user-id',
  via: 'mcp',
}
```

`session.userId` is still the user's id, so rules that scope by it limit the agent to what that user can do. To treat an agent differently, check for the kind you want. A session with no actor is not a human:

```typescript
import type { AccessControl } from '@opensaas/stack-core'

const humansOnly: AccessControl = ({ session }) => session?.actor?.kind === 'human'
const trustedAgent: AccessControl = ({ session }) =>
  session?.actor?.kind === 'agent' && session.actor.clientId === 'my-first-party-client'
```

The handler sets the actor itself, after it has copied the session's fields. An `actor` claim in a token, or an `actor` key a session provider returns, is discarded.

### Custom Session Providers Must Return a Verified Client Id

A session provider returns `clientId` alongside `userId`:

```typescript
import type { McpSessionProvider } from '@opensaas/stack-core/mcp'

declare function verifyToken(
  request: Request,
): Promise<{ subject: string; clientId: string; scopes: string[] } | null>

export const getSession: McpSessionProvider = async (request) => {
  const verified = await verifyToken(request)
  if (verified === null) return null
  return { userId: verified.subject, clientId: verified.clientId, scopes: verified.scopes }
}
```

- `clientId` must be the OAuth client the credential was issued to, taken from the part of the credential the authorization server controls (`azp` or `client_id` on a verified JWT, the client of an introspected token). Never copy it from a custom claim, a header or the request body.
- A session with no `clientId`, an empty one, or no `userId` is a server misconfiguration, not a bad token: it is answered `500`, and the server log names the missing field. Returning `null` (no session) is still answered `401` with the challenge. The handler does not fall back to a human or an anonymous session.
- `clientId` does not reach `context.session` as a flat field. It is on `session.actor.clientId`.
- `createBetterAuthMcpAdapter` does this for you: it reads the verified token's `azp` and refuses a token without one.

A provider written before this requirement returns no `clientId`, so every request it authenticates is now answered `500` until it returns one.

### Building a context yourself under `withMcpAuth`

A route that verifies the token with `withMcpAuth` and builds its own context gets the same agent actor from `mcpSessionToContextSession`:

```typescript
import { withMcpAuth, mcpSessionToContextSession } from '@opensaas/stack-auth/mcp'
import { getContext } from '@/.opensaas/context'

const handler = withMcpAuth(
  { resource: 'http://localhost:3000/api/mcp', baseURL: 'http://localhost:3000/api/auth' },
  async (_request, mcpSession) => {
    const context = await getContext(mcpSessionToContextSession(mcpSession))
    return Response.json(await context.db.Post.all())
  },
)

export { handler as GET, handler as POST }
```

It returns `{ userId, actor }`. Building `{ userId: mcpSession.userId }` by hand instead gives a session with no actor, which a rule that denies agents would admit. With a custom session provider, `mcpContextSession` from `@opensaas/stack-core/mcp` builds the session `createMcpHandlers` builds, custom fields included. Writing an `actor` object yourself does nothing: only one a host created is honoured.

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
│   MCP Handler   │ ← Tools derived from
│ (stack-core/mcp)│   config at runtime
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

- Check `session?.actor?.kind` positively when a rule should admit only people or only agents. An absent actor is neither

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

1. Check the database directly with a Postgres client (`psql "$DATABASE_URL"`)
2. Test access control with direct context calls
3. Verify session is being passed to context

### Custom Tools Not Working

**Problem:** Custom tool defined but not available

**Solutions:**

1. Restart the development server — tools are read from config at runtime
2. Check the tool is on a list's `mcp.customTools` (or registered by a plugin via `registerMcpTool`)
3. Verify the input schema is valid (Zod schema or plain JSON Schema object)
4. Check handler function returns correct format

## Example Project

See the complete working example at `examples/mcp-demo/` in the repository:

- Full configuration with custom tools
- OAuth setup with Better Auth
- Access control patterns
- A `create-user.ts` script for seeding a test user

## Next Steps

- [Authentication Guide](/docs/how-to/authentication) - Setup Better Auth
- [Access Control](/docs/concepts/access-control) - Secure your data
- [Hooks System](/docs/concepts/hooks) - Add business logic
- [Better Auth MCP Plugin](https://www.better-auth.com/docs/plugins/mcp) - OAuth details
- [Model Context Protocol](https://modelcontextprotocol.io) - MCP specification
