# Better-Auth Integration - Complete Implementation

This document summarizes the complete better-auth integration for OpenSaas Stack.

## ✅ What Was Implemented

### 1. New Package: `@opensaas/stack-auth`

**Location:** `packages/auth/`

A complete authentication package that integrates better-auth with OpenSaas Stack, providing:

- **Auto-generated auth tables** - User, Session, Account, Verification
- **Session integration** - Sessions automatically available in access control
- **Pre-built UI components** - SignInForm, SignUpForm, ForgotPasswordForm
- **Configurable sessions** - Choose which user fields to include
- **Extensible User model** - Add custom fields easily
- **Multiple auth methods** - Email/password, OAuth, verification, reset

### 2. Working Example: `examples/auth-demo`

A complete example application demonstrating:

- ✅ Sign up, sign in, forgot password pages
- ✅ Protected admin routes
- ✅ Author-only post editing
- ✅ Session-based access control
- ✅ Auto-generated auth tables
- ✅ Email verification (logged to console in dev)

## 🚀 Quick Start

### Setup (5 steps)

```bash
# 1. Wrap your config with withAuth()
# opensaas.config.ts
export default withAuth(
  config({ lists: { /* custom lists */ } }),
  authConfig({
    emailAndPassword: { enabled: true },
    sessionFields: ['userId', 'email', 'name'],
  })
)

# 2. Generate schema
pnpm generate

# 3. Create database
pnpm db:push

# 4. Add auth server (lib/auth.ts) and client (lib/auth-client.ts)
# 5. Use pre-built forms
```

### Try the Example

```bash
cd examples/auth-demo
pnpm install
pnpm generate
pnpm db:push
pnpm dev
# Visit http://localhost:3003/sign-up
```

## 📦 Package Structure

### Exports

**Main** (`@opensaas/stack-auth`):

```typescript
import { withAuth, authConfig } from '@opensaas/stack-auth'
```

**Server** (`@opensaas/stack-auth/server`):

```typescript
import { createAuth } from '@opensaas/stack-auth/server'
```

**Client** (`@opensaas/stack-auth/client`):

```typescript
import { createClient } from '@opensaas/stack-auth/client'
```

**UI** (`@opensaas/stack-auth/ui`):

```typescript
import { SignInForm, SignUpForm, ForgotPasswordForm } from '@opensaas/stack-auth/ui'
```

## 🎯 Key Features

### 1. Auto-Generated Auth Tables

When you use `withAuth()`, four tables are automatically added:

**User:**

- `id`, `name`, `email` (unique), `emailVerified`, `image`
- `sessions` (relationship), `accounts` (relationship)
- Plus custom fields via `extendUserList`

**Session:**

- `id`, `token` (unique), `expiresAt`
- `ipAddress`, `userAgent`
- `user` (relationship to User)

**Account:**

- `id`, `accountId`, `providerId`
- OAuth tokens: `accessToken`, `refreshToken`, etc.
- `password` (for credential provider)
- `user` (relationship to User)

**Verification:**

- `id`, `identifier`, `value`, `expiresAt`

### 2. Session Integration

Sessions are automatically available in all access control functions:

```typescript
// In opensaas.config.ts
authConfig({
  sessionFields: ['userId', 'email', 'name'],
})

// In access control
access: {
  operation: {
    create: ({ session }) => !!session,  // session = { userId, email, name }
    update: ({ session, item }) => {
      return session?.userId === item?.authorId
    }
  }
}
```

### 3. Extensible User Model

Add custom fields to the auto-generated User model:

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
      posts: relationship({ ref: 'Post.author', many: true }),
    },
  },
  sessionFields: ['userId', 'email', 'name', 'role'],
})
```

### 4. Pre-Built UI Components

Ready-to-use forms with customization options:

```typescript
<SignInForm
  authClient={authClient}
  redirectTo="/admin"
  showSocialProviders={true}
  socialProviders={['github', 'google']}
  onSuccess={() => console.log('Success!')}
  onError={(error) => console.error(error)}
/>
```

### 5. Multiple Auth Methods

Configure what you need:

```typescript
authConfig({
  emailAndPassword: { enabled: true, minPasswordLength: 8 },
  emailVerification: { enabled: true },
  passwordReset: { enabled: true },
  socialProviders: {
    github: { clientId: '...', clientSecret: '...' },
    google: { clientId: '...', clientSecret: '...' },
  },
})
```

## 📁 Files Created

### Package Files

```
packages/auth/
├── src/
│   ├── config/
│   │   ├── index.ts        # withAuth(), authConfig()
│   │   └── types.ts        # Configuration types
│   ├── lists/
│   │   └── index.ts        # User, Session, Account, Verification
│   ├── server/
│   │   └── index.ts        # createAuth()
│   ├── client/
│   │   └── index.ts        # createClient()
│   ├── ui/
│   │   ├── components/
│   │   │   ├── SignInForm.tsx
│   │   │   ├── SignUpForm.tsx
│   │   │   └── ForgotPasswordForm.tsx
│   │   └── index.ts
│   └── index.ts
├── package.json
├── tsconfig.json
├── README.md
└── INTEGRATION_SUMMARY.md
```

### Example Files

```
examples/auth-demo/
├── app/
│   ├── api/
│   │   └── auth/[...all]/route.ts  # Better-auth API handler
│   ├── sign-in/page.tsx
│   ├── sign-up/page.tsx
│   ├── forgot-password/page.tsx
│   └── admin/[[...admin]]/page.tsx
├── lib/
│   ├── auth.ts                      # Server auth instance
│   └── auth-client.ts               # Client for React hooks
├── opensaas.config.ts               # Config with withAuth()
├── .env
└── README.md
```

## 🔧 Usage Examples

### Configuration

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'
import { withAuth, authConfig } from '@opensaas/stack-auth'

export default withAuth(
  config({
    db: { provider: 'sqlite', url: 'file:./dev.db' },
    lists: {
      Post: list({
        fields: {
          /* ... */
        },
        access: {
          operation: {
            create: ({ session }) => !!session, // ✅ session available!
          },
        },
      }),
    },
  }),
  authConfig({
    emailAndPassword: { enabled: true },
    emailVerification: { enabled: true },
    sessionFields: ['userId', 'email', 'name'],
    extendUserList: {
      fields: {
        posts: relationship({ ref: 'Post.author', many: true }),
      },
    },
  }),
)
```

### Server Setup

```typescript
// lib/auth.ts
import { createAuth } from '@opensaas/stack-auth/server'
import config from '../opensaas.config'

export const auth = createAuth(config)
export const GET = auth.handler
export const POST = auth.handler

// app/api/auth/[...all]/route.ts
export { GET, POST } from '@/lib/auth'
```

### Client Setup

```typescript
// lib/auth-client.ts
'use client'
import { createClient } from '@opensaas/stack-auth/client'

export const authClient = createClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
})
```

### UI Pages

```typescript
// app/sign-in/page.tsx
import { SignInForm } from '@opensaas/stack-auth/ui'
import { authClient } from '@/lib/auth-client'

export default function SignInPage() {
  return <SignInForm authClient={authClient} redirectTo="/admin" />
}
```

## 🎨 Design Decisions

### 1. Why Better-Auth?

- TypeScript-first with full type safety
- Framework-agnostic (not tied to Next.js only)
- Simpler than NextAuth/Auth.js
- Modern security practices built-in
- No external service dependencies

### 2. Auto-Generation Pattern

All auth tables are auto-generated to:

- Reduce boilerplate
- Ensure schema consistency with better-auth
- Simplify updates (just upgrade package)
- Provide "batteries included" experience

Developers can still extend via `extendUserList`.

### 3. Configurable Session Fields

Instead of including all user data in session, developers choose what they need:

```typescript
sessionFields: ['userId', 'email', 'name']
// Session type: { userId: string, email: string, name: string }
```

This balances convenience with performance.

### 4. Component Registry Pattern

UI components follow the stack's registry pattern:

- Pre-built for common use cases
- Fully replaceable for custom designs
- Props-based customization for quick tweaks

## 🔒 Security

### Built-in Security Features

Better-auth provides:

- ✅ Bcrypt password hashing
- ✅ CSRF protection
- ✅ Secure session tokens
- ✅ XSS protection
- ✅ Rate limiting (configurable)

### Required Environment Variables

```bash
# Generate with: openssl rand -base64 32
BETTER_AUTH_SECRET=<strong-random-secret>
BETTER_AUTH_URL=https://your-domain.com
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

## 📚 Documentation

- **Package README:** `packages/auth/README.md`
- **Integration Summary:** `packages/auth/INTEGRATION_SUMMARY.md`
- **Example README:** `examples/auth-demo/README.md`

## ✨ What Makes This Integration Special

1. **Zero Boilerplate** - No manual User model, sessions, or routes needed
2. **Type-Safe** - Full TypeScript support throughout
3. **Framework-Aligned** - Follows OpenSaas architectural patterns
4. **Extensible** - Easy to customize and extend
5. **Production-Ready** - Security best practices built-in
6. **Developer Experience** - From zero to authenticated app in 5 steps

## 🎯 Next Steps (Future Enhancements)

Potential additions:

1. **Two-Factor Authentication** - Add 2FA via better-auth plugins
2. **Magic Links** - Passwordless email authentication
3. **Role-Based Access Control** - Built-in role helpers
4. **Admin UI Integration** - Show auth tables in admin panel
5. **Session Management UI** - View/revoke active sessions
6. **Audit Logging** - Track authentication events

## 🏁 Summary

The `@opensaas/stack-auth` package provides a complete, production-ready authentication solution that:

- Integrates seamlessly with OpenSaas Stack's access control system
- Follows the stack's config-first, type-safe design principles
- Reduces authentication setup from hours to minutes
- Provides excellent developer experience with pre-built components
- Maintains security best practices throughout

**Result:** Developers can build fully authenticated apps with OpenSaas in under 5 minutes! 🎉
