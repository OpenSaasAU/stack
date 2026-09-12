# OpenSaas Auth Demo

A complete example demonstrating authentication integration with OpenSaas Stack using `@opensaas/stack-auth` and better-auth.

## Features

- ✅ **Email/Password Authentication** - Sign up and sign in with email
- ✅ **Email Verification** - Verify email addresses (logged to console in dev)
- ✅ **Password Reset** - Forgot password flow
- ✅ **Session Management** - Automatic session handling with access control
- ✅ **Protected Routes** - Posts require authentication to create/edit
- ✅ **Author-Only Editing** - Only post authors can update their posts
- ✅ **Auto-Generated Auth Tables** - User, Session, Account, Verification

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Set Up Environment Variables

```bash
cp .env.example .env
```

Generate a secret key and add it to `.env`:

```bash
openssl rand -base64 32
```

### 3. Run Development Server

```bash
pnpm dev
```

`opensaas dev` starts the Dev database for this project, generates the schema and types (including the auth tables), reconciles the database with them, and then runs `next dev`.

Open [http://localhost:3003/sign-up](http://localhost:3003/sign-up) to create an account!

## Project Structure

```
examples/auth-demo/
├── app/
│   ├── api/auth/[...all]/route.ts  # Better-auth API routes
│   ├── sign-in/page.tsx             # Sign in page
│   ├── sign-up/page.tsx             # Sign up page
│   ├── forgot-password/page.tsx     # Password reset
│   └── admin/[[...admin]]/page.tsx  # Admin UI (protected)
├── lib/
│   ├── auth.ts                      # Auth server instance and session lookup
│   └── actions/                     # Auth, post and user server actions
├── opensaas.config.ts               # Config with authPlugin()
└── .env                             # Environment variables
```

## Access Control Rules

### User Model

- **Query**: Anyone can view users (to display author names)
- **Create**: Anyone can create a user (sign up)
- **Update**: Only the user themselves can update their record
- **Delete**: Only the user themselves can delete their record

### Post Model

- **Query**:
  - Anonymous users: Only see published posts
  - Authenticated users: See all posts
- **Create**: Must be signed in
- **Update**: Only the author can update
- **Delete**: Only the author can delete

### Field-Level Access

The `internalNotes` field on Post:

- **Read**: Only the author can see
- **Create**: Must be signed in — there is no `item` yet on create, and the
  author is whoever is creating the post
- **Update**: Only the author can modify

This demonstrates field-level access control - the field is stripped from the
row a non-author reads, rather than the read failing.

## Setup

### 1. Install Dependencies

From the repository root:

```bash
pnpm install
```

Build the core package:

```bash
cd packages/core
pnpm build
cd ../..
```

### 2. Configure Environment

```bash
cd examples/auth-demo
cp .env.example .env
```

Set `BETTER_AUTH_SECRET` to something of your own (`openssl rand -base64 32`).

`DATABASE_URL` is left unset, so `pnpm dev` runs the Dev database for this project.

### 3. Generate the Contract and Types

```bash
pnpm generate
```

This reads `opensaas.config.ts` and generates:

- `prisma/contract.ts` - the Contract module, with `prisma/contract.json` and `prisma/contract.d.ts` emitted beside it
- `prisma.config.ts` - Prisma CLI configuration
- `.opensaas/types.ts` - TypeScript types for your models and context

`pnpm dev` runs this for you, and reconciles the database with what it emits.
Commit everything but `.opensaas/`, which is regenerated.

### 4. Run the Development Server

```bash
pnpm dev
```

Then sign up at [http://localhost:3003/sign-up](http://localhost:3003/sign-up).

## Seeing Access Control Work

Sign up, then sign in, and the rules in `opensaas.config.ts` are visible in the
admin at [http://localhost:3003/admin](http://localhost:3003/admin). The admin
page refuses an anonymous visitor outright — it renders "Access Denied" instead
of the UI — so what it shows you is the signed-in half of the rules:

- **Signed in, not the author**: the post is readable, `internalNotes` is
  stripped from the row rather than the read failing, and update and delete
  return `null` — denied and not-found are deliberately indistinguishable.
- **The author**: reads and writes everything on their own posts, including
  `internalNotes`.
- **Session, Account and Verification** ship closed (ADR-0013), which is why
  they list as empty in the admin even to a signed-in user.

The anonymous rules — only published posts readable, `internalNotes` never
readable, nothing writable — are exercised through the server actions rather
than the admin. `examples/blog` carries a runnable suite over the same rules
(`pnpm --filter opensaas-blog-example test`).

## Example Server Actions

The example includes Server Actions demonstrating common operations:

### Create a Post

```typescript
import { createPost } from './lib/actions/posts'

const result = await createPost(userId, {
  title: 'Hello World',
  slug: 'hello-world',
  content: 'My first post',
})
```

### Update a Post

```typescript
import { updatePost } from './lib/actions/posts'

const result = await updatePost(userId, postId, {
  title: 'Updated Title',
})

// `success: false` if the user is not the author (silent failure)
```

### Publish a Post

```typescript
import { publishPost } from './lib/actions/posts'

const result = await publishPost(userId, postId)
```

### Get Published Posts

```typescript
import { getPublishedPosts } from './lib/actions/posts'

const posts = await getPublishedPosts()
// No authentication required
// Only returns published posts
```

## File Structure

```
examples/auth-demo/
├── opensaas.config.ts      # Schema definition with access control
├── lib/
│   ├── auth.ts             # Better-auth server instance and session lookup
│   └── actions/
│       ├── auth.ts         # Sign-in/sign-up/password-reset server actions
│       ├── posts.ts        # Post CRUD operations
│       └── users.ts        # User CRUD operations
├── types/session.d.ts      # Session shape the access rules read
├── prisma/
│   ├── contract.ts         # Generated Contract module
│   ├── contract.json       # Emitted contract artifact
│   └── contract.d.ts       # Emitted contract types
├── .opensaas/
│   └── types.ts            # Generated TypeScript types
└── package.json
```

## Key Concepts Demonstrated

### 1. Access Control Helpers

```typescript
const isSignedIn = ({ session }: Parameters<AccessControl>[0]): boolean => {
  return !!session
}

const isAuthor: AccessControl = ({ session }) => {
  if (!session) return false
  return {
    authorId: { equals: session.userId },
  }
}
```

The session shape they read is declared in `types/session.d.ts`, which augments
`Session` from `@opensaas/stack-core`.

### 2. Operation-Level Access

```typescript
access: {
  operation: {
    query: ({ session }) => {
      if (!session) {
        return { status: { equals: 'published' } }
      }
      return true
    },
    create: isSignedIn,
    update: isAuthor,
    delete: isAuthor,
  }
}
```

### 3. Field-Level Access

Field access is a per-field visibility decision, so it cannot honour the row
filter `isAuthor` returns — the per-field rules compare `item.authorId`
directly and answer a **boolean** per fetched item:

```typescript
internalNotes: text({
  access: {
    read: ({ session, item }) => !!session && session.userId === item!.authorId,
    create: isSignedIn,
    update: ({ session, item }) => !!session && session.userId === item!.authorId,
  },
})
```

The filter-returning `isAuthor` above is not assignable here. `FieldAccess`
from `@opensaas/stack-core` types the three slots (`read`, `create`, `update`)
as boolean-returning, so reusing `isAuthor` is a compile error and, untyped, an
`InvalidFieldAccessResultError` at runtime. `create` is `isSignedIn` because
there is no `item` yet on create — the author is whoever is creating the post.

### 4. Silent Failures

```typescript
const post = await context.db.Post.update({
  where: { id: postId },
  data: { title: 'New Title' },
})

if (!post) {
  // Either post doesn't exist OR user doesn't have access
  // No information leaked about which case it is
  return { error: 'Access denied' }
}
```

## Next Steps

- Add hooks for auto-setting timestamps
- Add OAuth providers (the `.env.example` carries commented GitHub and Google slots)
- Add a Next.js UI to display posts
- Implement pagination and filtering
- Add more field types (images, rich text, etc.)

## Database Management

Prisma 8 ships no Studio, so browse the data with any Postgres client
pointed at the connection string `pnpm dev` prints on startup (or at your
own `DATABASE_URL`):

```bash
psql "$DATABASE_URL"
```

Reset the database (stop `pnpm dev` first — the data directory is open while it runs):

```bash
rm -rf .opensaas/dev-db
```
