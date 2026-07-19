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
    updateAge: true, // default: true - update expiry on each request
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

### `sendEmail`

Provide a custom email sending function for verification and password reset emails:

```typescript
authPlugin({
  sendEmail: async ({ to, subject, html }) => {
    // Use your email service (SendGrid, Resend, etc.)
    await emailService.send({ to, subject, html })
  },
})
```

If not provided, emails will be logged to the console in development.

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

See [MCP Integration Guide](/docs/guides/mcp) for more details.

## Examples

- [Basic Authentication](https://github.com/OpenSaasAU/stack/tree/main/examples/auth-demo) - Email/password and OAuth
- [MCP Integration](https://github.com/OpenSaasAU/stack/tree/main/examples/mcp-demo) - Better Auth MCP plugin

## Further Reading

- [Authentication Guide](/docs/guides/authentication) - Comprehensive authentication guide
- [Access Control Guide](/docs/guides/access-control) - Using sessions in access control
- [Better Auth Documentation](https://better-auth.com) - Official Better Auth docs
