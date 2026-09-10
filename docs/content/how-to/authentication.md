# Authentication Guide

This guide covers everything you need to implement authentication in your Stack application using Better-auth integration.

## Introduction

Stack provides seamless authentication through the `@opensaas/stack-auth` package, which integrates [Better-auth](https://better-auth.com) with the stack's access control system. You get:

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
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { authPlugin } from '@opensaas/stack-auth'

export default config({
  plugins: [
    authPlugin({
      emailAndPassword: { enabled: true },
      sessionFields: ['userId', 'email', 'name'],
    }),
  ],
  db: { provider: 'postgresql' },
  lists: {
    Post: list({ fields: { title: text() } }),
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

Create a `.env` file with the following. Postgres is the only provider, and
`DATABASE_URL` is read from the environment rather than declared in your config —
omit it in local development and `opensaas dev` provisions a Dev database for you.

```bash
# Database
DATABASE_URL=postgresql://localhost:5432/myapp

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
import { config, list } from '@opensaas/stack-core'
import { text, relationship } from '@opensaas/stack-core/fields'
import { authPlugin } from '@opensaas/stack-auth'

export default config({
  plugins: [
    authPlugin({
      emailAndPassword: {
        enabled: true,
        minPasswordLength: 8,
        requireConfirmation: true,
      },
      passwordReset: {
        enabled: true,
        tokenExpiration: 3600,
      },
      sessionFields: ['userId', 'email', 'name'],
      extendUserList: {
        fields: {
          posts: relationship({ ref: 'Post.author', many: true }),
        },
      },
    }),
  ],

  db: { provider: 'postgresql' },

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

`sessionFields` names what lands on the `session` object your access rules see;
`extendUserList` adds fields to the plugin's own `User` list. Token expirations
are in seconds. The `db` block carries the provider and nothing about the
connection — see the [Config API](/docs/reference/config-api#db) for its
complete key list.

### 4. Generate Database Schema

```bash
pnpm generate
```

`pnpm dev` applies the change, creating the auth tables (User, Session, Account,
Verification) in your database. If it is already running, it applies them as
soon as you save the config.

## Creating Authentication Pages

### Server Setup

Create a server-side auth instance.

`getSessionFromAuth()` is what turns better-auth's own resolved session into the
flat `Session` object the stack's access rules read — it projects exactly the
names you listed in `sessionFields`, reading them from the resolved config at
runtime, so changing `sessionFields` takes effect without regenerating this file.
It returns `null` only when there is genuinely no session. Pass its result
straight to `getContext()`:

```typescript
// lib/auth.ts
import { createAuth, getSessionFromAuth } from '@opensaas/stack-auth/server'
import type { NormalizedAuthConfig } from '@opensaas/stack-auth'
import type { Session } from '@opensaas/stack-core'
import config from '../opensaas.config'
import { headers } from 'next/headers'
import { rawOpensaasContext } from '@/.opensaas/context'

export const auth = createAuth(config, rawOpensaasContext)

export async function getSession(): Promise<Session | null> {
  const resolvedConfig = await config
  const authConfig = resolvedConfig._pluginData?.auth as NormalizedAuthConfig | undefined
  const sessionFields = authConfig?.sessionFields ?? ['userId', 'email', 'name']
  return getSessionFromAuth(auth, sessionFields, await headers())
}

export const GET = auth.handler
export const POST = auth.handler
```

`createAuth()` takes the `rawOpensaasContext` **promise** — do not await it at
module scope. It defers construction behind a lazy proxy until the config and the
client are ready.

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

Stack doesn't use Next.js middleware for authentication. Instead, protect routes at the page/component level by checking the session.

### Protecting Admin Pages

Redirect or render a refusal when `getSession()` returns `null`, then hand the
session to `getContext()`. The generated `config` export is a promise, so it is
awaited alongside the context:

```typescript
// app/admin/[[...admin]]/page.tsx
import { AdminUI } from '@opensaas/stack-ui'
import { getContext, config } from '@/.opensaas/context'
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'

interface AdminPageProps {
  params: Promise<{ admin?: string[] }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function AdminPage({ params, searchParams }: AdminPageProps) {
  const session = await getSession()

  if (!session) {
    redirect('/sign-in')
  }

  return (
    <AdminUI
      context={await getContext(session)}
      config={await config}
      params={(await params).admin}
      searchParams={await searchParams}
      basePath="/admin"
    />
  )
}
```

### Protecting Server Actions

A write returns the row or `null` — `null` covers both "denied" and "no such
row", deliberately, so the caller cannot tell which. Check it before treating the
write as done. The relation field takes `{ connect: { id } }`; there is no nested
create:

```typescript
// lib/actions/posts.ts
'use server'

import { getContext } from '@/.opensaas/context'
import { getSession } from '@/lib/auth'

export async function createPost(title: string) {
  const session = await getSession()

  if (!session) {
    return { success: false, error: 'Not authenticated' }
  }

  const context = await getContext(session)

  const post = await context.db.Post.create({
    data: {
      title,
      author: { connect: { id: String(session.userId) } },
    },
  })

  if (post === null) {
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
import { getSession } from '@/lib/auth'

export default async function MyPage() {
  const session = await getSession()

  if (!session) {
    return <div>Not signed in</div>
  }

  return (
    <div>
      <h1>Welcome, {String(session.name)}!</h1>
      <p>Email: {String(session.email)}</p>
    </div>
  )
}
```

The object `getSession()` returns is **flat** — one key per name in
`sessionFields`, projected off better-auth's own resolved session. With
`sessionFields: ['userId', 'email', 'name']` it is:

```typescript
{
  userId: string
  email: string
  name: string
}
```

This is the same object your access rules receive as `session`, which is why they
read `session.userId` rather than `session.user.id`. `userId` is special-cased to
the authenticated user's `id`; every other name resolves against the first hit in
the resolved session's top-level keys, then its `user` object, then its `session`
sub-object — so a session-only field like the admin plugin's `impersonatedBy` is
reachable too. A name that resolves nowhere is omitted and logs a warning once
per process, rather than silently surfacing as `undefined` inside an access rule.

If you need better-auth's own nested `{ user, session }` shape — its `token`,
`expiresAt`, `ipAddress` and `userAgent` — call `auth.api.getSession()` directly
alongside `getSession()`.

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

A list's `access` carries exactly one member, `operation`, with a rule per
operation. `create` must return a boolean — there is no row to test yet, so a
filter result throws `InvalidCreateAccessResultError` rather than being taken as
an allow. `query`, `update` and `delete` may return either a boolean or a filter:

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
      query: () => true,
      create: ({ session }) => !!session,
      update: ({ session }) => (session ? { authorId: { equals: session.userId } } : false),
      delete: ({ session }) => (session ? { authorId: { equals: session.userId } } : false),
    },
  },
})
```

### Scoping rows with a returned filter

There is no separate `filter` block. A rule scopes rows by **returning** a
Prisma-shaped filter, which is ANDed into whatever `where` the caller supplied —
so a rule can only ever narrow what a session sees, never widen it:

```typescript
Post: list({
  access: {
    operation: {
      query: ({ session }) =>
        session
          ? {
              OR: [{ status: { equals: 'published' } }, { authorId: { equals: session.userId } }],
            }
          : { status: { equals: 'published' } },
    },
  },
})
```

Write the anonymous branch out explicitly, as above. A rule spelled
`({ session }) => ({ authorId: { equals: session?.userId } })` does **not** fall
back to an open read: an `undefined` condition is refused with an
`UndefinedAccessFilterError`, never dropped, so the read fails closed.

The filter vocabulary is a closed set — `equals`, `not`, `in`, `notIn`, `lt`,
`lte`, `gt`, `gte`, `contains` on a scalar; `some`, `every`, `none` on a
relationship; `AND`, `OR`, `NOT`. A bare value means equality, and `contains` is
case-insensitive. There is no `startsWith`, `endsWith` or `mode`.

### Field-Level Access Control

Field rules are declared on the field and return a **boolean only** — a field
decision is per-field visibility, not a row filter, and a non-boolean result
throws `InvalidFieldAccessResultError`. A denied field is stripped from the
returned row; the rest of the row comes back normally:

```typescript
Post: list({
  fields: {
    title: text(),
    content: text(),
    internalNotes: text({
      access: {
        read: ({ session, item }) => session?.userId === item.authorId,
        create: ({ session }) => !!session,
        update: ({ session, item }) => session?.userId === item.authorId,
      },
    }),
  },
})
```

### Access Control Helpers

Extract the rules you repeat. `AccessControl` is the type for an operation-level
rule, so `isAuthor` below can return a filter while `isSignedIn` and `isAdmin`
return booleans:

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import type { AccessControl } from '@opensaas/stack-core'

const isSignedIn: AccessControl = ({ session }) => !!session

const isAuthor: AccessControl = ({ session }) =>
  session ? { authorId: { equals: session.userId } } : false

const isAdmin: AccessControl = ({ session }) => session?.role === 'admin'

export default config({
  db: { provider: 'postgresql' },
  lists: {
    Post: list({
      fields: { title: text() },
      access: {
        operation: {
          create: isSignedIn,
          update: isAuthor,
          delete: isAuthor,
        },
      },
    }),
  },
})
```

`isSignedIn` and `isAdmin` are safe on `create`; `isAuthor` is not, because it
returns a filter. Reach for the boolean form wherever a rule may land on
`create`.

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
      role: select({/* ... */}),
      company: text(),
    },
  },
})
```

`session.role` is now available in every access control function:

```typescript
access: {
  operation: {
    delete: ({ session }) => session?.role === 'admin',
  },
}
```

### Custom Access Control on User List

The User list ships closed by default (see
[Access control: closed by default](#access-control-closed-by-default)).
`extendUserList.access` is the User-specific way to grant it — it predates
the more general `authPlugin({ access: { user: ... } })` passthrough and
takes precedence over `access.user` when both are set:

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

Add lifecycle hooks to the User list. `afterOperation`'s arguments are a union
over the operation — only `create` and `update` carry `item`, and `delete`
carries `originalItem` instead — so narrow on `args.operation` before reaching
for a row:

```typescript
authPlugin({
  extendUserList: {
    hooks: {
      afterOperation: async (args) => {
        if (args.operation !== 'create') return
        await sendWelcomeEmail(args.item.email)
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

`sendResetPassword`/`sendVerificationEmail` are forwarded straight through to better-auth's own `emailAndPassword`/`emailVerification` options — no stack wrapping. Each receives exactly what better-auth passes (`user`, `url`, `token`), so you build the subject line and body yourself:

```typescript
authPlugin({
  emailVerification: {
    enabled: true,
    sendOnSignUp: true, // Send verification email on sign-up
    tokenExpiration: 86400, // 24 hours
    sendVerificationEmail: async ({ user, url }) => {
      await resend.emails.send({
        from: 'noreply@yourapp.com',
        to: user.email,
        subject: 'Verify your email',
        html: `<a href="${url}">Verify your email</a>`,
      })
    },
  },

  passwordReset: {
    enabled: true,
    tokenExpiration: 3600, // 1 hour
  },

  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      await resend.emails.send({
        from: 'noreply@yourapp.com',
        to: user.email,
        subject: 'Reset your password',
        html: `<a href="${url}">Reset your password</a>`,
      })
    },
  },
})
```

### Using Resend

```typescript
import { Resend } from 'resend'
import { authPlugin } from '@opensaas/stack-auth'

const resend = new Resend(process.env.RESEND_API_KEY)

authPlugin({
  emailVerification: {
    enabled: true,
    sendVerificationEmail: async ({ user, url }) => {
      await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: user.email,
        subject: 'Verify your email',
        html: `<a href="${url}">Verify your email</a>`,
      })
    },
  },
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: user.email,
        subject: 'Reset your password',
        html: `<a href="${url}">Reset your password</a>`,
      })
    },
  },
})
```

### Using SendGrid

```typescript
import sgMail from '@sendgrid/mail'
import { authPlugin } from '@opensaas/stack-auth'

sgMail.setApiKey(process.env.SENDGRID_API_KEY!)

authPlugin({
  emailVerification: {
    enabled: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sgMail.send({
        from: 'noreply@yourapp.com',
        to: user.email,
        subject: 'Verify your email',
        html: `<a href="${url}">Verify your email</a>`,
      })
    },
  },
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      await sgMail.send({
        from: 'noreply@yourapp.com',
        to: user.email,
        subject: 'Reset your password',
        html: `<a href="${url}">Reset your password</a>`,
      })
    },
  },
})
```

### Development Mode

If no `sendVerificationEmail`/`sendResetPassword` callback is provided, emails are logged to the console in development:

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

## Adopting an Existing better-auth Installation

If you are migrating a project that **already runs better-auth** — its tables
exist, hold live data, and you don't want a destructive auth migration — the
plugin can adopt those tables instead of recreating them. This is the common
case when migrating an established app to Stack.

### App `User` vs the Auth identity

A migrating app almost always has **two** distinct concepts, and conflating them
is the main pitfall:

- **The application's domain `User`** — your own model (`public.User`), keyed
  however your app likes (e.g. a `subjectId`), carrying your domain fields
  (profile, billing, roles, relationships to your other lists).
- **The Auth identity** — the better-auth-owned user record (`AuthUser`), the
  thing a session belongs to. It owns sessions, OAuth accounts, and credentials.

The auth plugin models the **Auth identity** (the `User`/`Session`/`Account`/
`Verification` lists better-auth needs). It does **not** assume its user list is
your app's `User`. As long as the plugin's user model key differs from your app
list's key (e.g. the plugin uses `AuthUser` while your app keeps `User`), your
domain `User` is left completely untouched — never extended, never overwritten.

{% callout type="info" %}
Keep these separate. The plugin owns the Auth identity; your app owns its domain
`User`. **Linking the two is your application's concern** — see [Linking your
app User to the Auth identity](#linking-your-app-user-to-the-auth-identity)
below.
{% /callout %}

### The `adoptBetterAuthTables()` recipe

Rather than hand-write the four `modelName`s and a `schema` on every model, use
the `adoptBetterAuthTables()` recipe. It returns an auth-config fragment with the
adoption knobs already set to the conventions of a standard separate-schema
better-auth install, and you spread it into `authPlugin` alongside the rest of
your config:

The spread supplies the adoption defaults — `AuthUser`/`AuthSession`/
`AuthAccount`/`AuthVerification` in the `auth` Postgres schema, matching a live
better-auth install — and the rest of your auth config composes on top of it as
normal. Your own domain `User` stays in `public` and is not touched by the
plugin:

```typescript
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { authPlugin, adoptBetterAuthTables } from '@opensaas/stack-auth'

export default config({
  db: { provider: 'postgresql' },
  plugins: [
    authPlugin({
      ...adoptBetterAuthTables(),
      emailAndPassword: { enabled: true },
      sessionFields: ['userId', 'email', 'name'],
    }),
  ],
  lists: {
    User: list({
      fields: {
        subjectId: text({ validation: { isRequired: true } }),
      },
    }),
  },
})
```

With these defaults the plugin derives `AuthUser`/`AuthSession`/`AuthAccount`/
`AuthVerification`, pins each to its live table name (`@@map`) and the `auth`
schema (`@@schema`), and wires Postgres multi-schema automatically. The generated
Auth lists therefore reach **Schema parity** — they diff clean against your live
tables, so adding the plugin produces **no destructive auth migration**. The
lists are modelled for runtime and types, not migrated.

Regenerate, then diff the result against your live database with your project's
own `prisma migrate diff` setup — the auth tables should report no changes:

```bash
pnpm generate
```

### Customising the recipe

The recipe takes options when your live tables diverge from the defaults:

```typescript
adoptBetterAuthTables({
  // Postgres schema the live tables live in (default: 'auth')
  schema: 'identity',

  // Prefix applied to each model name (default: 'Auth' → AuthUser/AuthSession/…)
  modelNamePrefix: 'BA', // → BAUser/BASession/BAAccount/BAVerification

  // Column renames, only where your live columns differ from better-auth defaults
  fields: {
    user: { name: 'full_name', emailVerified: 'is_verified' },
    session: { userId: 'user_id' },
  },
})
```

The recipe is just a convenience over the plugin's own `schema` / per-model
`modelName` / `fields` options — anything it sets you can also set directly on
`authPlugin`, or override after spreading it in.

If your live install also runs better-auth's database-backed rate limiter,
opt the recipe into adopting that table too with `rateLimit: true` — it's
`false` by default since most installs use the in-memory limiter:

```typescript
adoptBetterAuthTables({ rateLimit: true })
// → adds rateLimit: { enabled: true, storage: 'database', modelName: 'AuthRateLimit' }
```

### Adopting better-auth's default table names

The most common migration shape isn't the renamed-table one above — it's a
project that ran better-auth **before** adding Stack, so its tables are
still better-auth's own default lowercase names (`user`, `session`,
`account`, `verification`). Your app almost always also has its own domain
`User`, so the Auth identity still needs a prefixed list key (`AuthUser`) to
avoid a collision — but that prefixed key must map to the _unprefixed_ live
table, not a table named `AuthUser`.

`modelName` and the physical table name are independent for exactly this
reason: `modelName` sets the list key, and a separate `tableName` pins the
`@@map`. Pass `useBetterAuthTableNames: true` to point every model's table
name at better-auth's own defaults while keeping the `Auth`-prefixed list
keys:

```typescript
authPlugin({
  ...adoptBetterAuthTables({ schema: 'auth', useBetterAuthTableNames: true }),
  emailAndPassword: { enabled: true },
})
// List keys: AuthUser / AuthSession / AuthAccount / AuthVerification
// Live tables: user / session / account / verification (via @@map)
```

For a mix — most tables use better-auth's defaults but one was renamed — use
the per-model `tableNames` escape hatch instead (it takes precedence over
`useBetterAuthTableNames` for any model it names):

```typescript
adoptBetterAuthTables({
  useBetterAuthTableNames: true,
  tableNames: { user: 'app_users' }, // only the user table was renamed
})
```

The same knob is available directly on `authPlugin` without the recipe, for a
single model:

```typescript
authPlugin({
  user: { modelName: 'AuthUser', tableName: 'user' },
  session: { modelName: 'AuthSession', tableName: 'session' },
  account: { modelName: 'AuthAccount', tableName: 'account' },
  verification: { modelName: 'AuthVerification', tableName: 'verification' },
})
```

With no `tableName` set, behaviour is unchanged from before this option
existed: the table name follows `modelName` whenever it differs from the
better-auth default, so a renamed-table install (the `adoptBetterAuthTables()`
default from the previous section) keeps working without any changes.

### Adopting a live constraint name or adding your own index (`indexes`)

Each per-model block (`user`/`session`/`account`/`verification`/`rateLimit`)
also accepts `indexes`, in the same shape as a list's own `db.indexes` (see
the [`db.indexes` reference](/docs/reference/config-api#dbindexes)) — entries
name the model's own field keys, not raw column names.

The stack already derives some indexes from better-auth's own table
definitions — `User.email` and `Session.token` are unique, for example. If
your live database's constraint has a different name than the one Prisma
would derive, adopting it under its real name is a generate-clean diff away:

```typescript
authPlugin({
  user: { indexes: [{ fields: ['email'], unique: true, name: 'user_email_key' }] },
  session: { indexes: [{ fields: ['token'], unique: true, name: 'session_token_key' }] },
})
```

An entry covering a column the stack already derives an index for **replaces**
that derived index rather than erroring — your declaration wins. This is the
opposite of `db.indexes` on a list you declare yourself, where a collision
with a field's own `isIndexed` is a config-time error: here, one of the two
declarations is derived, so there's nothing of yours to remove.

The same seam lets you extend a derived column into a composite index — e.g.
a per-identifier resend-cooldown check on the verification table:

```typescript
authPlugin({
  verification: {
    indexes: [{ fields: ['identifier', 'createdAt'] }],
  },
})
```

This suppresses the derived single-column index on `identifier` in favor of
the composite, which serves the same lookups. Suppression is per-column: every
other index the stack derives for that model is unaffected.

An index column carries no sort direction — `{ field: 'createdAt', sort: 'desc' }`
is refused at generate time. The index keeps the column order you declared, which
is what serves the lookup.

### Linking your app User to the Auth identity

Because the Auth identity (`AuthUser`) and your domain `User` are separate
models, **your application declares the link** — the plugin never imposes a
single-User-model assumption. Add a relationship from your domain `User` to the
Auth identity:

```typescript
lists: {
  User: list({
    fields: {
      subjectId: text({ validation: { isRequired: true } }),
      // The app owns the link to the Auth identity:
      authIdentity: relationship({ ref: 'AuthUser' }),
    },
  }),
}
```

Then resolve from a session's `userId` (the Auth identity's id) to your domain
`User` in your own code — e.g. look up the domain `User` whose `authIdentity`
points at `session.userId`. How you key and resolve that link is entirely up to
your app.

## Auto-Generated Lists

The auth plugin automatically creates these lists in your database:

### Access control: closed by default

Per [ADR-0013](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0013-access-control-belongs-to-the-application-not-plugins.md),
access control belongs to the application, not the plugin. The four Auth
lists (User/Session/Account/Verification) ship with **no** operation-level
access — with nothing configured, `context.db` reads/writes against them
return `null`/`[]` and they don't appear in the admin UI. This does not affect
sign-in/sign-up/session flows: better-auth talks to these tables through its own
adapter, outside access control entirely.

Grant access explicitly with `authPlugin({ access: { … } })`, keyed by
better-auth model name (`user`/`session`/`account`/`verification`, not the
derived list key — so it keeps working if you rename a model via `modelName`).
Each entry is a list access config: an `operation` block, and nothing else.

Below, signed-in users can browse the directory but only write themselves;
sessions and accounts are scoped to their owner by a returned filter. Crossing
the `user` relationship needs a quantifier — `some` here — because a
relationship key in a filter takes only `some`, `every` or `none`. Verification
tokens stay closed: better-auth manages them directly.

```typescript
authPlugin({
  access: {
    user: {
      operation: {
        query: ({ session }) => !!session,
        update: ({ session, item }) => session?.userId === item.id,
        delete: ({ session, item }) => session?.userId === item.id,
      },
    },
    session: {
      operation: {
        query: ({ session }) =>
          session ? { user: { some: { id: { equals: session.userId } } } } : false,
      },
    },
    account: {
      operation: {
        query: ({ session }) =>
          session ? { user: { some: { id: { equals: session.userId } } } } : false,
      },
    },
  },
})
```

There is no `fields` block here, and none is needed for the credential columns:
`Account.accessToken`/`refreshToken`/`password`, `Session.token` and
`Verification.value` ship field-level read-denied already (ADR-0036), so granting
operation access above does **not** expose them. See [Credential fields are
read-denied](/docs/reference/auth#credential-fields-are-read-denied-adr-0036) for
the full set. To deny a further field, declare the rule on the field itself —
via `extendUserList.fields` for the `User` list.

For the `user` model specifically, `extendUserList.access` (the pre-existing
User customization surface — see
[Custom Access Control on User List](#custom-access-control-on-user-list))
is still honored and takes precedence over `access.user` if both are set.

**Migrating from an older version:** if you relied on the previous permissive
defaults (`query: () => true`, self-only update/delete on User; session-owner
filters on Session/Account; closed Verification), add the equivalent under
`authPlugin({ access: { ... } })` — the first three blocks above reproduce
that behavior for `user`/`session`/`account`. Without it, `context.db` reads
on these lists (and their admin UI pages) go from visible to empty.

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

**Access Control:** closed by default (see
[Access control: closed by default](#access-control-closed-by-default) above)
— grant it via `authPlugin({ access: { user: { ... } } })` or
`extendUserList.access`. Sign-up still works with no access configured:
better-auth creates the row through the raw client, bypassing access control.

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

**Access Control:** closed by default — grant it via `authPlugin({ access: { session: { ... } } })`.

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

**Access Control:** closed by default — grant it via `authPlugin({ access: { account: { ... } } })`.
Consider hiding `accessToken`/`refreshToken`/`password` at the field level
even when you grant operation access (see the example above).

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

**Access Control:** closed by default — better-auth manages these tokens
directly through the raw client, so most apps never need to grant
`access.verification` at all.

### RateLimit List

Only present when `rateLimit.storage: 'database'` is set — mirrors better-auth's
own rate-limit table exactly, so no `createdAt`/`updatedAt` and no defaults on
any column (the limiter supplies `lastRequest` explicitly on every write):

```typescript
{
  id: string // Auto-generated UUID
  key: string // Unique — the rate-limit bucket key (e.g. "ip|/sign-in/email")
  count: number // Requests seen in the current window
  lastRequest: bigint // Millisecond epoch of the last request
}
```

```typescript
authPlugin({
  rateLimit: { enabled: true, storage: 'database' },
})
```

**Access Control:** closed by default — grant it via `authPlugin({ access: { rateLimit: { ... } } })` (e.g. to inspect throttled keys in the Admin UI).

## Best Practices

### Security

1. **Use Strong Secrets**

   ```bash
   # Generate with:
   openssl rand -base64 32
   ```

2. **Silent Failures**
   Access-denied operations return `null` (a single row), `[]` (a list) or a
   zeroed aggregate instead of throwing. There is no `AccessDeniedError` to
   catch — a `null` covers both "no such row" and "not allowed", and that
   ambiguity is the point:

   ```typescript
   const post = await context.db.Post.update({ where: { id }, data })
   if (post === null) {
     return { error: 'Access denied' }
   }
   ```

3. **Never Expose Sensitive Fields**
   A `password()` field is excluded from reads for you. Anything else you want
   hidden needs its own field-level `read` rule, which returns a boolean:

   ```typescript
   fields: {
     password: password(),
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
       updateAge: 86400, // Refresh session every 1 day; set `false` to disable
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

The `User` list ships closed by default (ADR-0013), so the config grants it
explicitly. `Post.query` scopes reads by returning a filter rather than declaring
one in a separate block:

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'
import { text, select, relationship } from '@opensaas/stack-core/fields'
import { authPlugin } from '@opensaas/stack-auth'
import type { AccessControl } from '@opensaas/stack-core'

const isSignedIn: AccessControl = ({ session }) => !!session

const isAuthor: AccessControl = ({ session }) =>
  session ? { authorId: { equals: session.userId } } : false

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
      access: {
        user: {
          operation: {
            query: isSignedIn,
            update: ({ session, item }) => session?.userId === item.id,
          },
        },
      },
    }),
  ],

  db: { provider: 'postgresql' },

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
          query: ({ session }) =>
            session
              ? {
                  OR: [
                    { status: { equals: 'published' } },
                    { authorId: { equals: session.userId } },
                  ],
                }
              : { status: { equals: 'published' } },
          create: isSignedIn,
          update: isAuthor,
          delete: isAuthor,
        },
      },
    }),
  },
})
```

```typescript
// lib/auth.ts
import { createAuth, getSessionFromAuth } from '@opensaas/stack-auth/server'
import type { NormalizedAuthConfig } from '@opensaas/stack-auth'
import type { Session } from '@opensaas/stack-core'
import config from '../opensaas.config'
import { rawOpensaasContext } from '@/.opensaas/context'
import { headers } from 'next/headers'

export const auth = createAuth(config, rawOpensaasContext)

export async function getSession(): Promise<Session | null> {
  const resolvedConfig = await config
  const authConfig = resolvedConfig._pluginData?.auth as NormalizedAuthConfig | undefined
  const sessionFields = authConfig?.sessionFields ?? ['userId', 'email', 'name']
  return getSessionFromAuth(auth, sessionFields, await headers())
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
import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'

interface AdminPageProps {
  params: Promise<{ admin?: string[] }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function AdminPage({ params, searchParams }: AdminPageProps) {
  const session = await getSession()

  if (!session) {
    redirect('/sign-in')
  }

  return (
    <AdminUI
      context={await getContext(session)}
      config={await config}
      params={(await params).admin}
      searchParams={await searchParams}
      basePath="/admin"
    />
  )
}
```

## Troubleshooting

### "Session is null" in Access Control

Make sure you're passing the session when creating the context, and that you're
passing the flat projection `getSession()` returns rather than better-auth's
nested `{ user, session }` object — access rules read `session.userId`, which only
the projection carries:

```typescript
// ❌ Anonymous — no session reaches the access rules
const context = await getContext()

// ✅ Correct
const session = await getSession()
const context = await getContext(session ?? undefined)
```

### OAuth Redirect Not Working

Check your OAuth app configuration:

1. Callback URL must match exactly: `http://localhost:3000/api/auth/callback/{provider}`
2. Environment variables are set correctly
3. App is approved/published (for Google)

### Email Verification Not Sending

1. Check if `emailVerification.sendVerificationEmail` (or `emailAndPassword.sendResetPassword` for password reset) is configured
2. In development, check console for email logs
3. Verify email provider API keys are set

### "Access Denied" on All Operations

Check your access control configuration:

- Does the operation return `true` or a filter?
- Is the session being passed correctly?
- Are you checking the right session fields?
- If this is one of the Auth lists (User/Session/Account/Verification): they
  ship closed by default (ADR-0013) — see
  [Access control: closed by default](#access-control-closed-by-default). Add
  `authPlugin({ access: { user: { ... } } })` (or the matching model key) to
  open it up.

### TypeScript Errors on Session Fields

Make sure custom fields are included in `sessionFields`:

```typescript
authPlugin({
  sessionFields: ['userId', 'email', 'name', 'role'], // Include 'role'
  extendUserList: {
    fields: {
      role: select({/* ... */}),
    },
  },
})
```

## Next Steps

- **Package Reference**: See the [Auth Package docs](/docs/reference/auth) for detailed API reference
- **Access Control Guide**: Learn more in the [Access Control Guide](/docs/concepts/access-control)
- **Working Example**: Check out the [auth-demo example](https://github.com/OpenSaasAU/stack/tree/main/examples/auth-demo)
- **Better Auth Docs**: Explore [Better-auth documentation](https://better-auth.com) for advanced features

You now have everything you need to implement secure authentication in your Stack application!
