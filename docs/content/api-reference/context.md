# Context API Reference

Complete API reference for the OpenSaaS Stack context system. The context provides access-controlled database operations with automatic security, hooks, and validation.

## Overview

The context is the runtime interface for all database operations in OpenSaaS Stack. It wraps your Prisma client with:

- **Access control** - Automatic enforcement of access rules
- **Hooks execution** - Data transformation and side effects
- **Field validation** - Automatic validation of field rules
- **Type safety** - Full TypeScript inference from Prisma types
- **Silent failures** - Returns `null`/`[]` on access denial (prevents information leakage)

## Core Function

### `getContext()`

Creates an access-controlled context for database operations.

```typescript
import { getContext } from '@opensaas/stack-core/context'

const context = await getContext(config, prisma, session, storage)
```

**Type Signature:**
```typescript
function getContext<
  TConfig extends OpenSaasConfig,
  TPrisma extends PrismaClientLike
>(
  config: TConfig,
  prisma: TPrisma,
  session: Session,
  storage?: StorageUtils,
  _isSudo?: boolean
): {
  db: AccessControlledDB<TPrisma>
  session: Session
  prisma: TPrisma
  storage: StorageUtils
  serverAction: (props: ServerActionProps) => Promise<unknown>
  sudo: () => Context
  _isSudo: boolean
}
```

#### Parameters

##### `config` (required)

Your OpenSaaS configuration object.

**Type:** `OpenSaasConfig`

**Example:**
```typescript
import config from './opensaas.config'

const context = await getContext(config, prisma, session)
```

##### `prisma` (required)

Your Prisma client instance. Pass as generic for type safety.

**Type:** `TPrisma extends PrismaClientLike`

**Example:**
```typescript
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const context = await getContext(config, prisma, session)
```

##### `session` (required)

Current user session or `null` for anonymous access.

**Type:** `Session | null`

**Session Type:**
```typescript
type Session = {
  userId?: string
  [key: string]: unknown
} | null
```

**Example:**
```typescript
// With authentication
const session = { userId: 'user-123', role: 'admin' }
const context = await getContext(config, prisma, session)

// Anonymous (no authentication)
const context = await getContext(config, prisma, null)
```

##### `storage` (optional)

Storage utilities for file/image uploads.

**Type:** `StorageUtils`

**Default:** Throws error when storage operations are attempted

**Example:**
```typescript
import { createStorageUtils } from '@opensaas/stack-storage'

const storage = createStorageUtils(config.storage)
const context = await getContext(config, prisma, session, storage)
```

##### `_isSudo` (optional, internal)

Internal flag for sudo mode. Do not set manually - use `context.sudo()` instead.

**Type:** `boolean`
**Default:** `false`

#### Return Value

Returns a context object with the following properties:

##### `db`

Access-controlled database interface with full Prisma type inference.

**Type:** `AccessControlledDB<TPrisma>`

**Available Operations:**
- `findUnique(args)` - Find single record by unique field
- `findMany(args)` - Find multiple records with filtering
- `create(args)` - Create new record
- `update(args)` - Update existing record
- `delete(args)` - Delete record
- `count(args)` - Count records

**Example:**
```typescript
// Query posts (access control enforced)
const posts = await context.db.post.findMany({
  where: { status: 'published' }
})

// Create post (access control + hooks)
const post = await context.db.post.create({
  data: {
    title: 'My Post',
    content: 'Post content...'
  }
})
```

##### `session`

Current user session (same as input parameter).

**Type:** `Session | null`

**Example:**
```typescript
if (context.session?.userId) {
  console.log('User is authenticated:', context.session.userId)
}
```

##### `prisma`

Raw Prisma client (bypasses access control - use with caution).

**Type:** `TPrisma`

**Warning:** Using `context.prisma` directly bypasses all access control. Only use when necessary and ensure proper authorization.

**Example:**
```typescript
// Direct Prisma access (bypasses access control)
const count = await context.prisma.post.count()
```

##### `storage`

Storage utilities for file/image operations.

**Type:** `StorageUtils`

**Methods:**
- `uploadFile(provider, file, buffer, options)` - Upload file
- `uploadImage(provider, file, buffer, options)` - Upload image with transformations
- `deleteFile(provider, filename)` - Delete file
- `deleteImage(metadata)` - Delete image and transformations

**Example:**
```typescript
const metadata = await context.storage.uploadImage(
  'avatars',
  file,
  buffer,
  { transformations: { thumbnail: { width: 150, height: 150 } } }
)
```

##### `serverAction()`

Generic server action handler for Next.js Server Actions.

**Type:** `(props: ServerActionProps) => Promise<unknown>`

**Props:**
```typescript
type ServerActionProps =
  | { listKey: string; action: 'create'; data: Record<string, unknown> }
  | { listKey: string; action: 'update'; id: string; data: Record<string, unknown> }
  | { listKey: string; action: 'delete'; id: string }
```

**Example:**
```typescript
'use server'

async function handleAction(formData: FormData) {
  const context = await getContext(config, prisma, session)

  return await context.serverAction({
    listKey: 'Post',
    action: 'create',
    data: {
      title: formData.get('title'),
      content: formData.get('content')
    }
  })
}
```

##### `sudo()`

Creates a new context with access control bypassed.

**Type:** `() => Context`

**Important:** Sudo mode bypasses access control but still executes hooks and validation.

**Example:**
```typescript
const adminContext = context.sudo()

// Can access all records regardless of access rules
const allPosts = await adminContext.db.post.findMany()
```

##### `_isSudo`

Flag indicating if context is in sudo mode.

**Type:** `boolean`

**Example:**
```typescript
if (context._isSudo) {
  console.log('Running in sudo mode - access control bypassed')
}
```

---

## Generated Context Factory

The stack automatically generates a context factory at `.opensaas/context.ts` that simplifies context creation in your application.

### Generated `getContext()`

```typescript
import { getContext } from '@/.opensaas/context'

// Anonymous access
const context = await getContext()

// With session
const context = await getContext({ userId: 'user-123' })
```

**Generated Implementation:**
```typescript
import { getContext as coreGetContext } from '@opensaas/stack-core/context'
import { PrismaClient } from '@prisma/client'
import config from '../opensaas.config'

// Singleton Prisma client
const prisma = globalThis.prisma || new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma

export async function getContext(session: Session = null) {
  return coreGetContext(config, prisma, session)
}
```

---

## Database Operations

All database operations are access-controlled and execute hooks in the correct order.

### `findUnique()`

Find a single record by unique field (typically ID).

**Signature:**
```typescript
db[listKey].findUnique(args: {
  where: { id: string }
  include?: Record<string, unknown>
}): Promise<Item | null>
```

**Parameters:**
- `where` - Unique field filter (e.g., `{ id: '...' }`)
- `include` - Optional relationships to include

**Returns:** Record or `null` if not found or access denied

**Access Control:**
- Checks `operation.query` access
- Applies field-level read access
- Returns `null` on access denial (silent failure)

**Hooks Executed:**
1. Field-level `resolveOutput` (transforms output values)
2. Field-level `afterOperation` (side effects)

**Example:**
```typescript
const post = await context.db.post.findUnique({
  where: { id: 'post-123' }
})

if (!post) {
  // Either doesn't exist OR user doesn't have access
  return { error: 'Post not found' }
}
```

**With Relationships:**
```typescript
const post = await context.db.post.findUnique({
  where: { id: 'post-123' },
  include: { author: true }
})
```

---

### `findMany()`

Find multiple records with optional filtering, pagination, and relationships.

**Signature:**
```typescript
db[listKey].findMany(args?: {
  where?: Record<string, unknown>
  take?: number
  skip?: number
  include?: Record<string, unknown>
}): Promise<Item[]>
```

**Parameters:**
- `where` - Filter conditions (merged with access filters)
- `take` - Maximum number of records to return
- `skip` - Number of records to skip (for pagination)
- `include` - Relationships to include

**Returns:** Array of records (empty array `[]` if none found or access denied)

**Access Control:**
- Checks `operation.query` access
- Merges access filters with user's `where` clause
- Applies field-level read access
- Returns `[]` on access denial (silent failure)

**Hooks Executed:**
1. Field-level `resolveOutput` for each record
2. Field-level `afterOperation` for each record

**Example:**
```typescript
// All published posts
const posts = await context.db.post.findMany({
  where: { status: 'published' }
})

// With pagination
const posts = await context.db.post.findMany({
  where: { status: 'published' },
  take: 10,
  skip: 20
})

// With relationships
const posts = await context.db.post.findMany({
  where: { status: 'published' },
  include: { author: true, comments: true }
})
```

---

### `create()`

Create a new record with full validation, access control, and hooks.

**Signature:**
```typescript
db[listKey].create(args: {
  data: Record<string, unknown>
}): Promise<Item | null>
```

**Parameters:**
- `data` - Field values for the new record

**Returns:** Created record or `null` if access denied

**Access Control:**
- Checks `operation.create` access
- Applies field-level create access
- Returns `null` on access denial (silent failure)

**Hooks Executed (in order):**
1. List-level `resolveInput` - Transform input data
2. Field-level `resolveInput` - Transform field values (e.g., hash passwords)
3. List-level `validateInput` - Custom validation
4. Field validation - Built-in rules (isRequired, length, min/max)
5. Field-level create access - Filter writable fields
6. Field-level `beforeOperation` - Side effects before write
7. List-level `beforeOperation` - Side effects before write
8. **Database create operation**
9. List-level `afterOperation` - Side effects after write
10. Field-level `afterOperation` - Side effects after write
11. Field-level read access - Filter readable fields
12. Field-level `resolveOutput` - Transform output values

**Example:**
```typescript
const post = await context.db.post.create({
  data: {
    title: 'My First Post',
    content: 'This is the content...',
    status: 'draft'
  }
})

if (!post) {
  return { error: 'Access denied' }
}
```

**With Validation Errors:**
```typescript
try {
  const post = await context.db.post.create({
    data: { title: '' } // Empty title (required field)
  })
} catch (error) {
  if (error instanceof ValidationError) {
    console.log(error.errors) // [{ field: 'title', message: 'Title is required' }]
  }
}
```

---

### `update()`

Update an existing record with full validation, access control, and hooks.

**Signature:**
```typescript
db[listKey].update(args: {
  where: { id: string }
  data: Record<string, unknown>
}): Promise<Item | null>
```

**Parameters:**
- `where` - Unique field to identify record
- `data` - Fields to update (partial update)

**Returns:** Updated record or `null` if not found or access denied

**Access Control:**
- Fetches existing record first
- Checks `operation.update` access (with access to existing item)
- Applies field-level update access
- Returns `null` on access denial (silent failure)

**Hooks Executed (in order):**
1. List-level `resolveInput` - Transform input data
2. Field-level `resolveInput` - Transform field values
3. List-level `validateInput` - Custom validation
4. Field validation - Built-in rules
5. Field-level update access - Filter writable fields
6. Field-level `beforeOperation` - Side effects before write
7. List-level `beforeOperation` - Side effects before write
8. **Database update operation**
9. List-level `afterOperation` - Side effects after write
10. Field-level `afterOperation` - Side effects after write
11. Field-level read access - Filter readable fields
12. Field-level `resolveOutput` - Transform output values

**Example:**
```typescript
const post = await context.db.post.update({
  where: { id: 'post-123' },
  data: {
    status: 'published',
    publishedAt: new Date()
  }
})

if (!post) {
  // Either doesn't exist OR user doesn't have access
  return { error: 'Access denied or not found' }
}
```

**Partial Updates:**
```typescript
// Only update title (other fields unchanged)
const post = await context.db.post.update({
  where: { id: 'post-123' },
  data: { title: 'Updated Title' }
})
```

---

### `delete()`

Delete an existing record with access control and hooks.

**Signature:**
```typescript
db[listKey].delete(args: {
  where: { id: string }
}): Promise<Item | null>
```

**Parameters:**
- `where` - Unique field to identify record

**Returns:** Deleted record or `null` if not found or access denied

**Access Control:**
- Fetches existing record first
- Checks `operation.delete` access (with access to existing item)
- Returns `null` on access denial (silent failure)

**Hooks Executed (in order):**
1. Field-level `beforeOperation` - Side effects before delete
2. List-level `beforeOperation` - Side effects before delete
3. **Database delete operation**
4. List-level `afterOperation` - Side effects after delete
5. Field-level `afterOperation` - Side effects after delete (e.g., cleanup files)

**Example:**
```typescript
const post = await context.db.post.delete({
  where: { id: 'post-123' }
})

if (!post) {
  return { error: 'Access denied or not found' }
}
```

**Use Case - Cleanup:**
```typescript
// Field hook automatically cleans up files
thumbnail: text({
  hooks: {
    afterOperation: async ({ operation, value }) => {
      if (operation === 'delete' && value) {
        await deleteFromStorage(value)
      }
    }
  }
})
```

---

### `count()`

Count records with optional filtering and access control.

**Signature:**
```typescript
db[listKey].count(args?: {
  where?: Record<string, unknown>
}): Promise<number>
```

**Parameters:**
- `where` - Optional filter conditions (merged with access filters)

**Returns:** Number of matching records (returns `0` if access denied)

**Access Control:**
- Checks `operation.query` access
- Merges access filters with user's `where` clause
- Returns `0` on access denial (silent failure)

**Example:**
```typescript
// Count all published posts
const count = await context.db.post.count({
  where: { status: 'published' }
})

// Count all posts (respects access control)
const totalCount = await context.db.post.count()
```

---

## Sudo Mode

Sudo mode creates a context that bypasses access control while still executing hooks and validation.

### When to Use Sudo Mode

1. **Admin operations** - System-level operations that need unrestricted access
2. **Background jobs** - Scheduled tasks that process data regardless of user permissions
3. **Migrations** - Data migrations that need to access all records
4. **Internal operations** - Server-side operations that shouldn't be restricted by user permissions

### Creating Sudo Context

```typescript
const adminContext = context.sudo()
```

### What Sudo Mode Does

**Bypasses:**
- Operation-level access control (query, create, update, delete)
- Field-level access control (read, create, update)

**Still Executes:**
- All hooks (resolveInput, validateInput, beforeOperation, afterOperation)
- Field validation (isRequired, length, min, max)
- Field transformations (password hashing, etc.)

### Example Usage

```typescript
// Regular context - restricted by access control
const userPosts = await context.db.post.findMany()
// Returns only posts the user can access

// Sudo context - unrestricted access
const sudoContext = context.sudo()
const allPosts = await sudoContext.db.post.findMany()
// Returns ALL posts regardless of access rules

// Still validates and executes hooks
const post = await sudoContext.db.post.create({
  data: {
    title: '', // ValidationError - still validates
    password: 'plain' // Still hashes password
  }
})
```

### Security Warning

⚠️ **Important:** Sudo mode should only be used in trusted server-side code. Never expose sudo operations to client-facing APIs without proper authorization checks.

```typescript
// ❌ BAD - Never do this
export async function deleteAnyPost(id: string) {
  const context = await getContext()
  return await context.sudo().db.post.delete({ where: { id } })
}

// ✅ GOOD - Check permissions first
export async function deletePostAsAdmin(id: string) {
  const context = await getContext()

  if (context.session?.role !== 'admin') {
    throw new Error('Admin access required')
  }

  // Safe to use sudo after verifying admin role
  return await context.sudo().db.post.delete({ where: { id } })
}
```

---

## Silent Failures

OpenSaaS Stack uses silent failures to prevent information leakage about the existence of records.

### Why Silent Failures?

When access is denied, returning explicit errors can reveal:
- Whether a record exists
- What fields it has
- Information about the data structure

Silent failures prevent this by returning the same result whether:
1. Record doesn't exist
2. User doesn't have access
3. Access rule filtered out the record

### Behavior by Operation

| Operation | Access Denied Returns |
|-----------|----------------------|
| `findUnique()` | `null` |
| `findMany()` | `[]` (empty array) |
| `create()` | `null` |
| `update()` | `null` |
| `delete()` | `null` |
| `count()` | `0` |

### Handling Silent Failures

Always check for `null` or empty results:

```typescript
const post = await context.db.post.update({
  where: { id },
  data: { title: 'New Title' }
})

if (!post) {
  // Could be: doesn't exist, access denied, or filtered by access rule
  return { error: 'Unable to update post' }
}
```

### When to Use Explicit Errors

If you need to distinguish between "not found" and "access denied", use sudo mode to check existence:

```typescript
const post = await context.db.post.findUnique({ where: { id } })

if (!post) {
  // Check if it exists at all
  const exists = await context.sudo().db.post.findUnique({ where: { id } })

  if (!exists) {
    return { error: 'Post not found' }
  } else {
    return { error: 'Access denied' }
  }
}
```

---

## Type Safety

The context provides full TypeScript type inference from your Prisma schema.

### Inferred Types

```typescript
// Type: Post | null
const post = await context.db.post.findUnique({
  where: { id: 'post-123' }
})

// Type: Post[]
const posts = await context.db.post.findMany()

// TypeScript knows available fields
if (post) {
  console.log(post.title) // ✅ Type: string
  console.log(post.invalidField) // ❌ TypeScript error
}
```

### Generic Context

Pass Prisma client as generic for full type safety:

```typescript
import { PrismaClient } from '@prisma/client'
import { getContext } from '@opensaas/stack-core/context'

const prisma = new PrismaClient()

// Full type inference for all operations
const context = getContext<typeof config, typeof prisma>(
  config,
  prisma,
  session
)
```

---

## Best Practices

### 1. Always Use Context (Not Raw Prisma)

```typescript
// ✅ Good: Uses context (access control enforced)
const posts = await context.db.post.findMany()

// ❌ Bad: Bypasses access control
const posts = await context.prisma.post.findMany()
```

### 2. Check for Null/Empty Results

```typescript
// ✅ Good: Handles silent failures
const post = await context.db.post.update({ where: { id }, data })
if (!post) {
  return { error: 'Unable to update post' }
}

// ❌ Bad: Assumes success
const post = await context.db.post.update({ where: { id }, data })
console.log(post.title) // Potential runtime error if null
```

### 3. Use Sudo Mode Sparingly

```typescript
// ✅ Good: Sudo only when necessary
async function adminCleanup() {
  if (session?.role !== 'admin') {
    throw new Error('Admin only')
  }

  const context = await getContext()
  return await context.sudo().db.post.deleteMany()
}

// ❌ Bad: Unnecessary sudo usage
async function getUserPosts(userId: string) {
  const context = await getContext()
  return await context.sudo().db.post.findMany() // Should use regular context
}
```

### 4. Validate Input Before Operations

```typescript
// ✅ Good: Validate input
async function createPost(data: unknown) {
  const validated = postSchema.parse(data)
  return await context.db.post.create({ data: validated })
}

// ❌ Bad: No validation
async function createPost(data: any) {
  return await context.db.post.create({ data })
}
```

### 5. Use Generated Context Factory

```typescript
// ✅ Good: Use generated factory
import { getContext } from '@/.opensaas/context'
const context = await getContext(session)

// ❌ Bad: Manually create context each time
import { getContext as coreGetContext } from '@opensaas/stack-core/context'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const context = coreGetContext(config, prisma, session)
```

---

## Error Handling

### Validation Errors

```typescript
import { ValidationError } from '@opensaas/stack-core'

try {
  const post = await context.db.post.create({
    data: { title: '' }
  })
} catch (error) {
  if (error instanceof ValidationError) {
    console.log('Validation failed:', error.errors)
    // [{ field: 'title', message: 'Title is required' }]

    console.log('Field errors:', error.fieldErrors)
    // { title: ['Title is required'] }
  }
}
```

### Access Denial (Silent)

```typescript
const post = await context.db.post.update({
  where: { id },
  data: { title: 'New Title' }
})

if (!post) {
  // Silent failure - could be access denied or not found
  return { error: 'Unable to update post' }
}
```

### Database Errors

```typescript
try {
  const post = await context.db.post.create({
    data: { /* ... */ }
  })
} catch (error) {
  // Prisma errors (unique constraint, foreign key, etc.)
  console.error('Database error:', error)
}
```

---

## Next Steps

- **[Config API](/docs/api-reference/config)** - Configuration options
- **[Field Types API](/docs/api-reference/fields)** - Field configuration
- **[Access Control](/docs/core-concepts/access-control)** - Security patterns
- **[Hooks](/docs/core-concepts/hooks)** - Data transformation
- **[Generators](/docs/core-concepts/generators)** - Code generation
