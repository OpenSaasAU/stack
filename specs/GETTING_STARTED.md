# Getting Started with OpenSaaS Framework

This guide will walk you through building and testing the OpenSaaS Framework prototype.

## Prerequisites

- Node.js 18+
- pnpm (install with `npm install -g pnpm`)

## Step-by-Step Setup

### 1. Install Dependencies

From the repository root:

```bash
pnpm install
```

This will install dependencies for all packages in the monorepo.

### 2. Build the Core Package

The `@opensaas/framework-core` package needs to be compiled before it can be used:

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

### The Context

Your application code uses the context to interact with the database:

```typescript
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
    └─→ .opensaas/types.ts → TypeScript types
                                    ↓
                              [getContext]
                                    ↓
                           Context with access control
                                    ↓
                              Your application
```

## What's Working in This Prototype

✅ **Schema Definition**: Declarative config with field types and relationships
✅ **Code Generation**: Prisma schema and TypeScript types
✅ **Access Control Engine**: Operation and field-level access control
✅ **Silent Failures**: No information leakage on access denial
✅ **Filter-Based Access**: Return Prisma filters for complex rules
✅ **Type Safety**: Full TypeScript support throughout
✅ **Field-Level Access**: Hide/show fields based on permissions

## What's Not Yet Implemented

❌ Hooks system (resolveInput, validateInput, etc.)
❌ CLI commands (init, migrate)
❌ Admin UI
❌ Authentication integration
❌ File upload handling
❌ Validation error messages

These will come in future phases of development.

## Success Criteria

You should be able to:

1. ✅ Define a schema in `opensaas.config.ts`
2. ✅ Run generator to create Prisma schema
3. ✅ Run generator to create TypeScript types
4. ✅ Create context with session
5. ✅ Perform CRUD operations through context
6. ✅ See access control working (operations denied when they should be)
7. ✅ See field-level access working (certain fields hidden)
8. ✅ All operations fully typed

If all these work, the prototype is successful! 🎉

## Learn More

- Read the full specification: `specs/Initial-opensaas-framework.md`
- Explore the core package: `packages/core/src/`
- Check out the example: `examples/blog/`

## Contributing

This is a prototype. Areas that need work:

- Better error messages
- Hook system implementation
- CLI tooling
- Test coverage
- Documentation
- Examples with different field types

Feel free to experiment and extend the framework!
