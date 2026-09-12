# OpenSaas Stack - Quick Reference

## Installation & Setup

```bash
# Install dependencies
pnpm install

# Build core package
cd packages/core && pnpm build

# Start the example: starts the Dev database, generates, reconciles the
# schema, and runs the app — there is no separate database step
cd ../../examples/blog
pnpm dev

# Run a one-off script against the running loop's database
pnpm dev -- tsx test-access-control.ts
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
    provider: 'postgresql', // the only supported provider
  },

  lists: {
    ModelName: list({
      fields: {/* ... */},
      access: {/* ... */},
      hooks: {/* ... */},
    }),
  },

  ui: {
    basePath: '/admin',
  },
})
```

The connection URL is not a config key — it's resolved from `DATABASE_URL`, or from
the running Dev database when that's unset. The session isn't part of the config
either: it's passed to `getContext()` at call time (see Context API below).

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
  ref: 'ListName.fieldName', // or 'ListName' for a list-only, one-sided ref
  many: boolean, // Default: false
  ui: { displayMode: 'select' | 'cards' },
  access: FieldAccess,
})
```

## Access Control

### Types

```typescript
type AccessControl<T> = (args: {
  session: Session | null
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
import type { FieldAccess } from '@opensaas/stack-core'

// Field rules return a **boolean** per fetched item. The filter-returning
// `isAuthor` above is not assignable here: `FieldAccess` types the three slots
// as boolean-returning, so reusing it is a compile error and, untyped, an
// `InvalidFieldAccessResultError` at runtime.
const authorOnlyField: FieldAccess = {
  read: ({ session, item }) => !!session?.userId && item.authorId === session.userId,
  create: ({ session }) => !!session?.userId,
  update: ({ session, item }) => !!session?.userId && item?.authorId === session.userId,
}

internalNotes: text({ access: authorOnlyField })
```

## Context API

### Get Context

```typescript
import { getContext } from '@/.opensaas/context'

// Anonymous
const anonymous = await getContext()

// Authenticated — pass the session's own fields, never a wrapper
const context = await getContext({ userId: 'user-123' })
```

`getContext` is generated at `.opensaas/context.ts` by `opensaas generate`; it takes
the session object itself, or nothing at all.

### Operations

```typescript
// Find one
const item = await context.db.ModelName.where({ id: { equals: id } }).first()
// Returns Item | null

// Find many, with a composed read
const items = await context.db.ModelName.where(whereInput).limit(take).offset(skip).all()
// Returns Item[]

// Create
const item = await context.db.ModelName.create({ data: createInput })
// Returns Item | null

// Update
const item = await context.db.ModelName.update({ where: { id }, data: updateInput })
// Returns Item | null

// Delete
const item = await context.db.ModelName.delete({ where: { id } })
// Returns Item | null

// Count
const { count } = await context.db.ModelName.where(whereInput).aggregate((aggregate) => ({
  count: aggregate.count(),
}))
// Returns number
```

### Relationship Syntax

```typescript
// Connect, on the field that owns the foreign key (create/update)
const post = await context.db.Post.create({
  data: { title: 'Hello', author: { connect: { id: userId } } },
})

// Clear the edge — there is no `disconnect`
const cleared = await context.db.Post.update({ where: { id }, data: { author: null } })
```

A to-many field has no foreign key of its own to write, so it takes no `connect` — write the owning side instead, or write the junction list directly for many-to-many.

## Generator CLI

### Commands

```bash
# Start the Dev database, generate, reconcile the schema, and run the app
pnpm dev

# Regenerate the contract and the .opensaas bundle without running the app
pnpm generate

# Apply a schema change the running loop staged but did not promote
pnpm db:update

# Production: run Prisma's migrate from the committed migrations/ directory
```

### Generated Files

- `prisma/contract.ts` - the Contract module, plus the committed `prisma/contract.json` / `prisma/contract.d.ts` it emits
- `prisma.config.ts` - Prisma's CLI config
- `migrations/<space>/**` - one Extension contract space per declared pack
- `.opensaas/` - the generated bundle: `context.ts`, `types.ts`, `lists.ts`, `plugin-types.ts`, `tables.ts` (not committed — `pnpm dev` regenerates it)

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

2. Regenerate (or just run the `pnpm dev` loop, which reconciles automatically):

```bash
pnpm generate
```

3. Use in code:

```typescript
const comment = await context.db.Comment.create({
  data: {
    text: 'Great post!',
    post: { connect: { id: postId } },
    author: { connect: { id: userId } },
  },
})
if (comment === null) throw new Error('Access denied')
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

2. Regenerate — under `pnpm dev`, this stages behind reconciliation and prompts
   for `pnpm db:update` if the plan is destructive:

```bash
pnpm generate
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

Tests stand up a real, fully secured **Test context** — `createTestContext(config,
session)` from `@opensaas/stack-core/testing` — rather than faking the secured
surface. There is no in-memory imitation of the surface's guarantees.

### Mock Session

```typescript
const harness = await createTestContext(config, { userId: 'user123' })
```

### Test Access Denial

```typescript
const result = await harness.context.db.Post.update({
  where: { id: postId },
  data: { title: 'New Title' },
})

// Silent failure returns null
expect(result).toBe(null)
```

### Test Field Filtering

```typescript
const post = await harness.context.db.Post.where({ id: { equals: postId } }).first()

// Field is absent from the row if access denied
expect(post?.internalNotes).toBe(undefined)
```

## Troubleshooting

### Types Not Found

```bash
# Make sure core is built
cd packages/core && pnpm build

# Make sure the contract and .opensaas bundle are generated
cd examples/blog && pnpm generate
```

### Access Control Not Working

- Check session is being passed correctly
- Check access control function returns correct type
- Use `console.log()` to debug access control functions

### Database Out of Sync

```bash
# Reset the Dev database
rm -rf .opensaas/dev-db/
pnpm dev
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
- Use PascalCase list keys; there is no camelCase spelling of a list on the secured surface

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
- Architecture map: `specs/prisma-8/architecture-spec.md`
- Docs site: https://stack.opensaas.au/
- Example Config: `examples/blog/opensaas.config.ts`
- Test Suite: `examples/blog/test-access-control.ts`
