# OpenSaas Stack Starter (with Better-auth)

A starter template with authentication built in using Better-auth.

## What's Included

- **Better-auth integration** with email/password and OAuth
- **Sign in/Sign up UI** pre-built
- **Session management** automatic
- **Admin UI** at `/admin` for managing data
- **Protected routes** with session-based access control
- **SQLite database** (easy to switch to PostgreSQL)
- **TypeScript** with full type safety
- **Next.js 16** with App Router

## Getting Started

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Set Up Environment Variables

Copy the example env file:

```bash
cp .env.example .env
```

Generate a random secret for Better-auth:

```bash
openssl rand -base64 32
```

Update `.env`:

```env
BETTER_AUTH_SECRET="your-generated-secret-here"
BETTER_AUTH_URL="http://localhost:3000"
```

Leave `DATABASE_URL` unset: `pnpm dev` runs the Dev database for this project.

### 3. Start Development Server

```bash
pnpm dev
```

`opensaas dev` starts the Dev database, generates the schema and types
(including the auth tables), reconciles the database with them, and then runs
`next dev`.

Visit:

- **Home**: [http://localhost:3000](http://localhost:3000)
- **Sign In**: [http://localhost:3000/sign-in](http://localhost:3000/sign-in)
- **Sign Up**: [http://localhost:3000/sign-up](http://localhost:3000/sign-up)
- **Admin UI**: [http://localhost:3000/admin](http://localhost:3000/admin)

## Session Type Safety

This starter includes typed session support for autocomplete and type checking. The session type is defined in `types/session.d.ts`:

```typescript
declare module '@opensaas/stack-core' {
  interface Session {
    userId: string
    email: string
    name: string
  }
}
```

This provides autocomplete everywhere sessions are used:

```typescript
// Access control - fully typed
const isSignedIn: AccessControl = ({ session }) => {
  return !!session?.userId // ✅ Autocomplete for userId, email, name
}

// Server actions
const context = await getContext(session)
const userEmail = context.session?.email // ✅ Type: string
```

**To add more session fields:**

1. Add the field to User in `opensaas.config.ts`:

   ```typescript
   extendUserList: {
     fields: {
       role: select({ options: [...] })
     }
   }
   ```

2. Include it in `sessionFields`:

   ```typescript
   sessionFields: ['userId', 'email', 'name', 'role']
   ```

3. Update `types/session.d.ts`:
   ```typescript
   interface Session {
     userId: string
     email: string
     name: string
     role: 'admin' | 'user' // Add this
   }
   ```

## Learn More

- [Documentation](https://stack.opensaas.au/docs)
- [Better-auth Integration](https://stack.opensaas.au/docs/how-to/authentication)
- [Access Control](https://stack.opensaas.au/docs/concepts/access-control)

## Need Help?

- [GitHub Issues](https://github.com/OpenSaasAU/stack/issues)
- [Documentation](https://stack.opensaas.au/docs)
