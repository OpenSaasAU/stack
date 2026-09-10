# @opensaas/stack-core

Core OpenSaas Stack - config system, field types, access control, and code generation.

## Installation

```bash
pnpm add @opensaas/stack-core
```

## Features

- 📝 **Schema Definition** - Config-first approach to defining your data model
- 🔒 **Access Control** - Automatic enforcement at database layer
- 🎯 **Type Generation** - Generate TypeScript types and Prisma schema
- 🔄 **Field Types** - Extensible field type system
- 🪝 **Hooks** - Data transformation and validation lifecycle
- 🛡️ **AI-Safe** - Silent failures prevent information leakage

## Quick Start

### 1. Define Your Schema

Create `opensaas.config.ts`:

```typescript
import { config, list } from '@opensaas/stack-core'
import { text, integer, select, relationship } from '@opensaas/stack-core/fields'
import type { AccessControl, FieldAccess } from '@opensaas/stack-core'

const isSignedIn: AccessControl = ({ session }) => !!session

const isAuthor: AccessControl = ({ session }) => {
  if (!session) return false
  return { authorId: { equals: session.userId } }
}

const authorOnlyField: FieldAccess = {
  read: ({ session, item }) => !!session && item?.authorId === session.userId,
  create: ({ session }) => !!session,
  update: ({ session, item }) => !!session && item?.authorId === session.userId,
}

export default config({
  db: { provider: 'postgresql' },
  lists: {
    User: list({
      fields: {
        name: text({ validation: { isRequired: true } }),
        email: text({ isIndexed: 'unique' }),
        posts: relationship({ ref: 'Post.author', many: true }),
      },
    }),
    Post: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
        slug: text({ isIndexed: 'unique' }),
        content: text(),
        status: select({
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
          defaultValue: 'draft',
        }),
        author: relationship({ ref: 'User.posts' }),
        internalNotes: text({ access: authorOnlyField }),
      },
      access: {
        operation: {
          query: ({ session }) => {
            if (!session) return { status: { equals: 'published' } }
            return true
          },
          create: isSignedIn,
          update: isAuthor,
          delete: isAuthor,
        },
      },
    }),
  },
})
```

`isAuthor` and `authorOnlyField` are not interchangeable, and the compiler
enforces it. An **operation** rule may return a filter, which is how `update` and
`delete` scope themselves to rows the caller owns. A **field** rule decides per
fetched item and must return a boolean — a filter is meaningless there, so
`FieldAccess` types the three slots as boolean-returning and reusing `isAuthor`
on a field is a type error rather than a silent "allow".

### 2. Generate Schema and Types

```bash
opensaas generate
```

This writes the generated bundle:

- `prisma/contract.ts` - the contract module the ORM executes against
- `.opensaas/types.ts` - TypeScript types
- `.opensaas/context.ts` - the context factory
- `.opensaas/lists.ts`, `.opensaas/tables.ts`, `.opensaas/plugin-types.ts`
- `prisma.config.ts` at the project root

The connection is resolved from `DIRECT_DATABASE_URL`, then `DATABASE_URL`, then
the Dev database `opensaas dev` starts. There is no `db.url` key and no
`prismaClientConstructor`.

### 3. Use the Generated Context

`.opensaas/context.ts` exports `getContext`. You do not construct a Prisma
client — the factory owns it.

```typescript
// lib/posts.ts
import { getContext } from '@/.opensaas/context'
import type { PostCreateInput } from '@/.opensaas/types'

export async function createPost(userId: string, data: PostCreateInput) {
  const context = await getContext({ userId })

  const post = await context.db.Post.create({ data })

  if (post === null) {
    return { error: 'Access denied' }
  }

  return { post }
}
```

List keys on `context.db` are **PascalCase**, matching the config —
`context.db.Post`, not `context.db.post`. A denied write returns `null`, so every
`create`, `update` and `delete` result is checked before use.

## Field Types

### Available Fields

- **text()** - String field
- **integer()** - Number field
- **checkbox()** - Boolean field
- **timestamp()** - Date/time field
- **password()** - Password field (excluded from reads)
- **select()** - Enum field with options
- **relationship()** - Foreign key relationship
- **json()** - JSON field for arbitrary data
- **virtual()** - Computed field not stored in database

### Field Options

All fields support:

```typescript
text({
  validation: {
    isRequired: true,
    length: { min: 3, max: 100 },
  },
  isIndexed: 'unique', // or true for non-unique index
  defaultValue: 'Hello',
  access: {
    read: ({ session }) => !!session,
    create: ({ session }) => !!session,
    update: ({ session }) => !!session,
  },
  hooks: {
    resolveInput: async ({ resolvedData }) => resolvedData,
    validateInput: async ({ operation, resolvedData }) => {
      if (operation === 'delete') return
      /* validate */
    },
  },
  ui: {
    fieldType: 'custom', // Reference global component
    component: CustomComponent, // Or provide directly
  },
})
```

### Creating Custom Field Types

Field types are fully self-contained:

```typescript
import type {
  BaseFieldConfig,
  ContractFieldDescriptor,
  TypeInfo,
} from '@opensaas/stack-core/extend'
import { z } from 'zod'

export type MyCustomField<TTypeInfo extends TypeInfo = TypeInfo> = BaseFieldConfig<TTypeInfo> & {
  type: 'myCustom'
  customOption?: string
}

export function myCustom(options?: Omit<MyCustomField, 'type'>): MyCustomField {
  return {
    type: 'myCustom',
    ...options,
    getZodSchema: (fieldName, operation) => z.string().optional(),
    getContractField: (fieldName): ContractFieldDescriptor => ({
      kind: 'column',
      name: fieldName,
      type: { pack: 'pg', type: 'text' },
      nullable: true,
    }),
  }
}
```

## Access Control

### Operation-Level Access

Control who can query, create, update, or delete:

```typescript
access: {
  operation: {
    query: true,  // Everyone can read
    create: isSignedIn,  // Must be signed in
    update: isAuthor,  // Only author
    delete: isAuthor,  // Only author
  }
}
```

### Filter-Based Access

Return Prisma filters to scope access:

```typescript
const isAuthor: AccessControl = ({ session }) => {
  if (!session) return false
  return { authorId: { equals: session.userId } }
}

// Applied as: where: { AND: [userFilter, { authorId: { equals: userId } }] }
```

### Field-Level Access

Control access to individual fields:

```typescript
internalNotes: text({
  access: {
    read: isAuthor, // Only author can see
    create: isAuthor, // Only author can set on create
    update: isAuthor, // Only author can modify
  },
})
```

### Silent Failures

Access-denied operations return `null` or `[]` instead of throwing:

`null` here means denied **or** absent — the two are deliberately
indistinguishable, so nothing leaks about which:

```typescript
const post = await context.db.Post.update({
  where: { id: postId },
  data: { title: 'New Title' },
})

if (post === null) {
  return { error: 'Not found' }
}
```

## Hooks

Transform and validate data during operations:

```typescript
hooks: {
  // Transform input before validation
  resolveInput: async ({ resolvedData, operation, session }) => {
    if (operation === 'create') {
      return { ...resolvedData, createdBy: session.userId }
    }
    return resolvedData
  },

  // Custom validation
  validateInput: async ({ operation, resolvedData, fieldPath }) => {
    if (operation === 'delete') return
    if (resolvedData.title?.includes('spam')) {
      throw new Error('Title contains prohibited content')
    }
  },

  // Before database operation
  beforeOperation: async ({ operation, resolvedData }) => {
    console.log(`About to ${operation}`, resolvedData)
  },

  // After database operation
  afterOperation: async ({ operation, item }) => {
    if (operation === 'create') {
      await sendNotification(item)
    }
  },
}
```

### Hook Execution Order

1. `resolveInput` - Transform input
2. `validateInput` - Custom validation
3. Field validation - Built-in rules
4. Field-level access - Filter writable fields
5. `beforeOperation` - Pre-operation side effects
6. **Database operation**
7. `afterOperation` - Post-operation side effects

## Context API

### Creating Context

`getContext` comes from the generated bundle and takes the session alone — the
config and the ORM client are already bound.

```typescript
import { getContext } from '@/.opensaas/context'

const authenticated = await getContext({ userId: '123' })
const anonymous = await getContext()
```

### Reading

A read is composed and then run by a terminal. `where` and `orderBy` accumulate;
`select`, `limit`, `offset` and `cursor` replace.

```typescript
const published = await context.db.Post.where({ status: { equals: 'published' } })
  .orderBy({ title: 'asc' })
  .limit(20)
  .all()

const one = await context.db.Post.where({ id: postId }).first()

const { total } = await context.db.Post.aggregate((a) => ({ total: a.count() }))
```

`all()` answers `[]` when the read is denied, `first()` answers `null`, and
`aggregate()` answers `0` under every key. There is no `findMany`, `findUnique`,
`findFirst` or `count()`.

The `where` vocabulary is a closed set: `equals`, `not`, `in`, `notIn`, `lt`,
`lte`, `gt`, `gte`, `contains` for scalars, and `some`, `every`, `none` for
relations, combined with `AND` / `OR` / `NOT`. A bare value means equality,
`contains` is case-insensitive, and `undefined` is refused rather than dropped —
so `{ authorId: session?.userId }` on a missing session is an error, not an open
read.

### Writing

```typescript
const created = await context.db.Post.create({ data: { title: 'Hello' } })
const updated = await context.db.Post.update({ where: { id }, data: { title: 'Hi' } })
const deleted = await context.db.Post.delete({ where: { id } })
```

`where` on a write is identity-only: exactly one key, `id`. Each of the three
returns `null` when the operation is denied.

An edge on the foreign-key-owning side is written as `{ connect: { id } }`, or
`null` to clear it. Nested creates and updates are refused.

```typescript
await context.db.Post.update({
  where: { id },
  data: { author: { connect: { id: userId } } },
})
```

## Generators

### Contract module

```typescript
import { deriveContract } from '@opensaas/stack-core'
import { writeContractModule } from '@opensaas/stack-cli/generator'

writeContractModule(deriveContract(config), './prisma/contract.ts')
```

`prisma contract emit` then reads that module and writes `prisma/contract.json`
and `prisma/contract.d.ts` — the artifacts the runtime executes. `opensaas
generate` runs both steps.

### TypeScript Types

`writeTypes` takes the declared-dependency table alongside the config, because
the emitted `Lists.<List>.TypeInfo` narrows each `resolveOutput` hook's `item` to
exactly what its field declared in `needs`. Derive the table from the same config:

```typescript
import { deriveDependencyTable } from '@opensaas/stack-core'
import { writeTypes } from '@opensaas/stack-cli/generator'

writeTypes(config, './.opensaas/types.ts', deriveDependencyTable(config))
```

### Utility Functions

```typescript
import { getUrlKey, getListKeyFromUrl } from '@opensaas/stack-core'

getUrlKey('BlogPost') // 'blog-post' - for URLs
getListKeyFromUrl('blog-post') // 'BlogPost' - parse from URLs
```

## Validation

Built-in validation with Zod:

```typescript
text({
  validation: {
    isRequired: true,
    length: { min: 3, max: 100 },
  },
})

integer({
  validation: {
    isRequired: true,
    min: 0,
    max: 1000,
  },
})
```

Custom validation in hooks:

```typescript
hooks: {
  validateInput: async ({ operation, resolvedData }) => {
    if (operation === 'delete') return
    const { title } = resolvedData
    if (title && !isValidSlug(slugify(title))) {
      throw new ValidationError('Title contains invalid characters')
    }
  }
}
```

## Testing

```typescript
import { describe, it, expect } from 'vitest'
import { getContext } from '@/.opensaas/context'

describe('Post access control', () => {
  it('allows author to update their post', async () => {
    const context = await getContext({ userId: authorId })
    const updated = await context.db.Post.update({
      where: { id: postId },
      data: { title: 'New Title' },
    })
    expect(updated?.title).toBe('New Title')
  })

  it('denies non-author from updating post', async () => {
    const context = await getContext({ userId: otherUserId })
    const updated = await context.db.Post.update({
      where: { id: postId },
      data: { title: 'Hacked!' },
    })
    expect(updated).toBeNull()
  })
})
```

The denied case returns `null` rather than throwing — that is the silent-failure
rule, and it is what the second test asserts.

## Examples

- [Blog Example](../../examples/blog) - Complete working example
- [Custom Field Example](../../examples/custom-field) - Extending field types

## Learn More

- [Context API reference](https://stack.opensaas.au/docs/reference/context-api) - The full `context.db` surface
- [Config API reference](https://stack.opensaas.au/docs/reference/config-api) - Every config and field option
- [OpenSaas Stack](../../README.md) - Stack overview

## License

MIT
