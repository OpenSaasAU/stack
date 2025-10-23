# @opensaas/core

Core OpenSaaS Framework - config system, field types, access control, and code generation.

## Installation

```bash
pnpm add @opensaas/core
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
import { config, list } from '@opensaas/core'
import { text, integer, select, relationship } from '@opensaas/core/fields'
import type { AccessControl } from '@opensaas/core'

const isSignedIn: AccessControl = ({ session }) => !!session

const isAuthor: AccessControl = ({ session }) => {
  if (!session) return false
  return { authorId: { equals: session.userId } }
}

export default config({
  db: {
    provider: 'postgresql',
    url: process.env.DATABASE_URL,
  },
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
        internalNotes: text({
          access: {
            read: isAuthor,
            create: isAuthor,
            update: isAuthor,
          },
        }),
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

### 2. Generate Schema and Types

```bash
opensaas generate
```

This creates:

- `prisma/schema.prisma` - Prisma schema
- `.opensaas/types.ts` - TypeScript types

### 3. Create Context

```typescript
// lib/context.ts
import { getContext } from '@opensaas/core'
import { PrismaClient } from '@prisma/client'
import config from '../opensaas.config'

export const prisma = new PrismaClient()

export async function getContextWithUser(userId: string) {
  return getContext(config, prisma, { userId })
}

export async function getContext() {
  return getContext(config, prisma, null)
}
```

### 4. Use in Your App

```typescript
import { getContextWithUser } from './lib/context'

export async function createPost(userId: string, data: any) {
  const context = await getContextWithUser(userId)

  // Access control automatically enforced
  const post = await context.db.post.create({ data })

  if (!post) {
    return { error: 'Access denied' }
  }

  return { post }
}
```

## Field Types

### Available Fields

- **text()** - String field
- **integer()** - Number field
- **checkbox()** - Boolean field
- **timestamp()** - Date/time field
- **password()** - Password field (excluded from reads)
- **select()** - Enum field with options
- **relationship()** - Foreign key relationship

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
    validateInput: async ({ resolvedData }) => {
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
import type { BaseFieldConfig } from '@opensaas/core'
import { z } from 'zod'

export type MyCustomField = BaseFieldConfig & {
  type: 'myCustom'
  customOption?: string
}

export function myCustom(options?: Omit<MyCustomField, 'type'>): MyCustomField {
  return {
    type: 'myCustom',
    ...options,
    getZodSchema: (fieldName, operation) => {
      return z.string().optional()
    },
    getPrismaType: (fieldName) => {
      return { type: 'String', modifiers: '?' }
    },
    getTypeScriptType: () => {
      return { type: 'string', optional: true }
    },
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

```typescript
const post = await context.db.post.update({
  where: { id: postId },
  data: { title: 'New Title' },
})

if (!post) {
  // Either doesn't exist OR user lacks access
  // No information leaked about which
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
  validateInput: async ({ resolvedData, fieldPath }) => {
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

```typescript
import { getContext } from '@opensaas/core'

// With session
const context = await getContext(config, prisma, { userId: '123' })

// Anonymous
const context = await getContext(config, prisma, null)
```

### Using Context

```typescript
// All Prisma operations supported
const post = await context.db.post.create({ data })
const posts = await context.db.post.findMany()
const post = await context.db.post.findUnique({ where: { id } })
const post = await context.db.post.update({ where: { id }, data })
const post = await context.db.post.delete({ where: { id } })

// Access control is automatic
// Returns null/[] if access denied
```

## Generators

### Prisma Schema

```typescript
import { writePrismaSchema } from '@opensaas/core'

writePrismaSchema(config, './prisma/schema.prisma')
```

### TypeScript Types

```typescript
import { writeTypes } from '@opensaas/core'

writeTypes(config, './.opensaas/types.ts')
```

### Utility Functions

```typescript
import { getDbKey, getUrlKey, getListKeyFromUrl } from '@opensaas/core'

getDbKey('BlogPost') // 'blogPost' - for context.db access
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
  validateInput: async ({ resolvedData }) => {
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
import { getContext } from '@opensaas/core'
import config from './opensaas.config'

describe('Post access control', () => {
  it('allows author to update their post', async () => {
    const context = await getContext(config, prisma, { userId: authorId })
    const updated = await context.db.post.update({
      where: { id: postId },
      data: { title: 'New Title' },
    })
    expect(updated).toBeTruthy()
    expect(updated?.title).toBe('New Title')
  })

  it('denies non-author from updating post', async () => {
    const context = await getContext(config, prisma, { userId: otherUserId })
    const updated = await context.db.post.update({
      where: { id: postId },
      data: { title: 'Hacked!' },
    })
    expect(updated).toBeNull() // Silent failure
  })
})
```

## Examples

- [Blog Example](../../examples/blog) - Complete working example
- [Custom Field Example](../../examples/custom-field) - Extending field types

## Learn More

- [API Reference](../../docs/API.md) - Complete API documentation
- [OpenSaaS Framework](../../README.md) - Framework overview
- [CLAUDE.md](../../CLAUDE.md) - Development guide

## License

MIT
