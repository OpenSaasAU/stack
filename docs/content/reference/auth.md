# Auth Package

Authentication integration with Better-auth using the OpenSaaS plugin system.

## Installation

```bash
pnpm add @opensaas/stack-auth
```

## Quick Start

Add the auth plugin to your OpenSaaS config:

```typescript
// opensaas.config.ts
import { config, list, text, relationship } from '@opensaas/stack-core'
import { authPlugin } from '@opensaas/stack-auth'

export default config({
  plugins: [
    authPlugin({
      emailAndPassword: {
        enabled: true,
        minPasswordLength: 8,
      },
      sessionFields: ['userId', 'email', 'name'],
    }),
  ],
  db: {
    provider: 'sqlite',
    url: 'file:./dev.db',
  },
  lists: {
    Post: list({
      fields: {
        title: text(),
        author: relationship({ ref: 'User.posts' }),
      },
      access: {
        operation: {
          create: ({ session }) => !!session,
          update: ({ session, item }) => session?.userId === item.authorId,
        },
      },
    }),
  },
})
```

Then set up the server and client:

```typescript
// lib/auth.ts
import { createAuth } from '@opensaas/stack-auth/server'
import config from '../opensaas.config'
import { rawOpensaasContext } from '@/.opensaas/context'

export const auth = createAuth(config, rawOpensaasContext)
export const GET = auth.handler
export const POST = auth.handler
```

```typescript
// lib/auth-client.ts
'use client'
import { createClient } from '@opensaas/stack-auth/client'

export const authClient = createClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
})
```

## Configuration Options

The `authPlugin()` function accepts the following configuration options:

### `emailAndPassword`

Configure email and password authentication:

```typescript
authPlugin({
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8, // default: 8
    requireConfirmation: true, // default: true
  },
})
```

`sendResetPassword` is forwarded straight through to better-auth's own `emailAndPassword.sendResetPassword` — no stack wrapping. It receives exactly what better-auth passes (`user`, `url`, `token`), so you build the subject line and body yourself:

```typescript
authPlugin({
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      await emailService.send({
        to: user.email,
        subject: 'Reset your password',
        html: `<a href="${url}">Reset your password</a>`,
      })
    },
  },
})
```

If not provided, reset emails are logged to the console in development.

### `emailVerification`

Configure email verification for new sign-ups:

```typescript
authPlugin({
  emailVerification: {
    enabled: true,
    sendOnSignUp: true, // default: true
    tokenExpiration: 86400, // default: 86400 (24 hours)
  },
})
```

`sendVerificationEmail` is forwarded straight through to better-auth's own `emailVerification.sendVerificationEmail` — no stack wrapping. It receives exactly what better-auth passes (`user`, `url`, `token`):

```typescript
authPlugin({
  emailVerification: {
    enabled: true,
    sendVerificationEmail: async ({ user, url }) => {
      await emailService.send({
        to: user.email,
        subject: 'Verify your email',
        html: `<a href="${url}">Verify your email</a>`,
      })
    },
  },
})
```

If not provided, verification emails are logged to the console in development.

### `passwordReset`

Configure password reset functionality:

```typescript
authPlugin({
  passwordReset: {
    enabled: true,
    tokenExpiration: 3600, // default: 3600 (1 hour)
  },
})
```

### `socialProviders`

Configure OAuth/social authentication providers:

```typescript
authPlugin({
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      enabled: true,
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      enabled: true,
    },
    discord: {
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
    },
  },
})
```

Supported providers: `github`, `google`, `discord`, `twitter`

### `session`

Configure session behavior:

```typescript
authPlugin({
  session: {
    expiresIn: 604800, // default: 604800 (7 days)
    updateAge: 86400, // default: 86400 (1 day) - seconds between session refreshes; set `false` to disable
  },
})
```

### `sessionFields`

Define which fields are available in the session object passed to access control functions:

```typescript
authPlugin({
  sessionFields: ['userId', 'email', 'name', 'role'],
})
```

These fields will be automatically typed and available in your access control functions:

```typescript
access: {
  operation: {
    update: ({ session }) => {
      // session is typed as { userId: string; email: string; name: string; role: string } | null
      return session?.role === 'admin'
    },
  },
}
```

### `extendUserList`

Add custom fields, access control, or hooks to the auto-generated User list:

```typescript
authPlugin({
  extendUserList: {
    fields: {
      role: select({
        options: [
          { label: 'Admin', value: 'admin' },
          { label: 'User', value: 'user' },
        ],
        defaultValue: 'user',
      }),
      posts: relationship({
        ref: 'Post.author',
        many: true,
      }),
    },
    access: {
      operation: {
        delete: ({ session }) => session?.role === 'admin',
      },
    },
    hooks: {
      afterOperation: async ({ operation, item }) => {
        if (operation === 'create') {
          console.log('New user created:', item.email)
        }
      },
    },
  },
})
```

### `betterAuthPlugins`

Add Better Auth plugins for additional functionality:

```typescript
import { authPlugin } from '@opensaas/stack-auth'
import { mcp } from '@opensaas/stack-auth/plugins'

authPlugin({
  betterAuthPlugins: [
    mcp({ loginPage: '/sign-in' }),
    // Add other Better Auth plugins here
  ],
})
```

The auth plugin automatically converts Better Auth plugin schemas to OpenSaaS lists.

### `betterAuthOptions`

Escape hatch for any better-auth option the stack doesn't model as its own config field. Deep-merged into the options `createAuth()` builds, applied **last** — a plain-object value at a given key merges recursively with what the stack already set there (so a nested addition like `session.cookieCache` adds alongside the stack's own `session.expiresIn`/`updateAge` rather than replacing them), and on a genuine key collision `betterAuthOptions` wins. Arrays and any other value type replace the stack's value outright.

```typescript
authPlugin({
  betterAuthOptions: {
    // Sync a domain user row for every better-auth user
    databaseHooks: { user: { create: { after: syncDomainUser } } },
    // 5-minute session cookie cache
    session: { cookieCache: { enabled: true, maxAge: 300 } },
    // Keep PII out of the verification table
    verification: { storeIdentifier: 'hashed' },
    // Derive the base URL instead of relying on env vars
    baseURL: process.env.BETTER_AUTH_URL,
  },
})
```

`database` and `plugins` are rejected — they're already the dedicated seams (the stack's `db` config, and `betterAuthPlugins` above) and accepting them here would create two unranked ways to set the same thing. So is `additionalFields` under `user`/`session`/`account`/`verification`: it has schema consequences (new columns) that a passthrough can't also apply to the generated Prisma schema, so add fields to the derived list instead — `extendUserList` for the user model, or declare the list yourself in your own `lists` config for the others.

The same options object is available standalone via `buildBetterAuthOptions()` — see [Escape hatch: hand-wiring `betterAuth()`](#escape-hatch-hand-wiring-betterauth) below.

## Auto-Generated Lists

The auth plugin automatically generates the following lists:

### User

- `id` (String, auto-generated)
- `email` (String, unique, required)
- `emailVerified` (Boolean)
- `name` (String, optional)
- `image` (String, optional)
- `createdAt` (DateTime, auto)
- `updatedAt` (DateTime, auto)
- Custom fields from `extendUserList`

### Session

- `id` (String, auto-generated)
- `userId` (String, foreign key to User)
- `expiresAt` (DateTime)
- `token` (String, unique)
- `ipAddress` (String, optional)
- `userAgent` (String, optional)
- `createdAt` (DateTime, auto)
- `updatedAt` (DateTime, auto)

### Account

Stores OAuth provider information and password hashes:

- `id` (String, auto-generated)
- `userId` (String, foreign key to User)
- `accountId` (String, provider-specific user ID)
- `providerId` (String, e.g., 'github', 'google')
- `accessToken` (String, optional)
- `refreshToken` (String, optional)
- `expiresAt` (DateTime, optional)
- `password` (String, optional, hashed)
- `createdAt` (DateTime, auto)
- `updatedAt` (DateTime, auto)

### Verification

Stores email verification and password reset tokens:

- `id` (String, auto-generated)
- `identifier` (String, email address)
- `value` (String, token)
- `expiresAt` (DateTime)
- `createdAt` (DateTime, auto)
- `updatedAt` (DateTime, auto)

## Server Setup

Create auth handlers for your API routes:

```typescript
// lib/auth.ts
import { createAuth } from '@opensaas/stack-auth/server'
import config from '../opensaas.config'
import { rawOpensaasContext } from '@/.opensaas/context'

export const auth = createAuth(config, rawOpensaasContext)

// Export handlers for Next.js API routes
export const GET = auth.handler
export const POST = auth.handler
```

Then create the API route:

```typescript
// app/api/auth/[...all]/route.ts
export { GET, POST } from '@/lib/auth'
```

### Escape hatch: hand-wiring `betterAuth()`

`createAuth()` covers the common case. If you need to construct `betterAuth()`
yourself — e.g. a third-party contract that requires a resolved instance
rather than `createAuth()`'s lazy proxy — `buildBetterAuthOptions()` gives you
the exact same options object `createAuth()` passes to `betterAuth()`, so your
hand-wired instance derives from the stack config instead of duplicating it:

```typescript
// lib/auth.ts
import { betterAuth } from 'better-auth'
import { buildBetterAuthOptions } from '@opensaas/stack-auth/server'
import config from '../opensaas.config'
import { rawOpensaasContext } from '@/.opensaas/context'

export const auth = betterAuth({
  ...(await buildBetterAuthOptions(config, rawOpensaasContext)),
  // Local additions on top of the stack-derived options
  databaseHooks: { user: { create: { after: syncDomainUser } } },
})
```

This keeps the auth plugin authoritative for everything it models (providers,
session expiry, password policy, the plugin array) while your additions stay
an explicit, reviewable diff. It also gives an incremental migration path onto
`createAuth()`: adopt the builder first, then move options into
[`betterAuthOptions`](#betterauthoptions) as the stack grows knobs for them.

### Typed `auth.api.*` reads: pass your plugin tuple

Called with just `(config, context)`, both `createAuth()` and
`buildBetterAuthOptions()` return the **widened** `BetterAuthOptions` /
`Auth<BetterAuthOptions>` types. better-auth infers plugin endpoints and a
`customSession()`'s replaced session shape from the _literal_ type of the
options object, so constructing from a widened type erases them — a plugin
like `emailOTP()` loses `auth.api.signInEmailOTP`, and `auth.api.getSession()`
falls back to better-auth's default `{ user, session }` instead of your
`customSession()` callback's return type.

If your app reads `auth.api.*` in typed code and uses either of those,
**pass your `betterAuthPlugins` array as a third argument** — the exact same
array already passed to `authPlugin({ betterAuthPlugins })` — to either
function:

```typescript
// auth-plugins.ts
import { emailOTP } from 'better-auth/plugins'

export const appBetterAuthPlugins = [emailOTP({ sendVerificationOTP })]
```

```typescript
// opensaas.config.ts
import { authPlugin } from '@opensaas/stack-auth'
import { appBetterAuthPlugins } from './auth-plugins'

export default config({
  plugins: [authPlugin({ betterAuthPlugins: appBetterAuthPlugins })],
  // ...
})
```

```typescript
// lib/auth.ts
import { betterAuth } from 'better-auth'
import { buildBetterAuthOptions } from '@opensaas/stack-auth/server'
import config from '../opensaas.config'
import { rawOpensaasContext } from '@/.opensaas/context'
import { appBetterAuthPlugins } from '../auth-plugins'

export const auth = betterAuth({
  ...(await buildBetterAuthOptions(config, rawOpensaasContext, appBetterAuthPlugins)),
  databaseHooks: { user: { create: { after: syncDomainUser } } },
})
// auth.api.signInEmailOTP is now typed, and auth.api.getSession() returns
// your customSession() shape if you have one.
```

The same third argument works on `createAuth()` — `createAuth(config, rawOpensaasContext, appBetterAuthPlugins)`.
Either way, the supplied array is for typing only: the plugin array actually
used at runtime is always the one resolved from `authPlugin({ betterAuthPlugins })`,
with exactly one `nextCookies()` appended last. Passing an array that isn't
the same plugin instances in the same order throws, naming the mismatch, so
the two can't silently drift apart.

**Which entry point to reach for:** `createAuth()`'s lazy `Proxy` does not
behave identically to a real `Auth` instance for every property — every
access, including a non-function property, is surfaced through an `async`
wrapper (so `auth.options`, for example, reads back as a `Promise` rather than
the plain object a real instance returns synchronously). If your app reads
`auth.api.*` in typed code, reach for `buildBetterAuthOptions()` plus
`betterAuth()` — it constructs a real instance and does not have this gap.

## Client Setup

Create a client for authentication in your components:

```typescript
// lib/auth-client.ts
'use client'
import { createClient } from '@opensaas/stack-auth/client'

export const authClient = createClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
})

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  // ... other auth methods
} = authClient
```

## UI Components

The auth package includes pre-built UI components:

### SignInForm

```typescript
import { SignInForm } from '@opensaas/stack-auth/ui'
import { authClient } from '@/lib/auth-client'

export default function SignInPage() {
  return (
    <SignInForm
      authClient={authClient}
      redirectTo="/admin"
      showSocialProviders={true}
    />
  )
}
```

### SignUpForm

```typescript
import { SignUpForm } from '@opensaas/stack-auth/ui'
import { authClient } from '@/lib/auth-client'

export default function SignUpPage() {
  return (
    <SignUpForm
      authClient={authClient}
      redirectTo="/admin"
      showSocialProviders={true}
    />
  )
}
```

### useSession Hook

```typescript
'use client'
import { useSession } from '@/lib/auth-client'

export function UserProfile() {
  const { data: session, isPending } = useSession()

  if (isPending) return <div>Loading...</div>
  if (!session) return <div>Not signed in</div>

  return <div>Welcome, {session.user.name}!</div>
}
```

## Access Control Integration

The session is automatically available in all access control functions:

```typescript
lists: {
  Post: list({
    fields: {
      title: text(),
      content: text(),
      author: relationship({ ref: 'User.posts' }),
    },
    access: {
      operation: {
        // Only authenticated users can create posts
        create: ({ session }) => !!session,

        // Only the author can update their posts
        update: ({ session, item }) => {
          return session?.userId === item.authorId
        },

        // Everyone can read published posts
        query: () => true,
      },
      filter: {
        // Users can only see their own drafts
        query: ({ session }) => {
          if (!session) {
            return { status: { equals: 'published' } }
          }
          return {
            OR: [
              { status: { equals: 'published' } },
              { authorId: { equals: session.userId } },
            ],
          }
        },
      },
    },
  }),
}
```

## MCP Integration

To enable Model Context Protocol support with Better Auth authentication:

```typescript
import { authPlugin } from '@opensaas/stack-auth'
import { mcp } from '@opensaas/stack-auth/plugins'

export default config({
  plugins: [
    authPlugin({
      emailAndPassword: { enabled: true },
      betterAuthPlugins: [mcp({ loginPage: '/sign-in' })],
    }),
  ],
  mcp: {
    enabled: true,
    auth: {
      type: 'better-auth',
      loginPage: '/sign-in',
    },
  },
  lists: {
    // Your lists
  },
})
```

The MCP plugin automatically converts its schema to OpenSaaS lists and enables OAuth authentication for AI assistants.

See [MCP Integration Guide](/docs/how-to/mcp) for more details.

## Examples

- [Basic Authentication](https://github.com/OpenSaasAU/stack/tree/main/examples/auth-demo) - Email/password and OAuth
- [MCP Integration](https://github.com/OpenSaasAU/stack/tree/main/examples/mcp-demo) - Better Auth MCP plugin

## Further Reading

- [Authentication Guide](/docs/how-to/authentication) - Comprehensive authentication guide
- [Access Control Guide](/docs/concepts/access-control) - Using sessions in access control
- [Better Auth Documentation](https://better-auth.com) - Official Better Auth docs
