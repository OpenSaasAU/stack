# Generators

Generators transform your `opensaas.config.ts` into Prisma schemas and TypeScript types.

## Overview

The generator system reads your declarative config and creates:

1. **Prisma Schema** (`prisma/schema.prisma`)
2. **TypeScript Types** (`.opensaas/types.ts`)
3. **Context Factory** (`.opensaas/context.ts`)

## Running the Generator

```bash
pnpm opensaas generate
```

Or in a specific example:

```bash
cd examples/blog
pnpm generate
```

## What Gets Generated

### 1. Prisma Schema

From your config:

```typescript
Post: list({
  fields: {
    title: text({ validation: { isRequired: true } }),
    author: relationship({ ref: 'User.posts' }),
  },
})
```

The generator creates:

```prisma
model Post {
  id        String   @id @default(cuid())
  title     String
  authorId  String
  author    User     @relation(fields: [authorId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### 2. TypeScript Types

Type-safe types for all your lists:

```typescript
export type Lists = {
  Post: {
    fields: {
      title: string
      author: User
    }
  }
  // ... more lists
}
```

### 3. Context Factory

Auto-generated context creation function:

```typescript
import { getContext } from '@/.opensaas/context'

const context = await getContext({ userId: '123' })
```

## Generator Architecture

Generators delegate to field builder methods rather than using switch statements. Each field type provides its own generation logic:

```typescript
text({
  getPrismaType: (fieldName) => {
    return { type: 'String', modifiers: '?' }
  },
  getTypeScriptType: () => {
    return { type: 'string', optional: true }
  },
})
```

This allows field types to be fully self-contained and extensible.

## Custom Prisma Client Constructor

To use custom database drivers (e.g., Neon, Turso, PlanetScale), provide a `prismaClientConstructor`:

```typescript
export default config({
  db: {
    provider: 'postgresql',
    url: process.env.DATABASE_URL,
    prismaClientConstructor: (PrismaClient) => {
      const adapter = new PrismaNeon({
        connectionString: process.env.DATABASE_URL,
      })
      return new PrismaClient({ adapter })
    },
  },
  // ... rest of config
})
```

## Generator Limitations

Current generators are basic:

- ❌ No migration support (use `prisma db push`)
- ❌ No introspection support
- ❌ Limited Prisma features (no raw queries, advanced transactions)

## Best Practices

### 1. Regenerate After Config Changes

Always run the generator after modifying your config:

```bash
pnpm generate
```

### 2. Commit Generated Files

Commit the generated files to version control for consistency:

```bash
git add prisma/schema.prisma
git add .opensaas/
git commit -m "Regenerate schema"
```

### 3. Use Type-Safe Operations

Use the generated types for type safety:

```typescript
import type { Lists } from '@/.opensaas/types'

const post: Lists['Post'] = await context.db.post.findUnique({
  where: { id: '123' },
})
```

## Next Steps

- **[Config System](/docs/core-concepts/config)** - Learn about config options
- **[Field Types](/docs/core-concepts/field-types)** - Available field types
