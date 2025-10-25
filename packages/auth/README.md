# @opensaas/stack-auth

Better-auth integration for OpenSaaS Stack - Add authentication to your app in minutes.

## Features

- **Auto-generated Auth Tables** - User, Session, Account, and Verification lists created automatically
- **Session Integration** - Seamless integration with OpenSaaS access control system
- **Pre-built UI Components** - Sign in, sign up, and forgot password forms ready to use
- **Multiple Auth Methods** - Email/password, OAuth providers (GitHub, Google, etc.)
- **Email Verification** - Built-in email verification support
- **Password Reset** - Forgot password flow included
- **Type-Safe** - Full TypeScript support with automatic type generation
- **Configurable Sessions** - Choose which user fields to include in session

## Installation

```bash
pnpm add @opensaas/stack-auth better-auth
```

## Quick Start

### 1. Update Your Config

Wrap your OpenSaaS config with `withAuth()`:

```typescript
// opensaas.config.ts
import { config } from '@opensaas/stack-core'
import { withAuth, authConfig } from '@opensaas/stack-auth'

export default withAuth(
  config({
    db: {
      provider: 'sqlite',
      url: process.env.DATABASE_URL || 'file:./dev.db',
    },
    lists: {
      // Your custom lists here
    },
  }),
  authConfig({
    emailAndPassword: { enabled: true },
    emailVerification: { enabled: true },
    passwordReset: { enabled: true },
    sessionFields: ['userId', 'email', 'name'],
  }),
)
```

### 2. Generate Schema and Push to Database

```bash
pnpm generate  # Generates Prisma schema with auth tables
pnpm db:push   # Push schema to database
```

### 3. Create Auth Server Instance

```typescript
// lib/auth.ts
import { createAuth } from '@opensaas/stack-auth/server'
import config from '../opensaas.config'

export const auth = createAuth(config)

// Export auth API for route handlers
export const GET = auth.handler
export const POST = auth.handler
```

### 4. Set Up Auth Route

```typescript
// app/api/auth/[...all]/route.ts
export { GET, POST } from '@/lib/auth'
```

### 5. Create Auth Client

```typescript
// lib/auth-client.ts
'use client'

import { createClient } from '@opensaas/stack-auth/client'

export const authClient = createClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
})
```

### 6. Add Sign In Page

```typescript
// app/sign-in/page.tsx
import { SignInForm } from '@opensaas/stack-auth/ui'
import { authClient } from '@/lib/auth-client'

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <SignInForm authClient={authClient} redirectTo="/admin" />
    </div>
  )
}
```

### 7. Use Session in Access Control

Sessions are now automatically available in your access control functions:

```typescript
// opensaas.config.ts
import { withAuth, authConfig } from '@opensaas/stack-auth'

export default withAuth(
  config({
    lists: {
      Post: list({
        fields: { title: text(), content: text() },
        access: {
          operation: {
            // Session is automatically populated from better-auth
            create: ({ session }) => !!session,
            update: ({ session, item }) => {
              if (!session) return false
              return { authorId: { equals: session.userId } }
            },
          },
        },
      }),
    },
  }),
  authConfig({
    emailAndPassword: { enabled: true },
    // Session will contain: { userId, email, name }
    sessionFields: ['userId', 'email', 'name'],
  }),
)
```

## Configuration

### Auth Config Options

```typescript
authConfig({
  // Email/password authentication
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    requireConfirmation: true,
  },

  // Email verification
  emailVerification: {
    enabled: true,
    sendOnSignUp: true,
    tokenExpiration: 86400, // 24 hours in seconds
  },

  // Password reset
  passwordReset: {
    enabled: true,
    tokenExpiration: 3600, // 1 hour in seconds
  },

  // OAuth providers
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },

  // Session configuration
  session: {
    expiresIn: 604800, // 7 days in seconds
    updateAge: true, // Refresh session on each request
  },

  // Fields to include in session object
  sessionFields: ['userId', 'email', 'name', 'role'],

  // Extend User list with custom fields
  extendUserList: {
    fields: {
      role: text({ defaultValue: 'user' }),
      company: text(),
    },
  },

  // Custom email sending function
  sendEmail: async ({ to, subject, html }) => {
    await yourEmailService.send({ to, subject, html })
  },
})
```

## UI Components

### SignInForm

```typescript
import { SignInForm } from '@opensaas/stack-auth/ui'
import { authClient } from '@/lib/auth-client'

<SignInForm
  authClient={authClient}
  redirectTo="/dashboard"
  showSocialProviders={true}
  socialProviders={['github', 'google']}
  onSuccess={() => console.log('Signed in!')}
  onError={(error) => console.error(error)}
/>
```

### SignUpForm

```typescript
import { SignUpForm } from '@opensaas/stack-auth/ui'
import { authClient } from '@/lib/auth-client'

<SignUpForm
  authClient={authClient}
  redirectTo="/dashboard"
  requirePasswordConfirmation={true}
  onSuccess={() => console.log('Account created!')}
/>
```

### ForgotPasswordForm

```typescript
import { ForgotPasswordForm } from '@opensaas/stack-auth/ui'
import { authClient } from '@/lib/auth-client'

<ForgotPasswordForm
  authClient={authClient}
  onSuccess={() => console.log('Reset email sent!')}
/>
```

## Auto-Generated Lists

The following lists are automatically created when you use `withAuth()`:

### User

```typescript
{
  id: string
  name: string
  email: string (unique)
  emailVerified: boolean
  image?: string
  sessions: Session[] (relationship)
  accounts: Account[] (relationship)
  createdAt: Date
  updatedAt: Date
  // Plus any custom fields you add via extendUserList
}
```

### Session

```typescript
{
  id: string
  token: string (unique)
  userId: string
  expiresAt: Date
  ipAddress?: string
  userAgent?: string
  user: User (relationship)
  createdAt: Date
  updatedAt: Date
}
```

### Account

```typescript
{
  id: string
  userId: string
  accountId: string
  providerId: string ('github', 'google', 'credentials', etc.)
  accessToken?: string
  refreshToken?: string
  accessTokenExpiresAt?: Date
  refreshTokenExpiresAt?: Date
  scope?: string
  idToken?: string
  password?: string
  user: User (relationship)
  createdAt: Date
  updatedAt: Date
}
```

### Verification

```typescript
{
  id: string
  identifier: string (e.g., email address)
  value: string (token)
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
}
```

## Extending the User List

Add custom fields to the User model:

```typescript
authConfig({
  extendUserList: {
    fields: {
      role: select({
        options: [
          { label: 'User', value: 'user' },
          { label: 'Admin', value: 'admin' },
        ],
        defaultValue: 'user',
      }),
      company: text(),
      phoneNumber: text(),
    },
    // Optionally override access control
    access: {
      operation: {
        query: () => true,
        create: () => true,
        update: ({ session, item }) => session?.userId === item?.id,
        delete: ({ session }) => session?.role === 'admin',
      },
    },
  },
})
```

## Session Fields

Control which user fields are included in the session object:

```typescript
authConfig({
  sessionFields: ['userId', 'email', 'name', 'role'],
})

// Now in access control:
access: {
  operation: {
    create: ({ session }) => {
      console.log(session) // { userId, email, name, role }
      return session?.role === 'admin'
    }
  }
}
```

## Client-Side Hooks

Use better-auth hooks in your React components:

```typescript
'use client'

import { authClient } from '@/lib/auth-client'

function MyComponent() {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) return <div>Loading...</div>

  if (!session) return <div>Not signed in</div>

  return <div>Welcome, {session.user.name}!</div>
}
```

## Server-Side Session

Access the session in server components or actions:

```typescript
import { getContext } from '@/.opensaas/context'

async function myServerAction() {
  const context = getContext()

  if (!context.session) {
    throw new Error('Not authenticated')
  }

  // Session contains fields you specified in sessionFields
  console.log(context.session) // { userId, email, name }

  // Use context.db with access control
  const posts = await context.db.post.findMany()
}
```

## Environment Variables

```bash
# .env
DATABASE_URL=file:./dev.db

# OAuth providers (optional)
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Better-auth
BETTER_AUTH_SECRET=your_secret_key  # Generate with: openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Examples

See `examples/auth-demo` for a complete working example.

## How It Works

1. **withAuth()** merges auth lists (User, Session, Account, Verification) with your config
2. **Generator** creates Prisma schema with all auth tables
3. **Session Provider** uses better-auth to get current session
4. **Context** includes session automatically in all access control functions
5. **UI Components** provide ready-to-use auth forms

## License

MIT
