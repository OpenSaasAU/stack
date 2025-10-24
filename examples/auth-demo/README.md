# OpenSaaS Auth Demo

A complete example demonstrating authentication integration with OpenSaaS Framework using `@opensaas/framework-auth` and better-auth.

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

### 3. Generate Schema and Create Database

```bash
pnpm generate  # Generates Prisma schema with auth tables
pnpm db:push   # Creates SQLite database
```

### 4. Run Development Server

```bash
pnpm dev
```

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
│   ├── auth.ts                      # Auth server instance
│   └── auth-client.ts               # Auth client for React
├── opensaas.config.ts               # Config with withAuth()
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
- **Create**: Only the author can set
- **Update**: Only the author can modify

This demonstrates field-level access control - the field will be filtered out for non-authors.

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

The example uses SQLite by default for simplicity. The database file will be created at `dev.db`.

### 3. Generate Schema and Types

```bash
pnpm generate
```

This reads `opensaas.config.ts` and generates:

- `prisma/schema.prisma` - Prisma schema
- `.opensaas/types.ts` - TypeScript types for your models and context

### 4. Create Database

```bash
pnpm db:push
```

This creates the SQLite database and tables.

### 5. Generate Prisma Client

```bash
npx prisma generate
```

## Testing Access Control

Create a test file to see access control in action:

```typescript
// test.ts
import { getContext, getContextWithUser } from './lib/context'
import { prisma } from './lib/context'

async function test() {
  // Create a user directly (bypassing access control for setup)
  const user = await prisma.user.create({
    data: {
      name: 'Alice',
      email: 'alice@example.com',
      password: 'hashed_password',
    },
  })

  // Get context as Alice
  const contextAlice = getContextWithUser(user.id)

  // Create a post as Alice
  const post = await contextAlice.db.post.create({
    data: {
      title: 'My First Post',
      slug: 'my-first-post',
      content: 'Hello world!',
      internalNotes: 'TODO: Add images',
      author: { connect: { id: user.id } },
    },
  })

  console.log('Post created:', post)
  console.log('Internal notes visible to author:', post?.internalNotes)

  // Try to read as anonymous user
  const contextAnon = getContext()
  const postAnon = await contextAnon.db.post.findUnique({
    where: { id: post!.id },
  })

  console.log('Post visible to anon (draft):', postAnon) // null

  // Publish the post
  await contextAlice.db.post.update({
    where: { id: post!.id },
    data: { status: 'published' },
  })

  // Now it's visible to anonymous users
  const postAnonPublished = await contextAnon.db.post.findUnique({
    where: { id: post!.id },
  })

  console.log('Post visible to anon (published):', postAnonPublished?.title)
  console.log('Internal notes hidden from anon:', postAnonPublished?.internalNotes) // undefined

  // Cleanup
  await prisma.post.deleteMany()
  await prisma.user.deleteMany()
}

test()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
```

Run with:

```bash
npx tsx test.ts
```

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

// Returns null if user is not the author (silent failure)
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
│   ├── context.ts          # Context creation helper
│   └── actions/
│       ├── posts.ts        # Post CRUD operations
│       └── users.ts        # User CRUD operations
├── prisma/
│   └── schema.prisma       # Generated Prisma schema
├── .opensaas/
│   └── types.ts            # Generated TypeScript types
└── package.json
```

## Key Concepts Demonstrated

### 1. Access Control Helpers

```typescript
const isSignedIn: AccessControl = ({ session }) => {
  return !!session
}

const isAuthor: AccessControl = ({ session }) => {
  if (!session) return false
  return {
    authorId: { equals: session.userId },
  }
}
```

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

```typescript
internalNotes: text({
  access: {
    read: isAuthor,
    create: isAuthor,
    update: isAuthor,
  },
})
```

### 4. Silent Failures

```typescript
const post = await context.db.post.update({
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

View your data with Prisma Studio:

```bash
pnpm db:studio
```

Reset the database:

```bash
rm dev.db
pnpm db:push
```
