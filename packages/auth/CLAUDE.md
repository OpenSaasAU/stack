# @opensaas/stack-auth

Better-auth integration for OpenSaas Stack providing authentication, session management, and pre-built UI components.

## Purpose

Adds complete authentication to OpenSaas Stack apps with minimal configuration. Wraps Better-auth to provide:

- Auto-generated auth tables (User, Session, Account, Verification)
- Automatic session integration with access control
- Pre-built UI components (sign in, sign up, password reset)
- OAuth provider support (GitHub, Google, etc.)

## Key Files & Exports

### Config (`src/config/plugin.ts`)

- `authPlugin({ ... })` - Plugin added to a config's `plugins` array; merges auth lists, configures Better-auth plugins and session. This is the only configuration entry point.

### Lists (`src/lists/index.ts`)

Auto-generated lists:

- `User` - Core user model (email, name, emailVerified, image)
- `Session` - Active sessions (token, expiresAt, ipAddress, userAgent)
- `Account` - OAuth accounts (providerId, accessToken, refreshToken, password)
- `Verification` - Email verification tokens

### Server (`src/server/index.ts`)

- `createAuth(config, rawContext?)` - Creates Better-auth instance with MCP plugin support
- Returns `{ handler, signIn, signOut, ... }` - Better-auth methods

### Client (`src/client/index.ts`)

- `createClient({ baseURL })` - Better-auth client for React hooks
- Returns hooks: `useSession()`, `signIn()`, `signOut()`, etc.

### UI (`src/ui/index.ts`)

Pre-built forms (client components):

- `SignInForm` - Email/password + OAuth sign in
- `SignUpForm` - Create account with password confirmation
- `ForgotPasswordForm` - Request password reset email

### Plugins (`src/plugins/index.ts`)

- Better-auth MCP plugin for OAuth authentication with AI assistants

## Architecture Patterns

### Config Merging

`authPlugin()` merges auth lists into your config:

```typescript
config({
  lists: { Post: list({...}) },
  plugins: [authPlugin({ emailAndPassword: { enabled: true } })],
})
// Result: { lists: { User, Session, Account, Verification, Post } }
```

### Deriving Auth lists from better-auth config

The four Auth lists are **derived** from the better-auth model config the
developer writes — not hardcoded. The pure derivation lives in
`src/config/derive-auth-lists.ts` (`deriveAuthLists`), which `getAuthLists`
and the plugin's add-vs-extend logic consume:

- per-model `modelName` → list key + table `@@map`
- per-model `fields` (better-auth field → column) → field-level `@map`
- the `userId` column override → the `user` relationship foreign-key `@map`
- relationship refs between the Auth lists follow the derived keys
  (e.g. `Session.user → AuthUser.sessions`)

With no `modelName`/`fields` overrides the output is unchanged
(`User`/`Session`/`Account`/`Verification`, original field shapes, no `@@map`).

```typescript
// Adopt an existing better-auth installation (Auth lists ≠ app User)
authPlugin({
  user: { modelName: 'AuthUser', fields: { name: 'full_name' } },
  session: { modelName: 'AuthSession', fields: { userId: 'user_id' } },
})
// Adds AuthUser/AuthSession/... and leaves an app's own `User` untouched.
```

Because the plugin only ever adds/extends its **derived** keys, an app's own
domain `User` (a different model from the better-auth user) is never extended
or overwritten when the user model is renamed. The runtime `getUser`/
`getCurrentUser` helpers resolve the user list's `context.db` key from the
configured user `modelName`.

### Schema placement (relocatable Auth lists)

A plugin-level `schema` option places all generated Auth lists in a non-`public`
Postgres schema via `@@schema(...)`, so they can adopt a separate-schema
better-auth layout (e.g. an `auth` schema) and reach **Schema parity** with the
live tables. Combined with the derived keys/`@@map`/field `@map`s above, the
generated lists diff CLEAN against an existing `auth`-schema install — they are
modelled for runtime/types without producing a migration.

```typescript
authPlugin({
  schema: 'auth', // all Auth lists get @@schema("auth")
  user: { modelName: 'AuthUser' },
  session: { modelName: 'AuthSession' },
  account: { modelName: 'AuthAccount' },
  verification: { modelName: 'AuthVerification' },
  // per-model override: relocate one list to a different schema
  // verification: { modelName: 'AuthVerification', schema: 'auth_internal' },
})
```

How it wires up (Postgres multi-schema):

- Each Auth list gets a list-level `db.schema` → `@@schema(...)` (per-model
  `schema` override, else the plugin-level `schema`).
- The plugin's `beforeGenerate` hook adds the auth schema(s) (always plus
  `public`) to the datasource `db.schemas` array and defaults any list without
  an explicit `db.schema` to `public`, so the generated multi-schema Prisma
  schema is valid (the generator emits `previewFeatures = ["multiSchema"]` and
  `schemas = [...]`).
- With no `schema` option the Auth lists stay in `public` and no `@@schema` /
  `schemas` / preview feature is emitted (greenfield default unchanged).

### Session Provider

Better-auth provides session to context via custom `prismaClientConstructor`:

```typescript
// Generated .opensaas/context.ts uses this pattern:
const session = await auth.api.getSession({ headers })
const context = createContext(config, prisma, session)
```

### Session Fields Configuration

Control which User fields appear in session:

```typescript
authPlugin({ sessionFields: ['userId', 'email', 'name', 'role'] })
// Access in access control:
access: {
  operation: {
    create: ({ session }) => session?.role === 'admin'
  }
}
```

### Session Type Safety

To get autocomplete and type safety for session fields, use module augmentation:

**Step 1: Create session type declaration file**

```typescript
// types/session.d.ts
import '@opensaas/stack-core'

declare module '@opensaas/stack-core' {
  interface Session {
    userId: string
    email: string
    name: string
    role: 'admin' | 'user'
  }
}
```

**Step 2: Ensure fields match your sessionFields configuration**

```typescript
authPlugin({
  sessionFields: ['userId', 'email', 'name', 'role'],
  extendUserList: {
    fields: {
      role: select({
        options: [
          { label: 'Admin', value: 'admin' },
          { label: 'User', value: 'user' },
        ],
        defaultValue: 'user',
      }),
    },
  },
})
```

**Result: Fully typed session everywhere**

```typescript
const isAdmin: AccessControl = ({ session }) => {
  return session?.role === 'admin' // ✅ Autocomplete and type checking
  //             ↑ Shows: userId, email, name, role
}

const context = await getContext(session)
if (context.session?.email) {
  // ✅ Type: string
  // Send email...
}
```

**Important Notes:**

- Session type declaration must match your `sessionFields` configuration
- `userId` always maps to User's `id` field
- Add fields to `extendUserList` before including them in session
- The session type is independent of Better Auth's internal types

### Extending User List

Add custom fields to User:

```typescript
authPlugin({
  extendUserList: {
    fields: {
      role: select({ options: [{ label: 'User', value: 'user' }] }),
      company: text(),
    },
  },
})
```

## Integration Points

### With @opensaas/stack-core

- Merges auth lists into core config
- Session flows through context to all access control functions
- Generator creates Prisma schema with auth tables

### With MCP (Model Context Protocol)

- Auth provides Better Auth MCP adapter via `@opensaas/stack-auth/mcp`
- MCP plugin enables OAuth for AI assistants
- `createBetterAuthMcpAdapter()` converts Better Auth instance to session provider
- Works with core MCP runtime from `@opensaas/stack-core/mcp`
- Requires `rawOpensaasContext` from `.opensaas/context.ts`:

```typescript
import { rawOpensaasContext } from '@/.opensaas/context'
export const auth = createAuth(config, rawOpensaasContext)
```

### With Better-auth

- Direct wrapper around Better-auth core
- Uses Better-auth's plugin system (MCP, OAuth providers)
- Schema converter maps OpenSaas lists to Better-auth schema format

## Common Patterns

### Basic Setup

```typescript
// 1. Config
export default config({
  db: {...},
  lists: {...},
  plugins: [authPlugin({ emailAndPassword: { enabled: true } })],
})

// 2. Server (lib/auth.ts)
export const auth = createAuth(config)

// 3. Route (app/api/auth/[...all]/route.ts)
export { GET, POST } from '@/lib/auth'

// 4. Client (lib/auth-client.ts)
export const authClient = createClient({ baseURL: process.env.NEXT_PUBLIC_APP_URL })

// 5. UI (app/sign-in/page.tsx)
<SignInForm authClient={authClient} redirectTo="/admin" />
```

### Access Control with Session

```typescript
Post: list({
  access: {
    operation: {
      create: ({ session }) => !!session,
      update: ({ session, item }) => session?.userId === item.authorId,
    },
    fields: {
      internalNotes: {
        read: ({ session }) => session?.role === 'admin',
      },
    },
  },
})
```

### OAuth Providers

```typescript
authPlugin({
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!
    }
  }
})

// UI
<SignInForm socialProviders={['github', 'google']} />
```

## Type Safety

Session type is inferred from `sessionFields`:

```typescript
authPlugin({ sessionFields: ['userId', 'email', 'role'] })
// session: { userId: string, email: string, role: string } | null
```

All auth operations use Better-auth's type-safe client.
