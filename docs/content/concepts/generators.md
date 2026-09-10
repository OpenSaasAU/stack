# Generators

Generators transform your `opensaas.config.ts` into the Contract module Prisma builds from, and the TypeScript types and context your app imports.

## Overview

The generator system reads your declarative config and creates:

1. **Contract module** (`prisma/contract.ts`), with the artifacts Prisma emits beside it (`prisma/contract.json`, `prisma/contract.d.ts`)
2. **Prisma CLI configuration** (`prisma.config.ts`)
3. **TypeScript Types** (`.opensaas/types.ts`)
4. **Context Factory** (`.opensaas/context.ts`)

## Running the Generator

```bash
pnpm generate
```

Or in a specific example:

```bash
cd examples/blog
pnpm generate
```

## What Gets Generated

### 1. Contract module

From your config:

```typescript
Post: list({
  fields: {
    title: text({ validation: { isRequired: true } }),
    author: relationship({ ref: 'User.posts' }),
  },
})
```

The generator derives a contract — the `Post` model with a `uuid7` id, a
non-null `title` column, an `authorId` foreign key with its relation to `User`,
and `createdAt`/`updatedAt` — renders it as `prisma/contract.ts`, and has
Prisma emit `prisma/contract.json` and `prisma/contract.d.ts` from it. The
runtime executes the emitted contract; `pnpm dev` applies it to the Dev
database and `prisma db migrate` applies committed migrations in production.

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

Generators delegate to the field builder rather than using switch statements. Each field type describes what it contributes to the contract, and the generator reads that:

```typescript
text({
  getContractField: (fieldName) => ({
    kind: 'column',
    name: fieldName,
    type: { pack: 'pg', type: 'text' },
    nullable: true,
  }),
})
```

The column's codec then types the field on both faces, so a field only declares `outputType` when it needs a different one — which a virtual or multi-column field always does, since it has no single column to be typed from.

This allows field types to be fully self-contained and extensible.

## The database block

`db: { provider: 'postgresql' }` is the whole database block: there is no
connection string, adapter or client constructor in the config. The connection
is chosen at run time by one lookup that the generated `prisma.config.ts` and
`.opensaas/context.ts` share — `DATABASE_URL` when it is set, otherwise the Dev
database `pnpm dev` runs. Referential actions, namespaces and extension packs
are first-class options on the config (a relationship's `db.onDelete`,
`db.extensions`), not edits to emitted output.

## Generator Limitations

- ✅ Migration support: `pnpm dev` reconciles the Dev database directly; production migrates from the committed `migrations/` directory with `prisma db migrate` (see ADR-0003 and ADR-0063).
- ❌ No introspection support

## Best Practices

### 1. Regenerate After Config Changes

Always run the generator after modifying your config:

```bash
pnpm generate
```

### 2. Commit Generated Files

Commit the contract, its emitted artifacts, `prisma.config.ts` and `migrations/`
alongside the config change that produced them; `.opensaas/` is regenerated and
stays ignored.

### 3. Use Type-Safe Operations

Use the generated types for type safety:

```typescript
import type { Post } from '@/.opensaas/types'

const post: Post | null = await context.db.Post.where({ id: { equals: '123' } }).first()
```

## Next Steps

- **[Config System](/docs/concepts/config)** - Learn about config options
- **[Field Types](/docs/concepts/field-types)** - Available field types
