# OpenSaas Blog Example

This is a working example demonstrating the OpenSaas stack with a simple blog application.

## Schema

This example includes five lists:

- **User**: Users who can create blog posts
- **Post**: Blog posts with title, content, status, and internal notes
- **Tag**: A label a post can carry
- **PostTag**: One edge of the Post↔Tag many-to-many — adding a tag is a create
  of this row under its own access, not a nested write on either side
- **Settings**: A singleton, reached with `context.db.Settings.get()`

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
cd examples/blog
cp .env.example .env
```

`DATABASE_URL` is left unset, so `pnpm dev` runs the Dev database for this project.

### 3. Generate the Contract and Types

```bash
pnpm generate
```

This reads `opensaas.config.ts` and generates:

- `prisma/contract.ts` - the Contract module, with `prisma/contract.json` and `prisma/contract.d.ts` emitted beside it
- `prisma.config.ts` - Prisma CLI configuration
- `.opensaas/types.ts` - TypeScript types for your models and context

Commit everything but `.opensaas/`, which is regenerated.

### 4. Run the Development Server

```bash
pnpm dev
```

`opensaas dev` starts the Dev database, generates, reconciles the database with
what it emits, and then runs `next dev`. Steps 2 and 3 are what it does for you
on every start and on every edit to `opensaas.config.ts`.

## Testing Access Control

`test-access-control.ts` is the suite, and `pnpm test` runs it:

```bash
pnpm test
```

That is `opensaas dev -- tsx test-access-control.ts`, so the Dev database is up
and reconciled before the script starts and stopped again when it exits — you
do not need `pnpm dev` running in another terminal. Set `DATABASE_URL` to run
the same suite against a Postgres of your own.

It reads and writes through the same `getContext` a server action uses, and
covers every path the rules below describe:

- anonymous reads are scoped to published posts, and anonymous writes are
  denied silently
- a signed-in non-author reads a draft but cannot update or delete it, and
  never sees `internalNotes`
- the author reads and writes `internalNotes`, publishes, and reaches the
  post's tags through the junction rows

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
examples/blog/
├── opensaas.config.ts      # Schema definition with access control
├── lib/
│   └── actions/
│       ├── posts.ts        # Post CRUD operations
│       └── users.ts        # User CRUD operations
├── test-access-control.ts  # The access-control suite (`pnpm test`)
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
    read: isAuthorOfItem,
    create: isSignedIn,
    update: isAuthorOfItem,
  },
})
```

The filter-returning `isAuthor` above is not assignable here. `FieldAccess`
from `@opensaas/stack-core` types the three slots (`read`, `create`, `update`)
as boolean-returning, so reusing `isAuthor` is a compile error and, untyped, an
`InvalidFieldAccessResultError` at runtime. That is why the example carries
`isAuthorOfItem` as the per-field counterpart of `isAuthor`, and why `create`
is `isSignedIn` — there is no `item` yet on create.

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
- Integrate with a real authentication system (better-auth, NextAuth, Clerk)
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
