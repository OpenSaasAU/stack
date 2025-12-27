---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Add automatic foreign key indexing for relationship fields (matching Keystone behavior)

Relationship fields now automatically generate `@@index` directives on their foreign key fields by default. This matches Keystone's behavior and prevents performance regression when migrating from Keystone.

**Default behavior (indexed):**

```typescript
author: relationship({ ref: 'User.posts' })
// Generates: @@index([authorId])
```

**Explicit control:**

```typescript
// Force indexing
author: relationship({ ref: 'User.posts', isIndexed: true })

// Unique constraint (for one-to-one)
author: relationship({ ref: 'User.posts', isIndexed: 'unique' })

// Disable indexing (not recommended)
author: relationship({ ref: 'User.posts', isIndexed: false })
```

This resolves the issue where migrations from Keystone would drop all foreign key indexes, causing performance degradation on queries filtering or joining on foreign keys.
