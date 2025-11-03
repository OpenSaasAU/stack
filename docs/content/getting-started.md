# Getting Started

This guide will walk you through building and testing the OpenSaaS Stack from the monorepo.

## Prerequisites

- Node.js 18+
- pnpm (install with `npm install -g pnpm`)
- Basic knowledge of Next.js, TypeScript, and Prisma

## Step-by-Step Setup

### 1. Install Dependencies

From the repository root:

```bash
pnpm install
```

This will install dependencies for all packages in the monorepo.

### 2. Build the Core Package

The `@opensaas/stack-core` package needs to be compiled before it can be used:

```bash
cd packages/core
pnpm build
```

You should see TypeScript compile the source files to the `dist/` directory.

### 3. Set Up the Blog Example

Navigate to the blog example:

```bash
cd ../../examples/blog
```

The `.env` file is already created with SQLite configuration.

### 4. Generate Prisma Schema and Types

This is the key step - it reads your `opensaas.config.ts` and generates both the Prisma schema and TypeScript types:

```bash
pnpm generate
```

You should see:

- `prisma/schema.prisma` created
- `.opensaas/types.ts` created
- `.opensaas/context.ts` created

Take a look at these generated files to see what OpenSaaS created from your config!

### 5. Create the Database

Push the schema to create the SQLite database:

```bash
pnpm db:push
```

This creates `dev.db` with your tables.

### 6. Generate Prisma Client

```bash
npx prisma generate
```

This creates the Prisma Client you'll use to interact with the database.

### 7. Run the Test Script

Now for the moment of truth - let's test the access control:

```bash
npx tsx test-access-control.ts
```

You should see a comprehensive test output showing:

- ✅ Users being created
- ✅ Posts being created with internal notes
- ✅ Anonymous users unable to see draft posts
- ✅ Published posts visible to everyone
- ✅ Internal notes hidden from non-authors
- ✅ Users unable to update others' posts
- ✅ Silent failures on access denial

## Understanding What Just Happened

### The Config File (`opensaas.config.ts`)

You defined your schema declaratively:

```typescript
Post: list({
  fields: {
    title: text(),
    internalNotes: text({
      access: {
        read: isAuthor, // Field-level access control
      },
    }),
    // ... more fields
  },
  access: {
    operation: {
      query: ({ session }) => {
        // Filter posts based on who's asking
        if (!session) return { status: { equals: 'published' } }
        return true
      },
      update: isAuthor, // Only author can update
    },
  },
})
```

### The Generator

`pnpm generate` read this config and created:

1. **Prisma Schema** with proper relationships and field types
2. **TypeScript Types** for type-safe database operations
3. **Context Factory** for access-controlled database operations

### The Context

Your application code uses the context to interact with the database:

```typescript
import { getContext } from '@/.opensaas/context'

const context = getContext()
const posts = await context.db.post.findMany()
```

The context automatically:

- Checks access control rules
- Filters results based on session
- Hides fields the user can't access
- Returns `null` or `[]` on access denial (silent failure)

## Next Steps

### Experiment with the Config

Try modifying `opensaas.config.ts`:

1. Add a new field to Post
2. Run `pnpm generate` again
3. See the changes in `prisma/schema.prisma` and `.opensaas/types.ts`
4. Update the test script to use the new field

### Try Different Access Control Patterns

Modify the access control rules:

```typescript
// Make all posts public
query: true

// Require admin role
update: ({ session }) => session?.role === 'admin'

// Complex filter
query: ({ session }) => ({
  OR: [{ status: { equals: 'published' } }, { authorId: { equals: session?.userId } }],
})
```

### Add More Models

Add a new list to the config:

```typescript
Comment: list({
  fields: {
    text: text({ validation: { isRequired: true } }),
    post: relationship({ ref: 'Post.comments' }),
    author: relationship({ ref: 'User.comments' }),
  },
  access: {
    operation: {
      query: true,
      create: isSignedIn,
      update: isAuthor,
      delete: isAuthor,
    },
  },
})
```

Then regenerate and test!

## Viewing Your Data

You can use Prisma Studio to view and edit data:

```bash
pnpm db:studio
```

This opens a browser-based GUI for your database.

## Troubleshooting

### "Module not found" errors

Make sure you've built the core package:

```bash
cd packages/core && pnpm build
```

### "Cannot find opensaas.config.ts"

Make sure you're in the `examples/blog` directory when running `pnpm generate`.

### TypeScript errors in generated types

This usually means the Prisma client hasn't been generated. Run:

```bash
npx prisma generate
```

### Database errors

Reset your database:

```bash
rm dev.db
pnpm db:push
npx prisma generate
```

## Architecture Overview

```
Your opensaas.config.ts
         ↓
    [Generator]
         ↓
    ├─→ prisma/schema.prisma → [Prisma] → @prisma/client
    ├─→ .opensaas/types.ts → TypeScript types
    └─→ .opensaas/context.ts → Context factory
                                    ↓
                              [getContext]
                                    ↓
                           Context with access control
                                    ↓
                              Your application
```

## Learn More

- **[Quick Start](/docs/quick-start)** - 5-minute tutorial
- **[Access Control](/docs/core-concepts/access-control)** - Deep dive into access control
- **[Field Types](/docs/core-concepts/field-types)** - All available field types
- **[Hooks](/docs/core-concepts/hooks)** - Data transformation and side effects
