# OpenSaas Stack - Original Design Specification

> **Note**: This is the original design specification document from the initial development of OpenSaas Stack. It provides valuable historical context about the project's design rationale and architectural decisions. For current architecture and implementation details, see the main [CLAUDE.md](../CLAUDE.md) file in the repository root.

## Project Overview

OpenSaas is a modern stack for building admin-heavy applications with Next.js App Router, designed to be AI-agent-friendly with built-in security guardrails. It provides a KeystoneJS-inspired configuration system with access control and hooks, but built for modern Next.js patterns with Server Components.

### Core Value Proposition

1. **AI-Safe Architecture**: Built from the ground up to be easy for AI coding agents to work with safely
2. **Access Control First**: Database operations automatically enforce access control patterns
3. **Modern Next.js Integration**: Works seamlessly with App Router and Server Components
4. **Embedded Admin UI**: Admin interface lives within your Next.js app, not as a separate service
5. **Type-Safe**: Full TypeScript support with generated types from schema

## Package Architecture

The stack consists of three main packages:

### `@opensaas/stack-core`

- Schema definition and validation
- Access control engine
- Hooks system
- Prisma client wrapper with access control
- Type generation
- Context/session management

### `@opensaas/admin`

- Admin UI components (React)
- Next.js App Router integration
- Server Actions for mutations
- File upload handling
- Depends on `@opensaas/stack-core`

### `@opensaas/stack-cli`

- Project scaffolding
- Schema migration management
- Type generation commands
- Dev tooling with watch mode
- Future: MCP server for AI agents

## Configuration System

### File: `opensaas.config.ts`

```typescript
import { config, list } from '@opensaas/stack-core'
import { text, relationship, select, timestamp, password } from '@opensaas/stack-core/fields'

export default config({
  db: {
    provider: 'postgresql',
    url: process.env.DATABASE_URL,
  },

  lists: {
    User: list({
      fields: {
        name: text({ validation: { isRequired: true } }),
        email: text({
          validation: { isRequired: true },
          isIndexed: 'unique',
        }),
        password: password({ validation: { isRequired: true } }),
        posts: relationship({ ref: 'Post.author', many: true }),
      },
      access: {
        operation: {
          query: true,
          create: true,
          update: ({ session, item }) => session?.userId === item.id,
          delete: ({ session, item }) => session?.userId === item.id,
        },
      },
    }),

    Post: list({
      fields: {
        title: text({
          validation: { isRequired: true },
          access: {
            read: true,
            create: isSignedIn,
            update: isAuthor,
          },
        }),
        slug: text({
          validation: { isRequired: true },
          isIndexed: 'unique',
        }),
        content: text({
          ui: { displayMode: 'textarea' },
          access: {
            read: true,
            create: isSignedIn,
            update: isAuthor,
          },
        }),
        internalNotes: text({
          // Only visible to author
          access: {
            read: isAuthor,
            create: isAuthor,
            update: isAuthor,
          },
        }),
        status: select({
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
          defaultValue: 'draft',
          ui: { displayMode: 'segmented-control' },
        }),
        publishedAt: timestamp(),
        author: relationship({ ref: 'User.posts' }),
      },
      access: {
        operation: {
          // Anyone can read published posts
          query: ({ session }) => {
            if (!session) return { status: { equals: 'published' } }
            return true // Logged in users see all
          },
          create: isSignedIn,
          update: isAuthor,
          delete: isAuthor,
        },
      },
      hooks: {
        resolveInput: async ({ operation, resolvedData, item, context }) => {
          // Auto-set publishedAt when status changes to published
          if (resolvedData.status === 'published' && !item?.publishedAt) {
            resolvedData.publishedAt = new Date()
          }
          return resolvedData
        },
        validateInput: async ({ operation, resolvedData, item, context, addValidationError }) => {
          if (operation === 'delete') return
          // Custom validation
        },
        beforeOperation: async ({ operation, item, context }) => {
          // Before any DB operation
        },
        afterOperation: async ({ operation, item, context }) => {
          // After DB operation
        },
      },
    }),
  },

  session: {
    // How to get session data - integrates with any auth system
    getSession: async () => {
      // User implements this with their auth system (better-auth, next-auth, clerk, etc.)
      const session = await auth()
      return session ? { userId: session.user.id, user: session.user } : null
    },
  },

  ui: {
    basePath: '/admin',
  },
})
```

### Access Control Helpers Example

```typescript
// access.ts
import type { AccessControl } from '@opensaas/stack-core'

export const isSignedIn: AccessControl = ({ session }) => {
  return !!session
}

export const isAuthor: AccessControl = ({ session, item }) => {
  if (!session) return false
  return session.userId === item.authorId
}

// Can also return Prisma filters for relational checks
export const isTeamMember: AccessControl = ({ session }) => {
  if (!session) return false
  return {
    team: {
      members: {
        some: {
          userId: { equals: session.userId },
        },
      },
    },
  }
}
```

## Access Control System

### Key Principles

1. **Fail Closed**: No access by default, must explicitly grant
2. **Silent Failure**: Return `null` or `[]` when access denied (no error messages that leak information)
3. **Operation-Level**: Control CRUD operations per list
4. **Field-Level**: Control read/write access per field
5. **Filter-Based**: Can return Prisma filter objects for complex relational checks

### Access Control Types

```typescript
type AccessControl<T = any> = (args: {
  session: Session | null
  item?: T // Present for update/delete operations
  context: Context
}) => boolean | PrismaFilter<T> | Promise<boolean | PrismaFilter<T>>
```

### How It Works

When a user calls `context.db.post.update()`:

1. Check operation-level access (can this user update posts at all?)
2. Apply access filter as Prisma where clause (which posts can they update?)
3. Check field-level access (which fields can they modify?)
4. Execute hooks (resolveInput, validateInput, beforeOperation)
5. Perform database operation
6. Execute afterOperation hook
7. Return result (or null if no access)

## Context API

### Usage in Application Code

```typescript
import { getContext } from '@opensaas/stack-core'
import type { Context } from '@opensaas/stack-core/types'
import { auth } from '@/lib/auth'

// In a Server Component or Server Action
export async function updatePost(id: string, data: PostUpdateInput) {
  const session = await auth()
  const context: Context = await getContext({ session })

  // Access control and hooks automatically applied
  const post = await context.db.post.update({
    where: { id },
    data,
  })

  if (!post) {
    // Either doesn't exist or no access (secure - no info leak)
    return null
  }

  return post
}
```

### Context Object Structure

```typescript
type Context = {
  db: {
    // Generated for each list
    [listKey: string]: {
      findUnique: (args) => Promise<Item | null>
      findMany: (args) => Promise<Item[]>
      create: (args) => Promise<Item | null>
      update: (args) => Promise<Item | null>
      delete: (args) => Promise<Item | null>
      count: (args) => Promise<number>
    }
  }
  session: Session | null
  prisma: PrismaClient // Raw Prisma client for advanced use
}
```

## Type Generation

### Generated Types

From the config, the CLI generates:

```typescript
// Generated: .opensaas/types.ts

export type Post = {
  id: string
  title: string
  slug: string
  content: string | null
  internalNotes: string | null
  status: 'draft' | 'published'
  publishedAt: Date | null
  authorId: string
  createdAt: Date
  updatedAt: Date
}

export type PostCreateInput = {
  title: string
  slug: string
  content?: string | null
  internalNotes?: string | null
  status?: 'draft' | 'published'
  publishedAt?: Date | null
  author: { connect: { id: string } }
}

export type PostUpdateInput = Partial<Omit<Post, 'id' | 'createdAt' | 'updatedAt'>>

export type PostWhereInput = { // Prisma where input types }

// Full Context type with all lists
export type Context = {
  db: {
    post: {
      findUnique: (args: { where: { id: string }; include?: any }) => Promise<Post | null>
      findMany: (args: { where?: PostWhereInput; include?: any }) => Promise<Post[]>
      create: (args: { data: PostCreateInput }) => Promise<Post | null>
      update: (args: { where: { id: string }; data: PostUpdateInput }) => Promise<Post | null>
      delete: (args: { where: { id: string } }) => Promise<Post | null>
      count: (args: { where?: PostWhereInput }) => Promise<number>
    }
    user: { // ... similar for User }
  }
  session: Session | null
  prisma: PrismaClient
}
```

## Hooks System

Matches KeystoneJS hook naming:

### Hook Types

```typescript
type Hooks<T> = {
  // Modify input data before validation
  resolveInput?: (args: {
    operation: 'create' | 'update'
    resolvedData: Partial<T>
    item?: T // Present for update
    context: Context
  }) => Promise<Partial<T>>

  // Custom validation (in addition to field validation)
  validateInput?: (args: {
    operation: 'create' | 'update'
    resolvedData: Partial<T>
    item?: T
    context: Context
    addValidationError: (msg: string) => void
  }) => Promise<void>

  // Before database operation (cannot modify data)
  beforeOperation?: (args: {
    operation: 'create' | 'update' | 'delete'
    item?: T
    context: Context
  }) => Promise<void>

  // After database operation
  afterOperation?: (args: {
    operation: 'create' | 'update' | 'delete'
    item: T
    context: Context
  }) => Promise<void>
}
```

### Execution Order

1. Access control check (operation-level)
2. `resolveInput` hook
3. `validateInput` hook
4. Field validation (isRequired, etc.)
5. Access control check (field-level)
6. `beforeOperation` hook
7. Database operation
8. `afterOperation` hook
9. Return result

## Field Types

### Initial Field Types to Support

```typescript
// Text fields
text(options?: {
  validation?: { isRequired?: boolean, length?: { min?: number, max?: number } }
  isIndexed?: boolean | 'unique'
  defaultValue?: string
  access?: FieldAccess
  ui?: { displayMode?: 'input' | 'textarea' }
})

// Relationship fields
relationship(options: {
  ref: string  // 'List.field' format
  many?: boolean
  ui?: { displayMode?: 'select' | 'cards' }
})

// Select fields
select(options: {
  options: Array<{ label: string, value: string }>
  defaultValue?: string
  ui?: { displayMode?: 'select' | 'segmented-control' | 'radio' }
  validation?: { isRequired?: boolean }
})

// Timestamp fields
timestamp(options?: {
  defaultValue?: { kind: 'now' } | Date
})

// Password fields (hashed automatically)
password(options?: {
  validation?: { isRequired?: boolean }
})

// Integer fields
integer(options?: {
  validation?: { isRequired?: boolean, min?: number, max?: number }
  defaultValue?: number
})

// Boolean fields
checkbox(options?: {
  defaultValue?: boolean
})
```

## Admin UI Integration

### Embedding in Next.js App

```typescript
// app/admin/[...admin]/page.tsx
import { AdminUI } from '@opensaas/admin'
import { auth } from '@/lib/auth'

export default async function AdminPage() {
  const session = await auth()

  return <AdminUI session={session} />
}
```

The admin UI provides:

- List views with filtering, sorting, pagination
- Detail views for create/edit
- Relationship management
- File uploads
- Uses Server Actions for all mutations
- Respects all access control and field-level permissions

## Authentication Integration

The stack is auth-system agnostic. Users provide their own session getter:

```typescript
// opensaas.config.ts
export default config({
  session: {
    getSession: async () => {
      // Example with better-auth
      const session = await auth()
      return session
        ? {
            userId: session.user.id,
            user: session.user,
          }
        : null
    },
  },
})
```

Future plugin for better-auth:

```typescript
// @opensaas/plugin-better-auth (future)
import { opensaasPlugin } from '@opensaas/plugin-better-auth'

export const auth = betterAuth({
  plugins: [opensaasPlugin()],
})
```

## Prisma Integration

### Schema Generation

CLI reads `opensaas.config.ts` and generates:

```prisma
// Generated: prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  name      String
  email     String   @unique
  password  String
  posts     Post[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Post {
  id            String    @id @default(cuid())
  title         String
  slug          String    @unique
  content       String?
  internalNotes String?
  status        String    @default("draft")
  publishedAt   DateTime?
  authorId      String
  author        User      @relation(fields: [authorId], references: [id])
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}
```

### Client Wrapping

The stack wraps Prisma client operations:

```typescript
// Conceptual implementation
function wrapPrismaClient(prisma, config, session) {
  const context = {}

  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    context[listKey] = {
      findMany: async (args) => {
        // 1. Check operation access
        const accessFilter = await checkAccess('query', listConfig, session)
        if (accessFilter === false) return []

        // 2. Merge access filter with user's where clause
        const where = mergeFilters(args.where, accessFilter)

        // 3. Execute with Prisma
        const results = await prisma[listKey].findMany({ ...args, where })

        // 4. Filter fields based on field-level access
        return filterFields(results, listConfig, session, 'read')
      },

      update: async (args) => {
        // Similar but with hooks and field-level checks
        const accessFilter = await checkAccess('update', listConfig, session, args.where)
        if (accessFilter === false) return null

        const item = await prisma[listKey].findFirst({
          where: mergeFilters(args.where, accessFilter),
        })
        if (!item) return null

        // Run hooks
        let data = await runHook('resolveInput', listConfig, {
          operation: 'update',
          resolvedData: args.data,
          item,
          context,
        })
        await runHook('validateInput', listConfig, {
          operation: 'update',
          resolvedData: data,
          item,
          context,
        })

        // Check field-level access
        data = await checkFieldAccess(data, listConfig, session, 'update')

        await runHook('beforeOperation', listConfig, { operation: 'update', item, context })

        const result = await prisma[listKey].update({ where: args.where, data })

        await runHook('afterOperation', listConfig, { operation: 'update', item: result, context })

        return filterFields(result, listConfig, session, 'read')
      },
    }
  }

  return context
}
```

## Development Workflow

### Initial Setup

```bash
# Create new project
npx @opensaas/stack-cli init my-app

# Generates:
# - opensaas.config.ts (with example schema)
# - .env (with DATABASE_URL)
# - Basic Next.js structure with admin route
# - package.json with dependencies
```

### Development

```bash
# Generate Prisma schema and types from config
npx @opensaas/stack-cli generate

# Run Prisma migrations
npx @opensaas/stack-cli migrate dev

# Start Next.js dev server (with type watching)
npm run dev
```

### CLI Commands

```bash
opensaas init [name]           # Scaffold new project
opensaas generate              # Generate schema + types
opensaas migrate dev           # Run migrations
opensaas migrate deploy        # Deploy migrations (production)
opensaas dev                   # Dev mode with type watching
opensaas build                 # Build for production
```

## Prototype Roadmap

### Phase 1: Core Foundation (Start Here)

1. **Config schema definition**
   - TypeScript types for config structure
   - Basic field types (text, relationship, select, timestamp)
   - Access control type definitions

2. **Prisma schema generation**
   - Read opensaas.config.ts
   - Generate prisma/schema.prisma
   - Handle relationships correctly

3. **Type generation**
   - Generate TypeScript types from config
   - Create Context type with all operations

### Phase 2: Access Control Engine

4. **Context creation with session**
   - getContext function
   - Session passing and validation

5. **Operation-level access control**
   - Wrap Prisma client
   - Check access before operations
   - Return null/[] on access denial
   - Support filter-based access (return Prisma where objects)

6. **Field-level access control**
   - Filter readable fields on output
   - Filter writable fields on input

### Phase 3: Hooks System

7. **Basic hooks implementation**
   - resolveInput
   - validateInput
   - beforeOperation
   - afterOperation

### Phase 4: CLI Tooling

8. **CLI scaffolding**
   - init command
   - generate command
   - Basic project structure

### Phase 5: Admin UI (Future)

9. **Basic admin UI**
   - List view
   - Detail view (create/edit)
   - Server Actions integration
   - Embed at /admin route

### Phase 6: Better-auth Integration (Future)

10. **Better-auth plugin**
    - Example integration
    - Helper utilities

## Technical Decisions

### Why Prisma First?

- Mature ecosystem
- Excellent TypeScript support
- AI agents already understand it well
- Easy migration path (can add Drizzle adapter later)

### Why Silent Failures on Access Denial?

- Prevents information leakage
- More secure default
- Common pattern in multi-tenant systems
- Can always add verbose mode for debugging

### Why Hooks Match KeystoneJS?

- Proven patterns from years of use
- Familiar to anyone who used KeystoneJS
- Clear separation of concerns

### Why Multi-Package?

- Users can use just what they need (headless API with just core)
- Cleaner separation of concerns
- Easier to maintain and test
- Can version independently if needed

## Success Criteria for Prototype

The initial prototype should demonstrate:

1. ✅ Define a simple schema in opensaas.config.ts
2. ✅ Generate Prisma schema from config
3. ✅ Generate TypeScript types from config
4. ✅ Create a context with session
5. ✅ Perform CRUD operations through context
6. ✅ Access control works (operation-level and field-level)
7. ✅ Returns null/[] when access denied
8. ✅ Basic hooks execute in correct order
9. ✅ All operations are fully typed

## Example Use Case: Simple Blog

**Goal**: AI agent can safely build blog features

**Schema**: User, Post (as shown in config example above)

**Agent Task**: "Add a feature where users can publish their drafts"

**Agent generates**:

```typescript
// app/actions/publish-post.ts
'use server'

import { getContext } from '@opensaas/stack-core'
import { auth } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

export async function publishPost(postId: string) {
  const session = await auth()
  const context = await getContext({ session })

  const post = await context.db.post.update({
    where: { id: postId },
    data: { status: 'published' },
  })

  if (!post) {
    return { success: false, error: 'Post not found or access denied' }
  }

  revalidatePath('/blog')
  return { success: true, post }
}
```

**What makes this safe:**

1. ✅ Access control ensures only author can update
2. ✅ Hook automatically sets publishedAt timestamp
3. ✅ Type-safe operations (can't set invalid fields)
4. ✅ Silent failure if no access (no info leak)
5. ✅ Agent code follows simple, predictable patterns

---

## Notes for Implementation

- Start with monorepo structure (pnpm workspaces or npm workspaces)
- Use TypeScript strict mode
- Consider using Zod for config validation
- Make extensive use of TypeScript generics for type safety
- Keep the API surface small and predictable
- Write tests for access control edge cases
- Document everything inline with JSDoc for better IDE support

## Questions to Resolve During Implementation

1. How to handle migrations when config changes?
2. Should we auto-add createdAt/updatedAt or make them explicit?
3. How to handle Prisma client regeneration in dev mode?
4. Should context be cached per request or created fresh each time?
5. How to handle file uploads in field types?
6. How to handle cascade deletes in relationships?
7. Should we support GraphQL as an optional layer later?
