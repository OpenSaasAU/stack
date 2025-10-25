# OpenSaaS Stack - Quick Reference

## Installation & Setup

```bash
# Install dependencies
pnpm install

# Build core package
cd packages/core && pnpm build

# Setup example
cd ../../examples/blog
pnpm generate
pnpm db:push
npx prisma generate

# Run tests
npx tsx test-access-control.ts
```

## Config Structure

```typescript
import { config, list } from '@opensaas/stack-core'
import {
  text,
  relationship,
  select,
  timestamp,
  password,
  integer,
  checkbox,
} from '@opensaas/stack-core/fields'
import type { AccessControl } from '@opensaas/stack-core'

export default config({
  db: {
    provider: 'sqlite' | 'postgresql' | 'mysql',
    url: process.env.DATABASE_URL,
  },

  lists: {
    ModelName: list({
      fields: {
        /* ... */
      },
      access: {
        /* ... */
      },
      hooks: {
        /* ... */
      }, // Not yet implemented
    }),
  },

  session: {
    getSession: async () => {
      /* ... */
    },
  },

  ui: {
    basePath: '/admin',
  },
})
```

## Field Types

### text()

```typescript
text({
  validation: {
    isRequired: boolean,
    length: { min: number, max: number },
  },
  isIndexed: boolean | 'unique',
  defaultValue: string,
  access: FieldAccess,
  ui: { displayMode: 'input' | 'textarea' },
})
```

### integer()

```typescript
integer({
  validation: {
    isRequired: boolean,
    min: number,
    max: number,
  },
  defaultValue: number,
  access: FieldAccess,
})
```

### checkbox()

```typescript
checkbox({
  defaultValue: boolean,
  access: FieldAccess,
})
```

### timestamp()

```typescript
timestamp({
  defaultValue: { kind: 'now' } | Date,
  access: FieldAccess,
})
```

### password()

```typescript
password({
  validation: { isRequired: boolean },
  access: FieldAccess,
})
```

### select()

```typescript
select({
  options: [
    { label: string, value: string },
    // ...
  ],
  defaultValue: string,
  validation: { isRequired: boolean },
  ui: { displayMode: 'select' | 'segmented-control' | 'radio' },
  access: FieldAccess,
})
```

### relationship()

```typescript
relationship({
  ref: 'ListName.fieldName', // Required
  many: boolean, // Default: false
  ui: { displayMode: 'select' | 'cards' },
  access: FieldAccess,
})
```

## Access Control

### Types

```typescript
type AccessControl<T> = (args: {
  session: Session
  item?: T
  context: AccessContext
}) => boolean | PrismaFilter<T> | Promise<boolean | PrismaFilter<T>>

type FieldAccess = {
  read?: AccessControl
  create?: AccessControl
  update?: AccessControl
}
```

### Operation-Level Access

```typescript
access: {
  operation: {
    query: AccessControl,   // Who can read
    create: AccessControl,  // Who can create
    update: AccessControl,  // Who can update
    delete: AccessControl   // Who can delete
  }
}
```

### Common Patterns

```typescript
// Boolean - simple allow/deny
const isSignedIn: AccessControl = ({ session }) => {
  return !!session
}

// Filter - return Prisma where clause
const isAuthor: AccessControl = ({ session }) => {
  if (!session) return false
  return {
    authorId: { equals: session.userId },
  }
}

// Item-based - check specific item
const isOwner: AccessControl = ({ session, item }) => {
  if (!session) return false
  return session.userId === item?.id
}

// Complex filter
const canSee: AccessControl = ({ session }) => {
  if (!session) {
    return { status: { equals: 'published' } }
  }
  return {
    OR: [{ status: { equals: 'published' } }, { authorId: { equals: session.userId } }],
  }
}
```

### Field-Level Access

```typescript
internalNotes: text({
  access: {
    read: isAuthor, // Only author can see
    create: isAuthor, // Only author can set
    update: isAuthor, // Only author can modify
  },
})
```

## Context API

### Get Context

```typescript
import { getContext } from '@opensaas/stack-core'
import { PrismaClient } from '@prisma/client'
import config from './opensaas.config'

const prisma = new PrismaClient()
const session = await getSession() // Your auth system

const context = getContext(config, prisma, session)
```

### Operations

```typescript
// Find unique
const item = await context.db.modelname.findUnique({
  where: { id: string },
  include?: any
})  // Returns Item | null

// Find many
const items = await context.db.modelname.findMany({
  where?: WhereInput,
  take?: number,
  skip?: number,
  include?: any
})  // Returns Item[]

// Create
const item = await context.db.modelname.create({
  data: CreateInput
})  // Returns Item | null

// Update
const item = await context.db.modelname.update({
  where: { id: string },
  data: UpdateInput
})  // Returns Item | null

// Delete
const item = await context.db.modelname.delete({
  where: { id: string }
})  // Returns Item | null

// Count
const count = await context.db.modelname.count({
  where?: WhereInput
})  // Returns number
```

### Relationship Syntax

```typescript
// Connect (create/update)
author: { connect: { id: userId } }

// Disconnect (update only)
author: { disconnect: true }

// Many relationship
tags: {
  connect: [{ id: tag1Id }, { id: tag2Id }],
  disconnect: [{ id: tag3Id }]
}
```

## Generator CLI

### Commands

```bash
# Generate Prisma schema and TypeScript types
npx opensaas generate
# or
pnpm generate  # (if in package.json scripts)

# Push schema to database (Prisma)
npx prisma db push

# Generate Prisma Client
npx prisma generate

# Run migrations (production)
npx prisma migrate dev --name init
npx prisma migrate deploy
```

### Generated Files

- `prisma/schema.prisma` - Prisma schema
- `.opensaas/types.ts` - TypeScript types
  - Model types (User, Post, etc.)
  - CreateInput types
  - UpdateInput types
  - WhereInput types
  - Context type

## Common Workflows

### Adding a New Model

1. Add to `opensaas.config.ts`:

```typescript
Comment: list({
  fields: {
    text: text({ validation: { isRequired: true } }),
    post: relationship({ ref: 'Post.comments' }),
    author: relationship({ ref: 'User.comments' }),
  },
})
```

2. Regenerate:

```bash
pnpm generate
npx prisma generate
```

3. Use in code:

```typescript
const comment = await context.db.comment.create({
  data: {
    text: 'Great post!',
    post: { connect: { id: postId } },
    author: { connect: { id: userId } },
  },
})
```

### Adding a New Field

1. Add to existing list in config:

```typescript
Post: list({
  fields: {
    // ... existing fields
    viewCount: integer({ defaultValue: 0 }),
  },
})
```

2. Regenerate:

```bash
pnpm generate
npx prisma db push
npx prisma generate
```

### Changing Access Control

Just edit the config and reload - no regeneration needed:

```typescript
access: {
  operation: {
    update: isAuthor // Changed from true
  }
}
```

## Testing Patterns

### Mock Session

```typescript
// Create context with specific user
const mockSession = {
  userId: 'user123',
  user: { id: 'user123', name: 'Test User' },
}

const context = getContext(config, prisma, mockSession)
```

### Test Access Denial

```typescript
const result = await context.db.post.update({
  where: { id: postId },
  data: { title: 'New Title' },
})

// Silent failure returns null
expect(result).toBe(null)
```

### Test Field Filtering

```typescript
const post = await context.db.post.findUnique({
  where: { id: postId },
})

// Field should be undefined if access denied
expect(post?.internalNotes).toBe(undefined)
```

## Troubleshooting

### Types Not Found

```bash
# Make sure core is built
cd packages/core && pnpm build

# Make sure types are generated
cd examples/blog && pnpm generate

# Make sure Prisma client is generated
npx prisma generate
```

### Access Control Not Working

- Check session is being passed correctly
- Check access control function returns correct type
- Use `console.log()` to debug access control functions

### Database Out of Sync

```bash
# Reset database
rm dev.db
pnpm db:push
npx prisma generate
```

### Module Resolution Errors

```bash
# Install workspace dependencies
pnpm install

# Build core
cd packages/core && pnpm build
```

## Best Practices

### Access Control

- Always fail closed (no access by default)
- Use filter-based access for performance
- Keep access control functions pure
- Don't throw errors in access control

### Schema Design

- Use unique indexes for lookup fields
- Set validation.isRequired on required fields
- Use relationships instead of manual foreign keys
- Keep field names consistent with Prisma conventions

### Sessions

- Keep session objects small
- Include only what's needed for access control
- Cache session data when possible
- Integrate with your existing auth system

### Type Safety

- Import types from `.opensaas/types.ts`
- Use the generated Context type
- Let TypeScript guide you
- Don't use `any` types

## Reference Links

- Main README: `README.md`
- Getting Started Guide: `GETTING_STARTED.md`
- Implementation Summary: `IMPLEMENTATION_SUMMARY.md`
- Full Specification: `specs/Initial-opensaas-stack.md`
- Example Config: `examples/blog/opensaas.config.ts`
- Test Suite: `examples/blog/test-access-control.ts`
