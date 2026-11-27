# OpenSaas Stack Starter (with Better-auth)

A starter template with authentication built in using Better-auth.

## What's Included

- **Better-auth integration** with email/password and OAuth
- **Sign in/Sign up UI** pre-built
- **Session management** automatic
- **Admin UI** at `/admin` for managing data
- **Procedures**: the post mutations at `/posts` are typed actions in `lib/procedures.ts`, called from a server action and from the browser
- **Protected routes** with session-based access control
- **Postgres** — the Dev database `pnpm dev` runs for you, or your own via `DATABASE_URL`
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

`BETTER_AUTH_URL` is also the one origin the procedure host (`lib/server.ts`) accepts cookie calls from. Unset or empty, it falls back to `http://localhost:3000` in development; in production the app throws when `lib/server.ts` loads, naming the variable, rather than accepting calls from localhost only.

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
- **Posts**: [http://localhost:3000/posts](http://localhost:3000/posts)

## How the app reaches the database

- `lib/procedures.ts` holds the actions: `createPost`, `updatePost`, `publishPost` and `deletePost`. Each declares its input and output schemas, its failures, an access rule that admits people on the web (`session?.actor?.kind === 'human'`) and `expose: ['web']`.
- `lib/server.ts` is the one module that imports the generated `getContext`. It exports `callProcedure` for server actions, `getServerContext()` for server components and the Admin UI, and the HTTP host that `app/api/procedures/[name]/route.ts` serves.
- `lib/actions/posts.ts` is a server action that only calls a procedure and redirects. `app/posts/post-controls.tsx` calls the procedures from the browser with the typed client.
- Reads stay on `context.db` in server components (`app/posts/page.tsx`).

The rules that must always hold, such as "only the author edits a post", live on the `Post` list's access control and hooks, not in the procedures: the Admin UI changes the same list without calling them.

`pnpm lint` runs `eslint.config.js`, which refuses any other import of `getContext` (and of `rawOpensaasContext` outside `lib/auth.ts`) allows `'use server'` only in `lib/actions/*.ts` and the admin page, and refuses `withSession` and `sudo` calls in those files. It covers `.ts`, `.tsx` and the JavaScript extensions alike. These rules are a guardrail, not a security boundary: they keep the wiring in one place by default, and access control is what protects the data. See [Procedures](https://stack.opensaas.au/docs/how-to/procedures).

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

// Server components, through lib/server.ts
const context = await getServerContext()
const userEmail = context.session?.email // ✅ Type: string
```

**To add more session fields:**

1. Add the field to User in `opensaas.config.ts`, protecting it with its own
   `access` right away — a field you add via `extendUserList` is app-authored,
   so `authPlugin({ fieldAccess })` (which only reaches a field better-auth
   itself derives) can't protect it; the field builder's own `access` is the
   seam for this one:

   ```typescript
   extendUserList: {
     fields: {
       role: select({
         options: [...],
         access: { update: ({ session }) => session?.role === 'admin' },
       })
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

**Why step 1 needed that `access`:** this config's `User` access grants a
whole-row owner-update rule (`update: ({ session, item }) => session?.userId
=== item.id`) — that says who may update the row, not which columns, so
without the field's own `access` a signed-in user could write `role: 'admin'`
to their own row through that same rule (issue #1618). See [Fields are
write-denied independent of operation
access](https://stack.opensaas.au/docs/reference/auth#fields-are-write-denied-independent-of-operation-access-adr-0073)
for the equivalent protection on a field better-auth itself derives (e.g. once
you register the `admin()` plugin).

## Learn More

- [Documentation](https://stack.opensaas.au/docs)
- [Better-auth Integration](https://stack.opensaas.au/docs/how-to/authentication)
- [Access Control](https://stack.opensaas.au/docs/concepts/access-control)

## Need Help?

- [GitHub Issues](https://github.com/OpenSaasAU/stack/issues)
- [Documentation](https://stack.opensaas.au/docs)
