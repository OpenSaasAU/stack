# Access Control

The access-control engine is why Stack exists. Application code — yours or your AI agent's — never talks to the database directly; it talks to a secured context, and the engine applies your access rules to **every** query, create, update, and delete. Security stops being a property of each handler someone remembered to write and becomes a property of the framework: the secure path is the only path.

## Overview

Every operation goes through the context wrapper, and every context operation passes access control before anything is returned.

```typescript
// Instead of using Prisma directly
const posts = await prisma.post.findMany()

// Use the context (which includes access control)
const posts = await context.db.post.findMany()
```

Two defaults set the tone:

- **Deny by default.** A list with no access rules isn't open — it's inaccessible. Nothing ships readable by accident.
- **Silent failure.** A denied operation returns `null` (single record) or `[]` (many), indistinguishable from "not found" — so callers can't probe for records they aren't allowed to see.

## How It Works

Writes check operation-level access, filter writable fields, then persist. Reads are a **two-phase** pipeline:

1. **Access Filter** (pre-query): the engine evaluates operation-level `query` access and merges the resulting filter into the Prisma `where`/`include` — rows and relations a session can't see never leave the database. This only runs for relations the caller actually asked for, one hop at a time: a read with no `include` fetches the row's own columns and computed fields only, matching Prisma's own semantics, and naming a relation fetches that relation's own columns and stops — reaching further means naming further in the `include`. A relation nobody named never has its list's `query` access evaluated at all. See [Queries & projections](/docs/concepts/queries).
2. **Field Visibility** (post-query): on the returned rows, fields the session can't read are removed, `resolveOutput` hooks run, and virtual fields are computed.

In order:

1. **Define access rules** in your `opensaas.config.ts`
2. **Operations go through context** wrapper: `context.db.post.update()`
3. **Access control engine checks** operation-level access
4. **Access filters are merged** with Prisma where clauses
5. **Field-level access** controls which fields are readable/writable
6. **Operations return** `null` or `[]` on access denial (silent failures)

## Access Control Types

### Operation-Level Access

Controls whether a user can perform an operation at all:

```typescript
Post: list({
  access: {
    operation: {
      query: true, // Anyone can query
      create: ({ session }) => !!session?.userId, // Must be signed in
      update: isAuthor, // Only author can update
      delete: isAdmin, // Only admins can delete
    },
  },
})
```

**Return Types:**

- **Boolean**: `true` (allow all) or `false` (deny all)
- **Prisma Filter**: Filter which records the user can access
- **Async Function**: All access functions can be async

### Filter-Based Access

Return a Prisma filter to scope which records a user can access:

```typescript
query: ({ session }) => {
  if (!session) {
    // Anonymous users only see published posts
    return { status: { equals: 'published' } }
  }

  // Authenticated users see published posts OR their own drafts
  return {
    OR: [{ status: { equals: 'published' } }, { authorId: { equals: session.userId } }],
  }
}
```

The filter is automatically merged with the operation's where clause.

### Field-Level Access

Control access to individual fields:

```typescript
fields: {
  internalNotes: text({
    access: {
      read: isAuthor, // Only author can read
      create: isSignedIn, // Any signed-in user can set
      update: isAuthor, // Only author can update
    },
  }),
  password: password({
    access: {
      read: false, // Never readable (automatically enforced)
    },
  }),
}
```

{% callout type="warning" %}
**Field-level rules are boolean-only.** An operation-level rule may return a Prisma filter to scope rows; a field-level rule decides allow/deny for one field (using `session` and, where available, the fetched `item`). Returning a filter from a field rule does not scope anything — don't reuse filter-returning helpers on fields.
{% /callout %}

## Access Functions

Access functions receive a context object with:

```typescript
interface AccessContext {
  session: Session | null // Current user session
  listKey: string // e.g., "Post"
  operation: 'query' | 'create' | 'update' | 'delete'
  originalInput?: any // The input data for create/update
  item?: any // The existing item for update/delete (includes all fields)
  context: Context // Full context for database queries
}
```

### Common Patterns

**Check if user is signed in:**

```typescript
const isSignedIn: AccessControl = ({ session }) => !!session?.userId
```

**Check if user is the author:**

```typescript
const isAuthor: AccessControl = ({ session, item }) => {
  if (!session?.userId) return false
  return item?.authorId === session.userId
}
```

**Check if user has a role:**

```typescript
const isAdmin: AccessControl = ({ session }) => {
  return session?.role === 'admin'
}
```

**Complex filter combining multiple conditions:**

```typescript
query: ({ session }) => ({
  AND: [
    { status: { equals: 'published' } },
    { visibility: { equals: 'public' } },
    {
      OR: [{ publishedAt: { lte: new Date() } }, { authorId: { equals: session?.userId } }],
    },
  ],
})
```

## Silent Failures

Stack returns `null` (for single records) or `[]` (for multiple records) when access is denied, rather than throwing errors. This prevents information leakage about whether records exist.

```typescript
const post = await context.db.post.findUnique({ where: { id: '123' } })

if (!post) {
  // Either:
  // 1. Post doesn't exist, OR
  // 2. User doesn't have access
  // The user can't tell which!
  return { error: 'Post not found' }
}
```

**Why silent failures?**

- Prevents information leakage
- Consistent API (no try/catch needed)
- Simpler application code
- Better security by default

## Nested `include` depth limit

The Access Filter — the pass that scopes relation `include`s before the database is queried — only scopes an `include` up to a fixed nesting depth (`READ_INCLUDE_MAX_DEPTH`, currently 5 hops from the list you queried). This is a cost limit, not an inability to scope: since the walk only ever follows branches a request itself names, there is no unscoped subtree to fail open on past the cap. If a caller-supplied `include` names a relation nested **past** that depth, the engine declines to serve a tree this expensive rather than serving it anyway, so it throws `AccessScopeDepthExceededError`:

```typescript
import { AccessScopeDepthExceededError } from '@opensaas/stack-core'

try {
  await context.db.post.findMany({
    include: { author: { include: {/* … nested 5+ levels deep */} } },
  })
} catch (err) {
  if (err instanceof AccessScopeDepthExceededError) {
    // err.listKey / err.fieldKey / err.depth identify where the include went too deep.
    // Restructure the query into separate, shallower reads instead.
  }
}
```

This only affects a caller-supplied `include` that explicitly reaches past the cap. An ordinary read with no `include` — or one that stays within the limit — is unaffected: the cap never turns a normal, shallow read into an error, and a schema deeper than the cap is still perfectly readable one hop at a time. See ADR-0022 for the full rationale.

## System Fields

Fields `id`, `createdAt`, `updatedAt` are automatically:

- Added to Prisma schema
- Excluded from access control (always readable)
- Excluded from field-level write operations

You cannot override access control for system fields.

## Nested `connect` is gated by the owning relationship field's access

When a write uses a nested `connect` (or the connect branch of `connectOrCreate`)
to link an existing related row, the connect is gated by the **owning relationship
field's create/update field-level access** (e.g. the `access` on `Post.author`),
evaluated for the enclosing write's operation. If that field's field-level access
denies the write, the connect is denied — exactly as for any other field on the
write. This gate receives the same `item` (the row being updated) and `inputData`
(the write payload) the parent write's field-access check uses, so a rule that
depends on either evaluates identically wherever the field is enforced.

For context, the connect is **also** gated by **read/query access on the target
list** (evaluated against the database): the caller must be able to _read_ the row
to connect it, because a connect references an existing row but does not modify its
data, so it requires read access on the target, not `update`. Both checks must pass
for a connect to succeed.

```typescript
lists: {
  Author: list({
    fields: { name: text() },
    access: {
      operation: {
        // Without a `query` rule, read access is DENY-BY-DEFAULT...
        update: () => true, // ...even though update is permissive.
      },
    },
  }),
  Post: list({
    fields: {
      title: text(),
      author: relationship({ ref: 'Author' }),
    },
    access: { operation: { query: () => true, update: () => true } },
  }),
}

// This nested connect is DENIED, because Author has no `query` rule
// (deny-by-default), even though Author's `update` is permissive:
await context.db.post.update({
  where: { id },
  data: { author: { connect: { id: authorId } } },
})
```

> **Behaviour change / migration note.** Because the access engine is
> **deny-by-default** for an undefined access rule, a related list that defines a
> permissive `update` but leaves `query` **undefined** now **denies** nested
> `connect` (previously such connects were allowed). This is the correct,
> read-gated direction and is consistent with how normal reads of that list
> already behave (they return empty). If you rely on connecting to such a list,
> **define a `query` rule** that permits the connect (for example a permissive
> `query: () => true` or a scoped filter). `sudo` bypasses the check entirely.

## Access Control Execution Order

For **write operations** (create/update):

1. List-level operation access check
2. Field-level write access check (filter writable fields)
3. Hook execution (resolveInput, validateInput, etc.)
4. Database operation
5. Field-level read access check (filter readable fields in response)

For **read operations** (query):

1. List-level operation access check
2. Merge access filters with where clause
3. Database operation
4. Field-level read access check (filter readable fields in response)

## Best Practices

### 1. Default to Restrictive

Start with restrictive access and open up as needed:

```typescript
access: {
  operation: {
    query: isSignedIn, // Require auth by default
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
}
```

### 2. Use Named Functions

Extract access functions for reusability:

```typescript
const isAuthor: AccessControl = ({ session, item }) => {
  return session?.userId === item?.authorId
}

const isAdminOrAuthor: AccessControl = ({ session, item }) => {
  if (session?.role === 'admin') return true
  return isAuthor({ session, item })
}
```

### 3. Always Check for Session

Guard against null sessions:

```typescript
update: ({ session, item }) => {
  if (!session?.userId) return false
  return item?.authorId === session.userId
}
```

### 4. Test Access Control

Always test your access rules with different user scenarios:

- Anonymous users
- Authenticated users
- Authors vs non-authors
- Admin vs regular users

## Advanced Patterns

### Conditional Field Access

Fields can have different access rules based on context:

```typescript
email: text({
  access: {
    read: ({ session, item }) => {
      // Users can read their own email, admins can read all emails
      if (session?.role === 'admin') return true
      return session?.userId === item?.id
    },
  },
})
```

### Cross-List Access Checks

Use the context to query other lists:

```typescript
delete: async ({ session, item, context }) => {
  // Check if user is org admin
  const membership = await context.db.orgMembership.findFirst({
    where: {
      userId: session?.userId,
      orgId: item?.orgId,
      role: 'admin',
    },
  })

  return !!membership
}
```

### Time-Based Access

```typescript
update: ({ session, item }) => {
  // Can only edit within 24 hours of creation
  const dayInMs = 24 * 60 * 60 * 1000
  const isRecent = Date.now() - item.createdAt.getTime() < dayInMs

  return session?.userId === item.authorId && isRecent
}
```

## Common Pitfalls

### Forgetting to Check Session

```typescript
// ❌ Bad: Doesn't check if session exists
update: ({ session, item }) => item.authorId === session.userId

// ✅ Good: Checks session exists first
update: ({ session, item }) => {
  if (!session?.userId) return false
  return item.authorId === session.userId
}
```

### Over-Permissive Defaults

```typescript
// ❌ Bad: Too permissive
access: {
  operation: {
    query: true,
    create: true, // Anyone can create!
  },
}

// ✅ Good: Explicit about permissions
access: {
  operation: {
    query: true,
    create: isSignedIn,
  },
}
```

### Not Testing Access Denial

Always test that access is denied when it should be:

```typescript
// Test that non-authors can't update
const post = await context.db.post.update({
  where: { id: postId },
  data: { title: 'New Title' },
})

// Should be null because user isn't the author
expect(post).toBe(null)
```

## Next Steps

- **[Hooks System](/docs/concepts/hooks)** - Add data transformation
- **[Field Types](/docs/concepts/field-types)** - Explore field options
- **[Context API](/docs/reference/context-api)** - Full context reference
- **[Anonymous & Pre-Account Access](/docs/how-to/anonymous-access-control)** - Keep pre-account and anonymous flows on the access-scoped context instead of `sudo()`
