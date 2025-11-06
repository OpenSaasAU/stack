# Authentication Guide

This guide covers everything you need to implement authentication in your OpenSaaS Stack application using Better-auth integration.

## Introduction

OpenSaaS Stack provides seamless authentication through the `@opensaas/stack-auth` package, which integrates [Better-auth](https://better-auth.com) with the stack's access control system. You get:

- **Email/password authentication** out of the box
- **OAuth/social login** (GitHub, Google, Discord, Twitter)
- **Email verification** and password reset flows
- **Session management** with secure HTTP-only cookies
- **Pre-built UI components** for common auth flows
- **Automatic session injection** into access control functions
- **Type-safe sessions** with configurable fields

Authentication setup takes less than 5 minutes, and the session is automatically available throughout your application.

## Quick Start

Here's the minimal setup to add authentication to your app:

```typescript
// opensaas.config.ts
import { config } from '@opensaas/stack-core'
import { authPlugin } from '@opensaas/stack-auth'

export default config({
  plugins: [
    authPlugin({
      emailAndPassword: { enabled: true },
      sessionFields: ['userId', 'email', 'name'],
    }),
  ],
  db: { provider: 'sqlite', url: 'file:./dev.db' },
  lists: {
    /* your lists */
  },
})
```

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
// app/api/auth/[...all]/route.ts
export { GET, POST } from '@/lib/auth'
```

That's it! You now have authentication endpoints and auto-generated User, Session, Account, and Verification lists.

## Installation & Setup

### 1. Install the Package

```bash
pnpm add @opensaas/stack-auth
```

### 2. Set Environment Variables

Create a `.env` file with the following:

```bash
# Database
DATABASE_URL=file:./dev.db

# Better Auth
BETTER_AUTH_SECRET=your_secret_key_here  # Generate with: openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:3000

# Public URL
NEXT_PUBLIC_APP_URL=http://localhost:3000

# OAuth (optional)
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
```

### 3. Configure the Auth Plugin

Add the auth plugin to your OpenSaaS config:

```typescript
// opensaas.config.ts
import { config, list, text, relationship } from '@opensaas/stack-core'
import { authPlugin } from '@opensaas/stack-auth'

export default config({
  plugins: [
    authPlugin({
      // Email and password authentication
      emailAndPassword: {
        enabled: true,
        minPasswordLength: 8,
        requireConfirmation: true,
      },

      // Password reset functionality
      passwordReset: {
        enabled: true,
        tokenExpiration: 3600, // 1 hour
      },

      // Fields available in session object
      sessionFields: ['userId', 'email', 'name'],

      // Extend User list with custom fields
      extendUserList: {
        fields: {
          posts: relationship({ ref: 'Post.author', many: true }),
        },
      },
    }),
  ],

  db: {
    provider: 'sqlite',
    url: process.env.DATABASE_URL || 'file:./dev.db',
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
        },
      },
    }),
  },
})
```

### 4. Generate Database Schema

```bash
pnpm generate
pnpm db:push
```

This creates the auth tables (User, Session, Account, Verification) in your database.

## Creating Authentication Pages

### Server Setup

Create a server-side auth instance:

```typescript
// lib/auth.ts
import { createAuth } from '@opensaas/stack-auth/server'
import config from '../opensaas.config'
import { rawOpensaasContext } from '@/.opensaas/context'

// Create auth instance
export const auth = createAuth(config, rawOpensaasContext)

// Helper to get current session
export async function getAuth() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })
  return session
}

// Export handlers for API routes
export const GET = auth.handler
export const POST = auth.handler
```

### Client Setup

Create a client-side auth instance:

```typescript
// lib/auth-client.ts
'use client'

import { createClient } from '@opensaas/stack-auth/client'

export const authClient = createClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
})

// Optional: Export individual methods for convenience
export const { signIn, signUp, signOut, useSession } = authClient
```

### API Routes

Create the catch-all auth route:

```typescript
// app/api/auth/[...all]/route.ts
export { GET, POST } from '@/lib/auth'
```

This handles all auth endpoints:

- `/api/auth/sign-in`
- `/api/auth/sign-up`
- `/api/auth/sign-out`
- `/api/auth/session`
- `/api/auth/forgot-password`
- `/api/auth/reset-password`

### Sign-In Page

Create a sign-in page using the pre-built component:

```typescript
// app/sign-in/page.tsx
import { SignInForm } from '@opensaas/stack-auth/ui'
import { authClient } from '@/lib/auth-client'

export default function SignInPage() {
  return (
    <div className="container mx-auto max-w-md py-16">
      <h1 className="text-3xl font-bold mb-8">Sign In</h1>
      <SignInForm
        authClient={authClient}
        redirectTo="/admin"
        showSocialProviders={false}
      />
    </div>
  )
}
```

### Sign-Up Page

Create a sign-up page:

```typescript
// app/sign-up/page.tsx
import { SignUpForm } from '@opensaas/stack-auth/ui'
import { authClient } from '@/lib/auth-client'

export default function SignUpPage() {
  return (
    <div className="container mx-auto max-w-md py-16">
      <h1 className="text-3xl font-bold mb-8">Sign Up</h1>
      <SignUpForm
        authClient={authClient}
        redirectTo="/admin"
        requirePasswordConfirmation={true}
      />
    </div>
  )
}
```

### Forgot Password Page

Create a password reset request page:

```typescript
// app/forgot-password/page.tsx
import { ForgotPasswordForm } from '@opensaas/stack-auth/ui'
import { authClient } from '@/lib/auth-client'

export default function ForgotPasswordPage() {
  return (
    <div className="container mx-auto max-w-md py-16">
      <h1 className="text-3xl font-bold mb-8">Reset Password</h1>
      <ForgotPasswordForm authClient={authClient} />
    </div>
  )
}
```

## Protected Routes

OpenSaaS Stack doesn't use Next.js middleware for authentication. Instead, protect routes at the page/component level by checking the session.

### Protecting Admin Pages

```typescript
// app/admin/[[...admin]]/page.tsx
import { AdminUI } from '@opensaas/stack-ui'
import { getContext, config } from '@/.opensaas/context'
import { getAuth } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function AdminPage({ params, searchParams }) {
  const session = await getAuth()

  // Redirect unauthenticated users
  if (!session) {
    redirect('/sign-in')
  }

  // Or show an error message
  if (!session) {
    return (
      <div className="p-8">
        <div className="bg-destructive/10 border border-destructive rounded-lg p-6">
          <h2 className="text-xl font-bold mb-2">Access Denied</h2>
          <p className="text-muted-foreground">
            You must be logged in to access the admin interface.
          </p>
          <a href="/sign-in" className="text-primary underline mt-4 inline-block">
            Sign In
          </a>
        </div>
      </div>
    )
  }

  return (
    <AdminUI
      context={await getContext(session.user)}
      config={await config}
      params={params.admin}
      searchParams={searchParams}
    />
  )
}
```

### Protecting Server Actions

```typescript
// lib/actions/posts.ts
'use server'

import { getContext } from '@/.opensaas/context'
import { getAuth } from '@/lib/auth'

export async function createPost(data: PostCreateInput) {
  const session = await getAuth()

  if (!session) {
    return { success: false, error: 'Not authenticated' }
  }

  const context = await getContext(session.user)

  const post = await context.db.post.create({
    data: {
      ...data,
      author: { connect: { id: session.user.id } },
    },
  })

  if (!post) {
    return { success: false, error: 'Access denied' }
  }

  return { success: true, post }
}
```

### Client-Side Protection

```typescript
'use client'

import { useSession } from '@/lib/auth-client'
import { redirect } from 'next/navigation'

export function ProtectedComponent() {
  const { data: session, isPending } = useSession()

  if (isPending) {
    return <div>Loading...</div>
  }

  if (!session) {
    redirect('/sign-in')
  }

  return <div>Protected content for {session.user.name}</div>
}
```

## Session Management

### Server-Side Session Access

Get the current session in server components or actions:

```typescript
import { getAuth } from '@/lib/auth'

export default async function MyPage() {
  const session = await getAuth()

  if (!session) {
    return <div>Not signed in</div>
  }

  return (
    <div>
      <h1>Welcome, {session.user.name}!</h1>
      <p>Email: {session.user.email}</p>
    </div>
  )
}
```

The session object contains:

```typescript
{
  user: {
    id: string
    email: string
    name: string | null
    image: string | null
    emailVerified: boolean
    // ... any custom fields from sessionFields
  }
  session: {
    token: string
    expiresAt: Date
    ipAddress: string | null
    userAgent: string | null
  }
}
```

### Client-Side Session Hook

Use the `useSession()` hook in client components:

```typescript
'use client'

import { authClient } from '@/lib/auth-client'

export function UserProfile() {
  const { data: session, isPending, error } = authClient.useSession()

  if (isPending) {
    return <div>Loading...</div>
  }

  if (error) {
    return <div>Error: {error.message}</div>
  }

  if (!session) {
    return <div>Not signed in</div>
  }

  return (
    <div>
      <img src={session.user.image || '/default-avatar.png'} alt="Avatar" />
      <h2>{session.user.name}</h2>
      <p>{session.user.email}</p>
    </div>
  )
}
```

### Session Configuration

Configure which fields are available in the session:

```typescript
authPlugin({
  sessionFields: ['userId', 'email', 'name', 'role', 'company'],
})
```

These fields will be:

1. Available in the session object
2. Automatically typed in TypeScript
3. Passed to all access control functions

## Access Control Integration

The session is automatically injected into all access control functions. This makes it easy to implement user-based permissions.

### Operation-Level Access Control

Control who can perform operations on a list:

```typescript
Post: list({
  fields: {
    title: text(),
    content: text(),
    status: select({
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Published', value: 'published' },
      ],
      defaultValue: 'draft',
    }),
    author: relationship({ ref: 'User.posts' }),
  },
  access: {
    operation: {
      // Anyone can view published posts
      query: () => true,

      // Only authenticated users can create posts
      create: ({ session }) => !!session,

      // Only the author can update their posts
      update: ({ session, item }) => {
        if (!session) return false
        return session.userId === item.authorId
      },

      // Only the author can delete their posts
      delete: ({ session, item }) => {
        if (!session) return false
        return session.userId === item.authorId
      },
    },
  },
})
```

### Filter-Based Access Control

Filter which records users can access:

```typescript
Post: list({
  access: {
    operation: {
      query: () => true, // Allow the query operation
    },
    filter: {
      query: ({ session }) => {
        // Anonymous users: only published posts
        if (!session) {
          return { status: { equals: 'published' } }
        }

        // Authenticated users: published posts + their own drafts
        return {
          OR: [{ status: { equals: 'published' } }, { authorId: { equals: session.userId } }],
        }
      },
    },
  },
})
```

### Field-Level Access Control

Control access to individual fields:

```typescript
Post: list({
  fields: {
    title: text(),
    content: text(),

    // Only the author can read/write internal notes
    internalNotes: text({
      access: {
        read: ({ session, item }) => {
          if (!session) return false
          return session.userId === item.authorId
        },
        create: ({ session }) => !!session,
        update: ({ session, item }) => {
          if (!session) return false
          return session.userId === item.authorId
        },
      },
    }),
  },
})
```

### Access Control Helpers

Create reusable access control functions:

```typescript
// opensaas.config.ts
import type { AccessControl } from '@opensaas/stack-core'

// Check if user is signed in
const isSignedIn: AccessControl = ({ session }) => {
  return !!session
}

// Check if user is the author
const isAuthor: AccessControl = ({ session, item }) => {
  if (!session) return false
  return { authorId: { equals: session.userId } }
}

// Check if user is an admin
const isAdmin: AccessControl = ({ session }) => {
  return session?.role === 'admin'
}

export default config({
  lists: {
    Post: list({
      access: {
        operation: {
          create: isSignedIn,
          update: isAuthor,
          delete: isAuthor,
        },
      },
    }),

    User: list({
      access: {
        operation: {
          delete: isAdmin,
        },
      },
    }),
  },
})
```

## User List Customization

The auth plugin auto-generates a User list, but you can extend it with custom fields.

### Adding Custom Fields

```typescript
authPlugin({
  extendUserList: {
    fields: {
      // Add a role field
      role: select({
        options: [
          { label: 'User', value: 'user' },
          { label: 'Admin', value: 'admin' },
          { label: 'Moderator', value: 'moderator' },
        ],
        defaultValue: 'user',
      }),

      // Add company and phone
      company: text(),
      phoneNumber: text(),

      // Add relationships
      posts: relationship({
        ref: 'Post.author',
        many: true,
      }),
    },
  },
})
```

### Including Custom Fields in Session

Make custom fields available in the session:

```typescript
authPlugin({
  sessionFields: ['userId', 'email', 'name', 'role', 'company'],

  extendUserList: {
    fields: {
      role: select({
        /* ... */
      }),
      company: text(),
    },
  },
})
```

Now you can access these in access control:

```typescript
access: {
  operation: {
    delete: ({ session }) => {
      // session.role is now typed and available
      return session?.role === 'admin'
    },
  },
}
```

### Custom Access Control on User List

Override the default User list access control:

```typescript
authPlugin({
  extendUserList: {
    access: {
      operation: {
        // Only admins can view all users
        query: ({ session }) => {
          if (!session) return false
          if (session.role === 'admin') return true
          return { id: { equals: session.userId } }
        },

        // Only admins can delete users
        delete: ({ session }) => session?.role === 'admin',
      },
    },
  },
})
```

### Custom Hooks on User List

Add lifecycle hooks to the User list:

```typescript
authPlugin({
  extendUserList: {
    hooks: {
      afterOperation: async ({ operation, item, context }) => {
        if (operation === 'create') {
          console.log('New user created:', item.email)

          // Send welcome email
          await sendWelcomeEmail(item.email)
        }
      },
    },
  },
})
```

## OAuth/Social Login

Add OAuth providers for social login.

### Configure OAuth Providers

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
    twitter: {
      clientId: process.env.TWITTER_CLIENT_ID!,
      clientSecret: process.env.TWITTER_CLIENT_SECRET!,
    },
  },
})
```

Supported providers: `github`, `google`, `discord`, `twitter`

### Setting Up OAuth Apps

#### GitHub

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Create a new OAuth App
3. Set Authorization callback URL to: `http://localhost:3000/api/auth/callback/github`
4. Copy Client ID and Client Secret to `.env`

#### Google

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Set Authorized redirect URI to: `http://localhost:3000/api/auth/callback/google`
6. Copy Client ID and Client Secret to `.env`

### Using Social Login in UI

Enable social providers in your sign-in form:

```typescript
<SignInForm
  authClient={authClient}
  showSocialProviders={true}
  socialProviders={['github', 'google']}
/>
```

The form will automatically render OAuth buttons for the specified providers.

### Custom OAuth Button Styling

You can customize the OAuth buttons using CSS:

```css
.auth-provider-button {
  /* Your custom styles */
}

.auth-provider-button[data-provider='github'] {
  /* GitHub-specific styles */
}
```

## Email Verification & Password Reset

Configure email flows for verification and password reset.

### Email Configuration

```typescript
authPlugin({
  emailVerification: {
    enabled: true,
    sendOnSignUp: true, // Send verification email on sign-up
    tokenExpiration: 86400, // 24 hours
  },

  passwordReset: {
    enabled: true,
    tokenExpiration: 3600, // 1 hour
  },

  // Custom email sending function
  sendEmail: async ({ to, subject, html }) => {
    // Use your email service
    await resend.emails.send({
      from: 'noreply@yourapp.com',
      to,
      subject,
      html,
    })
  },
})
```

### Using Resend

```typescript
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

authPlugin({
  sendEmail: async ({ to, subject, html }) => {
    await resend.emails.send({
      from: 'onboarding@resend.dev',
      to,
      subject,
      html,
    })
  },
})
```

### Using SendGrid

```typescript
import sgMail from '@sendgrid/mail'

sgMail.setApiKey(process.env.SENDGRID_API_KEY!)

authPlugin({
  sendEmail: async ({ to, subject, html }) => {
    await sgMail.send({
      from: 'noreply@yourapp.com',
      to,
      subject,
      html,
    })
  },
})
```

### Development Mode

If no `sendEmail` function is provided, emails are logged to the console in development:

```
📧 Email would be sent to: user@example.com
Subject: Verify your email
Token: abc123def456
Verification link: http://localhost:3000/api/auth/verify-email?token=abc123def456
```

### Email Verification Flow

1. User signs up
2. Verification email sent with token
3. User clicks link: `/api/auth/verify-email?token=...`
4. Better-auth verifies token and marks email as verified
5. User can now sign in

### Password Reset Flow

1. User requests password reset
2. Reset email sent with token
3. User clicks link and enters new password
4. Better-auth verifies token and updates password
5. User can sign in with new password

## Auto-Generated Lists

The auth plugin automatically creates these lists in your database:

### User List

```typescript
{
  id: string              // Auto-generated UUID
  email: string           // Unique, required
  emailVerified: boolean  // Email verification status
  name: string | null     // Display name
  image: string | null    // Avatar URL
  createdAt: DateTime     // Auto-generated
  updatedAt: DateTime     // Auto-updated

  // Relationships
  sessions: Session[]     // User's sessions
  accounts: Account[]     // OAuth accounts

  // Custom fields from extendUserList
  ...customFields
}
```

**Access Control:**

- Query: Anyone
- Create: Anyone (sign-up)
- Update: Own user only
- Delete: Own user only

### Session List

```typescript
{
  id: string // Auto-generated UUID
  userId: string // Foreign key to User
  token: string // Session token (unique)
  expiresAt: DateTime // Session expiration
  ipAddress: string | null // Client IP
  userAgent: string | null // Client user agent
  createdAt: DateTime // Auto-generated
  updatedAt: DateTime // Auto-updated

  // Relationships
  user: User // Session owner
}
```

### Account List

Stores OAuth provider information and password hashes:

```typescript
{
  id: string // Auto-generated UUID
  userId: string // Foreign key to User
  accountId: string // Provider-specific user ID
  providerId: string // 'github', 'google', 'email-password'
  accessToken: string | null // OAuth access token
  refreshToken: string | null // OAuth refresh token
  expiresAt: DateTime | null // Token expiration
  password: string | null // Hashed password (for email/password)
  createdAt: DateTime // Auto-generated
  updatedAt: DateTime // Auto-updated

  // Relationships
  user: User // Account owner
}
```

### Verification List

Stores email verification and password reset tokens:

```typescript
{
  id: string // Auto-generated UUID
  identifier: string // Email address
  value: string // Token value
  expiresAt: DateTime // Token expiration
  createdAt: DateTime // Auto-generated
  updatedAt: DateTime // Auto-updated
}
```

## Best Practices

### Security

1. **Use Strong Secrets**

   ```bash
   # Generate with:
   openssl rand -base64 32
   ```

2. **Silent Failures**
   Access-denied operations return `null` or `[]` instead of throwing errors. This prevents information leakage about whether records exist:

   ```typescript
   const post = await context.db.post.update({ where: { id }, data })
   if (!post) {
     // Could mean: doesn't exist OR access denied
     return { error: 'Access denied' }
   }
   ```

3. **Never Expose Sensitive Fields**

   ```typescript
   fields: {
     password: password(), // Automatically excluded from reads
     apiKey: text({
       access: {
         read: ({ session, item }) => session?.userId === item.id,
       },
     }),
   }
   ```

4. **Validate on Both Client and Server**
   Always validate in server actions, even if client validates:
   ```typescript
   'use server'
   export async function createPost(data: unknown) {
     // Server-side validation
     const validated = postSchema.parse(data)
     // ...
   }
   ```

### Session Management

1. **Configure Session Expiration**

   ```typescript
   authPlugin({
     session: {
       expiresIn: 604800, // 7 days
       updateAge: true, // Extend expiry on each request
     },
   })
   ```

2. **Include Only Necessary Fields**
   Don't include sensitive data in session fields:
   ```typescript
   sessionFields: ['userId', 'email', 'name', 'role'], // Good
   sessionFields: ['userId', 'password', 'apiKey'], // Bad!
   ```

### Project Structure

Recommended structure for auth-enabled apps:

```
app/
├── sign-in/
│   └── page.tsx              # Sign in page
├── sign-up/
│   └── page.tsx              # Sign up page
├── forgot-password/
│   └── page.tsx              # Password reset request
├── admin/
│   └── [[...admin]]/
│       └── page.tsx          # Protected admin area
└── api/
    └── auth/
        └── [...all]/
            └── route.ts      # Auth API routes

lib/
├── auth.ts                   # Server auth instance
├── auth-client.ts            # Client auth instance
└── actions/
    └── *.ts                  # Server actions with auth

opensaas.config.ts            # Config with authPlugin
```

### Environment Variables

Always use environment variables for sensitive data:

```typescript
// Good
authPlugin({
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
  },
})

// Bad
authPlugin({
  socialProviders: {
    github: {
      clientId: 'hardcoded_client_id', // Never do this!
      clientSecret: 'hardcoded_secret',
    },
  },
})
```

### Error Handling

Handle auth errors gracefully:

```typescript
'use client'

export function SignInButton() {
  const [error, setError] = useState<string | null>(null)

  async function handleSignIn(email: string, password: string) {
    try {
      await authClient.signIn.email({ email, password })
      router.push('/admin')
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('An error occurred')
      }
    }
  }

  return (
    <div>
      {error && <div className="text-red-500">{error}</div>}
      {/* Form */}
    </div>
  )
}
```

## Complete Example

Here's a complete working example of an authenticated blog application:

```typescript
// opensaas.config.ts
import { config, list, text, select, relationship } from '@opensaas/stack-core'
import { authPlugin } from '@opensaas/stack-auth'
import type { AccessControl } from '@opensaas/stack-core'

// Access control helpers
const isSignedIn: AccessControl = ({ session }) => !!session

const isAuthor: AccessControl = ({ session, item }) => {
  if (!session) return false
  return { authorId: { equals: session.userId } }
}

export default config({
  plugins: [
    authPlugin({
      emailAndPassword: {
        enabled: true,
        minPasswordLength: 8,
      },
      passwordReset: {
        enabled: true,
      },
      sessionFields: ['userId', 'email', 'name'],
      extendUserList: {
        fields: {
          posts: relationship({
            ref: 'Post.author',
            many: true,
          }),
        },
      },
    }),
  ],

  db: {
    provider: 'sqlite',
    url: process.env.DATABASE_URL || 'file:./dev.db',
  },

  lists: {
    Post: list({
      fields: {
        title: text({
          validation: { isRequired: true },
        }),
        content: text({
          validation: { isRequired: true },
        }),
        status: select({
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
          defaultValue: 'draft',
        }),
        author: relationship({
          ref: 'User.posts',
        }),
      },
      access: {
        operation: {
          query: () => true,
          create: isSignedIn,
          update: isAuthor,
          delete: isAuthor,
        },
        filter: {
          query: ({ session }) => {
            if (!session) {
              return { status: { equals: 'published' } }
            }
            return {
              OR: [{ status: { equals: 'published' } }, { authorId: { equals: session.userId } }],
            }
          },
        },
      },
    }),
  },
})
```

```typescript
// lib/auth.ts
import { createAuth } from '@opensaas/stack-auth/server'
import config from '../opensaas.config'
import { rawOpensaasContext } from '@/.opensaas/context'
import { headers } from 'next/headers'

export const auth = createAuth(config, rawOpensaasContext)

export async function getAuth() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })
  return session
}

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

```typescript
// app/sign-in/page.tsx
import { SignInForm } from '@opensaas/stack-auth/ui'
import { authClient } from '@/lib/auth-client'

export default function SignInPage() {
  return (
    <div className="container mx-auto max-w-md py-16">
      <h1 className="text-3xl font-bold mb-8">Sign In</h1>
      <SignInForm
        authClient={authClient}
        redirectTo="/admin"
      />
    </div>
  )
}
```

```typescript
// app/admin/[[...admin]]/page.tsx
import { AdminUI } from '@opensaas/stack-ui'
import { getContext, config } from '@/.opensaas/context'
import { getAuth } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function AdminPage({ params, searchParams }) {
  const session = await getAuth()

  if (!session) {
    redirect('/sign-in')
  }

  return (
    <AdminUI
      context={await getContext(session.user)}
      config={await config}
      params={params.admin}
      searchParams={searchParams}
    />
  )
}
```

## Troubleshooting

### "Session is null" in Access Control

Make sure you're passing the session when creating the context:

```typescript
// ❌ Wrong
const context = await getContext()

// ✅ Correct
const session = await getAuth()
const context = await getContext(session?.user)
```

### OAuth Redirect Not Working

Check your OAuth app configuration:

1. Callback URL must match exactly: `http://localhost:3000/api/auth/callback/{provider}`
2. Environment variables are set correctly
3. App is approved/published (for Google)

### Email Verification Not Sending

1. Check if `sendEmail` function is configured
2. In development, check console for email logs
3. Verify email provider API keys are set

### "Access Denied" on All Operations

Check your access control configuration:

- Does the operation return `true` or a filter?
- Is the session being passed correctly?
- Are you checking the right session fields?

### TypeScript Errors on Session Fields

Make sure custom fields are included in `sessionFields`:

```typescript
authPlugin({
  sessionFields: ['userId', 'email', 'name', 'role'], // Include 'role'
  extendUserList: {
    fields: {
      role: select({
        /* ... */
      }),
    },
  },
})
```

## Next Steps

- **Package Reference**: See the [Auth Package docs](/docs/packages/auth) for detailed API reference
- **Access Control Guide**: Learn more in the [Access Control Guide](/docs/guides/access-control)
- **Working Example**: Check out the [auth-demo example](https://github.com/OpenSaasAU/stack/tree/main/examples/auth-demo)
- **Better Auth Docs**: Explore [Better-auth documentation](https://better-auth.com) for advanced features

You now have everything you need to implement secure authentication in your OpenSaaS Stack application!
